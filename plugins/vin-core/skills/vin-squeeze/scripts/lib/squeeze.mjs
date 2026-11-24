// Shrink logs, command output and JSON before it reaches a model's context.
// Rules: never drop an error line, say what was removed, keep the original on disk.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g
const IMPORTANT = /\b(error|errors|fatal|panic|exception|traceback|fail(ed|ure|s)?|assert(ion)?|warn(ing)?|denied|refused|timeout|timed out|not found|undefined|segfault|killed|abort(ed)?|critical)\b|✗|✘|ERR!/i
const FRAME = /^\s+(at\s+\S|File ".*", line \d+|\S+\.(go|rs|java|kt|py|js|ts|mjs|cjs):\d+|#\d+\s+0x[0-9a-f]+|\.\.\. \d+ more)/

export const estimateTokens = (s) => Math.ceil(s.length / 4)

/** A line with numbers, hex ids, timestamps and quoted values replaced, for "same shape" grouping. */
export function lineShape (line) {
  return line
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b[0-9a-f]{7,64}\b/gi, '<hex>')
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb|gb|%)?\b/gi, '<n>')
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, '<str>')
    .trim()
}

/** Collapse runs of identical lines into one line with a count. */
export function collapseRuns (lines) {
  const out = []
  for (let i = 0; i < lines.length;) {
    let j = i + 1
    while (j < lines.length && lines[j] === lines[i]) j++
    out.push(j - i > 1 ? `${lines[i]}  [×${j - i}]` : lines[i])
    i = j
  }
  return out
}

/** Shorten stack traces: keep the first `keep` frames and the last one. */
export function collapseFrames (lines, keep = 4) {
  const out = []
  for (let i = 0; i < lines.length;) {
    if (!FRAME.test(lines[i])) { out.push(lines[i]); i++; continue }
    let j = i
    while (j < lines.length && FRAME.test(lines[j])) j++
    const n = j - i
    if (n <= keep + 2) out.push(...lines.slice(i, j))
    else out.push(...lines.slice(i, i + keep), `    … ${n - keep - 1} more frames`, lines[j - 1])
    i = j
  }
  return out
}

/** Lines that share a shape with many others are shown once with a count (first example kept). */
export function groupByShape (lines, minRepeat = 4) {
  const counts = new Map()
  for (const l of lines) if (!IMPORTANT.test(l)) { const s = lineShape(l); counts.set(s, (counts.get(s) || 0) + 1) }
  const seen = new Set()
  const out = []
  for (const l of lines) {
    if (IMPORTANT.test(l)) { out.push(l); continue }
    const s = lineShape(l)
    const c = counts.get(s)
    if (c >= minRepeat && s.length > 0) {
      if (seen.has(s)) continue
      seen.add(s)
      out.push(`${l}  [+${c - 1} similar lines]`)
    } else out.push(l)
  }
  return out
}

/** Keep head, tail and every important line in between until the budget is met. */
export function fitLines (lines, maxChars, { head = 40, tail = 60 } = {}) {
  const size = (ls) => ls.reduce((a, l) => a + l.length + 1, 0)
  if (size(lines) <= maxChars) return lines
  const h = lines.slice(0, head)
  const t = lines.slice(Math.max(head, lines.length - tail))
  const middle = lines.slice(head, Math.max(head, lines.length - tail))
  const imp = []
  let dropped = 0
  for (const l of middle) {
    if (IMPORTANT.test(l)) imp.push(l)
    else dropped++
  }
  let res = [...h, ...(dropped ? [`… ${dropped} lines without errors or warnings removed …`] : []), ...imp, ...t]
  // Still too big: cut long lines, then thin the important list evenly.
  if (size(res) > maxChars) res = res.map(l => l.length > 400 ? l.slice(0, 380) + ` … (+${l.length - 380} chars)` : l)
  while (size(res) > maxChars && imp.length > 20) {
    imp.splice(10, Math.ceil((imp.length - 20) / 2), `… ${Math.ceil((imp.length - 20) / 2)} more error/warning lines in the original …`)
    res = [...h, `… ${dropped} lines removed …`, ...imp, ...t]
  }
  return res
}

export function squeezeText (text, opts = {}) {
  const maxChars = opts.maxChars ?? 12000
  let lines = text.replace(ANSI, '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''))
  lines = collapseRuns(lines)
  lines = collapseFrames(lines, opts.frames ?? 4)
  lines = groupByShape(lines, opts.minRepeat ?? 4)
  lines = collapseRuns(lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')))
  lines = fitLines(lines, maxChars)
  return lines.join('\n')
}

// ---------- JSON ----------

const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

/**
 * Describe a JSON value as one line per path: type, how often it is present,
 * array lengths, number ranges and, for enum-like strings, the values.
 *   $[].sha            string  ×30  30 distinct
 *   $[].commit.author  object  ×30
 */
export function describePaths (value, { maxPaths = 120, maxNodes = 200000 } = {}) {
  const stats = new Map()
  let nodes = 0
  const visit = (v, p, parentCount) => {
    if (++nodes > maxNodes) return
    let st = stats.get(p)
    if (!st) { st = { types: new Map(), n: 0, strs: new Map(), min: Infinity, max: -Infinity, lmin: Infinity, lmax: -Infinity }; stats.set(p, st) }
    st.n++
    const t = typeOf(v)
    st.types.set(t, (st.types.get(t) || 0) + 1)
    if (t === 'number') { st.min = Math.min(st.min, v); st.max = Math.max(st.max, v) }
    if (t === 'string' && st.strs.size <= 50) st.strs.set(v, (st.strs.get(v) || 0) + 1)
    if (t === 'array') {
      st.lmin = Math.min(st.lmin, v.length); st.lmax = Math.max(st.lmax, v.length)
      for (const x of v) visit(x, p + '[]')
    } else if (t === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, p + (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : `[${JSON.stringify(k)}]`))
    }
  }
  visit(value, '$')
  const lines = []
  const width = Math.min(48, Math.max(...[...stats.keys()].slice(0, maxPaths).map(k => k.length)))
  for (const [p, st] of [...stats.entries()].slice(0, maxPaths)) {
    const types = [...st.types.entries()].map(([t, c]) => st.types.size > 1 ? `${t}:${c}` : t).join('|')
    const bits = [types, `×${st.n}`]
    if (st.lmax >= 0 && st.lmin !== Infinity) bits.push(st.lmin === st.lmax ? `len ${st.lmin}` : `len ${st.lmin}..${st.lmax}`)
    if (st.min !== Infinity) bits.push(st.min === st.max ? `= ${st.min}` : `${st.min}..${st.max}`)
    const nStr = [...st.strs.values()].reduce((a, b) => a + b, 0)
    if (nStr) {
      const distinct = st.strs.size
      if (distinct <= 6 && (distinct < nStr / 2 || nStr === 1)) bits.push('values ' + [...st.strs.keys()].map(x => JSON.stringify(x.length > 40 ? x.slice(0, 40) + '…' : x)).join(', '))
      else bits.push(distinct > 50 ? '50+ distinct' : `${distinct} distinct`)
    }
    lines.push(`${p.length > width ? p : p.padEnd(width)}  ${bits.join('  ')}`)
  }
  if (stats.size > maxPaths) lines.push(`… ${stats.size - maxPaths} more paths`)
  if (nodes > maxNodes) lines.push(`… stopped after ${maxNodes} values`)
  return lines
}

/** Shorten a value for display: long strings cut, arrays sampled, depth limited. */
export function trimValue (v, { maxString = 160, maxItems = 3, depth = 0, maxDepth = 5 } = {}) {
  if (typeof v === 'string') return v.length > maxString ? v.slice(0, maxString) + `…(+${v.length - maxString})` : v
  if (Array.isArray(v)) {
    if (depth >= maxDepth) return `[array ${v.length}]`
    const shown = v.slice(0, maxItems).map(x => trimValue(x, { maxString, maxItems, depth: depth + 1, maxDepth }))
    if (v.length > maxItems) shown.push(`… ${v.length - maxItems} more items`)
    return shown
  }
  if (v && typeof v === 'object') {
    if (depth >= maxDepth) return `{object ${Object.keys(v).length} keys}`
    const o = {}
    for (const [k, x] of Object.entries(v)) o[k] = trimValue(x, { maxString, maxItems, depth: depth + 1, maxDepth })
    return o
  }
  return v
}

/** Find values worth keeping whole: anything under a key that looks like an error. */
export function findErrors (v, path = '$', out = [], limit = 20) {
  if (out.length >= limit || v === null || typeof v !== 'object') return out
  for (const [k, x] of Object.entries(v)) {
    const p = Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`
    if (/^(error|errors|err|exception|failure|failures|fault|warnings?)$/i.test(k) && x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && !x.length)) {
      out.push({ path: p, value: trimValue(x, { maxString: 500, maxItems: 5 }) })
    } else findErrors(x, p, out, limit)
    if (out.length >= limit) break
  }
  return out
}

export function squeezeJson (value, opts = {}) {
  const maxChars = opts.maxChars ?? 12000
  const full = JSON.stringify(value, null, 2)
  if (full.length <= maxChars) return full
  const errors = findErrors(value)
  const build = (maxPaths, items, maxString) => {
    const parts = ['JSON summarised by vin-squeeze (shape, counts, samples). The original file has everything.', '', 'Shape:']
    parts.push(...describePaths(value, { maxPaths }))
    if (errors.length) parts.push('', 'Error-like fields (kept whole):', JSON.stringify(errors, null, 1))
    if (items > 0) parts.push('', `Sample (first ${items} items of each array, long strings cut):`, JSON.stringify(trimValue(value, { maxItems: items, maxString }), null, 1))
    return parts.join('\n')
  }
  const samples = opts.samples ?? 3
  const attempts = [[120, samples, 160], [120, 1, 100], [60, 1, 60], [120, 0, 0], [40, 0, 0]]
  let out = ''
  for (const [paths, items, str] of attempts) {
    out = build(paths, items, str)
    if (out.length <= maxChars) return out
  }
  return out.slice(0, maxChars) + '\n… (summary cut at the size limit)'
}

/** Parse JSON or JSON Lines; returns undefined when it is neither. */
export function tryParseJson (text) {
  const t = text.trim()
  if (!t) return undefined
  if (t[0] === '{' || t[0] === '[') { try { return JSON.parse(t) } catch {} }
  const lines = t.split('\n').filter(Boolean)
  if (lines.length > 1 && lines.every(l => l.trim()[0] === '{')) {
    try { return lines.map(l => JSON.parse(l)) } catch {}
  }
  return undefined
}

export function squeeze (text, opts = {}) {
  const mode = opts.mode || 'auto'
  const parsed = mode === 'text' ? undefined : tryParseJson(text)
  if (mode === 'json' && parsed === undefined) throw new Error('input is not valid JSON or JSON Lines')
  const out = parsed !== undefined ? squeezeJson(parsed, opts) : squeezeText(text, opts)
  return { kind: parsed !== undefined ? 'json' : 'text', output: out, before: text.length, after: out.length }
}
