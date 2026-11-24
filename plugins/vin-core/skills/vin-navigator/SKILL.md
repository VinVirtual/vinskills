---
name: vin-navigator
description: Navigate code by symbol instead of reading whole files. Builds a symbol index for a repository (Universal Ctags when installed, otherwise a built-in extractor for JavaScript, TypeScript, Python, Go and Swift) and answers where a function, class, method, type or constant is defined, where it is used and inside which function, what a file contains with line ranges, and prints just one symbol's source with line numbers so an edit can target exactly that block. Use when exploring an unfamiliar codebase, before editing a function in a large file, when asked "where is X defined", "who calls X", "what uses this", "show me this function", for a repo map or outline, for renames and other symbol-scoped changes, or whenever reading a whole file would waste context.
---

# vin-navigator

Read the 30 lines you need, not the 3,000-line file they live in.

## Commands

```bash
N="node scripts/vin-nav.mjs --root /path/to/repo"
$N map                      # every file and its top-level symbols: a repo overview
$N find parseConfig         # where it is defined (file:start-end, kind, signature)
$N find Server.start        # a method by its class
$N find /^use[A-Z]/         # regex over names; --fuzzy for substring
$N show parseConfig         # just that symbol's source, with line numbers (--context 3, --all)
$N refs parseConfig         # whole-word uses outside the definition, with the enclosing symbol
$N outline src/server.ts    # symbols in one file with line ranges
$N stats                    # files, symbols, engine
```

Paths are relative to this skill's folder. Add `--json` for structured output. The index is
cached in `$TMPDIR/vin-navigator/` and refreshed per file by size and modification time, so
repeat calls are fast; `--no-cache` skips it.

## How to work with it

1. **Start wide, cheaply**: `map` (or `outline` for one big file) instead of reading files.
2. **Locate**: `find` the symbol. If there are several, the file paths tell you which one.
3. **Read narrowly**: `show` the symbol. Read more of the file only if the symbol depends on
   things around it (use the line range with your file-reading tool's offset and limit).
4. **Check impact before changing a signature**: `refs` lists every use with the function it sits in.
5. **Edit the symbol**: the `show` output is the exact current text, so an exact-match edit
   of that block is safe. After a rename, run `refs` on the old name: it should find nothing.

Edit patterns for common symbol-scoped changes: `references/symbol-edits.md`.

## Engines

- **ctags** (used automatically when `ctags --version` reports Universal Ctags with JSON):
  many languages, exact end lines.
- **regex** (built in): JS/TS (functions, arrow functions, classes, methods, interfaces, types,
  enums, top-level constants), Python (classes, functions, methods, UPPER_CASE constants),
  Go (functions, methods, types, top-level const/var), Swift (classes, actors, structs, enums,
  protocols, extensions, functions). Ends come from brace matching or Python indentation. A `~`
  after a range means the end is approximate.

Force one with `--engine regex` or `--engine ctags`.

## Limits

- `refs` is a whole-word text search, not type-aware: a same-named symbol elsewhere also matches,
  and strings or comments containing the word are included. Read the enclosing-symbol column.
- The regex engine misses unusual layouts (a function signature split before its name, code
  generated at runtime). If `find` says nothing, try `--fuzzy` or `refs`.
- Files over 1 MB and folders like node_modules, dist, build, vendor and .venv are skipped.
  Inside a git repository the file list comes from `git ls-files`, so ignored files are skipped.

## Troubleshooting

- **"not indexed" for a file**: unsupported extension, too large, or gitignored.
- **Stale results**: the cache is keyed by size and mtime; `--no-cache` forces a fresh scan.
