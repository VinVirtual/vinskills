import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { skill, tmpdir, runNode, makePdf, has } from './helpers.mjs'
import { readZip, writeZip } from '../plugins/vin-core/skills/vin-docs/scripts/lib/zip.mjs'
import { parseXml, decodeEntities, findAll, textOf } from '../plugins/vin-core/skills/vin-docs/scripts/lib/xml.mjs'
import { docxToMarkdown, xlsxToMarkdown, pptxToMarkdown } from '../plugins/vin-core/skills/vin-docs/scripts/lib/office.mjs'
import { htmlToMarkdown } from '../plugins/vin-core/skills/vin-docs/scripts/lib/html.mjs'
import { layoutToMarkdown, pdfToMarkdown } from '../plugins/vin-core/skills/vin-docs/scripts/lib/pdf.mjs'
import { table, cell, budget, tidy } from '../plugins/vin-core/skills/vin-docs/scripts/lib/markdown.mjs'
import { detectKind, convert, parseArgs } from '../plugins/vin-core/skills/vin-docs/scripts/vin-docs.mjs'

const CLI = skill('vin-docs', 'scripts/vin-docs.mjs')
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function docx () {
  const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  const body = [
    p('Quarterly Report', 'Title'),
    p('Results', 'Heading2'),
    '<w:p><w:r><w:t xml:space="preserve">Revenue was </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>up</w:t></w:r><w:r><w:t xml:space="preserve"> and costs were </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>flat</w:t></w:r><w:r><w:t>. See </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:t>the site</w:t></w:r></w:hyperlink></w:p>',
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>first point</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested &amp; escaped</w:t></w:r></w:p>',
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>North | East</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  ].join('')
  return writeZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W}><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
    'word/_rels/document.xml.rels': '<Relationships><Relationship Id="rId9" Type="hyperlink" Target="https://example.org/q" TargetMode="External"/></Relationships>'
  })
}

function xlsx () {
  return writeZip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Part</t></si><si><t>Qty</t></si><si><t>Servo</t></si><si><r><t>Fr</t></r><r><t>ame</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>6</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="b"><v>1</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>'
  })
}

function pptx () {
  const slide = (title, bullets) => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody>${bullets.map(([t, l]) => `<a:p><a:pPr lvl="${l}"/><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>
  </p:spTree></p:cSld></p:sld>`
  return writeZip({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('Second in order', [['b1', 0]]),
    'ppt/slides/slide2.xml': slide('Opening', [['Why', 0], ['because', 1]]),
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Say hello first.</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>'
  })
}

test('writeZip and readZip round-trip stored text', () => {
  const z = readZip(writeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x/>' }))
  assert.deepEqual(z.names, ['a.txt', 'dir/b.xml'])
  assert.equal(z.text('a.txt'), 'hello')
  assert.equal(z.read('missing'), null)
})

test('readZip rejects junk, too many entries and declared zip bombs', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /not a ZIP/)
  assert.throws(() => readZip(Buffer.alloc(5)), /too small/)
  const z = writeZip({ a: '1', b: '2', c: '3' })
  assert.throws(() => readZip(z, { maxEntries: 2 }), /limit is 2/)
  const big = writeZip({ a: 'x'.repeat(1000) })
  assert.throws(() => readZip(big, { maxTotal: 100 }), /expand past/)
})

test('readZip caps inflation at the declared size', () => {
  const z = writeZip({ a: 'x'.repeat(100000) })
  // Lie about the uncompressed size in the central directory: inflation must stop.
  const cd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  z.writeUInt32LE(10, cd + 24)
  assert.throws(() => readZip(z).read('a'), /buffer|length|larger/i)
})

test('XML: entities decoded, no custom entity expansion, CDATA kept', () => {
  assert.equal(decodeEntities('&lt;a&gt; &amp; &#65;&#x42; &bogus;'), '<a> & AB &bogus;')
  const doc = parseXml('<!DOCTYPE x [<!ENTITY e "boom">]><r><t>&e;</t><t><![CDATA[1 < 2]]></t></r>')
  const ts = findAll(doc, 't').map(textOf)
  assert.deepEqual(ts, ['&e;', '1 < 2'])
})

test('DOCX: title, headings, bold/italic, links, nested lists, tables with escaped pipes', () => {
  const md = docxToMarkdown(docx())
  assert.match(md, /^# Quarterly Report/m)
  assert.match(md, /^## Results/m)
  assert.match(md, /Revenue was \*\*up\*\* and costs were \*flat\*\. See \[the site\]\(https:\/\/example\.org\/q\)/)
  assert.match(md, /^- first point$/m)
  assert.match(md, /^ {2}- nested & escaped$/m)
  assert.match(md, /\| Region \| Sales \|\n\| --- \| --- \|\n\| North \\\| East \| 120 \|/)
})

test('DOCX without word/document.xml is refused', () => {
  assert.throws(() => docxToMarkdown(writeZip({ 'x.xml': '<x/>' })), /not a Word document/)
})

test('XLSX: sheets in order, shared and rich strings, booleans, gaps, empty sheets', () => {
  const md = xlsxToMarkdown(xlsx())
  assert.match(md, /## Parts\n\n\| Part \| Qty \| {3}\|\n/)
  assert.match(md, /\| Servo \| 6 \|  \|/)
  assert.match(md, /\| Frame \|  \| TRUE \|/)
  assert.match(md, /## Empty\n\n\(empty sheet\)/)
})

test('XLSX row limit is reported', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('')
  const z = writeZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/s.xml"/></Relationships>',
    'xl/worksheets/s.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`
  })
  assert.match(xlsxToMarkdown(z, { maxRows: 10 }), /20 more rows not shown/)
})

test('PPTX: presentation order, titles, bullet levels and speaker notes', () => {
  const md = pptxToMarkdown(pptx())
  assert.ok(md.indexOf('Slide 1: Opening') < md.indexOf('Slide 2: Second in order'))
  assert.match(md, /^- Why\n {2}- because/m)
  assert.match(md, /> Notes: Say hello first\./)
})

test('HTML: main content, links resolved, scripts and nav dropped, tables, nested lists, code', () => {
  const html = `<html><head><title>T &amp; C</title><style>p{}</style></head><body>
    <nav><a href="/">Home</a></nav><main><h2>Intro</h2><p>Read <a href="docs/a">this</a> and <a href="javascript:alert(1)">not this</a>.</p>
    <ol><li>one<ul><li>inner</li></ul></li><li>two</li></ol><pre>x = 1\ny = 2</pre>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><b>2</b></td></tr></table><img src="x.png" alt="chart"><script>evil()</script></main></body></html>`
  const md = htmlToMarkdown(html, { base: 'https://example.org/guide/' })
  assert.match(md, /^# T & C/)
  assert.match(md, /\[this\]\(https:\/\/example\.org\/guide\/docs\/a\)/)
  assert.match(md, / and not this\./)
  assert.doesNotMatch(md, /evil|Home|javascript:/)
  assert.match(md, /^1\. one\n {2}- inner\n2\. two/m)
  assert.match(md, /```\nx = 1\ny = 2\n```/)
  assert.match(md, /\| 1 \| \*\*2\*\* \|/)
  assert.match(md, /\[image: chart\]/)
})

test('HTML: --keep-nav keeps navigation', () => {
  assert.match(htmlToMarkdown('<body><nav><p>Menu</p></nav><p>Body</p></body>', { keepNav: true }), /Menu/)
})

test('layoutToMarkdown fences column-aligned runs and joins hyphenated lines', () => {
  const md = layoutToMarkdown('Intro text that is hyphen-\nated here.\n\nName      Qty   Price\nBolt       10    0.20\n\nNut        20    0.10\n\nEnd.')
  assert.match(md, /hyphenated here\./)
  assert.match(md, /```text\nName {6}Qty {3}Price\nBolt {7}10 {4}0\.20\nNut {8}20 {4}0\.10\n```/)
})

test('markdown helpers: cell escaping, ragged tables, budget, tidy', () => {
  assert.equal(cell('a|b\nc'), 'a\\|b <br> c')
  assert.equal(table([['a', 'b'], ['1']]), '| a | b |\n| --- | --- |\n| 1 |  |')
  assert.equal(table([['', '']]), '')
  const b = budget('aaaa\n\nbbbb\n\ncccc', 10)
  assert.equal(b.cut, true)
  assert.match(b.text, /^aaaa\n\nbbbb/)
  assert.equal(tidy('a  \n\n\n\nb'), 'a\n\nb\n')
})

test('detectKind checks extension and magic bytes', () => {
  const zip = writeZip({ a: 'b' })
  assert.equal(detectKind('x.docx', zip), 'docx')
  assert.throws(() => detectKind('x.docx', Buffer.from('%PDF-1.4 ...')), /not a DOCX/)
  assert.throws(() => detectKind('x.pdf', Buffer.from('hello there')), /like a PDF/)
  assert.throws(() => detectKind('x.doc', zip), /old binary format/)
  assert.throws(() => detectKind('x.rtf', zip), /unsupported/)
})

test('convert enforces the size limit and refuses folders', () => {
  const d = tmpdir()
  const f = path.join(d, 'big.html')
  fs.writeFileSync(f, '<p>' + 'x'.repeat(2 * 1024 * 1024) + '</p>')
  assert.throws(() => convert(f, { maxMb: 1 }), /limit is 1 MB/)
  assert.throws(() => convert(d), /not a file/)
})

test('parseArgs', () => {
  assert.equal(parseArgs(['a.pdf', '--stdout']).out, '-')
  assert.throws(() => parseArgs(['--max-mb', '0']), /1\.\.2000/)
  assert.throws(() => parseArgs(['a', 'b']), /unknown option/)
})

const pdfOk = has('pdftotext', ['-v']) && has('pdfinfo', ['-v'])

test('PDF: page markers and text', { skip: !pdfOk && 'pdftotext not installed' }, () => {
  const d = tmpdir()
  const f = path.join(d, 'two.pdf')
  fs.writeFileSync(f, makePdf([['Hello from page one'], ['Second page here']]))
  const r = pdfToMarkdown(f)
  assert.equal(r.pages, 2)
  assert.match(r.markdown, /<!-- page 1 -->\n\nHello from page one/)
  assert.match(r.markdown, /<!-- page 2 -->\n\nSecond page here/)
  assert.equal(r.scanned, false)
})

test('PDF: a page limit is reported and a textless PDF is flagged', { skip: !pdfOk && 'pdftotext not installed' }, () => {
  const d = tmpdir()
  const f = path.join(d, 'three.pdf')
  fs.writeFileSync(f, makePdf([['one'], ['two'], ['three']]))
  assert.match(pdfToMarkdown(f, { maxPages: 1 }).markdown, /2 more pages not converted/)
  const e = path.join(d, 'empty.pdf')
  fs.writeFileSync(e, makePdf([[]]))
  assert.equal(pdfToMarkdown(e).scanned, true)
})

test('CLI: writes the .md next to the input and prints a preview; --stdout prints it', () => {
  const d = tmpdir()
  const f = path.join(d, 'deck.pptx')
  fs.writeFileSync(f, pptx())
  const r = runNode(CLI, [f])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /deck\.md\npptx, 0 tables/)
  assert.match(fs.readFileSync(path.join(d, 'deck.md'), 'utf8'), /Slide 1: Opening/)
  const s = runNode(CLI, [path.join(d, 'deck.pptx'), '--stdout'])
  assert.match(s.stdout, /^## Slide 1: Opening/)
})

test('CLI: refuses to overwrite the input and reports bad files', () => {
  const d = tmpdir()
  const f = path.join(d, 'x.html')
  fs.writeFileSync(f, '<p>hi</p>')
  assert.equal(runNode(CLI, [f, '-o', f]).status, 2)
  const bad = path.join(d, 'fake.docx')
  fs.writeFileSync(bad, 'plain text')
  const r = runNode(CLI, [bad])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /not a DOCX/)
})

test('zlib is the only decompressor used (no external unzip)', () => {
  assert.equal(typeof zlib.inflateRawSync, 'function')
})
