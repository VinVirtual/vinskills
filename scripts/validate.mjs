#!/usr/bin/env node
// Lint the marketplace, the catalog and the bundle manifests in this repository. The skills
// themselves live in their own repositories, which lint their SKILL.md in their own CI;
// tests/sources.test.mjs checks each pinned SKILL.md online.
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
    if (fs.existsSync(path.join(pluginsDir, p, 'skills'))) problems.push(`plugins/${p}: bundles hold no skills; skills live in their own repositories`)
  }
  return problems
}

if (process.argv[1] && process.argv[1].endsWith('validate.mjs')) {
  const problems = lintAll()
  for (const p of problems) console.error('✗ ' + p)
  console.log(problems.length ? `${problems.length} problem(s)` : '✔ marketplace, catalog and bundle manifests look right')
  process.exitCode = problems.length ? 1 : 0
}
