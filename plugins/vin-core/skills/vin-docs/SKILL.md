---
name: vin-docs
description: Convert documents to clean Markdown on this machine so they can be read, searched, quoted or summarised without a paid service. Handles PDF (via poppler's pdftotext, with page markers and table-like blocks kept aligned), Word DOCX (headings, bold and italic, lists, links, tables), Excel XLSX (one Markdown table per sheet), PowerPoint PPTX (one section per slide with titles, bullets, tables and speaker notes) and HTML (main content, headings, lists, links, code and tables, with scripts and navigation dropped). Writes the full Markdown to a file and prints a short preview, with size limits on input and printed output. Use when the user shares or points at a PDF, Word, Excel, PowerPoint or HTML file and wants it read, summarised, searched, compared, quoted, turned into notes or fed to another tool, or asks to convert a document to Markdown or text.
---

# vin-docs

Turn a document into Markdown once, then work from the Markdown.

## Run it

```bash
node scripts/vin-docs.mjs report.pdf                 # writes report.md, prints a summary and preview
node scripts/vin-docs.mjs deck.pptx -o notes/deck.md
node scripts/vin-docs.mjs table.xlsx --stdout --max 20000
node scripts/vin-docs.mjs page.html --base https://example.org/docs/
```

Paths are relative to this skill's folder. The written file is always complete; `--max` only
limits what is printed. `--max-mb` (default 50) refuses larger inputs, `--pages` (default 300)
limits PDF pages.

## Good habits

- **Write to a file, then read parts of it.** For a long document, convert, look at the preview
  and the size, then read the sections you need (search the .md for headings or page markers)
  rather than printing everything.
- **Cite pages**: PDF output has `<!-- page N -->` markers; quote with the page number.
- **Tables**: Office and HTML tables become Markdown tables. PDF has no real tables, so runs of
  column-aligned lines are kept in a fenced `text` block with the original spacing; read them
  as columns.
- **Check scanned PDFs**: if the summary says "almost no text found", the PDF is images. It
  needs OCR, which this skill does not do.

What each converter keeps and drops: `references/formats.md`.

## Needs

- Node.js 20+. DOCX, XLSX, PPTX and HTML need nothing else (the Office formats are read directly).
- PDF needs `pdftotext` and `pdfinfo` from poppler: `sudo apt install poppler-utils` or
  `brew install poppler`.
- Old binary formats (.doc, .xls, .ppt): convert first, for example
  `soffice --headless --convert-to docx old.doc`, then run vin-docs on the result.

## Limits

- Images, charts and drawings are not described (alt text in HTML is kept as `[image: ...]`).
- Merged cells in Office tables are flattened; formulas show their last saved value.
- PDF reading order follows pdftotext's layout mode; multi-column pages can interleave.

## Troubleshooting

- **"file is not a DOCX (not a ZIP archive)"**: it is probably an old .doc renamed; convert it.
- **"ZIP would expand past ..."**: the archive claims an unusually large size; it is refused on purpose.
- **Garbled PDF text**: the PDF uses fonts without a text mapping; only OCR helps.
