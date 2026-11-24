import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT, skill, tmpdir, runNode } from './helpers.mjs'
import { parseCsp, analyzeCsp, analyzeHeaders, seoFromHtml, visibleWords, prerenderGap, grade, sortFindings, renderReport, randomPort } from '../plugins/vin-core/skills/vin-site-qa/scripts/lib/qa-core.mjs'
import { resolveInside, serveFolder } from '../plugins/vin-core/skills/vin-site-qa/scripts/lib/serve.mjs'
import { parseArgs } from '../plugins/vin-core/skills/vin-site-qa/scripts/site-qa.mjs'

const CLI = skill('vin-site-qa', 'scripts/site-qa.mjs')
const ids = (f) => f.map(x => x.id)

test('parseCsp keeps the first copy of a directive', () => {
  const c = parseCsp("default-src 'self'; script-src 'self' cdn.example; script-src *")
  assert.deepEqual(c['script-src'], ["'self'", 'cdn.example'])
})

test('analyzeCsp: missing, unsafe-inline, unsafe-eval, wildcard', () => {
  assert.deepEqual(ids(analyzeCsp('')), ['csp/missing'])
  const weak = ids(analyzeCsp("script-src 'self' 'unsafe-inline' 'unsafe-eval' https:"))
  for (const id of ['csp/unsafe-inline', 'csp/unsafe-eval', 'csp/wildcard-script', 'csp/object-src', 'csp/base-uri', 'csp/frame-ancestors']) assert.ok(weak.includes(id), id)
})

test("analyzeCsp: a nonce makes 'unsafe-inline' harmless and a strict policy has no warnings", () => {
  const strict = analyzeCsp("default-src 'self'; script-src 'nonce-abc' 'unsafe-inline' 'strict-dynamic' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  assert.equal(strict.filter(f => f.level !== 'info').length, 0)
  assert.equal(strict.length, 0)
})

test('analyzeCsp from a meta tag notes that frame-ancestors is ignored there', () => {
  const f = analyzeCsp("default-src 'self'", { source: 'meta' })
  assert.ok(f.some(x => x.id === 'csp/meta'))
  assert.match(f.find(x => x.id === 'csp/frame-ancestors').msg, /ignored in a <meta>/)
})

test('analyzeHeaders: HSTS only matters on https', () => {
  assert.ok(ids(analyzeHeaders({}, 'https://a.example')).includes('headers/hsts'))
  assert.ok(!ids(analyzeHeaders({}, 'http://127.0.0.1')).includes('headers/hsts'))
  assert.deepEqual(analyzeHeaders({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=1' }, 'https://a'), [])
})

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Lamps that last</title><meta name="description" content="Brass lamps."><link rel="canonical" href="https://shop.example/">
<meta property="og:title" content="Lamps"><meta property="og:image" content="https://shop.example/og.png"><script type="application/ld+json">{}</script></head>
<body><h1>Lamps</h1><p>${'word '.repeat(80)}</p></body></html>`

test('seoFromHtml: a complete page has no warnings', () => {
  const { info, findings } = seoFromHtml(GOOD, 'https://shop.example/')
  assert.equal(info.title, 'Lamps that last')
  assert.equal(info.lang, 'en')
  assert.equal(info.jsonLd, 1)
  assert.deepEqual(findings, [])
})

test('seoFromHtml: an empty client-rendered shell is flagged', () => {
  const { findings } = seoFromHtml('<html><head></head><body><div id="root"></div><script src="app.js"></script></body></html>')
  for (const id of ['seo/title', 'seo/description', 'seo/viewport', 'a11y/lang', 'prerender/h1', 'prerender/thin']) assert.ok(ids(findings).includes(id), id)
})

test('seoFromHtml: noindex, long titles and foreign canonicals', () => {
  const html = GOOD.replace('<title>Lamps that last</title>', `<title>${'Long '.repeat(20)}</title>`).replace('<meta charset="utf-8">', '<meta name="robots" content="noindex"><meta charset="utf-8">').replace('https://shop.example/"', 'https://other.example/"')
  const f = ids(seoFromHtml(html, 'https://shop.example/').findings)
  for (const id of ['seo/noindex', 'seo/title-long', 'seo/canonical-host']) assert.ok(f.includes(id), id)
})

test('visibleWords ignores scripts, styles and tags', () => {
  assert.equal(visibleWords('<p>one two</p><script>three four</script><style>.five{}</style><!-- six -->'), 2)
})

test('prerenderGap flags content that only exists after JavaScript', () => {
  assert.equal(prerenderGap(10, 50), null)
  assert.equal(prerenderGap(10, 500).id, 'prerender/gap')
  assert.equal(prerenderGap(400, 500), null)
})

test('grade applies the budgets', () => {
  assert.deepEqual(grade({ lcpMs: 1000, cls: 0.01, jsKb: 100, imagesWithoutSize: 0 }), [])
  const f = ids(grade({ lcpMs: 4000, cls: 0.3, jsKb: 200, imagesWithoutSize: 2 }, { pageType: 'landing' }))
  assert.deepEqual(f.sort(), ['perf/cls', 'perf/img-size', 'perf/js', 'perf/lcp'])
  assert.ok(!ids(grade({ jsKb: 200 })).includes('perf/js'))
})

test('sortFindings orders by level and removes duplicates', () => {
  const s = sortFindings([{ level: 'info', id: 'b', msg: 'x' }, { level: 'error', id: 'a', msg: 'y' }, { level: 'error', id: 'a', msg: 'y', where: 'other' }])
  assert.deepEqual(s.map(x => x.level), ['error', 'info'])
})

test('renderReport lists findings, screenshots and skipped passes', () => {
  const md = renderReport({ url: 'u', when: 'now', perf: { lcpMs: 900, cls: 0, jsKb: 12, totalKb: 40, requests: 3 }, findings: [{ level: 'warn', id: 'x/y', msg: 'm' }], shots: [{ label: 'l', file: 'f.png' }], skipped: ['webkit'] })
  assert.match(md, /0 errors, 1 warnings/)
  assert.match(md, /\| 900 ms \| 0\.000 \| 12 KB \| 40 KB \| 3 \|/)
  assert.match(md, /- l: `f\.png`/)
  assert.match(md, /## Not checked\n\n- webkit/)
})

test('randomPort stays in 41000-49999', () => {
  assert.equal(randomPort(() => 0), 41000)
  assert.equal(randomPort(() => 0.99999), 49999)
})

test('resolveInside refuses traversal, NUL bytes and symlinks out of the folder', () => {
  const d = tmpdir()
  fs.mkdirSync(path.join(d, 'site/about'), { recursive: true })
  fs.writeFileSync(path.join(d, 'site/index.html'), 'home')
  fs.writeFileSync(path.join(d, 'site/about/index.html'), 'about')
  fs.writeFileSync(path.join(d, 'secret.txt'), 'secret')
  fs.symlinkSync(path.join(d, 'secret.txt'), path.join(d, 'site/link.txt'))
  const root = path.join(d, 'site')
  assert.equal(fs.readFileSync(resolveInside(root, '/'), 'utf8'), 'home')
  assert.equal(fs.readFileSync(resolveInside(root, '/about'), 'utf8'), 'about')
  assert.equal(resolveInside(root, '/../secret.txt'), null)
  assert.equal(resolveInside(root, '/%2e%2e/secret.txt'), null)
  assert.equal(resolveInside(root, '/a%00b'), null)
  assert.equal(resolveInside(root, '/link.txt'), null)
  assert.equal(resolveInside(root, '/%E0%A4%A'), null)
})

test('serveFolder binds to 127.0.0.1 on a port in the house range and serves 404s', async () => {
  const d = tmpdir()
  fs.writeFileSync(path.join(d, 'index.html'), '<h1>hi</h1>')
  const s = await serveFolder(d)
  try {
    assert.ok(s.port >= 41000 && s.port <= 49999)
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:/)
    const ok = await fetch(s.url)
    assert.equal(ok.status, 200)
    assert.match(ok.headers.get('content-type'), /text\/html/)
    assert.equal((await fetch(s.url + 'nope')).status, 404)
  } finally { await s.close() }
})

test('parseArgs validates widths, themes and page type', () => {
  assert.deepEqual(parseArgs(['x', '--widths', '320,800']).widths, [320, 800])
  assert.throws(() => parseArgs(['--widths', '10']), /240\.\.3840/)
  assert.throws(() => parseArgs(['--themes', 'sepia']), /light and\/or dark/)
  assert.throws(() => parseArgs(['--page-type', 'blog']), /app or landing/)
  assert.throws(() => parseArgs(['--path', 'about']), /start with/)
})

function browserAvailable () {
  try { createRequire(ROOT + '/')('playwright-core') } catch { return false }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].some(p => fs.existsSync(p)) || Boolean(process.env.CI_HAS_PLAYWRIGHT_CHROMIUM)
}

test('end to end: the demo page with deliberate mistakes', { skip: !browserAvailable() && 'no playwright-core or Chromium', timeout: 180000 }, () => {
  const out = tmpdir()
  const r = runNode(CLI, [path.join(ROOT, 'examples/site-qa/site'), '--out', out, '--widths', '390,1440', '--no-webkit', '--json'], { cwd: ROOT, timeout: 170000 })
  assert.equal(r.status, 1, r.stderr) // errors found on purpose
  const rep = JSON.parse(r.stdout)
  const found = new Set(rep.findings.map(f => f.id))
  for (const id of ['a11y/img-alt', 'a11y/control-name', 'a11y/input-label', 'console/exception', 'layout/overflow-x', 'motion/reduced', 'csp/missing', 'a11y/lang', 'a11y/heading-skip']) assert.ok(found.has(id), id)
  assert.ok(rep.perf.lcpMs > 0)
  assert.equal(rep.shots.length, 5)
  for (const s of rep.shots) assert.ok(fs.statSync(s.file).size > 1000, s.file)
  assert.ok(fs.existsSync(path.join(out, 'report.md')))
})
