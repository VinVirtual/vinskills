// Online check: every pinned source exists, is public, and has a SKILL.md whose name matches the
// plugin name, plus a LICENSE, at the pinned commit.
// Runs only with VINSKILLS_ONLINE=1 (npm run test:online). Uses the GitHub REST API without a
// token, so it works in CI and on any machine; GH_TOKEN raises the rate limit if set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog } from '../scripts/build-marketplace.mjs'
import { parseFrontmatter } from '../scripts/validate.mjs'

const online = process.env.VINSKILLS_ONLINE === '1'
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'vinskills-source-check', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }
const api = async (p) => {
  const r = await fetch('https://api.github.com/' + p, { headers })
  return { status: r.status, body: r.status === 200 ? await r.json() : null }
}

const cat = loadCatalog()

for (const s of cat.skills) {
  test(`${s.name}: public repo, pinned commit exists, SKILL.md named ${s.name} and a LICENSE at the repo root`, { skip: !online && 'set VINSKILLS_ONLINE=1', timeout: 30000 }, async () => {
    const repo = await api(`repos/${s.repo}`)
    assert.equal(repo.status, 200, `${s.repo} not found`)
    assert.equal(repo.body.private, false, `${s.repo} is private`)
    assert.equal(repo.body.visibility, 'public')
    const commit = await api(`repos/${s.repo}/commits/${s.sha}`)
    assert.equal(commit.status, 200, `${s.repo}@${s.sha} not found`)
    const skill = await api(`repos/${s.repo}/contents/SKILL.md?ref=${s.sha}`)
    assert.equal(skill.status, 200, `${s.repo}@${s.sha} has no root SKILL.md`)
    const text = Buffer.from(skill.body.content, 'base64').toString('utf8')
    const fm = parseFrontmatter(text)
    assert.ok(fm, 'SKILL.md has no frontmatter')
    assert.equal(fm.data.name, s.name, 'SKILL.md name does not match the plugin name')
    assert.ok(fm.data.description && fm.data.description.length <= 1024, 'SKILL.md description missing or over 1024 characters')
    const licence = await api(`repos/${s.repo}/contents/LICENSE?ref=${s.sha}`)
    assert.equal(licence.status, 200, `${s.repo}@${s.sha} has no LICENSE`)
  })
}

for (const p of cat.projects) {
  test(`${p.name}: linked project is public`, { skip: !online && 'set VINSKILLS_ONLINE=1', timeout: 30000 }, async () => {
    const repo = await api(`repos/${p.repo}`)
    assert.equal(repo.status, 200)
    assert.equal(repo.body.private, false)
  })
}
