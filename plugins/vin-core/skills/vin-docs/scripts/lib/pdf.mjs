// PDF to Markdown with poppler's pdftotext, one section per page.
// Commands run with argument arrays (never a shell) and a timeout.
import { spawnSync } from 'node:child_process'
import { tidy } from './markdown.mjs'

export function havePdftotext () {
  const r = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' })
  return !r.error
}

export function pageCount (file) {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8', timeout: 30000 })
  if (r.error || r.status !== 0) return null
  const m = /^Pages:\s+(\d+)/m.exec(r.stdout)
  return m ? Number(m[1]) : null
}

/** Lines that look like a table row in -layout output: 2+ columns split by 2+ spaces. */
export function layoutToMarkdown (pageText) {
  const lines = pageText.replace(/\f/g, '').split('\n')
  const out = []
  // A table-like line has 2+ cells separated by runs of 2+ spaces.
  const isRow = (l) => l.trim().length < 300 && l.trim().split(/\s{2,}/).length >= 2
  for (let i = 0; i < lines.length;) {
    if (!isRow(lines[i])) { out.push(lines[i].trim()); i++; continue }
    // Grow the run; single blank lines between rows are allowed.
    let j = i
    const run = []
    while (j < lines.length) {
      if (isRow(lines[j])) { run.push(lines[j].replace(/\s+$/, '')); j++; continue }
      if (!lines[j].trim() && j + 1 < lines.length && isRow(lines[j + 1])) { j++; continue }
      break
    }
    if (run.length >= 3) {
      // Keep the page layout so columns stay aligned; drop the common left margin.
      const margin = Math.min(...run.map(l => l.match(/^\s*/)[0].length))
      out.push('', '```text', ...run.map(l => l.slice(margin)), '```', '')
    } else out.push(...run.map(l => l.trim()))
    i = j
  }
  // Join wrapped lines of one paragraph; keep blank lines as paragraph breaks.
  const paras = []
  let cur = []
  let inFence = false
  for (const l of out) {
    if (l.startsWith('```')) { if (cur.length) { paras.push(cur.join(' ')); cur = [] } paras.push(l); inFence = !inFence; continue }
    if (inFence) { paras.push(l); continue }
    if (!l) { if (cur.length) { paras.push(cur.join(' ')); cur = [] } paras.push(''); continue }
    if (cur.length && cur[cur.length - 1].endsWith('-') && /^[a-z]/.test(l)) cur[cur.length - 1] = cur[cur.length - 1].slice(0, -1) + l
    else cur.push(l)
  }
  if (cur.length) paras.push(cur.join(' '))
  return paras.join('\n')
}

export function pdfToMarkdown (file, { maxPages = 300, timeoutMs = 120000 } = {}) {
  if (!havePdftotext()) throw new Error('pdftotext is not installed (Debian/Ubuntu: sudo apt install poppler-utils; macOS: brew install poppler)')
  const pages = pageCount(file)
  const last = pages ? Math.min(pages, maxPages) : maxPages
  const r = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-f', '1', '-l', String(last), file, '-'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 512 * 1024 * 1024 })
  if (r.error) throw new Error('pdftotext failed: ' + r.error.message)
  if (r.status !== 0) throw new Error('pdftotext failed: ' + (r.stderr || '').trim().split('\n').pop())
  const texts = r.stdout.split('\f')
  const out = []
  texts.forEach((t, i) => {
    if (i >= last || (!t.trim() && i === texts.length - 1)) return
    out.push(`<!-- page ${i + 1} -->`, '', layoutToMarkdown(t), '')
  })
  if (pages && pages > last) out.push(`… ${pages - last} more pages not converted (limit ${maxPages})`)
  const md = tidy(out.join('\n'))
  const words = md.replace(/<!--.*?-->/g, '').trim().split(/\s+/).filter(Boolean).length
  return { markdown: md, pages: pages ?? texts.length, scanned: words < (pages || 1) * 2 }
}
