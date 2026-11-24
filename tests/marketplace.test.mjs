import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, has, tmpdir } from './helpers.mjs'
import { loadCatalog, validateCatalog, buildMarketplace, buildThemeManifest, outputs, spliceReadme } from '../scripts/build-marketplace.mjs'
import { lintAll, parseFrontmatter, lintMarketplace } from '../scripts/validate.mjs'

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
  const bad = { ...cat, themes: { ...cat.themes, 'vin-empty': { displayName: 'E', description: 'e' } }, skills: [...cat.skills, { ...cat.skills[0] }, { name: 'Bad Name', theme: 'nope', repo: 'x', sha: 'abc', description: '' }, { ...cat.skills[0], name: 'vin-core' }] }
  const errs = validateCatalog(bad).join('\n')
  for (const re of [/duplicate/, /bad name/, /unknown theme/, /owner\/name/, /40-character/, /description/, /clashes/, /no skills/]) assert.match(errs, re)
})

test('repo lint: marketplace, catalog, bundle manifests and pins', () => {
  assert.deepEqual(lintAll(), [])
})

test('marketplace: name, owner, vin-core first, bundles relative, skills pinned github sources', () => {
  const m = market()
  assert.equal(m.name, 'vinskills')
  assert.ok(m.owner.name)
  assert.equal(m.plugins[0].name, 'vin-core')
  const names = m.plugins.map(p => p.name)
  assert.equal(new Set(names).size, names.length)
  const bundles = ['vin-core', 'vin-media', 'vin-robotics', 'vin-ai-eval']
  for (const b of bundles) assert.equal(m.plugins.find(p => p.name === b).source, `./plugins/${b}`)
  assert.deepEqual(m.plugins.filter(p => typeof p.source === 'string').map(p => p.name), bundles)
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

test('vin-core is a bundle of the eight core skill repositories', () => {
  const core = buildThemeManifest(loadCatalog(), 'vin-core')
  assert.deepEqual([...core.dependencies].sort(), ['vin-agent-orchestration', 'vin-docs', 'vin-house-build', 'vin-meter', 'vin-navigator', 'vin-scriptlens', 'vin-site-qa', 'vin-squeeze'])
  for (const n of core.dependencies) assert.equal(loadCatalog().skills.find(s => s.name === n).repo, `VinVirtual/${n}`)
})

test('the repository holds no skill code: every skill is a pinned external repository', () => {
  for (const p of fs.readdirSync(path.join(ROOT, 'plugins'))) {
    assert.deepEqual(fs.readdirSync(path.join(ROOT, 'plugins', p)), ['.claude-plugin'], `plugins/${p} should hold only its manifest`)
  }
  const skillFiles = spawnSync('git', ['-C', ROOT, 'ls-files', '*SKILL.md'], { encoding: 'utf8' }).stdout.trim()
  assert.equal(skillFiles, '')
})

test('every skill repository is listed once, with its README row linking to it', () => {
  const cat = loadCatalog()
  assert.equal(cat.skills.length, 29)
  const readme = read('README.md')
  for (const s of cat.skills) assert.ok(readme.includes(`[${s.name}](https://github.com/${s.repo})`), s.name)
})

test('every skill belongs to exactly one bundle and every bundle dependency exists', () => {
  const cat = loadCatalog()
  const deps = Object.keys(cat.themes).flatMap(t => buildThemeManifest(cat, t).dependencies)
  assert.deepEqual([...deps].sort(), cat.skills.map(s => s.name).sort())
  const names = new Set(buildMarketplace(cat).plugins.map(p => p.name))
  for (const d of deps) assert.ok(names.has(d), d)
})

test('lintMarketplace catches escaping and missing relative sources', () => {
  const d = tmpdir()
  try {
    fs.mkdirSync(path.join(d, '.claude-plugin'))
    fs.writeFileSync(path.join(d, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'm', owner: { name: 'o' }, plugins: [{ name: 'a', source: './../x' }, { name: 'b', source: './missing' }, { name: 'c', source: { source: 'github', repo: 'o/r' } }] }))
    const p = lintMarketplace(d).join('\n')
    assert.match(p, /stay inside/); assert.match(p, /does not exist/); assert.match(p, /pinned/)
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
  const banned = [['code', 'bu', 'rn'], ['ser', 'ena'], ['head', 'room'], ['any', 'doc'], ['code', '-mode'], ['code ', 'mode'], ['east', 'world'], ['crowd', '-lights'], ['photo', '-drop'], ['virtu', 'als']].map(p => p.join(''))
  // The old name of vin-meter may appear only in the changelog's history.
  const oldName = ['b', 'urn'].join('')
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').toLowerCase()
    for (const b of banned) {
      const ok = (b === 'crowd-lights' || b === 'photo-drop') && f === 'tests/marketplace.test.mjs'
      assert.ok(ok || !text.includes(b), `${f} mentions "${b}"`)
    }
    if (f !== 'CHANGELOG.md') assert.ok(!text.includes(oldName), `${f} still uses the old name of vin-meter`)
  }
})

test('claude plugin validate passes on the marketplace and on vin-core', { skip: !has('claude') && 'claude CLI not installed', timeout: 120000 }, () => {
  for (const target of ['.', ...fs.readdirSync(path.join(ROOT, 'plugins')).map(p => 'plugins/' + p)]) {
    const r = spawnSync('claude', ['plugin', 'validate', target], { cwd: ROOT, encoding: 'utf8', timeout: 60000 })
    assert.equal(r.status, 0, `${target}: ${r.stdout}${r.stderr}`)
    assert.match(r.stdout, /Validation passed/)
  }
})
