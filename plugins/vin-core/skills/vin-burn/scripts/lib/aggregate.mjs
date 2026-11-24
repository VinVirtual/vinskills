// Prices and totals. All money is an estimate from list prices; nothing here calls a network.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyTask } from './classify.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RATE_KEYS = ['input', 'output', 'cache_write_5m', 'cache_write_1h', 'cache_read']

export function loadPricing (overridePath) {
  const base = JSON.parse(fs.readFileSync(path.join(HERE, 'pricing.json'), 'utf8')).models
  const table = { ...base }
  if (overridePath) {
    let extra
    try { extra = JSON.parse(fs.readFileSync(overridePath, 'utf8')) } catch (e) {
      throw new Error(`could not read pricing file ${overridePath}: ${e.message}`)
    }
    const models = extra && typeof extra === 'object' && extra.models ? extra.models : extra
    if (!models || typeof models !== 'object') throw new Error('pricing file must be {"models": {"<model>": {...}}}')
    for (const [name, rates] of Object.entries(models)) {
      if (!rates || typeof rates !== 'object') throw new Error(`pricing for ${name} must be an object`)
      for (const k of Object.keys(rates)) {
        if (!RATE_KEYS.includes(k)) throw new Error(`unknown rate "${k}" for ${name} (use ${RATE_KEYS.join(', ')})`)
        if (!Number.isFinite(rates[k]) || rates[k] < 0) throw new Error(`rate ${name}.${k} must be a number >= 0`)
      }
      table[name] = { ...(table[name] || {}), ...rates }
    }
  }
  return table
}

/** Find rates for a model id: exact, then without a date suffix, then longest known prefix. */
export function ratesFor (model, table) {
  if (!model) return null
  if (table[model]) return { name: model, rates: table[model] }
  const undated = model.replace(/-\d{8}$/, '').replace(/@\d{8}$/, '')
  if (table[undated]) return { name: undated, rates: table[undated] }
  let best = null
  for (const k of Object.keys(table)) if (undated.startsWith(k) && (!best || k.length > best.length)) best = k
  return best ? { name: best, rates: table[best] } : null
}

export function costOf (usage, rates) {
  if (!rates) return 0
  const r = (k) => (Number.isFinite(rates[k]) ? rates[k] : 0)
  return (usage.input * r('input') + usage.output * r('output') + usage.cacheWrite5m * r('cache_write_5m') +
    usage.cacheWrite1h * r('cache_write_1h') + usage.cacheRead * r('cache_read')) / 1e6
}

const emptyTotals = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, cost: 0, turns: 0 })

function add (bucket, key, usage, cost) {
  const t = bucket.get(key) || emptyTotals()
  bucket.set(key, {
    input: t.input + usage.input,
    output: t.output + usage.output,
    cacheWrite5m: t.cacheWrite5m + usage.cacheWrite5m,
    cacheWrite1h: t.cacheWrite1h + usage.cacheWrite1h,
    cacheRead: t.cacheRead + usage.cacheRead,
    cost: t.cost + cost,
    turns: t.turns + 1
  })
}

export function localDay (iso, timeZone) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Short project label from a working folder: the last two path parts. */
export function projectLabel (cwd) {
  if (!cwd) return '(unknown)'
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || '/'
}

/**
 * Aggregate turns. opts: { pricing, since, until (ISO or Date), timeZone, project (substring) }
 * Returns plain objects sorted by cost, ready for printing or JSON.
 */
export function aggregate (turns, opts = {}) {
  const table = opts.pricing || loadPricing()
  const since = opts.since ? new Date(opts.since).getTime() : -Infinity
  const until = opts.until ? new Date(opts.until).getTime() : Infinity
  const tz = opts.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const kept = turns.filter(t => {
    const ms = new Date(t.timestamp).getTime()
    if (Number.isNaN(ms)) return since === -Infinity && until === Infinity
    if (ms < since || ms >= until) return false
    if (opts.project && !t.cwd.toLowerCase().includes(String(opts.project).toLowerCase())) return false
    return true
  })

  // Classify tasks first so every turn knows its category.
  const byTask = new Map()
  for (const t of kept) {
    const list = byTask.get(t.task) || []
    list.push(t)
    byTask.set(t.task, list)
  }
  const taskCategory = new Map()
  for (const [id, list] of byTask) taskCategory.set(id, classifyTask(list[0].prompt, list))

  const buckets = { day: new Map(), project: new Map(), model: new Map(), tool: new Map(), category: new Map() }
  const unpriced = new Map()
  const total = new Map()
  for (const t of kept) {
    const hit = ratesFor(t.model, table)
    if (!hit) unpriced.set(t.model, (unpriced.get(t.model) || 0) + 1)
    const cost = costOf(t.usage, hit && hit.rates)
    add(total, 'all', t.usage, cost)
    add(buckets.day, localDay(t.timestamp, tz), t.usage, cost)
    add(buckets.project, projectLabel(t.cwd), t.usage, cost)
    add(buckets.model, t.model, t.usage, cost)
    add(buckets.category, taskCategory.get(t.task), t.usage, cost)
    // A turn's cost is shared evenly between the tools it called; turns with no tool count as "(text)".
    const names = t.tools.length ? t.tools : ['(text)']
    const share = 1 / names.length
    for (const n of names) {
      add(buckets.tool, n, {
        input: t.usage.input * share,
        output: t.usage.output * share,
        cacheWrite5m: t.usage.cacheWrite5m * share,
        cacheWrite1h: t.usage.cacheWrite1h * share,
        cacheRead: t.usage.cacheRead * share
      }, cost * share)
    }
  }
  const rows = (m, sortKey = 'cost') => [...m.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => sortKey === 'key' ? a.key.localeCompare(b.key) : b.cost - a.cost || b.output - a.output)
  return {
    total: total.get('all') || emptyTotals(),
    tasks: byTask.size,
    byDay: rows(buckets.day, 'key'),
    byProject: rows(buckets.project),
    byModel: rows(buckets.model),
    byTool: rows(buckets.tool),
    byCategory: rows(buckets.category),
    unpriced: [...unpriced.entries()].map(([model, turns]) => ({ model, turns }))
  }
}
