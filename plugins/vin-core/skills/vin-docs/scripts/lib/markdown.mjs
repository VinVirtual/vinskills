// Markdown helpers shared by the converters.

/** Escape a table cell: pipes and newlines would break the row. */
export function cell (s) {
  return String(s ?? '').replace(/\r?\n+/g, ' <br> ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/** Rows (arrays of strings) to a GitHub-style table. The first row is the header. */
export function table (rows) {
  const clean = rows.filter(r => r.some(c => String(c ?? '').trim() !== ''))
  if (!clean.length) return ''
  const width = Math.max(...clean.map(r => r.length))
  const pad = (r) => [...r.map(cell), ...Array(width - r.length).fill('')]
  const [head, ...body] = clean.map(pad)
  return [
    '| ' + head.map(c => c || ' ').join(' | ') + ' |',
    '| ' + head.map(() => '---').join(' | ') + ' |',
    ...body.map(r => '| ' + r.join(' | ') + ' |')
  ].join('\n')
}

/** Tidy the final document: no runs of blank lines, no trailing spaces. */
export function tidy (md) {
  return md.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Apply a character budget; returns {text, cut}. */
export function budget (md, maxChars) {
  if (!maxChars || md.length <= maxChars) return { text: md, cut: false }
  // Cut at a paragraph or page boundary near the limit.
  let at = md.lastIndexOf('\n\n', maxChars)
  if (at < maxChars * 0.6) at = maxChars
  return { text: md.slice(0, at) + `\n\n… (cut at ${maxChars} characters; ${md.length - at} more in the full output)\n`, cut: true }
}
