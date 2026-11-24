#!/usr/bin/env node
// vin-squeeze: compress big command output, logs or JSON, keep the original on disk.
//   some-command 2>&1 | node vin-squeeze.mjs
//   node vin-squeeze.mjs build.log --max 8000
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { squeeze, estimateTokens } from './lib/squeeze.mjs'

const HELP = `vin-squeeze — shrink logs, output and JSON before it enters context

Usage: <command> 2>&1 | vin-squeeze.mjs [options]
       vin-squeeze.mjs <file> [options]

Options:
  --max <chars>      size budget for the result (default 12000, about 3k tokens)
  --mode auto|text|json
  --frames <n>       stack frames kept per trace (default 4)
  --samples <n>      JSON array items shown (default 3)
  --keep-dir <dir>   where the untouched original is saved (default: $TMPDIR/vin-squeeze)
  --no-keep          do not save the original
  -h, --help
`
const MAX_INPUT = 200 * 1024 * 1024

export function parseArgs (argv) {
  const o = { maxChars: 12000, mode: 'auto', keep: true }
  const num = (v, flag, min, max) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be a whole number ${min}..${max}`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '--max') o.maxChars = num(next(), a, 500, 5_000_000)
    else if (a === '--frames') o.frames = num(next(), a, 0, 100)
    else if (a === '--samples') o.samples = num(next(), a, 1, 50)
    else if (a === '--mode') { o.mode = next(); if (!['auto', 'text', 'json'].includes(o.mode)) throw new Error('--mode must be auto, text or json') }
    else if (a === '--keep-dir') o.keepDir = next()
    else if (a === '--no-keep') o.keep = false
    else if (!a.startsWith('-') && !o.file) o.file = a
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

/** Save the original where only this user can read it; returns the path. */
export function keepOriginal (text, dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.createHash('sha256').update(text).digest('hex').slice(0, 10) + '.txt'
  const p = path.join(dir, name)
  fs.writeFileSync(p, text, { mode: 0o600 })
  return p
}

async function readInput (file) {
  if (file) {
    const st = fs.statSync(file)
    if (st.size > MAX_INPUT) throw new Error(`input is ${(st.size / 1e6).toFixed(0)} MB; the limit is ${MAX_INPUT / 1e6} MB`)
    return fs.readFileSync(file, 'utf8')
  }
  if (process.stdin.isTTY) throw new Error('pipe something in or give a file (see --help)')
  const chunks = []
  let size = 0
  for await (const c of process.stdin) {
    size += c.length
    if (size > MAX_INPUT) throw new Error(`input is over ${MAX_INPUT / 1e6} MB`)
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main () {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('vin-squeeze: ' + e.message); process.exit(2) }
  if (o.help) { process.stdout.write(HELP); return }
  const text = await readInput(o.file)
  const r = squeeze(text, o)
  let kept = ''
  if (o.keep && r.after < r.before) {
    kept = o.file ? path.resolve(o.file) : keepOriginal(text, o.keepDir || path.join(os.tmpdir(), 'vin-squeeze'))
  }
  process.stdout.write(r.output + '\n')
  const pct = r.before ? Math.round((1 - r.after / r.before) * 100) : 0
  process.stdout.write(`\n[vin-squeeze] ${r.kind}: ${r.before} → ${r.after} chars (~${estimateTokens(text)} → ~${estimateTokens(r.output)} tokens, -${pct}%)` +
    (kept ? `; original: ${kept}` : '') + '\n')
}

if (process.argv[1] && process.argv[1].endsWith('vin-squeeze.mjs')) {
  main().catch(e => { console.error('vin-squeeze: ' + e.message); process.exit(1) })
}
