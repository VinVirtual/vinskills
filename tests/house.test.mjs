import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { skill, tmpdir, runNode, gitRepo } from './helpers.mjs'
import { scanText, scanRepo } from '../plugins/vin-core/skills/vin-house-build/scripts/privacy-scan.mjs'

const SCAN = skill('vin-house-build', 'scripts/privacy-scan.mjs')
const FRESH = skill('vin-house-build', 'scripts/fresh-clone-check.sh')
const ids = (f) => f.map(x => x.id)

// Fake values are assembled at run time so this file itself stays clean for scanners.
const fake = {
  gh: 'ghp' + '_' + 'a'.repeat(36),
  ant: 'sk-' + 'ant-' + 'b'.repeat(30),
  aws: 'AK' + 'IA' + 'C'.repeat(16),
  key: '-----BEGIN ' + 'PRIVATE KEY-----',
  mail: 'jane.doe' + '@' + 'corp-mail.com',
  url: 'https://admin:' + 'hunter22' + '@db.internal.example'
}

test('scanText finds key-shaped tokens and never prints their values', () => {
  const f = scanText([fake.gh, fake.ant, fake.aws, fake.key, fake.url].join('\n'), 'x.txt')
  for (const id of ['github-token', 'anthropic-key', 'aws-key-id', 'private-key', 'password-in-url']) assert.ok(ids(f).includes(id), id)
  for (const x of f) assert.ok(!Object.values(fake).some(v => x.detail.includes(v)), 'value leaked')
})

test('scanText: personal e-mail is an error, no-reply and example addresses are fine', () => {
  const f = scanText(`${fake.mail}\n1+me@users.noreply.github.com\nhi@example.com\nlogo@2x.png\nreact@18.3.1`, 'a.md')
  assert.deepEqual(ids(f), ['email'])
  assert.match(f[0].detail, /^j\*\*\*@corp-mail\.com$/)
})

test('scanText: home paths warn unless marked as an example; allow comments skip a line', () => {
  assert.deepEqual(ids(scanText('/home/' + 'alicew/project', 'a')), ['home-path'])
  assert.deepEqual(scanText('for example /home/' + 'alicew/x', 'a'), [])
  assert.deepEqual(scanText('/home/runner/work', 'a'), [])
  assert.deepEqual(scanText(fake.mail + ' // vin-privacy: allow', 'a'), [])
})

test('scanText: private words are matched case-insensitively and masked', () => {
  const f = scanText('Built for ACME Robotics', 'a', { privateWords: ['acme robotics'] })
  assert.deepEqual(ids(f), ['private-word'])
  assert.equal(f[0].detail, 'ac***')
})

test('scanRepo reads tracked and untracked files, skips binaries and ignored files, flags .env', () => {
  const d = gitRepo(tmpdir(), { 'README.md': 'clean', '.gitignore': 'secret.log\n', 'img.png': fake.mail })
  fs.writeFileSync(path.join(d, 'new.txt'), fake.mail)
  fs.writeFileSync(path.join(d, 'secret.log'), fake.mail)
  fs.writeFileSync(path.join(d, '.env'), 'X=1')
  const r = scanRepo(d)
  const at = r.findings.map(f => f.at)
  assert.ok(at.some(a => a.startsWith('new.txt')))
  assert.ok(!at.some(a => a.startsWith('secret.log') || a.startsWith('img.png')))
  assert.ok(ids(r.findings).includes('secret-file'))
})

test('privacy-scan CLI exits 1 on errors and 0 when clean; refuses non-repos', () => {
  const dirty = gitRepo(tmpdir(), { 'a.txt': fake.gh })
  assert.equal(runNode(SCAN, [dirty]).status, 1)
  const clean = gitRepo(tmpdir(), { 'a.txt': 'nothing here' })
  const r = runNode(SCAN, [clean])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /0 errors/)
  assert.equal(runNode(SCAN, [tmpdir()]).status, 2)
})

test('fresh-clone-check passes for committed files and fails when a needed file was never committed', () => {
  const pkg = JSON.stringify({ name: 't', private: true, scripts: { test: 'node check.mjs' } })
  const good = gitRepo(tmpdir(), { 'package.json': pkg, 'check.mjs': "import './lib.mjs'\n", 'lib.mjs': 'export {}\n' })
  const ok = spawnSync('bash', [FRESH, good], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /fresh clone: OK/)
  const bad = gitRepo(tmpdir(), { 'package.json': pkg, 'check.mjs': "import './lib.mjs'\n" })
  fs.writeFileSync(path.join(bad, 'lib.mjs'), 'export {}\n') // exists on disk, never committed
  const r = spawnSync('bash', [FRESH, bad], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /uncommitted changes are NOT in the clone/)
  assert.equal(fs.readdirSync(path.join(bad, '.scratch')).length, 0, 'clone folder cleaned up')
})

test('fresh-clone-check accepts a custom command', () => {
  const d = gitRepo(tmpdir(), { 'x.txt': 'hi' })
  const r = spawnSync('bash', [FRESH, d, 'cat', 'x.txt'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /hi/)
})
