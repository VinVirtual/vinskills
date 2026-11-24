// DOCX, XLSX and PPTX to Markdown, reading the Office Open XML directly.
import { readZip } from './zip.mjs'
import { parseXml, findAll, first, attr, local, textOf } from './xml.mjs'
import { table, tidy } from './markdown.mjs'

// ---------- DOCX ----------

function runText (r) {
  let t = ''
  for (const c of r.children || []) {
    const n = c.name && local(c.name)
    if (n === 't') t += textOf(c)
    else if (n === 'tab') t += '\t'
    else if (n === 'br' || n === 'cr') t += '\n'
  }
  if (!t.trim()) return t
  const pr = first(r, 'rPr')
  const on = (tag) => { const n = pr && (pr.children || []).find(x => x.name && local(x.name) === tag); return n && !['0', 'false'].includes(attr(n, 'val')) }
  const bold = on('b')
  const italic = on('i')
  const lead = t.match(/^\s*/)[0]
  const trail = t.match(/\s*$/)[0]
  let core = t.trim()
  if (bold && italic) core = `***${core}***`
  else if (bold) core = `**${core}**`
  else if (italic) core = `*${core}*`
  return lead + core + trail
}

function paragraphText (p, rels) {
  let out = ''
  for (const c of p.children || []) {
    const n = c.name && local(c.name)
    if (n === 'r') out += runText(c)
    else if (n === 'hyperlink') {
      const inner = (c.children || []).filter(x => x.name && local(x.name) === 'r').map(runText).join('')
      const target = rels[attr(c, 'id')]
      out += target && inner.trim() ? `[${inner.trim()}](${target})` : inner
    } else if (n === 'ins' || n === 'smartTag' || n === 'sdt' || n === 'sdtContent') out += paragraphText(c, rels)
  }
  return out.replace(/\*\*\s*\*\*/g, '')
}

function headingLevel (p, styles) {
  const pPr = first(p, 'pPr')
  const style = pPr && first(pPr, 'pStyle')
  const id = style && attr(style, 'val')
  if (!id) return 0
  const name = (styles[id] || id).toLowerCase().replace(/\s+/g, '')
  if (name === 'title') return 1
  const m = /^heading(\d)$/.exec(name)
  return m ? Math.min(6, Number(m[1])) : 0
}

function listInfo (p) {
  const pPr = first(p, 'pPr')
  const num = pPr && first(pPr, 'numPr')
  if (!num) return null
  const lvl = first(num, 'ilvl')
  return { level: Number(attr(lvl, 'val') || 0) }
}

function docxTable (tbl, rels) {
  const rows = []
  for (const tr of (tbl.children || []).filter(c => c.name && local(c.name) === 'tr')) {
    const cells = []
    for (const tc of (tr.children || []).filter(c => c.name && local(c.name) === 'tc')) {
      const text = findAll(tc, 'p').map(p => paragraphText(p, rels).trim()).filter(Boolean).join('\n')
      const span = Number(attr(first(tc, 'gridSpan'), 'val') || 1)
      cells.push(text)
      for (let i = 1; i < span && i < 50; i++) cells.push('')
    }
    rows.push(cells)
  }
  return table(rows)
}

function relsOf (zip, part) {
  const xml = zip.text(part)
  if (!xml) return {}
  const out = {}
  for (const r of findAll(parseXml(xml), 'Relationship')) if (r.attrs.TargetMode === 'External' || /^https?:/.test(r.attrs.Target || '')) out[r.attrs.Id] = r.attrs.Target
  return out
}

export function docxToMarkdown (buf) {
  const zip = readZip(buf)
  const docXml = zip.text('word/document.xml')
  if (!docXml) throw new Error('not a Word document (no word/document.xml)')
  const styles = {}
  const stylesXml = zip.text('word/styles.xml')
  if (stylesXml) for (const s of findAll(parseXml(stylesXml), 'style')) { const nm = first(s, 'name'); if (attr(s, 'styleId') && nm) styles[attr(s, 'styleId')] = attr(nm, 'val') || '' }
  const rels = relsOf(zip, 'word/_rels/document.xml.rels')
  const body = first(parseXml(docXml), 'body')
  const out = []
  let n = 1
  for (const c of (body && body.children) || []) {
    const name = c.name && local(c.name)
    if (name === 'tbl') { out.push('', docxTable(c, rels), ''); continue }
    if (name !== 'p') continue
    const text = paragraphText(c, rels).trim()
    if (!text) { out.push(''); continue }
    const h = headingLevel(c, styles)
    const li = listInfo(c)
    if (h) out.push('', '#'.repeat(h) + ' ' + text.replace(/\*+/g, ''), '')
    else if (li) out.push('  '.repeat(li.level) + '- ' + text)
    else out.push(text, '')
    n++
  }
  return tidy(out.join('\n'))
}

// ---------- XLSX ----------

function colIndex (ref) {
  const letters = (/^[A-Z]+/.exec(ref || '') || ['A'])[0]
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function xlsxToMarkdown (buf, { maxRows = 2000, maxCols = 60 } = {}) {
  const zip = readZip(buf)
  const wbXml = zip.text('xl/workbook.xml')
  if (!wbXml) throw new Error('not an Excel workbook (no xl/workbook.xml)')
  const shared = []
  const ssXml = zip.text('xl/sharedStrings.xml')
  if (ssXml) for (const si of findAll(parseXml(ssXml), 'si')) shared.push(findAll(si, 't').map(textOf).join(''))
  const relXml = zip.text('xl/_rels/workbook.xml.rels')
  const targets = {}
  if (relXml) for (const r of findAll(parseXml(relXml), 'Relationship')) targets[r.attrs.Id] = r.attrs.Target
  const out = []
  for (const sh of findAll(parseXml(wbXml), 'sheet')) {
    const name = sh.attrs.name || 'Sheet'
    let target = targets[attr(sh, 'id')] || ''
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
    const xml = zip.text(target)
    out.push(`## ${name}`, '')
    if (!xml) { out.push('(sheet not found)', ''); continue }
    const rows = []
    let more = 0
    for (const row of findAll(parseXml(xml), 'row')) {
      if (rows.length >= maxRows) { more++; continue }
      const cells = []
      for (const c of findAll(row, 'c')) {
        const i = colIndex(c.attrs.r)
        if (i >= maxCols) continue
        const v = first(c, 'v')
        let val = v ? textOf(v) : ''
        const t = c.attrs.t
        if (t === 's') val = shared[Number(val)] ?? ''
        else if (t === 'inlineStr') val = findAll(c, 't').map(textOf).join('')
        else if (t === 'b') val = val === '1' ? 'TRUE' : 'FALSE'
        cells[i] = val
      }
      rows.push(Array.from(cells, x => x ?? ''))
    }
    out.push(rows.length ? table(rows) : '(empty sheet)', '')
    if (more) out.push(`… ${more} more rows not shown (limit ${maxRows})`, '')
  }
  return tidy(out.join('\n'))
}

// ---------- PPTX ----------

function slideOrder (zip) {
  const pres = zip.text('ppt/presentation.xml')
  const rels = zip.text('ppt/_rels/presentation.xml.rels')
  if (pres && rels) {
    const map = {}
    for (const r of findAll(parseXml(rels), 'Relationship')) map[r.attrs.Id] = 'ppt/' + r.attrs.Target.replace(/^\.\//, '').replace(/^\/ppt\//, '')
    const relId = (n) => Object.entries(n.attrs).find(([k]) => /:id$/.test(k))?.[1]
    const ordered = findAll(parseXml(pres), 'sldId').map(s => map[relId(s)]).filter(Boolean)
    if (ordered.length) return ordered
  }
  return zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()))
}

export function pptxToMarkdown (buf) {
  const zip = readZip(buf)
  const slides = slideOrder(zip)
  if (!slides.length) throw new Error('not a PowerPoint file (no slides)')
  const out = []
  slides.forEach((part, i) => {
    const xml = zip.text(part)
    if (!xml) return
    const doc = parseXml(xml)
    const shapes = findAll(doc, 'sp')
    let title = ''
    const body = []
    for (const sp of shapes) {
      const ph = first(sp, 'ph')
      const isTitle = ph && /title/i.test(ph.attrs.type || '')
      const paras = findAll(sp, 'p').map(p => ({ text: findAll(p, 't').map(textOf).join('').trim(), lvl: Number((first(p, 'pPr') || { attrs: {} }).attrs.lvl || 0) })).filter(p => p.text)
      if (isTitle && !title) title = paras.map(p => p.text).join(' ')
      else for (const p of paras) body.push('  '.repeat(p.lvl) + '- ' + p.text)
    }
    for (const tbl of findAll(doc, 'tbl')) {
      const rows = findAll(tbl, 'tr').map(tr => findAll(tr, 'tc').map(tc => findAll(tc, 't').map(textOf).join(' ')))
      body.push('', table(rows), '')
    }
    out.push(`## Slide ${i + 1}${title ? ': ' + title : ''}`, '', ...body, '')
    const notesRel = zip.text(part.replace('slides/', 'slides/_rels/') + '.rels')
    if (notesRel) {
      const nr = findAll(parseXml(notesRel), 'Relationship').find(r => /notesSlide/.test(r.attrs.Type || ''))
      const notes = nr && zip.text('ppt/' + nr.attrs.Target.replace(/^\.\.\//, ''))
      if (notes) {
        const txt = findAll(parseXml(notes), 'p').map(p => findAll(p, 't').map(textOf).join('').trim()).filter(t => t && !/^\d+$/.test(t)).join(' ')
        if (txt) out.push(`> Notes: ${txt}`, '')
      }
    }
  })
  return tidy(out.join('\n'))
}
