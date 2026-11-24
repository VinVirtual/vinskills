#!/usr/bin/env node
// vin-nav: symbol-level navigation so you read a function, not a whole file.
import path from 'node:path'
import { buildIndex, findDefinitions, findReferences, symbolSource, allSymbols } from './lib/index.mjs'

const HELP = `vin-nav — find definitions and uses, read one symbol at a time

Usage: vin-nav.mjs <command> [args] [--root <dir>] [--json]

Commands:
  find <name>          where a symbol is defined (name, Parent.name, /regex/; --fuzzy for substring)
  show <name>          print a symbol's source with line numbers (--context <n>, --all for every match)
  refs <name>          whole-word uses outside the definition, with the enclosing symbol
  outline <file>       the symbols in one file with their line ranges
  map [--depth n]      files and their top-level symbols (a repo overview)
  stats                how many files and symbols were indexed, and with which engine

Options:
  --root <dir>         project folder (default: current folder)
  --engine auto|regex|ctags   default auto (Universal Ctags when installed)
  --no-cache           ignore and do not write the cache in $TMPDIR/vin-navigator
  --limit <n>          max results (default 50, refs 200)
  --json               machine-readable output
`

export function parseArgs (argv) {
  const o = { root: '.', engine: 'auto', cache: true, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '--root') o.root = next()
    else if (a === '--engine') { o.engine = next(); if (!['auto', 'regex', 'ctags'].includes(o.engine)) throw new Error('--engine must be auto, regex or ctags') }
    else if (a === '--no-cache') o.cache = false
    else if (a === '--json') o.json = true
    else if (a === '--fuzzy') o.fuzzy = true
    else if (a === '--all') o.all = true
    else if (a === '--limit' || a === '--context' || a === '--depth') {
      const n = Number(next())
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error(`${a} must be a whole number 0..10000`)
      o[a.slice(2)] = n
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
    else o.positional.push(a)
  }
  o.command = o.positional.shift()
  return o
}

const where = (s) => `${s.file}:${s.line}-${s.end}${s.approx ? '~' : ''}`
const label = (s) => `${s.kind} ${s.parent ? s.parent + '.' : ''}${s.name}`

function run (o) {
  const idx = buildIndex(o.root, { engine: o.engine, cache: o.cache })
  const say = (text, data) => process.stdout.write((o.json ? JSON.stringify(data, null, 2) : text) + '\n')
  const arg = o.positional[0]
  switch (o.command) {
    case 'find': {
      const defs = findDefinitions(idx, arg, { fuzzy: o.fuzzy }).slice(0, o.limit ?? 50)
      return say(defs.length ? defs.map(s => `${where(s).padEnd(40)} ${label(s)}\n    ${s.signature}`).join('\n') : `no definition of "${arg}" (try --fuzzy or refs)`, defs)
    }
    case 'show': {
      const defs = findDefinitions(idx, arg, { fuzzy: o.fuzzy })
      if (!defs.length) return say(`no definition of "${arg}"`, [])
      const pick = o.all ? defs.slice(0, o.limit ?? 10) : defs.slice(0, 1)
      const parts = pick.map(s => ({ ...s, ...symbolSource(idx, s, { context: o.context ?? 0 }) }))
      const more = !o.all && defs.length > 1 ? `\n(${defs.length - 1} more matches: ${defs.slice(1, 6).map(where).join(', ')}; use --all)` : ''
      return say(parts.map(p => `── ${label(p)}  ${where(p)}\n${p.text}${p.cut ? '\n  … (cut; read the file range to see the rest)' : ''}`).join('\n\n') + more, parts)
    }
    case 'refs': {
      const r = findReferences(idx, arg, { limit: o.limit ?? 200 })
      return say(r.hits.map(h => `${(h.file + ':' + h.line).padEnd(36)} in ${h.in.padEnd(24)} ${h.text}`).join('\n') +
        `\n${r.total} use(s)${r.total > r.hits.length ? `, ${r.hits.length} shown` : ''}`, r)
    }
    case 'outline': {
      if (!arg) throw new Error('outline needs a file')
      const rel = path.relative(idx.root, path.resolve(o.root, arg)).split(path.sep).join('/')
      const f = idx.files[rel] || idx.files[arg]
      if (!f) throw new Error(`not indexed: ${arg} (supported: .js .ts .py .go .swift)`)
      return say(f.symbols.map(s => `${String(s.line).padStart(5)}-${String(s.end).padEnd(5)} ${s.parent ? '  ' : ''}${label(s)}`).join('\n') || '(no symbols found)', f.symbols)
    }
    case 'map': {
      const depth = o.depth ?? 0
      const lines = []
      for (const [file, f] of Object.entries(idx.files).sort()) {
        const top = f.symbols.filter(s => depth > 0 || !s.parent)
        if (!top.length) continue
        lines.push(`${file}: ${top.slice(0, 15).map(s => s.name).join(', ')}${top.length > 15 ? ` …+${top.length - 15}` : ''}`)
      }
      return say(lines.join('\n'), Object.fromEntries(Object.entries(idx.files).map(([k, f]) => [k, f.symbols.map(s => s.name)])))
    }
    case 'stats': {
      const syms = allSymbols(idx)
      const data = { root: idx.root, engine: idx.engine, files: Object.keys(idx.files).length, symbols: syms.length, refreshed: idx.refreshed }
      return say(`${data.files} files, ${data.symbols} symbols, engine ${data.engine}, ${data.refreshed} files (re)indexed`, data)
    }
    default:
      throw new Error(o.command ? `unknown command ${o.command}` : 'give a command (see --help)')
  }
}

if (process.argv[1] && process.argv[1].endsWith('vin-nav.mjs')) {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('vin-nav: ' + e.message); process.exit(2) }
  if (o.help) process.stdout.write(HELP)
  else {
    try { run(o) } catch (e) { console.error('vin-nav: ' + e.message); process.exit(1) }
  }
}
