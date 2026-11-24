#!/usr/bin/env node
// Pre-publish privacy scan for a git repository: e-mail addresses (except GitHub no-reply),
// key-shaped tokens, home-folder paths and words you list as private.
//   node privacy-scan.mjs <repo> [--private-words words.txt] [--allow-email x@y] [--json]
// Scans tracked files plus untracked, not-ignored files. Never prints a secret's value.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['aws-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['stripe-live', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['hf-token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['password-in-url', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@[^\s/]+/i]
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const HOME_PATH = /(?:\/home\/|\/Users\/|C:\\Users\\)([A-Za-z0-9._-]+)/g
const SAFE_EMAIL = [/@users\.noreply\.github\.com$/i, /@example\.(com|org|net)$/i, /^noreply@/i, /^git@github\.com$/i]
const SAFE_HOME = new Set(['runner', 'user', 'you', 'me', 'name', 'username', 'example', 'alice', 'bob', 'USER', 'your-name', 'yourname'])
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|mp4|webm|mov|mp3|wav|ogg|glb|gltf|usdz|zip|gz|tgz|pdf|woff2?|ttf|otf|bin|onnx|pt|npz)$/i

export function listFiles (repo) {
  const r = spawnSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`not a git repository: ${repo}`)
  return r.stdout.split('\0').filter(Boolean)
}

/** Findings for one file's text. Values are masked: type, line and length only. */
export function scanText (text, file, { privateWords = [], allowEmails = [] } = {}) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`
    if (/vin-privacy:\s*allow/.test(line)) return
    for (const [id, re] of PATTERNS) {
      const m = re.exec(line)
      if (m) out.push({ level: 'error', id, at, detail: `${m[0].length} chars` })
    }
    for (const m of line.matchAll(EMAIL)) {
      const e = m[0]
      if (SAFE_EMAIL.some(r => r.test(e)) || allowEmails.includes(e.toLowerCase())) continue
      if (/\.(png|jpe?g|svg|webp|gif|js|css)$/i.test(e) || /@\d+x\./.test(e) || /@v?\d+\.\d+/.test(e)) continue // image@2x.png, package@1.2.3
      out.push({ level: 'error', id: 'email', at, detail: e.replace(/^(.).*(@.*)$/, '$1***$2') })
    }
    for (const m of line.matchAll(HOME_PATH)) {
      if (SAFE_HOME.has(m[1])) continue
      if (/\be\.g\.|for example|such as/i.test(line)) continue
      out.push({ level: 'warn', id: 'home-path', at, detail: m[0] })
    }
    for (const w of privateWords) {
      if (w && line.toLowerCase().includes(w.toLowerCase())) out.push({ level: 'error', id: 'private-word', at, detail: w.slice(0, 2) + '***' })
    }
  })
  return out
}

export function scanRepo (repo, opts = {}) {
  const findings = []
  let scanned = 0
  for (const rel of listFiles(repo)) {
    if (BINARY.test(rel)) continue
    const abs = path.join(repo, rel)
    let st
    try { st = fs.lstatSync(abs) } catch { continue }
    if (!st.isFile() || st.size > 5 * 1024 * 1024) continue
    const buf = fs.readFileSync(abs)
    if (buf.includes(0)) continue
    scanned++
    findings.push(...scanText(buf.toString('utf8'), rel, opts))
    if (/^\.env(\..*)?$|\.pem$|id_rsa|\.npmrc$|\.pypirc$/.test(path.basename(rel)) && !/\.example$/.test(rel)) findings.push({ level: 'error', id: 'secret-file', at: rel, detail: 'file type usually holds secrets' })
  }
  return { scanned, findings }
}

function main () {
  const args = process.argv.slice(2)
  const o = { repo: null, privateWords: [], allowEmails: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--private-words') o.privateWords = fs.readFileSync(args[++i], 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    else if (a === '--allow-email') o.allowEmails.push(String(args[++i]).toLowerCase())
    else if (a === '--json') o.json = true
    else if (a === '-h' || a === '--help') { console.log('usage: privacy-scan.mjs <repo> [--private-words file] [--allow-email addr] [--json]'); return }
    else if (!o.repo) o.repo = a
    else { console.error('unknown argument ' + a); process.exit(2) }
  }
  let r
  try { r = scanRepo(o.repo || '.', o) } catch (e) { console.error('privacy-scan: ' + e.message); process.exit(2) }
  if (o.json) console.log(JSON.stringify(r, null, 2))
  else {
    for (const f of r.findings) console.log(`${f.level.padEnd(5)} ${f.id.padEnd(15)} ${f.at}  ${f.detail}`)
    const errors = r.findings.filter(f => f.level === 'error').length
    console.log(`${r.scanned} files scanned: ${errors} errors, ${r.findings.length - errors} warnings`)
  }
  process.exitCode = r.findings.some(f => f.level === 'error') ? 1 : 0
}

if (process.argv[1] && process.argv[1].endsWith('privacy-scan.mjs')) main()
