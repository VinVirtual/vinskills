// File discovery, the symbol index (cached by file size and mtime) and queries.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { extractSymbols, langOf, parseCtagsJson } from './extract.mjs'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.venv', 'venv', '__pycache__',
  'coverage', '.next', '.nuxt', 'target', '.build', 'Pods', 'DerivedData', '.cache', '.turbo', '.scratch'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 20000

/** Files to index: `git ls-files` inside a repository, else a walk that skips build folders. */
export function listSourceFiles (root) {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let files
  if (git.status === 0 && git.stdout) {
    files = git.stdout.split('\0').filter(Boolean).filter(f => !f.split('/').some(p => SKIP_DIRS.has(p)))
  } else {
    files = []
    const walk = (dir, rel) => {
      if (files.length >= MAX_FILES) return
      let ents
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name) } else if (e.isFile()) files.push(rel ? rel + '/' + e.name : e.name)
      }
    }
    walk(root, '')
  }
  return files.filter(f => langOf(f)).slice(0, MAX_FILES)
}

function cachePath (root) {
  const h = crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16)
  return path.join(os.tmpdir(), 'vin-navigator', h + '.json')
}

function hasCtags () {
  const r = spawnSync('ctags', ['--version'], { encoding: 'utf8' })
  return r.status === 0 && /Universal Ctags/.test(r.stdout) && /\+json/.test(r.stdout)
}

/**
 * Build or refresh the index. Returns { root, engine, files: {rel: {mtime,size,symbols}} }.
 * opts.engine: 'auto' | 'regex' | 'ctags'; opts.cache: false to skip the cache file.
 */
export function buildIndex (root, opts = {}) {
  const abs = path.resolve(root)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`not a folder: ${root}`)
  const engine = opts.engine === 'ctags' || (opts.engine !== 'regex' && hasCtags()) ? 'ctags' : 'regex'
  if (opts.engine === 'ctags' && !hasCtags()) throw new Error('Universal Ctags with JSON output is not installed')
  const cp = cachePath(abs)
  let cached = { files: {} }
  if (opts.cache !== false) { try { const c = JSON.parse(fs.readFileSync(cp, 'utf8')); if (c.engine === engine && c.root === abs) cached = c } catch {} }
  const files = listSourceFiles(abs)
  const out = { root: abs, engine, files: {} }
  const stale = []
  for (const rel of files) {
    let st
    try { st = fs.statSync(path.join(abs, rel)) } catch { continue }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue
    const prev = cached.files[rel]
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) out.files[rel] = prev
    else stale.push([rel, st])
  }
  if (engine === 'ctags' && stale.length) {
    const r = spawnSync('ctags', ['--output-format=json', '--fields=+neKS', '-f', '-', ...stale.map(([rel]) => rel)], { cwd: abs, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    const byFile = new Map()
    for (const s of parseCtagsJson(r.stdout || '')) { const { file, ...rest } = s; (byFile.get(file) || byFile.set(file, []).get(file)).push(rest) }
    for (const [rel, st] of stale) out.files[rel] = { mtime: st.mtimeMs, size: st.size, symbols: byFile.get(rel) || [] }
  } else {
    for (const [rel, st] of stale) {
      let text
      try { text = fs.readFileSync(path.join(abs, rel), 'utf8') } catch { continue }
      out.files[rel] = { mtime: st.mtimeMs, size: st.size, symbols: extractSymbols(text, langOf(rel)) }
    }
  }
  if (opts.cache !== false) {
    try { fs.mkdirSync(path.dirname(cp), { recursive: true, mode: 0o700 }); fs.writeFileSync(cp, JSON.stringify(out), { mode: 0o600 }) } catch {}
  }
  out.refreshed = stale.length
  return out
}

export function allSymbols (index) {
  const out = []
  for (const [file, f] of Object.entries(index.files)) for (const s of f.symbols) out.push({ file, ...s })
  return out
}

/** Name matching: exact, `Parent.name`, /regex/, or case-insensitive substring with --fuzzy. */
export function matcher (query, { fuzzy = false } = {}) {
  if (typeof query !== 'string' || !query) throw new Error('give a symbol name')
  if (query.length > 200) throw new Error('query too long')
  if (query.startsWith('/') && query.endsWith('/') && query.length > 2) {
    let re
    try { re = new RegExp(query.slice(1, -1)) } catch (e) { throw new Error('bad regex: ' + e.message) }
    return (s) => re.test(s.name)
  }
  if (query.includes('.') && !fuzzy) {
    const [parent, name] = [query.slice(0, query.lastIndexOf('.')), query.slice(query.lastIndexOf('.') + 1)]
    return (s) => s.name === name && s.parent === parent
  }
  if (fuzzy) { const q = query.toLowerCase(); return (s) => s.name.toLowerCase().includes(q) }
  return (s) => s.name === query
}

export function findDefinitions (index, query, opts = {}) {
  const m = matcher(query, opts)
  return allSymbols(index).filter(m).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

/** The innermost symbol whose range holds a line. */
export function enclosing (symbols, line) {
  let best = null
  for (const s of symbols) if (s.line <= line && line <= s.end && (!best || s.end - s.line <= best.end - best.line)) best = s
  return best
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word uses of a name, skipping its definition lines; each hit says which symbol it is inside. */
export function findReferences (index, name, { limit = 200 } = {}) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error('references need a plain identifier')
  const re = new RegExp(`(^|[^\\w$])${escapeRe(name)}(?![\\w$])`)
  const hits = []
  let total = 0
  for (const [file, f] of Object.entries(index.files)) {
    let text
    try { text = fs.readFileSync(path.join(index.root, file), 'utf8') } catch { continue }
    if (!text.includes(name)) continue
    const defLines = new Set(f.symbols.filter(s => s.name === name).map(s => s.line))
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i]) || defLines.has(i + 1)) continue
      total++
      if (hits.length < limit) {
        const inside = enclosing(f.symbols, i + 1)
        hits.push({ file, line: i + 1, in: inside ? (inside.parent ? inside.parent + '.' : '') + inside.name : '(top level)', text: lines[i].trim().slice(0, 200) })
      }
    }
  }
  return { hits, total }
}

/** Source text of a symbol, with line numbers, ready for an exact-match edit. */
export function symbolSource (index, sym, { context = 0, maxLines = 400 } = {}) {
  const text = fs.readFileSync(path.join(index.root, sym.file), 'utf8')
  const lines = text.split(/\r?\n/)
  const from = Math.max(1, sym.line - context)
  const to = Math.min(lines.length, sym.end + context, from + maxLines - 1)
  const body = []
  for (let n = from; n <= to; n++) body.push(String(n).padStart(5) + '  ' + lines[n - 1])
  return { from, to, cut: sym.end + context > to, text: body.join('\n') }
}
