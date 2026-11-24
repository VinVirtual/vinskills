// Pure checks for vin-site-qa: CSP, security headers, raw-HTML SEO/prerender, budgets, report.
// No browser here, so everything in this file is unit-tested.

export const BUDGETS = {
  lcpMs: 2500,
  cls: 0.1,
  jsKbApp: 300,      // gzipped JS transferred, app page
  jsKbLanding: 150,  // landing page
  tapTargetPx: 24
}

/** Parse a CSP string into {directive: [sources]}. Later duplicates are ignored, as browsers do. */
export function parseCsp (policy) {
  const out = {}
  for (const part of String(policy || '').split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/)
    if (!name) continue
    const d = name.toLowerCase()
    if (!(d in out)) out[d] = vals
  }
  return out
}

/** Findings for a Content-Security-Policy. level: error | warn | info */
export function analyzeCsp (policy, { source = 'header' } = {}) {
  const f = []
  if (!policy) return [{ level: 'warn', id: 'csp/missing', msg: 'No Content-Security-Policy (header or meta). Add one; start with default-src \'self\'.' }]
  const csp = parseCsp(policy)
  const script = csp['script-src'] || csp['default-src']
  if (!script) f.push({ level: 'warn', id: 'csp/no-script-src', msg: 'Neither script-src nor default-src is set, so scripts are unrestricted.' })
  else {
    const hasNonceOrHash = script.some(s => /^'(nonce|sha(256|384|512))-/.test(s))
    const strictDynamic = script.includes("'strict-dynamic'")
    if (script.includes("'unsafe-inline'") && !hasNonceOrHash) f.push({ level: 'warn', id: 'csp/unsafe-inline', msg: "script-src allows 'unsafe-inline' without a nonce or hash: inline script injection is not blocked." })
    if (script.includes("'unsafe-eval'")) f.push({ level: 'warn', id: 'csp/unsafe-eval', msg: "script-src allows 'unsafe-eval'." })
    if (script.some(s => s === '*' || s === 'http:' || s === 'https:' || s === 'data:') && !strictDynamic) f.push({ level: 'warn', id: 'csp/wildcard-script', msg: `script-src allows a broad source (${script.filter(s => ['*', 'http:', 'https:', 'data:'].includes(s)).join(' ')}).` })
  }
  if (!csp['object-src'] && !(csp['default-src'] || []).includes("'none'")) f.push({ level: 'info', id: 'csp/object-src', msg: "Set object-src 'none'." })
  if (!csp['base-uri']) f.push({ level: 'info', id: 'csp/base-uri', msg: "Set base-uri 'self' (or 'none')." })
  if (!csp['frame-ancestors']) {
    f.push({ level: 'info', id: 'csp/frame-ancestors', msg: source === 'meta' ? 'frame-ancestors is ignored in a <meta> CSP; send it as a header (or X-Frame-Options).' : "Set frame-ancestors 'none' or 'self' to stop clickjacking." })
  }
  if (source === 'meta') f.push({ level: 'info', id: 'csp/meta', msg: 'CSP comes from a <meta> tag; a response header is stronger (it also covers frame-ancestors and report-to).' })
  return f
}

/** Other response headers worth having. `headers` keys are lower-case. */
export function analyzeHeaders (headers, url) {
  const f = []
  const h = headers || {}
  const https = /^https:/i.test(url || '')
  if (https && !h['strict-transport-security']) f.push({ level: 'info', id: 'headers/hsts', msg: 'No Strict-Transport-Security header.' })
  if ((h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') f.push({ level: 'info', id: 'headers/nosniff', msg: 'Set X-Content-Type-Options: nosniff.' })
  if (!h['referrer-policy']) f.push({ level: 'info', id: 'headers/referrer', msg: 'No Referrer-Policy header (browsers default to strict-origin-when-cross-origin).' })
  return f
}

const attrOf = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null
}

function metaContent (html, key, value) {
  const re = /<meta\b[^>]*>/gi
  let m
  while ((m = re.exec(html))) {
    const v = attrOf(m[0], key)
    if (v && v.toLowerCase() === value.toLowerCase()) return attrOf(m[0], 'content')
  }
  return null
}

/** Visible words in an HTML string (scripts, styles, tags removed). */
export function visibleWords (html) {
  const text = String(html)
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
  return text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
}

/** What a crawler sees before JavaScript runs. */
export function seoFromHtml (html, url = '') {
  const s = String(html || '')
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1]
  const htmlTag = (/<html\b[^>]*>/i.exec(s) || [''])[0]
  const canonical = (() => { const m = /<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(s); return m ? attrOf(m[0], 'href') : null })()
  const info = {
    title: title ? title.replace(/\s+/g, ' ').trim() : null,
    description: metaContent(s, 'name', 'description'),
    canonical,
    ogTitle: metaContent(s, 'property', 'og:title'),
    ogImage: metaContent(s, 'property', 'og:image'),
    twitterCard: metaContent(s, 'name', 'twitter:card'),
    robots: metaContent(s, 'name', 'robots'),
    viewport: metaContent(s, 'name', 'viewport'),
    lang: attrOf(htmlTag, 'lang'),
    h1InRaw: (s.match(/<h1\b/gi) || []).length,
    rawWords: visibleWords(s),
    jsonLd: (s.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json/gi) || []).length
  }
  const f = []
  if (!info.title) f.push({ level: 'error', id: 'seo/title', msg: 'No <title> in the HTML.' })
  else if (info.title.length > 65) f.push({ level: 'info', id: 'seo/title-long', msg: `Title is ${info.title.length} characters; search results cut around 60.` })
  if (!info.description) f.push({ level: 'warn', id: 'seo/description', msg: 'No meta description.' })
  if (!info.canonical) f.push({ level: 'info', id: 'seo/canonical', msg: 'No canonical link.' })
  if (!info.ogTitle || !info.ogImage) f.push({ level: 'info', id: 'seo/og', msg: 'Missing og:title or og:image, so link previews will be plain.' })
  if (!info.viewport) f.push({ level: 'error', id: 'seo/viewport', msg: 'No viewport meta: phones will render the desktop layout zoomed out.' })
  if (!info.lang) f.push({ level: 'warn', id: 'a11y/lang', msg: '<html> has no lang attribute.' })
  if (info.robots && /noindex/i.test(info.robots)) f.push({ level: 'warn', id: 'seo/noindex', msg: `robots meta says "${info.robots}".` })
  if (info.h1InRaw === 0) f.push({ level: 'warn', id: 'prerender/h1', msg: 'No <h1> in the HTML before JavaScript runs.' })
  if (info.rawWords < 50) f.push({ level: 'warn', id: 'prerender/thin', msg: `Only ${info.rawWords} words in the HTML before JavaScript runs: crawlers and link previews may see an empty page. Prerender or server-render it.` })
  if (url && info.canonical && /^https?:/i.test(info.canonical)) {
    try { if (new URL(info.canonical).host !== new URL(url).host) f.push({ level: 'info', id: 'seo/canonical-host', msg: `Canonical points at another host (${new URL(info.canonical).host}).` }) } catch {}
  }
  return { info, findings: f }
}

/** Compare rendered words with raw words: a big gap means the content needs JavaScript. */
export function prerenderGap (rawWords, renderedWords) {
  if (renderedWords < 80) return null
  const ratio = rawWords / renderedWords
  if (ratio < 0.5) return { level: 'warn', id: 'prerender/gap', msg: `Only ${Math.round(ratio * 100)}% of the rendered text is in the HTML; the rest needs JavaScript.` }
  return null
}

/** Budget findings for one page load. */
export function grade (perf, { pageType = 'app' } = {}) {
  const f = []
  const jsBudget = pageType === 'landing' ? BUDGETS.jsKbLanding : BUDGETS.jsKbApp
  if (perf.lcpMs != null && perf.lcpMs > BUDGETS.lcpMs) f.push({ level: 'warn', id: 'perf/lcp', msg: `LCP ${Math.round(perf.lcpMs)} ms (target < ${BUDGETS.lcpMs} ms, measured without throttling).` })
  if (perf.cls != null && perf.cls > BUDGETS.cls) f.push({ level: 'warn', id: 'perf/cls', msg: `CLS ${perf.cls.toFixed(3)} (target < ${BUDGETS.cls}).` })
  if (perf.jsKb != null && perf.jsKb > jsBudget) f.push({ level: 'warn', id: 'perf/js', msg: `${Math.round(perf.jsKb)} KB of JavaScript transferred (budget ${jsBudget} KB for a ${pageType} page).` })
  if (perf.imagesWithoutSize > 0) f.push({ level: 'info', id: 'perf/img-size', msg: `${perf.imagesWithoutSize} image(s) without width and height attributes (layout shift risk).` })
  return f
}

const ORDER = { error: 0, warn: 1, info: 2 }

export function sortFindings (findings) {
  const seen = new Set()
  return findings
    .filter(x => { const k = x.level + x.id + x.msg; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.id.localeCompare(b.id))
}

/** A short Markdown report. */
export function renderReport (r) {
  const findings = sortFindings(r.findings)
  const count = (l) => findings.filter(f => f.level === l).length
  const lines = [
    `# Site QA: ${r.url}`,
    '',
    `${count('error')} errors, ${count('warn')} warnings, ${count('info')} notes. Run ${r.when}.`,
    ''
  ]
  if (r.perf) {
    lines.push('## Load (Chromium, desktop 1440, no throttling)', '',
      `| LCP | CLS | JS transferred | All transferred | Requests |`,
      `| --- | --- | --- | --- | --- |`,
      `| ${r.perf.lcpMs != null ? Math.round(r.perf.lcpMs) + ' ms' : 'n/a'} | ${r.perf.cls != null ? r.perf.cls.toFixed(3) : 'n/a'} | ${r.perf.jsKb != null ? Math.round(r.perf.jsKb) + ' KB' : 'n/a'} | ${r.perf.totalKb != null ? Math.round(r.perf.totalKb) + ' KB' : 'n/a'} | ${r.perf.requests ?? 'n/a'} |`, '')
  }
  lines.push('## Findings', '')
  if (!findings.length) lines.push('Nothing found.')
  for (const f of findings) lines.push(`- **${f.level}** \`${f.id}\`${f.where ? ` (${f.where})` : ''}: ${f.msg}`)
  if (r.shots && r.shots.length) {
    lines.push('', '## Screenshots', '')
    for (const s of r.shots) lines.push(`- ${s.label}: \`${s.file}\``)
  }
  if (r.skipped && r.skipped.length) lines.push('', '## Not checked', '', ...r.skipped.map(s => `- ${s}`))
  lines.push('', 'Automated checks catch a lot, not everything: still look at the screenshots, try the keyboard, and run a full accessibility audit before launch.')
  return lines.join('\n') + '\n'
}

/** A free port in the house range (41000-49999), picked at random. */
export function randomPort (rand = Math.random) {
  return 41000 + Math.floor(rand() * 9000)
}
