// Symbol extraction without a parser: line patterns per language, then the end of each
// symbol from brace matching (C-like languages) or indentation (Python).
// It is a fast approximation; it is right for ordinary code and says "approx" when unsure.

export const LANGS = {
  js: ['.js', '.mjs', '.cjs', '.jsx'],
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  py: ['.py', '.pyi'],
  go: ['.go'],
  swift: ['.swift']
}

export function langOf (file) {
  const lower = file.toLowerCase()
  for (const [lang, exts] of Object.entries(LANGS)) if (exts.some(e => lower.endsWith(e))) return lang
  return null
}

const ID = '[A-Za-z_$][\\w$]*'
const JS_RULES = [
  ['class', new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`)],
  ['interface', new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?interface\\s+(${ID})`)],
  ['type', new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+(${ID})\\s*(?:<[^=]*>)?\\s*=`)],
  ['enum', new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID})`)],
  ['function', new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})\\s*[<(]`)],
  ['function', new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|${ID}\\s*=>)`)],
  ['const', new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=`)],
  ['method', new RegExp(`^\\s+(?:(?:public|private|protected|static|readonly|async|override|get|set)\\s+)*\\*?(${ID})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::\\s*[^{]+)?\\{\\s*$`)]
]
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try'])

const RULES = {
  js: JS_RULES,
  ts: JS_RULES,
  py: [
    ['class', new RegExp(`^(\\s*)class\\s+(${ID})`)],
    ['function', new RegExp(`^(\\s*)(?:async\\s+)?def\\s+(${ID})\\s*\\(`)],
    ['const', new RegExp(`^()([A-Z][A-Z0-9_]+)\\s*(?::[^=]+)?=`)]
  ],
  go: [
    ['method', new RegExp(`^func\\s+\\([^)]*\\)\\s*(${ID})\\s*[\\[(]`)],
    ['function', new RegExp(`^func\\s+(${ID})\\s*[\\[(]`)],
    ['type', new RegExp(`^type\\s+(${ID})\\s+(?:struct|interface|func|map|\\[|\\*|${ID})`)],
    ['const', new RegExp(`^(?:const|var)\\s+(${ID})\\b`)]
  ],
  swift: [
    ['class', new RegExp(`^\\s*(?:(?:public|private|fileprivate|internal|open|final)\\s+)*(?:class|actor)\\s+(${ID})`)],
    ['struct', new RegExp(`^\\s*(?:(?:public|private|fileprivate|internal)\\s+)*struct\\s+(${ID})`)],
    ['enum', new RegExp(`^\\s*(?:(?:public|private|fileprivate|internal|indirect)\\s+)*enum\\s+(${ID})`)],
    ['protocol', new RegExp(`^\\s*(?:(?:public|private|fileprivate|internal)\\s+)*protocol\\s+(${ID})`)],
    ['extension', new RegExp(`^\\s*(?:(?:public|private|fileprivate|internal)\\s+)*extension\\s+(${ID})`)],
    ['function', new RegExp(`^\\s*(?:@\\w+\\s+)*(?:(?:public|private|fileprivate|internal|open|static|class|override|mutating|final|nonisolated)\\s+)*func\\s+(${ID})`)]
  ]
}

/** Remove string literals and comments from one line so braces inside them are not counted. */
export function stripLine (line, lang, state) {
  let out = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    const two = line.slice(i, i + 2)
    if (state.block) {
      if (two === '*/') { state.block = false; i++ }
      continue
    }
    if (state.tmpl) {
      if (c === '\\') { i++; continue }
      if (c === '`') state.tmpl = false
      continue
    }
    if (lang !== 'py' && two === '/*') { state.block = true; i++; continue }
    if ((lang !== 'py' && two === '//') || (lang === 'py' && c === '#')) break
    if (c === '"' || c === "'" || (c === '`' && lang !== 'py' && lang !== 'swift')) {
      if (c === '`') { state.tmpl = true; continue }
      const q = c
      i++
      while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++ }
      out += '""'
      continue
    }
    out += c
  }
  return out
}

/** Line index (0-based) where a brace block that opens at or after `start` closes. */
export function braceEnd (lines, start, lang, maxScan = 5000) {
  const state = { block: false, tmpl: false }
  let depth = 0
  let opened = false
  for (let i = start; i < Math.min(lines.length, start + maxScan); i++) {
    const s = stripLine(lines[i], lang, state)
    for (const ch of s) {
      if (ch === '{') { depth++; opened = true } else if (ch === '}') depth--
    }
    if (opened && depth <= 0) return { end: i, approx: false }
    // A declaration with no body (type alias, interface method, `const x = 1`): ends where its statement ends.
    if (!opened && i > start && /^\s*$/.test(lines[i])) return { end: i - 1, approx: true }
    if (!opened && /;\s*$/.test(s)) return { end: i, approx: false }
    if (!opened && i - start > 40) return { end: start, approx: true }
  }
  return { end: opened ? Math.min(lines.length, start + maxScan) - 1 : start, approx: true }
}

/** Python: a block ends before the next non-blank line indented at or below the header. */
export function indentEnd (lines, start) {
  const indent = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length
  const base = indent(lines[start])
  let end = start
  let open = 0
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]
    open += (l.match(/[([{]/g) || []).length - (l.match(/[)\]}]/g) || []).length
    if (i > start && open <= 0 && l.trim() && !l.trim().startsWith('#') && indent(l) <= base && !/^\s*[)\]}]/.test(l)) break
    if (l.trim()) end = i
  }
  return { end, approx: false }
}

/** All symbols in one file's text. Lines are 1-based in the result. */
export function extractSymbols (text, lang) {
  const rules = RULES[lang]
  if (!rules) return []
  const lines = text.split(/\r?\n/)
  const out = []
  const stack = [] // enclosing containers: {name, end}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue
    while (stack.length && i > stack[stack.length - 1].end) stack.pop()
    for (const [kind, re] of rules) {
      const m = re.exec(line)
      if (!m) continue
      const name = lang === 'py' ? m[2] : m[1]
      if (kind === 'method' && (lang === 'js' || lang === 'ts') && (NOT_METHOD.has(name) || !stack.length)) continue
      if (kind === 'const' && stack.length && lang !== 'go') continue
      let k = kind
      if (lang === 'py' && kind === 'function' && m[1].length > 0 && stack.length) k = 'method'
      const { end, approx } = lang === 'py' ? indentEnd(lines, i) : braceEnd(lines, i, lang)
      const parent = stack.length ? stack[stack.length - 1].name : undefined
      out.push({ name, kind: k, line: i + 1, end: end + 1, parent, signature: line.trim().slice(0, 160), approx })
      if (['class', 'struct', 'enum', 'protocol', 'extension', 'interface'].includes(k)) stack.push({ name, end })
      break
    }
  }
  return out
}

/** Universal Ctags JSON lines → the same symbol shape. */
export function parseCtagsJson (text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let t
    try { t = JSON.parse(line) } catch { continue }
    if (t._type !== 'tag' || !t.name || !t.path || !t.line) continue
    out.push({
      file: t.path,
      name: t.name,
      kind: t.kind || 'symbol',
      line: t.line,
      end: t.end || t.line,
      parent: t.scope || undefined,
      signature: (t.pattern || '').replace(/^\/\^|\$\/$/g, '').trim().slice(0, 160),
      approx: !t.end
    })
  }
  return out
}
