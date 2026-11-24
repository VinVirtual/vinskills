#!/usr/bin/env node
// Lint the marketplace, plugin manifests and every SKILL.md in this repository.
// No dependencies; `claude plugin validate .` is the authoritative check when the CLI is installed.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, loadCatalog, validateCatalog } from './build-marketplace.mjs'

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED = /^(claude|anthropic)(-|$)|^cc-plugin-/

/** Split simple YAML frontmatter (key: value lines, values may be quoted). */
export function parseFrontmatter (text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return null
  const data = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    data[kv[1]] = v
  }
  return { data, body: m[2] }
}

/** Problems with one SKILL.md. `dir` is the skill folder. */
export function lintSkill (dir) {
  const problems = []
  const file = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(file)) return [`${dir}: no SKILL.md`]
  const text = fs.readFileSync(file, 'utf8')
  const fm = parseFrontmatter(text)
  const rel = path.relative(ROOT, file)
  if (!fm) return [`${rel}: no frontmatter`]
  const { name, description } = fm.data
  if (!name) problems.push(`${rel}: name missing`)
  else {
    if (!NAME_RE.test(name) || name.length > 64) problems.push(`${rel}: name "${name}" must be kebab-case, at most 64 characters`)
    if (name !== path.basename(dir)) problems.push(`${rel}: name "${name}" does not match folder "${path.basename(dir)}"`)
    if (RESERVED.test(name)) problems.push(`${rel}: name uses a reserved word`)
  }
  if (!description) problems.push(`${rel}: description missing`)
  else {
    if (description.length > 1024) problems.push(`${rel}: description is ${description.length} characters (max 1024)`)
    if (/[<>]/.test(description)) problems.push(`${rel}: description contains < or > (XML-like tags are not allowed)`)
    if (!/\buse (when|for|before|after)\b/i.test(description)) problems.push(`${rel}: description never says when to use the skill`)
  }
  const lines = fm.body.split('\n').length
  if (lines > 500) problems.push(`${rel}: body is ${lines} lines (keep under 500, move detail to references/)`)
  // Every relative file mentioned in backticks or links must exist.
  const refs = new Set()
  for (const m of fm.body.matchAll(/`((?:references|scripts)\/[A-Za-z0-9_./-]+)`/g)) refs.add(m[1])
  for (const m of fm.body.matchAll(/\]\(((?:references|scripts)\/[^)\s]+)\)/g)) refs.add(m[1])
  for (const r of refs) if (!fs.existsSync(path.join(dir, r))) problems.push(`${rel}: mentions ${r}, which does not exist`)
  if (/\/home\/[a-z]|\/Users\/[a-z]/.test(text)) problems.push(`${rel}: contains an absolute home path`)
  return problems
}

export function lintManifest (file) {
  const problems = []
  let j
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return [`${file}: invalid JSON (${e.message})`] }
  if (!j.name || !NAME_RE.test(j.name)) problems.push(`${file}: name missing or not kebab-case`)
  if (RESERVED.test(j.name || '')) problems.push(`${file}: reserved name`)
  for (const k of ['version', 'description', 'author', 'license']) if (!j[k]) problems.push(`${file}: ${k} missing`)
  if (path.basename(path.dirname(path.dirname(file))) !== j.name) problems.push(`${file}: name "${j.name}" does not match its folder`)
  return problems
}

export function lintMarketplace (root = ROOT) {
  const problems = []
  const file = path.join(root, '.claude-plugin/marketplace.json')
  let m
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return [`marketplace.json: ${e.message}`] }
  if (!m.name || !NAME_RE.test(m.name)) problems.push('marketplace name missing or not kebab-case')
  if (!m.owner || !m.owner.name) problems.push('owner.name missing')
  const names = new Set()
  for (const [i, p] of (m.plugins || []).entries()) {
    if (!p.name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.name)) problems.push(`plugins[${i}]: bad name`)
    if (names.has(p.name)) problems.push(`duplicate plugin ${p.name}`)
    names.add(p.name)
    if (typeof p.source === 'string') {
      if (!p.source.startsWith('./') || p.source.includes('..')) problems.push(`${p.name}: relative source must start with ./ and stay inside`)
      else if (!fs.existsSync(path.join(root, p.source))) problems.push(`${p.name}: ${p.source} does not exist`)
    } else if (p.source && p.source.source === 'github') {
      if (!/^[0-9a-f]{40}$/.test(p.source.sha || '')) problems.push(`${p.name}: github source should be pinned to a full sha`)
    } else problems.push(`${p.name}: unexpected source type`)
  }
  // Every bundle dependency must be a plugin in this marketplace.
  for (const p of m.plugins || []) {
    if (typeof p.source !== 'string') continue
    const mf = path.join(root, p.source, '.claude-plugin/plugin.json')
    if (!fs.existsSync(mf)) continue
    const j = JSON.parse(fs.readFileSync(mf, 'utf8'))
    for (const d of j.dependencies || []) if (!names.has(typeof d === 'string' ? d : d.name)) problems.push(`${p.name}: depends on ${d}, which is not in the marketplace`)
  }
  return problems
}

export function lintAll (root = ROOT) {
  const problems = [...lintMarketplace(root), ...validateCatalog(loadCatalog(root)).map(e => 'catalog.json: ' + e)]
  const pluginsDir = path.join(root, 'plugins')
  for (const p of fs.readdirSync(pluginsDir)) {
    const mf = path.join(pluginsDir, p, '.claude-plugin/plugin.json')
    problems.push(...lintManifest(mf))
    const skillsDir = path.join(pluginsDir, p, 'skills')
    if (fs.existsSync(skillsDir)) for (const s of fs.readdirSync(skillsDir)) problems.push(...lintSkill(path.join(skillsDir, s)))
  }
  return problems
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) {
  const problems = lintAll()
  for (const p of problems) console.error('✗ ' + p)
  console.log(problems.length ? `${problems.length} problem(s)` : '✔ marketplace, manifests and skills look right')
  process.exitCode = problems.length ? 1 : 0
}
