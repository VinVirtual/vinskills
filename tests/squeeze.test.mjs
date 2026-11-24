import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { skill, tmpdir, runNode } from './helpers.mjs'
import { squeeze, squeezeText, squeezeJson, collapseRuns, collapseFrames, groupByShape, fitLines, lineShape, describePaths, trimValue, findErrors, tryParseJson } from '../plugins/vin-core/skills/vin-squeeze/scripts/lib/squeeze.mjs'
import { parseArgs, keepOriginal } from '../plugins/vin-core/skills/vin-squeeze/scripts/vin-squeeze.mjs'

const CLI = skill('vin-squeeze', 'scripts/vin-squeeze.mjs')

test('collapseRuns counts identical neighbours', () => {
  assert.deepEqual(collapseRuns(['a', 'a', 'a', 'b', 'a']), ['a  [×3]', 'b', 'a'])
})

test('lineShape ignores numbers, hex ids, timestamps and quoted values', () => {
  assert.equal(lineShape('2026-11-24T10:00:01Z took 12ms id=deadbeef1 "x"'), lineShape('2026-11-25T11:22:33Z took 9ms id=cafebabe2 "yy"'))
  assert.notEqual(lineShape('GET /a'), lineShape('POST /a'))
})

test('groupByShape keeps one example per repeated shape with a count', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `request ${i} ok in ${i * 3}ms`)
  const out = groupByShape(lines, 4)
  assert.equal(out.length, 1)
  assert.match(out[0], /\[\+9 similar lines\]/)
})

test('groupByShape never folds error lines', () => {
  const lines = Array.from({ length: 6 }, (_, i) => `Error: disk ${i} failed`)
  assert.equal(groupByShape(lines, 2).length, 6)
})

test('collapseFrames keeps the first frames and the last one', () => {
  const lines = ['TypeError: x', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (a.js:${i}:1)`), 'after']
  const out = collapseFrames(lines, 3)
  assert.equal(out[0], 'TypeError: x')
  assert.equal(out[1], '    at f0 (a.js:0:1)')
  assert.match(out[4], /… 16 more frames/)
  assert.equal(out[5], '    at f19 (a.js:19:1)')
  assert.equal(out.at(-1), 'after')
})

test('collapseFrames understands Python tracebacks', () => {
  const lines = ['Traceback (most recent call last):', ...Array.from({ length: 12 }, (_, i) => `  File "m.py", line ${i}, in f`), 'ValueError: bad']
  const out = collapseFrames(lines, 2)
  assert.ok(out.length < lines.length)
  assert.equal(out.at(-1), 'ValueError: bad')
})

test('fitLines keeps head, tail and every error line in the middle', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => i === 500 ? 'FATAL error: out of memory' : `line ${i} ${'x'.repeat(40)}`)
  const out = fitLines(lines, 8000)
  assert.ok(out.includes('FATAL error: out of memory'))
  assert.equal(out[0], lines[0])
  assert.equal(out.at(-1), lines.at(-1))
  assert.ok(out.some(l => /lines without errors or warnings removed/.test(l)))
})

test('fitLines returns small input unchanged', () => {
  assert.deepEqual(fitLines(['a', 'b'], 1000), ['a', 'b'])
})

test('squeezeText strips ANSI colour codes and CRLF', () => {
  assert.equal(squeezeText('\x1b[31mred\x1b[0m\r\nok'), 'red\nok')
})

test('squeezeText on a realistic noisy log keeps the error and shrinks a lot', () => {
  const log = [
    ...Array.from({ length: 400 }, (_, i) => `[2026-11-24 10:00:${String(i % 60).padStart(2, '0')}] INFO fetched page ${i} in ${i % 90}ms`),
    'ERROR payment webhook rejected: signature mismatch',
    ...Array.from({ length: 30 }, () => 'heartbeat')
  ].join('\n')
  const out = squeezeText(log, { maxChars: 3000 })
  assert.match(out, /signature mismatch/)
  assert.match(out, /heartbeat {2}\[×30\]/)
  assert.ok(out.length < log.length / 10)
})

test('describePaths reports types, counts, lengths, ranges and enum values', () => {
  const data = Array.from({ length: 10 }, (_, i) => ({ id: i, state: i % 2 ? 'open' : 'closed', tags: Array(i % 3).fill('t'), note: i === 3 ? null : 'n' + i }))
  const lines = describePaths(data)
  const find = (p) => lines.find(l => l.startsWith(p + ' '))
  assert.match(find('$'), /array.*len 10/)
  assert.match(find('$[].id'), /number.*0\.\.9/)
  assert.match(find('$[].state'), /values "closed", "open"|values "open", "closed"/)
  assert.match(find('$[].tags'), /len 0\.\.2/)
  assert.match(find('$[].note'), /string:9\|null:1|null:1\|string:9/)
})

test('describePaths quotes odd keys and stops at maxPaths', () => {
  const lines = describePaths({ 'a b': 1, ok: 2 })
  assert.ok(lines.some(l => l.startsWith('$["a b"]')))
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['k' + i, i]))
  assert.match(describePaths(many, { maxPaths: 10 }).at(-1), /more paths/)
})

test('trimValue cuts long strings and samples arrays', () => {
  const v = trimValue({ s: 'x'.repeat(500), a: [1, 2, 3, 4, 5] }, { maxString: 10, maxItems: 2 })
  assert.match(v.s, /^x{10}…\(\+490\)$/)
  assert.deepEqual(v.a, [1, 2, '… 3 more items'])
})

test('findErrors finds error-like keys at any depth', () => {
  const e = findErrors({ data: [{ ok: 1 }, { error: { code: 'E42', message: 'nope' } }], warnings: [] })
  assert.equal(e.length, 1)
  assert.equal(e[0].path, '$.data[1].error')
})

test('squeezeJson leaves small JSON alone and summarises big JSON within budget', () => {
  assert.equal(squeezeJson({ a: 1 }), JSON.stringify({ a: 1 }, null, 2))
  const big = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: 'item ' + i, body: 'lorem '.repeat(20), error: i === 1500 ? 'boom' : null }))
  const out = squeezeJson(big, { maxChars: 5000 })
  assert.ok(out.length <= 5000 + 60)
  assert.match(out, /Shape:/)
  assert.match(out, /\$\[\]\.id/)
  assert.match(out, /boom/)
})

test('tryParseJson handles JSON, JSON Lines and plain text', () => {
  assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 })
  assert.deepEqual(tryParseJson('{"a":1}\n{"a":2}\n'), [{ a: 1 }, { a: 2 }])
  assert.equal(tryParseJson('hello'), undefined)
  assert.equal(tryParseJson('{broken'), undefined)
})

test('squeeze picks the mode and --mode json refuses non-JSON', () => {
  assert.equal(squeeze('[1,2]').kind, 'json')
  assert.equal(squeeze('[1,2]', { mode: 'text' }).kind, 'text')
  assert.throws(() => squeeze('nope', { mode: 'json' }), /not valid JSON/)
})

test('parseArgs validates numbers and modes', () => {
  assert.equal(parseArgs(['--max', '2000']).maxChars, 2000)
  assert.throws(() => parseArgs(['--max', '10']), /500/)
  assert.throws(() => parseArgs(['--mode', 'xml']), /auto, text or json/)
  assert.throws(() => parseArgs(['--bogus']), /unknown option/)
})

test('keepOriginal writes a private file', () => {
  const d = tmpdir()
  const p = keepOriginal('secret log', path.join(d, 'keep'))
  assert.equal(fs.readFileSync(p, 'utf8'), 'secret log')
  if (process.platform !== 'win32') assert.equal(fs.statSync(p).mode & 0o777, 0o600)
})

test('CLI: piped input is squeezed and the original path is printed', () => {
  const d = tmpdir()
  const input = Array.from({ length: 3000 }, (_, i) => `ok ${i}`).join('\n') + '\nerror: the one that matters\n'
  const r = runNode(CLI, ['--keep-dir', d], { input })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /the one that matters/)
  const m = /original: (.+)$/m.exec(r.stdout)
  assert.ok(m, r.stdout)
  assert.equal(fs.readFileSync(m[1].trim(), 'utf8'), input)
})

test('CLI: a file argument points back to that file, --no-keep saves nothing', () => {
  const d = tmpdir()
  const f = path.join(d, 'big.json')
  fs.writeFileSync(f, JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ i }))))
  const r = runNode(CLI, [f, '--max', '2000'])
  assert.match(r.stdout, new RegExp('original: ' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const r2 = runNode(CLI, [f, '--no-keep', '--max', '2000'])
  assert.doesNotMatch(r2.stdout, /original:/)
})
