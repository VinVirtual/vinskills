// Host side of vin-scriptlens: start the runner in a child Node process with the
// permission model on (no file writes, no child processes, no workers, reads only of
// the runner itself), an empty environment, a memory cap and a wall-clock kill.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const RUNNER = path.join(HERE, 'runner.mjs')

export const LIMITS = {
  timeoutMs: 2000,       // CPU time inside the script
  wallMs: 10000,         // whole child process, including parsing the data
  memoryMb: 256,
  maxDataBytes: 100 * 1024 * 1024,
  maxResultChars: 20000,
  maxCodeChars: 20000
}

export function validateRequest ({ code, dataText }, limits = LIMITS) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('script is empty')
  if (code.length > limits.maxCodeChars) throw new Error(`script is longer than ${limits.maxCodeChars} characters`)
  if (typeof dataText !== 'string') throw new Error('data must be text')
  if (Buffer.byteLength(dataText) > limits.maxDataBytes) throw new Error(`data is over ${limits.maxDataBytes / 1e6} MB`)
  try { JSON.parse(dataText) } catch (e) { throw new Error('data is not valid JSON: ' + e.message) }
}

/** Run `code` over JSON `dataText`. Resolves {ok, result|error, logs, beforeChars, afterChars}. */
export function runLens ({ code, dataText }, overrides = {}) {
  const limits = { ...LIMITS, ...overrides }
  validateRequest({ code, dataText }, limits)
  const args = [
    '--permission',
    `--allow-fs-read=${RUNNER}`,
    `--max-old-space-size=${limits.memoryMb}`,
    '--disallow-code-generation-from-strings',
    RUNNER
  ]
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: {}, stdio: ['pipe', 'pipe', 'pipe'], cwd: HERE })
    let stdout = ''
    let stderr = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, limits.wallMs)
    child.stdout.on('data', d => { if (stdout.length < limits.maxResultChars * 4 + 100000) stdout += d })
    child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d })
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: 'could not start node: ' + e.message }) })
    child.on('close', (codeNum) => {
      clearTimeout(timer)
      const base = { beforeChars: dataText.length }
      if (killed) return resolve({ ...base, ok: false, error: `killed after ${limits.wallMs} ms (wall clock)` })
      let msg
      try { msg = JSON.parse(stdout) } catch {
        const reason = /heap out of memory|Allocation failed/i.test(stderr) ? `ran out of memory (limit ${limits.memoryMb} MB)` : (stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${codeNum}`)
        return resolve({ ...base, ok: false, error: reason })
      }
      if (!msg.ok) return resolve({ ...base, ok: false, error: msg.error })
      let text = msg.resultJson
      let truncated = false
      if (text.length > limits.maxResultChars) { text = text.slice(0, limits.maxResultChars); truncated = true }
      resolve({ ...base, ok: true, result: text, truncated, logs: msg.logs, afterChars: text.length })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ code, dataText, timeoutMs: limits.timeoutMs }))
  })
}
