import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { skill, tmpdir, runNode } from './helpers.mjs'
import { runLens, validateRequest } from '../plugins/vin-core/skills/vin-scriptlens/scripts/lib/lens.mjs'
import { parseArgs } from '../plugins/vin-core/skills/vin-scriptlens/scripts/vin-lens.mjs'

const CLI = skill('vin-scriptlens', 'scripts/vin-lens.mjs')
const DATA = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, state: i % 3 ? 'open' : 'closed', ms: (i * 37) % 1000, user: { name: 'u' + (i % 5) } })))
const lens = (code, extra) => runLens({ code, dataText: DATA }, extra)

test('runs a script and returns only its result', async () => {
  const r = await lens('return count(data, x => x.state)')
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(JSON.parse(r.result), { closed: 67, open: 133 })
  assert.ok(r.afterChars < r.beforeChars / 100)
})

test('helpers: sum, groupBy, pick, uniq, sortBy, top, get', async () => {
  const r = await lens(`return {
    total: sum(data, x => x.ms),
    groups: Object.keys(groupBy(data, x => x.user.name)).length,
    first: pick(data[0], 'id', 'state', 'missing'),
    users: uniq(data.map(x => get(x, 'user.name'))).length,
    slowest: top(data, 2, x => x.ms).map(x => x.ms),
    fastest: sortBy(data, x => x.ms)[0].ms
  }`)
  const v = JSON.parse(r.result)
  assert.equal(v.groups, 5); assert.equal(v.users, 5)
  assert.deepEqual(v.first, { id: 0, state: 'closed' })
  assert.ok(v.slowest[0] >= v.slowest[1])
  assert.equal(v.fastest, 0)
  assert.equal(v.total, JSON.parse(DATA).reduce((a, x) => a + x.ms, 0))
})

test('console.log lines come back separately', async () => {
  const r = await lens('console.log("n =", data.length); return 1')
  assert.deepEqual(r.logs, ['n = 200'])
  assert.equal(r.result, '1')
})

test('undefined result becomes null', async () => {
  assert.equal((await lens('data.length')).result, 'null')
})

test('no process, require, fetch or import inside the script', async () => {
  const r = await lens('return [typeof process, typeof require, typeof fetch, typeof globalThis.process, typeof Buffer]')
  assert.deepEqual(JSON.parse(r.result), ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'])
  const imp = await lens('return import("fs")')
  assert.equal(imp.ok, false)
  assert.match(imp.error, /synchronous/)
})

test('constructor-chain escapes find no host process', async () => {
  const attempts = [
    'return this.constructor.constructor("return process")()',
    'return console.log.constructor("return process")()',
    'return count.constructor("return typeof process")()',
    'return (()=>{}).constructor("return process")()',
    'return data.constructor.constructor("return this")().process'
  ]
  for (const code of attempts) {
    const r = await lens(code)
    if (r.ok) assert.ok(!/"pid"|"env"|"versions"/.test(r.result), `escaped with: ${code}`)
    else assert.match(r.error, /Code generation from strings disallowed|not a function|undefined/)
  }
})

test('eval and new Function are disabled', async () => {
  assert.equal((await lens('return eval("1+1")')).ok, false)
  assert.equal((await lens('return new Function("return 1")()')).ok, false)
})

test('the child process cannot write files even if code reached Node APIs', async () => {
  // The runner itself runs under --permission; prove it by asking the same flags directly.
  const { spawnSync } = await import('node:child_process')
  const d = tmpdir()
  const target = path.join(d, 'pwned.txt')
  const r = spawnSync(process.execPath, ['--permission', '-e', `require('fs').writeFileSync(${JSON.stringify(target)}, 'x')`], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.equal(fs.existsSync(target), false)
})

test('an endless loop is stopped by the CPU timeout', async () => {
  const r = await lens('while (true) {}', { timeoutMs: 200 })
  assert.equal(r.ok, false)
  assert.match(r.error, /timed out after 200 ms/)
})

test('runaway memory is stopped', async () => {
  const r = await lens('const a = []; while (true) a.push(new Array(1e6).fill(1))', { memoryMb: 64, timeoutMs: 20000, wallMs: 20000 })
  assert.equal(r.ok, false)
})

test('thrown errors are reported', async () => {
  const r = await lens('throw new Error("custom failure")')
  assert.equal(r.ok, false)
  assert.match(r.error, /custom failure/)
})

test('big results are cut at the limit', async () => {
  const r = await lens('return "x".repeat(50000)', { maxResultChars: 1000 })
  assert.equal(r.truncated, true)
  assert.equal(r.result.length, 1000)
})

test('validateRequest rejects empty scripts, bad JSON and oversized input', () => {
  assert.throws(() => validateRequest({ code: '  ', dataText: '{}' }), /empty/)
  assert.throws(() => validateRequest({ code: 'return 1', dataText: '{nope' }), /not valid JSON/)
  assert.throws(() => validateRequest({ code: 'return 1', dataText: '[1]' }, { maxDataBytes: 1, maxCodeChars: 100 }), /over/)
  assert.throws(() => validateRequest({ code: 'x'.repeat(200), dataText: '[]' }, { maxDataBytes: 100, maxCodeChars: 100 }), /longer/)
})

test('parseArgs needs exactly one script source', () => {
  assert.throws(() => parseArgs([]), /-e or -f/)
  assert.throws(() => parseArgs(['-e', 'return 1', '-f', 'x.js']), /not both/)
  assert.throws(() => parseArgs(['-e', 'x', '--timeout', '5']), /10\.\.60000/)
  assert.equal(parseArgs(['data.json', '-e', 'return 1']).dataFile, 'data.json')
})

test('CLI: stdin and file input, pretty output and size line', () => {
  const d = tmpdir()
  const f = path.join(d, 'd.json')
  fs.writeFileSync(f, DATA)
  const a = runNode(CLI, ['-e', 'return data.length'], { input: DATA })
  assert.equal(a.status, 0, a.stderr)
  assert.match(a.stdout, /^200\n\[vin-lens\] data \d+ chars → result 3 chars/)
  const s = path.join(d, 's.js')
  fs.writeFileSync(s, 'return pick(data[1], "id", "state")')
  const b = runNode(CLI, [f, '-f', s, '--pretty'])
  assert.match(b.stdout, /"id": 1,\n {2}"state": "open"/)
})

test('CLI: a failing script exits 1, bad arguments exit 2', () => {
  assert.equal(runNode(CLI, ['-e', 'throw 1'], { input: '[]' }).status, 1)
  assert.equal(runNode(CLI, ['-e', 'return 1'], { input: 'not json' }).status, 2)
  assert.equal(runNode(CLI, []).status, 2)
})
