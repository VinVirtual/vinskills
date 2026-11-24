#!/usr/bin/env node
// vin-docs: any document to clean Markdown, locally.
//   node vin-docs.mjs report.pdf                 → report.md next to it, summary on stdout
//   node vin-docs.mjs deck.pptx --stdout --max 20000
import fs from 'node:fs'
import path from 'node:path'
import { docxToMarkdown, xlsxToMarkdown, pptxToMarkdown } from './lib/office.mjs'
import { htmlToMarkdown } from './lib/html.mjs'
import { pdfToMarkdown } from './lib/pdf.mjs'
import { budget } from './lib/markdown.mjs'

const HELP = `vin-docs — convert PDF, DOCX, XLSX, PPTX or HTML to Markdown on this machine

Usage: vin-docs.mjs <file> [options]

Options:
  -o, --out <file.md>   where to write (default: <file>.md next to the input; "-" = stdout)
  --stdout              print the Markdown instead of writing a file
  --max <chars>         cap printed Markdown at this size (default 60000); the file is always complete
  --max-mb <n>          refuse inputs larger than this (default 50)
  --pages <n>           PDF: convert at most n pages (default 300)
  --base <url>          HTML: resolve relative links against this URL
  --keep-nav            HTML: keep <nav> blocks
  -h, --help

PDF needs pdftotext (poppler). DOCX, XLSX, PPTX and HTML need nothing extra.
Old binary formats (.doc .xls .ppt) are not read directly: convert them first, e.g.
  soffice --headless --convert-to docx file.doc
`

export const KINDS = { '.pdf': 'pdf', '.docx': 'docx', '.xlsx': 'xlsx', '.xlsm': 'xlsx', '.pptx': 'pptx', '.html': 'html', '.htm': 'html', '.xhtml': 'html' }

export function parseArgs (argv) {
  const o = { max: 60000, maxMb: 50, pages: 300 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    const num = (lo, hi) => { const n = Number(next()); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${a} must be ${lo}..${hi}`); return n }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '-o' || a === '--out') o.out = next()
    else if (a === '--stdout') o.out = '-'
    else if (a === '--max') o.max = num(0, 1e8)
    else if (a === '--max-mb') o.maxMb = num(1, 2000)
    else if (a === '--pages') o.pages = num(1, 100000)
    else if (a === '--base') o.base = next()
    else if (a === '--keep-nav') o.keepNav = true
    else if (!a.startsWith('-') && !o.file) o.file = a
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

/** Detect the kind from the extension, then confirm from the first bytes. */
export function detectKind (file, head) {
  const ext = path.extname(file).toLowerCase()
  const kind = KINDS[ext]
  if (['.doc', '.xls', '.ppt'].includes(ext)) throw new Error(`${ext} is an old binary format; convert it first: soffice --headless --convert-to ${ext.slice(1)}x "${path.basename(file)}"`)
  if (!kind) throw new Error(`unsupported file type ${ext || '(none)'}; supported: ${Object.keys(KINDS).join(' ')}`)
  if (kind === 'pdf' && head.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('file does not start like a PDF')
  if (['docx', 'xlsx', 'pptx'].includes(kind) && head.readUInt32LE(0) !== 0x04034b50) throw new Error(`file is not a ${kind.toUpperCase()} (not a ZIP archive)`)
  return kind
}

export function convert (file, o = {}) {
  const st = fs.statSync(file)
  if (!st.isFile()) throw new Error(`not a file: ${file}`)
  const maxMb = o.maxMb ?? 50
  if (st.size > maxMb * 1024 * 1024) throw new Error(`file is ${(st.size / 1048576).toFixed(1)} MB; the limit is ${maxMb} MB (raise with --max-mb)`)
  const buf = fs.readFileSync(file)
  const kind = detectKind(file, buf.length >= 8 ? buf : Buffer.concat([buf, Buffer.alloc(8)]))
  const info = { kind, bytes: st.size }
  let md
  if (kind === 'pdf') {
    const r = pdfToMarkdown(file, { maxPages: o.pages ?? 300 })
    md = r.markdown
    info.pages = r.pages
    if (r.scanned) info.warning = 'almost no text found: this PDF is probably scanned images and needs OCR'
  } else if (kind === 'docx') md = docxToMarkdown(buf)
  else if (kind === 'xlsx') md = xlsxToMarkdown(buf)
  else if (kind === 'pptx') md = pptxToMarkdown(buf)
  else md = htmlToMarkdown(buf.toString('utf8'), { base: o.base, keepNav: o.keepNav })
  info.chars = md.length
  info.tables = (md.match(/^\| ---/gm) || []).length
  return { markdown: md, info }
}

function main () {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error('vin-docs: ' + e.message); process.exit(2) }
  if (o.help || !o.file) { process.stdout.write(HELP); process.exit(o.help ? 0 : 2) }
  let r
  try { r = convert(o.file, o) } catch (e) { console.error('vin-docs: ' + e.message); process.exit(1) }
  const { info } = r
  if (o.out === '-') {
    const b = budget(r.markdown, o.max)
    process.stdout.write(b.text)
    if (info.warning) console.error('vin-docs: ' + info.warning)
    return
  }
  const out = o.out || o.file.replace(/\.[^.]+$/, '') + '.md'
  if (path.resolve(out) === path.resolve(o.file)) { console.error('vin-docs: output would overwrite the input'); process.exit(2) }
  fs.writeFileSync(out, r.markdown)
  const preview = budget(r.markdown, Math.min(o.max, 1500)).text
  process.stdout.write(`${out}\n${info.kind}, ${info.pages ? info.pages + ' pages, ' : ''}${info.tables} tables, ${info.chars} chars (~${Math.ceil(info.chars / 4)} tokens)\n` +
    (info.warning ? 'warning: ' + info.warning + '\n' : '') + '\n' + preview)
}

if (process.argv[1] && process.argv[1].endsWith('vin-docs.mjs')) main()
