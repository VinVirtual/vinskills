import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, has } from './helpers.mjs'
import { loadCatalog, validateCatalog, buildMarketplace, buildThemeManifest, outputs, spliceReadme } from '../scripts/build-marketplace.mjs'
import { lintAll, lintSkill, parseFrontmatter, lintMarketplace } from '../scripts/validate.mjs'

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const market = () => JSON.parse(read('.claude-plugin/marketplace.json'))

test('generated files match catalog.json (run scripts/build-marketplace.mjs after edits)', () => {
  for (const [rel, text] of Object.entries(outputs(loadCatalog()))) assert.equal(read(rel), text, rel)
})

test('catalog.json is valid', () => {
  assert.deepEqual(validateCatalog(loadCatalog()), [])
})

test('validateCatalog catches bad entries', () => {
  const cat = loadCatalog()
  const bad = { ...cat, skills: [...cat.skills, { ...cat.skills[0] }, { name: 'Bad Name', theme: 'nope', repo: 'x', sha: 'abc', description: '' }, { ...cat.skills[0], name: 'vin-core' }] }
  const errs = validateCatalog(bad).join('\n')
  for (const re of [/duplicate/, /bad name/, /unknown theme/, /owner\/name/, /40-character/, /description/, /reserved/]) assert.match(errs, re)
})

test('repo lint: manifests, every SKILL.md, references and pins', () => {
  assert.deepEqual(lintAll(), [])
})

test('marketplace: name, owner, vin-core first, bundles relative, skills pinned github sources', () => {
  const m = market()
  assert.equal(m.name, 'vinskills')
  assert.ok(m.owner.name)
  assert.equal(m.plugins[0].name, 'vin-core')
  const names = m.plugins.map(p => p.name)
  assert.equal(new Set(names).size, names.length)
  for (const b of ['vin-media', 'vin-robotics', 'vin-ai-eval']) assert.equal(m.plugins.find(p => p.name === b).source, `./plugins/${b}`)
  const remote = m.plugins.filter(p => typeof p.source === 'object')
  assert.equal(remote.length, loadCatalog().skills.length)
  for (const p of remote) {
    assert.equal(p.source.source, 'github')
    assert.match(p.source.repo, /^VinVirtual\//)
    assert.match(p.source.sha, /^[0-9a-f]{40}$/)
  }
})

test('private products and non-skill projects are not installable plugins', () => {
  const names = market().plugins.map(p => p.name)
  for (const n of ['crowd-lights', 'photo-drop', 'dual-memory', 'malay-eval', 'lashvin.com']) assert.ok(!names.includes(n), n)
})

test('every skill belongs to exactly one bundle and every bundle dependency exists', () => {
  const cat = loadCatalog()
  const deps = Object.keys(cat.themes).flatMap(t => buildThemeManifest(cat, t).dependencies)
  assert.deepEqual([...deps].sort(), cat.skills.map(s => s.name).sort())
  const names = new Set(buildMarketplace(cat).plugins.map(p => p.name))
  for (const d of deps) assert.ok(names.has(d), d)
})

test('lintMarketplace catches escaping and missing relative sources', () => {
  const d = fs.mkdtempSync(path.join(ROOT, '.scratch', 'lint-'))
  try {
    fs.mkdirSync(path.join(d, '.claude-plugin'))
    fs.writeFileSync(path.join(d, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'm', owner: { name: 'o' }, plugins: [{ name: 'a', source: './../x' }, { name: 'b', source: './missing' }, { name: 'c', source: { source: 'github', repo: 'o/r' } }] }))
    const p = lintMarketplace(d).join('\n')
    assert.match(p, /stay inside/); assert.match(p, /does not exist/); assert.match(p, /pinned/)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('lintSkill catches a bad SKILL.md', () => {
  const d = fs.mkdtempSync(path.join(ROOT, '.scratch', 'skill-'))
  const dir = path.join(d, 'my-skill')
  fs.mkdirSync(dir)
  try {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: other-name\ndescription: Does <b>things</b>. ${'x'.repeat(1100)}\n---\nSee \`references/missing.md\`. /home/someone/x\n`)  // vin-privacy: allow (deliberate fixture)
    const p = lintSkill(dir).join('\n')
    for (const re of [/does not match folder/, /max 1024/, /< or >/, /when to use/, /missing\.md/, /home path/]) assert.match(p, re)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('parseFrontmatter reads quoted values and returns null without frontmatter', () => {
  assert.deepEqual(parseFrontmatter('---\nname: "a"\ndescription: \'b\'\n---\nbody').data, { name: 'a', description: 'b' })
  assert.equal(parseFrontmatter('no frontmatter'), null)
})

test('spliceReadme needs both markers', () => {
  assert.throws(() => spliceReadme('no markers', 'x'), /markers/)
})

test('no third-party tool names or private material anywhere in the repository', () => {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  const files = r.stdout.split('\0').filter(f => f && !/\.(png|jpe?g|pdf|docx|xlsx|pptx)$/.test(f))
  // Names are split so this test file does not match itself.
  const banned = [['code', 'burn'], ['ser', 'ena'], ['head', 'room'], ['any', 'doc'], ['code', '-mode'], ['code ', 'mode'], ['east', 'world'], ['crowd', '-lights'], ['photo', '-drop']].map(p => p.join(''))
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').toLowerCase()
    for (const b of banned) {
      const ok = (b === 'crowd-lights' || b === 'photo-drop') && f === 'tests/marketplace.test.mjs'
      assert.ok(ok || !text.includes(b), `${f} mentions "${b}"`)
    }
  }
})

test('claude plugin validate passes on the marketplace and on vin-core', { skip: !has('claude') && 'claude CLI not installed', timeout: 120000 }, () => {
  for (const target of ['.', 'plugins/vin-core', 'plugins/vin-media', 'plugins/vin-robotics', 'plugins/vin-ai-eval']) {
    const r = spawnSync('claude', ['plugin', 'validate', target], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })
    assert.equal(r.status, 0, `${target}: ${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /Validation passed/)
  }
})
