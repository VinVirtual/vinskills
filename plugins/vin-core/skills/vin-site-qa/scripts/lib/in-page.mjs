// Functions evaluated inside the page by Playwright. They must be self-contained
// (no closures over this module) because they are serialised into the browser.

/** Quick accessibility and layout checks on the rendered page. */
export function pageChecks ({ tapTargetPx, mobile, viewportWidth }) {
  const out = []
  const push = (level, id, msg, where) => out.push({ level, id, msg, where })
  const short = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''
    return (el.tagName || '').toLowerCase() + id + cls
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent) || el.textContent || (el.querySelector('img[alt]')?.getAttribute('alt')) || (el.querySelector('svg title')?.textContent) || '').trim()

  const imgs = [...document.images]
  const noAlt = imgs.filter(i => !i.hasAttribute('alt') && visible(i))
  if (noAlt.length) push('error', 'a11y/img-alt', `${noAlt.length} visible image(s) without an alt attribute (use alt="" for decoration).`, noAlt.slice(0, 3).map(short).join(', '))
  const noSize = imgs.filter(i => !(i.getAttribute('width') && i.getAttribute('height')) && !i.closest('picture[data-sized]'))
  const controls = [...document.querySelectorAll('a[href], button, [role="button"], [role="link"]')].filter(visible)
  const unnamed = controls.filter(el => !name(el))
  if (unnamed.length) push('error', 'a11y/control-name', `${unnamed.length} link(s)/button(s) with no accessible name.`, unnamed.slice(0, 3).map(short).join(', '))
  const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(visible)
  const unlabeled = inputs.filter(el => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('title'))
  if (unlabeled.length) push('error', 'a11y/input-label', `${unlabeled.length} form field(s) without a label.`, unlabeled.slice(0, 3).map(short).join(', '))
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible)
  const h1s = hs.filter(h => h.tagName === 'H1').length
  if (h1s === 0) push('warn', 'a11y/no-h1', 'No visible <h1>.')
  if (h1s > 1) push('info', 'a11y/multi-h1', `${h1s} visible <h1> elements.`)
  for (let i = 1; i < hs.length; i++) {
    const a = Number(hs[i - 1].tagName[1]); const b = Number(hs[i].tagName[1])
    if (b > a + 1) { push('info', 'a11y/heading-skip', `Heading level jumps from h${a} to h${b}.`, short(hs[i])); break }
  }
  const ids = new Map()
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1)
  const dup = [...ids.entries()].filter(([, n]) => n > 1)
  if (dup.length) push('warn', 'a11y/duplicate-id', `${dup.length} duplicate id(s): ${dup.slice(0, 5).map(([k]) => '#' + k).join(' ')}`)
  if (!document.querySelector('main, [role="main"]')) push('info', 'a11y/no-main', 'No <main> landmark.')
  if (mobile) {
    const small = controls.filter(el => { const r = el.getBoundingClientRect(); return (r.width < tapTargetPx || r.height < tapTargetPx) && el.textContent.trim().length < 40 && getComputedStyle(el).display !== 'inline' })
    if (small.length) push('info', 'a11y/tap-target', `${small.length} tap target(s) smaller than ${tapTargetPx}px.`, small.slice(0, 3).map(short).join(', '))
    // On phones the browser may widen the layout viewport to fit overflowing content,
    // so compare with the width we asked for, not window.innerWidth.
    const sw = document.documentElement.scrollWidth; const vw = viewportWidth || window.innerWidth
    if (sw > vw + 1) push('error', 'layout/overflow-x', `Page scrolls sideways at ${vw}px wide (content is ${sw}px).`)
  }
  const words = (document.body?.innerText || '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length
  return { findings: out, renderedWords: words, imagesWithoutSize: noSize.length }
}

/** Web-vitals style numbers from the performance timeline, after load. */
export function collectPerf () {
  return new Promise((resolve) => {
    let lcp = null
    let cls = 0
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value }).observe({ type: 'layout-shift', buffered: true })
    } catch {}
    setTimeout(() => {
      const res = performance.getEntriesByType('resource')
      const nav = performance.getEntriesByType('navigation')[0]
      const kb = (xs) => xs.reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0) / 1024
      const js = res.filter(e => e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name))
      resolve({
        lcpMs: lcp,
        cls: Math.round(cls * 1000) / 1000,
        jsKb: kb(js) + 0,
        totalKb: kb(res) + (nav ? (nav.transferSize || nav.encodedBodySize || 0) / 1024 : 0),
        requests: res.length + 1
      })
    }, 1500)
  })
}

/** Animations still running after reduced motion was requested (infinite ones are the problem). */
export function runningAnimations () {
  if (!document.getAnimations) return { infinite: 0, running: 0, examples: [] }
  const anims = document.getAnimations().filter(a => a.playState === 'running')
  const infinite = anims.filter(a => { const t = a.effect && a.effect.getTiming && a.effect.getTiming(); return t && t.iterations === Infinity })
  const ex = infinite.slice(0, 3).map(a => { const el = a.effect && a.effect.target; return el ? el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') : 'animation' })
  return { infinite: infinite.length, running: anims.length, examples: ex }
}
