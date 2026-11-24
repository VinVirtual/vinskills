import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { skill, tmpdir, runNode, gitRepo } from './helpers.mjs'
import { extractSymbols, langOf, stripLine, braceEnd, indentEnd, parseCtagsJson } from '../plugins/vin-core/skills/vin-navigator/scripts/lib/extract.mjs'
import { buildIndex, findDefinitions, findReferences, symbolSource, matcher, enclosing, listSourceFiles } from '../plugins/vin-core/skills/vin-navigator/scripts/lib/index.mjs'
import { parseArgs } from '../plugins/vin-core/skills/vin-navigator/scripts/vin-nav.mjs'

const CLI = skill('vin-navigator', 'scripts/vin-nav.mjs')
const byName = (syms, n) => syms.find(s => s.name === n)

const TS = `import x from 'y'
export const LIMIT = 10
export interface Options {
  depth: number
}
export type Mode = 'a' | 'b'
export enum Color { Red, Green }
export async function load (path: string): Promise<string> {
  const s = "not a } brace"
  // } also not a brace
  return s
}
export const handler = async (req: Request) => {
  return \`template with } brace \${req.url}\`
}
export default class Store {
  private items: string[] = []
  add (item: string): void {
    if (item) {
      this.items.push(item)
    }
  }
  static create () {
    return new Store()
  }
}
function helper () { return load('x') }
`

test('langOf maps extensions', () => {
  assert.equal(langOf('a/b.tsx'), 'ts'); assert.equal(langOf('x.mjs'), 'js'); assert.equal(langOf('m.py'), 'py')
  assert.equal(langOf('main.go'), 'go'); assert.equal(langOf('App.swift'), 'swift'); assert.equal(langOf('README.md'), null)
})

test('TypeScript: functions, arrow functions, classes, methods, interfaces, types, enums, constants', () => {
  const s = extractSymbols(TS, 'ts')
  assert.equal(byName(s, 'LIMIT').kind, 'const')
  assert.equal(byName(s, 'Options').kind, 'interface')
  assert.deepEqual([byName(s, 'Options').line, byName(s, 'Options').end], [3, 5])
  assert.equal(byName(s, 'Mode').kind, 'type')
  assert.equal(byName(s, 'Color').kind, 'enum')
  assert.deepEqual([byName(s, 'load').line, byName(s, 'load').end], [8, 12])
  assert.deepEqual([byName(s, 'handler').kind, byName(s, 'handler').end], ['function', 15])
  assert.deepEqual([byName(s, 'Store').line, byName(s, 'Store').end], [16, 26])
  const add = byName(s, 'add')
  assert.deepEqual([add.kind, add.parent, add.line, add.end], ['method', 'Store', 18, 22])
  assert.equal(byName(s, 'create').parent, 'Store')
  assert.equal(byName(s, 'helper').line, 27)
  assert.equal(s.filter(x => x.name === 'if').length, 0)
})

test('stripLine removes strings and comments so braces inside them do not count', () => {
  const st = { block: false, tmpl: false }
  assert.equal(stripLine('const s = "a { b" // }', 'js', st), 'const s = "" ')
  assert.equal(stripLine("x = '}' # {", 'py', { block: false }), 'x = "" ')
  const st2 = { block: false, tmpl: false }
  stripLine('/* start {', 'js', st2)
  assert.equal(st2.block, true)
  assert.equal(stripLine('still } */ x {', 'js', st2), ' x {')
})

test('braceEnd handles one-line bodies and declarations without bodies', () => {
  assert.deepEqual(braceEnd(['function f () { return 1 }'], 0, 'js'), { end: 0, approx: false })
  assert.equal(braceEnd(['type A = string;', 'x'], 0, 'ts').end, 0)
})

test('Python: classes, methods by indentation, functions, constants, decorators and multi-line calls', () => {
  const py = [
    'MAX_SIZE = 10',
    '',
    'class Parser:',
    '    """Doc."""',
    '    def parse(self, text):',
    '        return call(',
    '            text,',
    ')',
    '',
    '    async def close(self):',
    '        pass',
    '',
    'def main():',
    '    p = Parser()',
    '    return p',
    ''
  ].join('\n')
  const s = extractSymbols(py, 'py')
  assert.equal(byName(s, 'MAX_SIZE').kind, 'const')
  assert.deepEqual([byName(s, 'Parser').line, byName(s, 'Parser').end], [3, 11])
  const parse = byName(s, 'parse')
  assert.deepEqual([parse.kind, parse.parent, parse.end], ['method', 'Parser', 8])
  assert.equal(byName(s, 'close').kind, 'method')
  assert.deepEqual([byName(s, 'main').kind, byName(s, 'main').end], ['function', 15])
})

test('indentEnd stops at the next line at the same level', () => {
  assert.equal(indentEnd(['def a():', '    x', 'def b():', '    y'], 0).end, 1)
})

test('Go: functions, methods, types, constants', () => {
  const go = ['package main', '', 'const Version = "1"', '', 'type Server struct {', '\taddr string', '}', '', 'func (s *Server) Start() error {', '\treturn nil', '}', '', 'func main() {', '\ts := &Server{}', '\ts.Start()', '}'].join('\n')
  const s = extractSymbols(go, 'go')
  assert.equal(byName(s, 'Version').kind, 'const')
  assert.deepEqual([byName(s, 'Server').kind, byName(s, 'Server').end], ['type', 7])
  assert.deepEqual([byName(s, 'Start').kind, byName(s, 'Start').line, byName(s, 'Start').end], ['method', 9, 11])
  assert.equal(byName(s, 'main').end, 16)
})

test('Swift: struct, class, protocol, extension, enum and funcs with modifiers', () => {
  const sw = ['import SwiftUI', 'protocol Loader { func load() }', 'public struct Item {', '  let id: Int', '}', 'final class Cache {', '  private static func make() -> Cache {', '    return Cache()', '  }', '}', 'extension Item {', '  mutating func bump() { }', '}', 'enum Mode { case a, b }', '@MainActor func boot() {', '}'].join('\n')
  const s = extractSymbols(sw, 'swift')
  assert.equal(byName(s, 'Loader').kind, 'protocol')
  assert.equal(byName(s, 'Item').kind, 'struct')
  assert.deepEqual([byName(s, 'make').parent, byName(s, 'make').end], ['Cache', 9])
  assert.equal(byName(s, 'bump').parent, 'Item')
  assert.equal(byName(s, 'Mode').kind, 'enum')
  assert.equal(byName(s, 'boot').kind, 'function')
})

test('unknown languages and very long lines are skipped', () => {
  assert.deepEqual(extractSymbols('fn main() {}', 'rust'), [])
  assert.deepEqual(extractSymbols('function ' + 'a'.repeat(3000) + '() {}', 'js'), [])
})

test('parseCtagsJson converts Universal Ctags JSON lines', () => {
  const out = parseCtagsJson([
    '{"_type": "tag", "name": "load", "path": "src/a.ts", "pattern": "/^export function load() {$/", "line": 8, "end": 12, "kind": "function"}',
    '{"_type": "ptag", "name": "JSON_OUTPUT_VERSION"}',
    'not json'
  ].join('\n'))
  assert.equal(out.length, 1)
  assert.deepEqual([out[0].file, out[0].line, out[0].end, out[0].signature], ['src/a.ts', 8, 12, 'export function load() {'])
})

function fixtureRepo () {
  const d = tmpdir()
  return gitRepo(d, {
    'src/store.ts': TS,
    'src/app.ts': "import Store, { load } from './store'\nexport function start () {\n  const s = Store.create()\n  return load('a')\n}\n",
    'tools/run.py': 'def load(x):\n    return x\n',
    'node_modules/dep/index.js': 'function load () {}\n',
    'README.md': '# load'
  })
}

test('listSourceFiles uses git and skips node_modules and unsupported files', () => {
  const files = listSourceFiles(fixtureRepo()).sort()
  assert.deepEqual(files, ['src/app.ts', 'src/store.ts', 'tools/run.py'])
})

test('find, refs, show and enclosing over a repository', () => {
  const idx = buildIndex(fixtureRepo(), { engine: 'regex', cache: false })
  const defs = findDefinitions(idx, 'load')
  assert.deepEqual(defs.map(d => d.file), ['src/store.ts', 'tools/run.py'])
  assert.equal(findDefinitions(idx, 'Store.add').length, 1)
  assert.equal(findDefinitions(idx, '/^hel/').length, 1)
  assert.ok(findDefinitions(idx, 'STORE', { fuzzy: true }).length >= 1)
  const refs = findReferences(idx, 'load')
  assert.ok(refs.hits.some(h => h.file === 'src/app.ts' && h.in === 'start'))
  assert.ok(refs.hits.some(h => h.file === 'src/store.ts' && h.in === 'helper'))
  assert.ok(!refs.hits.some(h => h.file === 'src/store.ts' && h.line === 8))
  const src = symbolSource(idx, findDefinitions(idx, 'Store.add')[0])
  assert.match(src.text, /^ {3}18 {2}\s+add \(item: string\): void \{/)
  assert.match(src.text, /22 {2}\s+\}$/)
  assert.equal(enclosing(idx.files['src/store.ts'].symbols, 20).name, 'add')
})

test('matcher rejects bad input', () => {
  assert.throws(() => matcher(''), /symbol name/)
  assert.throws(() => matcher('/(/'), /bad regex/)
  assert.throws(() => matcher('x'.repeat(300)), /too long/)
})

test('references need a plain identifier (no regex injection)', () => {
  const idx = buildIndex(fixtureRepo(), { engine: 'regex', cache: false })
  assert.throws(() => findReferences(idx, 'a.*'), /plain identifier/)
})

test('the cache is reused and refreshed per file', () => {
  const repo = fixtureRepo()
  const first = buildIndex(repo, { engine: 'regex' })
  assert.equal(first.refreshed, 3)
  const second = buildIndex(repo, { engine: 'regex' })
  assert.equal(second.refreshed, 0)
  fs.appendFileSync(path.join(repo, 'tools/run.py'), '\ndef extra():\n    pass\n')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(path.join(repo, 'tools/run.py'), later, later)
  const third = buildIndex(repo, { engine: 'regex' })
  assert.equal(third.refreshed, 1)
  assert.equal(findDefinitions(third, 'extra').length, 1)
})

test('buildIndex refuses a missing folder', () => {
  assert.throws(() => buildIndex('/no/such/folder', { cache: false }), /not a folder/)
})

test('parseArgs', () => {
  const o = parseArgs(['find', 'x', '--root', '/r', '--json', '--limit', '5'])
  assert.deepEqual([o.command, o.positional[0], o.root, o.json, o.limit], ['find', 'x', '/r', true, 5])
  assert.throws(() => parseArgs(['--engine', 'tree']), /auto, regex or ctags/)
  assert.throws(() => parseArgs(['--limit', '-1']), /0\.\.10000/)
})

test('CLI: find, show, refs, outline, map, stats', () => {
  const repo = fixtureRepo()
  const run = (...a) => runNode(CLI, [...a, '--root', repo, '--engine', 'regex', '--no-cache'])
  assert.match(run('find', 'start').stdout, /src\/app\.ts:2-5 +function start/)
  assert.match(run('show', 'helper').stdout, /function helper/)
  assert.match(run('show', 'load').stdout, /1 more matches/)
  assert.match(run('refs', 'Store').stdout, /src\/app\.ts:3 +in start/)
  assert.match(run('outline', 'src/store.ts').stdout, /method Store\.add/)
  assert.match(run('map').stdout, /src\/store\.ts: LIMIT, Options/)
  const stats = JSON.parse(run('stats', '--json').stdout)
  assert.equal(stats.files, 3)
  assert.equal(run('nonsense').status, 1)
  assert.match(run('find', 'nothing_here').stdout, /no definition/)
})
