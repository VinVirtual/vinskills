// HTML to Markdown for article-like pages: headings, paragraphs, lists, links, code, tables.
// Scripts, styles, navigation chrome and forms are dropped.
import { decodeEntities } from './xml.mjs'
import { table, tidy } from './markdown.mjs'

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])
const DROP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'button', 'select', 'textarea', 'head'])

/** Tolerant HTML tree: {tag, attrs, children} and strings. */
export function parseHtml (html) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/\s*([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+|<)/gi
  let m
  let guard = 0
  while ((m = re.exec(html))) {
    if (++guard > 3_000_000) throw new Error('HTML is too large')
    const top = stack[stack.length - 1]
    if (m[1]) {
      const tag = m[1].toLowerCase()
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break }
    } else if (m[2]) {
      const tag = m[2].toLowerCase()
      const attrs = {}
      const ar = /([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g
      let a
      while ((a = ar.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '')
      const node = { tag, attrs, children: [] }
      top.children.push(node)
      if (DROP.has(tag)) {
        // Skip to the matching close tag without parsing the inside.
        const close = new RegExp(`</\\s*${tag}\\s*>`, 'ig')
        close.lastIndex = re.lastIndex
        const c = close.exec(html)
        re.lastIndex = c ? close.lastIndex : html.length
      } else if (!VOID.has(tag) && !m[0].endsWith('/>')) stack.push(node)
    } else if (m[4]) top.children.push(decodeEntities(m[4]))
  }
  return root
}

const inlineText = (n) => typeof n === 'string' ? n : n.children.map(inlineText).join('')

function inline (n, base) {
  if (typeof n === 'string') return n.replace(/\s+/g, ' ')
  const inner = () => n.children.map(c => inline(c, base)).join('')
  switch (n.tag) {
    case 'strong': case 'b': { const t = inner().trim(); return t ? `**${t}**` : '' }
    case 'em': case 'i': { const t = inner().trim(); return t ? `*${t}*` : '' }
    case 'code': return '`' + inlineText(n).replace(/`/g, 'ˋ') + '`'
    case 'br': return '  \n'
    case 'img': return n.attrs.alt ? `[image: ${n.attrs.alt}]` : ''
    case 'a': {
      const t = inner().trim()
      let href = n.attrs.href || ''
      if (/^\s*javascript:/i.test(href)) href = ''
      if (href && base && !/^[a-z]+:|^#/i.test(href)) { try { href = new URL(href, base).href } catch {} }
      return href && t ? `[${t}](${href})` : t
    }
    default: return inner()
  }
}

const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'blockquote', 'ul', 'ol', 'li', 'table', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'body', 'html', '#root', 'nav'])

function blocks (n, out, ctx) {
  if (typeof n === 'string') { if (n.trim()) out.push(n.replace(/\s+/g, ' ').trim()); return }
  const { base, skipNav } = ctx
  if (skipNav && (n.tag === 'nav' || n.attrs.role === 'navigation')) return
  if (/^h[1-6]$/.test(n.tag)) { out.push('', '#'.repeat(Number(n.tag[1])) + ' ' + inline(n, base).trim(), ''); return }
  switch (n.tag) {
    case 'p': case 'figcaption': case 'dt': case 'dd': { const t = inline(n, base).trim(); if (t) out.push(t, ''); return }
    case 'hr': out.push('', '---', ''); return
    case 'pre': out.push('', '```', inlineText(n).replace(/\n$/, ''), '```', ''); return
    case 'blockquote': { const sub = []; n.children.forEach(c => blocks(c, sub, ctx)); out.push(...tidy(sub.join('\n')).trim().split('\n').map(l => '> ' + l), ''); return }
    case 'ul': case 'ol': {
      let i = 1
      for (const li of n.children.filter(c => typeof c !== 'string' && c.tag === 'li')) {
        const own = li.children.filter(c => typeof c === 'string' || !['ul', 'ol'].includes(c.tag)).map(c => inline(c, base)).join('').trim()
        out.push('  '.repeat(ctx.depth || 0) + (n.tag === 'ol' ? `${i++}. ` : '- ') + own)
        for (const sub of li.children.filter(c => typeof c !== 'string' && ['ul', 'ol'].includes(c.tag))) blocks(sub, out, { ...ctx, depth: (ctx.depth || 0) + 1 })
      }
      if (!ctx.depth) out.push('')
      return
    }
    case 'table': {
      const rows = []
      const visit = (x) => { if (typeof x === 'string') return; if (x.tag === 'tr') rows.push(x.children.filter(c => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')).map(c => inline(c, base).trim())); else x.children.forEach(visit) }
      visit(n)
      out.push('', table(rows), '')
      return
    }
    default: {
      // Mixed content: gather inline runs between block children.
      let run = []
      const flush = () => { const t = run.join('').replace(/\s+/g, ' ').trim(); if (t) out.push(t, ''); run = [] }
      for (const c of n.children) {
        if (typeof c !== 'string' && BLOCK.has(c.tag)) { flush(); blocks(c, out, ctx) } else run.push(inline(c, base))
      }
      flush()
    }
  }
}

export function htmlToMarkdown (html, { base, keepNav = false } = {}) {
  const tree = parseHtml(html)
  const find = (n, tag) => { if (typeof n === 'string') return null; if (n.tag === tag) return n; for (const c of n.children) { const f = find(c, tag); if (f) return f } return null }
  const titleNode = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const main = find(tree, 'main') || find(tree, 'article') || find(tree, 'body') || tree
  const out = []
  const title = titleNode ? decodeEntities(titleNode[1]).replace(/\s+/g, ' ').trim() : ''
  blocks(main, out, { base, skipNav: !keepNav, depth: 0 })
  let md = tidy(out.join('\n'))
  if (title && !md.startsWith('# ')) md = `# ${title}\n\n` + md
  return md
}
