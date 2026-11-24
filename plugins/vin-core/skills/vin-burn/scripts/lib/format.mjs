// Terminal, JSON and CSV output for an aggregate() result.

export function fmtTokens (n) {
  const v = Math.round(n)
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(v)
}

export const fmtCost = (c) => '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2))

const allTokens = (r) => r.input + r.output + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead

function bar (share, width = 16) {
  const n = Math.max(0, Math.min(width, Math.round(share * width)))
  return '█'.repeat(n) + '·'.repeat(width - n)
}

function table (title, rows, total, limit, color) {
  const lines = [color.bold(title)]
  const shown = rows.slice(0, limit)
  const w = Math.min(34, Math.max(8, ...shown.map(r => String(r.key).length)))
  for (const r of shown) {
    const label = String(r.key).length > w ? String(r.key).slice(0, w - 1) + '…' : String(r.key)
    const share = total.cost > 0 ? r.cost / total.cost : 0
    lines.push(`  ${label.padEnd(w)}  ${fmtCost(r.cost).padStart(9)}  ${bar(share)} ${(share * 100).toFixed(0).padStart(3)}%  ` +
      color.dim(`out ${fmtTokens(r.output).padStart(7)}  all ${fmtTokens(allTokens(r)).padStart(8)}  ${String(Math.round(r.turns)).padStart(5)} turns`))
  }
  if (rows.length > limit) lines.push(color.dim(`  … ${rows.length - limit} more`))
  return lines.join('\n')
}

export function renderText (agg, { limit = 8, useColor = false, header = '' } = {}) {
  const c = useColor
    ? { bold: s => `\x1b[1m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` }
    : { bold: s => s, dim: s => s }
  const t = agg.total
  const cacheIn = t.cacheRead + t.cacheWrite5m + t.cacheWrite1h + t.input
  const hit = cacheIn > 0 ? t.cacheRead / cacheIn : 0
  const out = [
    c.bold('vin-burn') + (header ? '  ' + header : ''),
    `  estimated cost ${c.bold(fmtCost(t.cost))}   turns ${t.turns}   tasks ${agg.tasks}`,
    `  input ${fmtTokens(t.input)}   output ${fmtTokens(t.output)}   cache write ${fmtTokens(t.cacheWrite5m + t.cacheWrite1h)}   cache read ${fmtTokens(t.cacheRead)}   cache hit ${(hit * 100).toFixed(0)}%`,
    '',
    table('By day', agg.byDay, t, 31, c),
    '',
    table('By project', agg.byProject, t, limit, c),
    '',
    table('By model', agg.byModel, t, limit, c),
    '',
    table('By task category', agg.byCategory, t, limit, c),
    '',
    table('By tool (turn cost split across the tools it called)', agg.byTool, t, limit, c)
  ]
  if (agg.unpriced.length) {
    out.push('', 'Not priced (tokens counted, cost 0): ' + agg.unpriced.map(u => `${u.model} (${u.turns} turns)`).join(', '))
    out.push('Add them with --pricing <file>.')
  }
  out.push('', c.dim('Costs are estimates from list prices in pricing.json, not your bill.'))
  return out.join('\n')
}

function csvCell (v) {
  const s = String(v)
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s
  return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe
}

export function renderCsv (agg) {
  const lines = ['group,key,cost_usd,input,output,cache_write_5m,cache_write_1h,cache_read,turns']
  const groups = { day: agg.byDay, project: agg.byProject, model: agg.byModel, category: agg.byCategory, tool: agg.byTool }
  for (const [g, rows] of Object.entries(groups)) {
    for (const r of rows) {
      lines.push([g, r.key, r.cost.toFixed(6), Math.round(r.input), Math.round(r.output), Math.round(r.cacheWrite5m),
        Math.round(r.cacheWrite1h), Math.round(r.cacheRead), Math.round(r.turns)].map(csvCell).join(','))
    }
  }
  return lines.join('\n') + '\n'
}
