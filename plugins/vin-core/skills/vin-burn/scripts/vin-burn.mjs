#!/usr/bin/env node
// vin-burn: where your Claude Code tokens and money go, from local transcripts only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTranscripts, readTranscript, entriesToTurns } from './lib/parse.mjs'
import { aggregate, loadPricing } from './lib/aggregate.mjs'
import { renderText, renderCsv } from './lib/format.mjs'

const HELP = `vin-burn — token and cost lens for Claude Code (local, read-only)

Usage: vin-burn.mjs [period] [options]

Period (default: 7d):  today | yesterday | 7d | 30d | month | all | <N>d | <N>h
Options:
  --from YYYY-MM-DD      start date (local time), overrides period
  --to YYYY-MM-DD        end date, exclusive
  --project <text>       only folders whose path contains <text>
  --dir <folder>         transcripts folder (default: ~/.claude/projects)
  --pricing <file.json>  override or add model prices (USD per 1M tokens)
  --json                 print JSON instead of the report
  --csv <file>           also write a CSV (use - for stdout)
  --limit <n>            rows per table (default 8)
  --tz <IANA zone>       time zone for days (default: system)
  -h, --help             this help
`

export function parseArgs (argv) {
  const o = { period: '7d', limit: 8 }
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '--json') o.json = true
    else if (a === '--from') o.from = need(i, a), i++
    else if (a === '--to') o.to = need(i, a), i++
    else if (a === '--project') o.project = need(i, a), i++
    else if (a === '--dir') o.dir = need(i, a), i++
    else if (a === '--pricing') o.pricing = need(i, a), i++
    else if (a === '--csv') o.csv = need(i, a), i++
    else if (a === '--tz') o.tz = need(i, a), i++
    else if (a === '--limit') {
      o.limit = Number(need(i, a)); i++
      if (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > 500) throw new Error('--limit must be 1..500')
    } else if (!a.startsWith('-')) o.period = a
    else throw new Error(`unknown option ${a}`)
  }
  for (const k of ['from', 'to']) {
    if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error(`--${k} must be YYYY-MM-DD`)
  }
  if (o.tz) {
    try { new Intl.DateTimeFormat('en', { timeZone: o.tz }) } catch { throw new Error(`unknown time zone ${o.tz}`) }
  }
  return o
}

/** Turn a period word into [since, until) Dates relative to now. */
export function periodRange (period, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  if (period === 'all') return [null, null]
  if (period === 'today') return [today, null]
  if (period === 'yesterday') return [new Date(today.getTime() - 864e5), today]
  if (period === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), null]
  const m = /^(\d{1,4})([dh])$/.exec(period)
  if (m) {
    const n = Number(m[1])
    if (n < 1) throw new Error('period must be at least 1')
    return m[2] === 'h' ? [new Date(now.getTime() - n * 36e5), null] : [new Date(today.getTime() - (n - 1) * 864e5), null]
  }
  throw new Error(`unknown period "${period}" (today, yesterday, 7d, 30d, month, all, <N>d, <N>h)`)
}

async function main () {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('vin-burn: ' + e.message + '\n\n' + HELP); process.exit(2) }
  if (o.help) { process.stdout.write(HELP); return }
  const dir = o.dir || path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(dir)) { console.error(`vin-burn: no transcripts folder at ${dir}`); process.exit(2) }
  let since, until
  try {
    ;[since, until] = periodRange(o.period)
    if (o.from) since = new Date(o.from + 'T00:00:00')
    if (o.to) until = new Date(o.to + 'T00:00:00')
  } catch (e) { console.error('vin-burn: ' + e.message); process.exit(2) }

  let pricing
  try { pricing = loadPricing(o.pricing) } catch (e) { console.error('vin-burn: ' + e.message); process.exit(2) }

  const files = listTranscripts(dir)
  const turns = []
  let bad = 0
  for (const f of files) {
    // Skip files last written before the window starts: they cannot hold newer turns.
    if (since) { try { if (fs.statSync(f).mtimeMs < since.getTime()) continue } catch { continue } }
    const r = await readTranscript(f)
    bad += r.bad
    turns.push(...entriesToTurns(r.entries, f))
  }
  const agg = aggregate(turns, { pricing, since, until, project: o.project, timeZone: o.tz })
  const label = `${o.from || o.period}${o.to ? ' → ' + o.to : ''}${o.project ? '  project~' + o.project : ''}  (${files.length} transcript files${bad ? `, ${bad} unreadable lines skipped` : ''})`
  if (o.csv) {
    const csv = renderCsv(agg)
    if (o.csv === '-') process.stdout.write(csv)
    else fs.writeFileSync(o.csv, csv)
  }
  if (o.json) process.stdout.write(JSON.stringify({ period: label, ...agg }, null, 2) + '\n')
  else if (o.csv !== '-') process.stdout.write(renderText(agg, { limit: o.limit, useColor: process.stdout.isTTY && !process.env.NO_COLOR, header: label }) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('vin-burn.mjs')) {
  main().catch(e => { console.error('vin-burn: ' + (e && e.message ? e.message : e)); process.exit(1) })
}
