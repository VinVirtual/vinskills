// Runs inside a locked-down child process (see lens.mjs). Reads {code, data, limits}
// as JSON on stdin, runs the code in a fresh V8 context and prints {ok, result, logs}.
// No host object is ever placed in the context: the data is parsed inside it, and
// helpers are defined from source inside it, so nothing can reach `process` through
// a host function's constructor.
import vm from 'node:vm'

const PRELUDE = `
'use strict';
const __logs = [];
const console = { log: (...a) => { if (__logs.length < 200) __logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) } };
console.info = console.warn = console.error = console.log;
const data = JSON.parse(__input);
const count = (xs, f = x => x) => { const m = {}; for (const x of xs) { const k = String(f(x)); m[k] = (m[k] || 0) + 1 } return m };
const groupBy = (xs, f) => { const m = {}; for (const x of xs) { const k = String(f(x)); (m[k] = m[k] || []).push(x) } return m };
const sum = (xs, f = x => x) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const pick = (o, ...keys) => Object.fromEntries(keys.filter(k => o != null && k in o).map(k => [k, o[k]]));
const uniq = (xs) => [...new Set(xs)];
const sortBy = (xs, f, desc = false) => [...xs].sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) });
const top = (xs, n, f) => sortBy(xs, f, true).slice(0, n);
const get = (o, path) => String(path).split('.').reduce((a, k) => a == null ? undefined : a[k], o);
`

async function readStdin () {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const req = JSON.parse(await readStdin())
const ctx = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
  microtaskMode: 'afterEvaluate'
})
ctx.__input = req.dataText
let out
try {
  vm.runInContext(PRELUDE, ctx, { timeout: req.timeoutMs })
  delete ctx.__input
  const body = `(() => {\n${req.code}\n})()`
  const value = vm.runInContext(body, ctx, { timeout: req.timeoutMs, filename: 'lens-script.js' })
  // Serialise inside the context so getters or toJSON run under the same timeout.
  ctx.__value = value
  const json = vm.runInContext(`(() => {
    if (__value && typeof __value.then === 'function') throw new Error('the script returned a Promise: lens scripts are synchronous (no await, no import())')
    return JSON.stringify(__value === undefined ? null : __value)
  })()`, ctx, { timeout: req.timeoutMs })
  const logs = vm.runInContext('JSON.stringify(__logs)', ctx, { timeout: req.timeoutMs })
  out = { ok: true, resultJson: json === undefined ? 'null' : json, logs: JSON.parse(logs) }
} catch (e) {
  const msg = e && e.message ? String(e.message) : String(e)
  out = { ok: false, error: /timed out/i.test(msg) ? `script timed out after ${req.timeoutMs} ms` : msg }
}
process.stdout.write(JSON.stringify(out))
