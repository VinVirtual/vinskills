// A small, forgiving XML reader: enough for Office Open XML parts.
// Produces nodes {name, attrs, children, text}; no DTDs, no entity expansion beyond the five
// predefined entities and numeric references (so no billion-laughs).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities (s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    }
    return ENT[e.toLowerCase()] ?? m
  })
}

export function parseXml (xml, { maxNodes = 2_000_000 } = {}) {
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  let nodes = 0
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    if (++nodes > maxNodes) throw new Error('XML part is too large')
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.children.push({ name: '#text', text: m[1] })
    else if (m[2]) {
      // Close the nearest matching element; tolerate stray closers.
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[2]) { stack.length = i; break }
    } else if (m[3]) {
      const attrs = {}
      const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a
      while ((a = ar.exec(m[4] || ''))) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '')
      const node = { name: m[3], attrs, children: [] }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.children.push({ name: '#text', text: decodeEntities(m[6]) })
  }
  return root
}

/** Local name without the namespace prefix: "w:p" -> "p". */
export const local = (name) => name.includes(':') ? name.slice(name.indexOf(':') + 1) : name

export function* walk (node) {
  yield node
  for (const c of node.children || []) yield * walk(c)
}

export function findAll (node, lname) {
  const out = []
  for (const n of walk(node)) if (n.name && local(n.name) === lname) out.push(n)
  return out
}

export function first (node, lname) {
  for (const n of walk(node)) if (n !== node && n.name && local(n.name) === lname) return n
  return null
}

export function attr (node, lname) {
  if (!node) return undefined
  for (const [k, v] of Object.entries(node.attrs || {})) if (local(k) === lname) return v
  return undefined
}

/** Concatenated text of a node. */
export function textOf (node) {
  if (node.name === '#text') return node.text
  return (node.children || []).map(textOf).join('')
}
