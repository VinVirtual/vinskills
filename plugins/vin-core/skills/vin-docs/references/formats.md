# What each converter keeps

| Format | Kept | Dropped or simplified |
|---|---|---|
| PDF | text in reading order (pdftotext layout mode), `<!-- page N -->` markers, column-aligned runs in a fenced block, hyphenated line breaks joined | images, fonts, exact positions; multi-column pages may interleave |
| DOCX | headings (Heading 1-6, Title), paragraphs, bold/italic, bulleted and numbered lists (as bullets, nested by level), external links, tables (merged cells flattened) | images, comments, footnotes, headers/footers, tracked deletions |
| XLSX | one `## Sheet` section per sheet with a table of cell values (shared strings, inline strings, booleans) | formulas (last saved value is shown), formatting, charts, hidden-state; rows after 2000 and columns after 60 |
| PPTX | one `## Slide N: title` per slide in presentation order, bullets with indent levels, tables, speaker notes as `> Notes:` | images, shapes without text, animations, layouts |
| HTML | `<main>` or `<article>` (else `<body>`), headings, paragraphs, lists, links (resolved with `--base`), code blocks, tables, image alt text, the page title | scripts, styles, forms, iframes, SVG, `<nav>` (unless `--keep-nav`) |

## Safety

- Input size limit (`--max-mb`, default 50 MB).
- Office files: the ZIP reader refuses archives with more than 5,000 entries or that declare more
  than 300 MB uncompressed, and caps each entry's inflated size at its declared size.
- XML is parsed without DTDs or custom entities, so entity-expansion tricks do nothing.
- PDF tools run with argument arrays (no shell) and a timeout.
- `javascript:` links in HTML are dropped.
