#!/usr/bin/env node
// vin-site-qa: screenshots, console, CSP, prerender/SEO, quick accessibility and load numbers
// for one page, in real browsers. Needs playwright-core and a Chromium (system Chrome is fine).
//   node site-qa.mjs https://example.org --out qa/
//   node site-qa.mjs ./dist --out qa/          (serves the folder on 127.0.0.1:41000-49999)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { analyzeCsp, analyzeHeaders, seoFromHtml, prerenderGap, grade, renderReport, sortFindings, BUDGETS } from './lib/qa-core.mjs'
import { pageChecks, collectPerf, runningAnimations } from './lib/in-page.mjs'
import { serveFolder } from './lib/serve.mjs'

const HELP = `vin-site-qa — ship-check one page in real browsers

Usage: site-qa.mjs <url | built-site-folder> [options]

Options:
  --out <dir>          where screenshots and report go (default ./site-qa-out)
  --path <p>           page path when serving a folder (default /)
  --widths 390,1024,1440
  --themes light,dark
  --full               full-page screenshots (default: first screen only)
  --page-type app|landing   JS budget to apply (default app)
  --no-webkit          skip the WebKit iPhone pass
  --chrome <path>      Chromium/Chrome binary (default: Playwright's, then system Chrome)
  --json               print the report as JSON
  -h, --help

Exit code: 0 no errors, 1 errors found, 2 could not run.
`

export function parseArgs (argv) {
  const o = { out: 'site-qa-out', path: '/', widths: [390, 1024, 1440], themes: ['light', 'dark'], webkit: true, pageType: 'app' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '--out') o.out = next()
    else if (a === '--path') { o.path = next(); if (!o.path.startsWith('/')) throw new Error('--path must start with /') }
    else if (a === '--widths') {
      o.widths = next().split(',').map(Number)
      if (!o.widths.length || o.widths.some(w => !Number.isInteger(w) || w < 240 || w > 3840)) throw new Error('--widths must be numbers 240..3840')
    } else if (a === '--themes') {
      o.themes = next().split(',')
      if (o.themes.some(t => !['light', 'dark'].includes(t))) throw new Error('--themes takes light and/or dark')
    } else if (a === '--full') o.full = true
    else if (a === '--page-type') { o.pageType = next(); if (!['app', 'landing'].includes(o.pageType)) throw new Error('--page-type is app or landing') }
    else if (a === '--no-webkit') o.webkit = false
    else if (a === '--chrome') o.chrome = next()
    else if (a === '--json') o.json = true
    else if (!a.startsWith('-') && !o.target) o.target = a
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

function loadPlaywright () {
  const tries = [process.cwd() + '/', path.dirname(new URL(import.meta.url).pathname) + '/', ...(process.env.VIN_PLAYWRIGHT_DIR ? [process.env.VIN_PLAYWRIGHT_DIR + '/'] : [])]
  for (const base of tries) {
    try { return createRequire(base)('playwright-core') } catch {}
    try { return createRequire(base)('playwright') } catch {}
  }
  throw new Error('playwright-core is not installed. In a scratch folder run: npm i playwright-core  then set VIN_PLAYWRIGHT_DIR=<that folder>/node_modules/..')
}

async function launchChromium (pw, chrome) {
  const candidates = [chrome, undefined, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter((c, i) => i === 1 || c)
  let last
  for (const executablePath of candidates) {
    try { return await pw.chromium.launch({ executablePath, timeout: 30000 }) } catch (e) { last = e }
  }
  throw new Error('no Chromium could start: ' + (last && last.message.split('\n')[0]))
}

async function main () {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('site-qa: ' + e.message + '\n\n' + HELP); process.exit(2) }
  if (o.help || !o.target) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2) }
  const pw = loadPlaywright()
  fs.mkdirSync(o.out, { recursive: true })

  let server = null
  let url = o.target
  if (!/^https?:\/\//i.test(o.target)) {
    if (!fs.existsSync(o.target) || !fs.statSync(o.target).isDirectory()) throw new Error(`not a URL or a folder: ${o.target}`)
    server = await serveFolder(o.target)
    url = new URL(o.path, server.url).href
  }

  const findings = []
  const shots = []
  const skipped = []
  const browsers = []
  try {
    // 1. Raw HTML as a crawler sees it (no JavaScript).
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'vin-site-qa (prerender check)' } })
    const rawHtml = await res.text()
    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]))
    if (!res.ok) findings.push({ level: 'error', id: 'http/status', msg: `HTTP ${res.status} for ${url}` })
    const seo = seoFromHtml(rawHtml, url)
    findings.push(...seo.findings, ...analyzeHeaders(headers, url))
    const metaCsp = (/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i.exec(rawHtml) || [])[0]
    const metaCspValue = metaCsp ? (/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(metaCsp) || []).slice(1).find(Boolean) : null
    findings.push(...analyzeCsp(headers['content-security-policy'] || metaCspValue, { source: headers['content-security-policy'] ? 'header' : 'meta' }))

    // 2. Chromium: every width x theme, console errors, a11y checks, reduced motion.
    const chromium = await launchChromium(pw, o.chrome)
    browsers.push(chromium)
    let renderedWords = 0
    for (const theme of o.themes) {
      for (const width of o.widths) {
        const mobile = width < 600
        const ctx = await chromium.newContext({ viewport: { width, height: mobile ? 844 : 900 }, colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
        const page = await ctx.newPage()
        const where = `chromium ${width} ${theme}`
        page.on('console', m => { if (m.type() === 'error') findings.push({ level: 'error', id: 'console/error', msg: m.text().slice(0, 300), where }) })
        page.on('pageerror', e => findings.push({ level: 'error', id: 'console/exception', msg: String(e.message || e).slice(0, 300), where }))
        page.on('response', r => { if (r.status() >= 400 && r.url() !== url) findings.push({ level: 'warn', id: 'http/subresource', msg: `${r.status()} ${r.url().slice(0, 200)}`, where }) })
        page.on('requestfailed', r => findings.push({ level: 'warn', id: 'http/failed', msg: `${r.failure()?.errorText || 'failed'} ${r.url().slice(0, 200)}`, where }))
        await page.goto(url, { waitUntil: 'load', timeout: 45000 })
        await page.waitForTimeout(800)
        const file = path.join(o.out, `chromium-${width}-${theme}.png`)
        await page.screenshot({ path: file, fullPage: Boolean(o.full) })
        shots.push({ label: where, file })
        const checks = await page.evaluate(pageChecks, { tapTargetPx: BUDGETS.tapTargetPx, mobile, viewportWidth: width })
        findings.push(...checks.findings.map(f => ({ ...f, where: f.where ? `${where}: ${f.where}` : where })))
        renderedWords = Math.max(renderedWords, checks.renderedWords)
        await ctx.close()
      }
    }
    const gap = prerenderGap(seo.info.rawWords, renderedWords)
    if (gap) findings.push(gap)

    // Reduced motion: infinite animations should stop.
    {
      const ctx = await chromium.newContext({ viewport: { width: 1024, height: 900 }, reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'load', timeout: 45000 })
      await page.waitForTimeout(1000)
      const a = await page.evaluate(runningAnimations)
      if (a.infinite > 0) findings.push({ level: 'warn', id: 'motion/reduced', msg: `${a.infinite} looping animation(s) still run with prefers-reduced-motion: reduce (${a.examples.join(', ')}).` })
      const file = path.join(o.out, 'chromium-1024-reduced-motion.png')
      await page.screenshot({ path: file })
      shots.push({ label: 'chromium 1024 reduced motion', file })
      await ctx.close()
    }

    // 3. Cold load numbers at desktop width.
    const ctx = await chromium.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    const perf = await page.evaluate(collectPerf)
    const imgInfo = await page.evaluate(pageChecks, { tapTargetPx: BUDGETS.tapTargetPx, mobile: false })
    perf.imagesWithoutSize = imgInfo.imagesWithoutSize
    findings.push(...grade(perf, { pageType: o.pageType }))
    await ctx.close()

    // 4. WebKit with an iPhone profile, when WebKit can start here.
    if (o.webkit) {
      try {
        const webkit = await pw.webkit.launch({ timeout: 30000 })
        browsers.push(webkit)
        const device = pw.devices['iPhone 15'] || pw.devices['iPhone 14'] || pw.devices['iPhone 13']
        for (const theme of o.themes) {
          const wctx = await webkit.newContext({ ...device, colorScheme: theme })
          const wpage = await wctx.newPage()
          const where = `webkit iPhone ${theme}`
          wpage.on('pageerror', e => findings.push({ level: 'error', id: 'console/exception', msg: String(e.message || e).slice(0, 300), where }))
          wpage.on('console', m => { if (m.type() === 'error') findings.push({ level: 'error', id: 'console/error', msg: m.text().slice(0, 300), where }) })
          await wpage.goto(url, { waitUntil: 'load', timeout: 45000 })
          await wpage.waitForTimeout(800)
          const file = path.join(o.out, `webkit-iphone-${theme}.png`)
          await wpage.screenshot({ path: file, fullPage: Boolean(o.full) })
          shots.push({ label: where, file })
          const c = await wpage.evaluate(pageChecks, { tapTargetPx: BUDGETS.tapTargetPx, mobile: true, viewportWidth: device.viewport.width })
          findings.push(...c.findings.filter(f => f.id === 'layout/overflow-x').map(f => ({ ...f, where })))
          await wctx.close()
        }
      } catch (e) {
        skipped.push(`WebKit iPhone pass: WebKit could not start here (${e.message.split('\n').find(l => /missing|Executable|not found/i.test(l))?.trim() || e.message.split('\n')[0]}). Install it with: npx playwright-core install --with-deps webkit`)
      }
    }

    const report = { url: o.target === url ? url : `${o.target} (served at ${url})`, when: new Date().toISOString(), perf, findings: sortFindings(findings), shots, skipped }
    fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(o.out, 'report.md'), renderReport(report))
    if (o.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    else process.stdout.write(renderReport(report) + `\nReport: ${path.join(o.out, 'report.md')}\n`)
    process.exitCode = report.findings.some(f => f.level === 'error') ? 1 : 0
  } finally {
    for (const b of browsers) await b.close().catch(() => {})
    if (server) await server.close()
  }
}

if (process.argv[1] && process.argv[1].endsWith('site-qa.mjs')) {
  main().catch(e => { console.error('site-qa: ' + (e && e.message ? e.message : e)); process.exit(2) })
}
