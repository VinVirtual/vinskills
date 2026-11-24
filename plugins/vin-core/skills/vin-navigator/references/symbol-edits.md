# Symbol-scoped edits

The idea: get the exact current text of one symbol, change only that, verify with refs.

## Change a function body

1. `vin-nav.mjs show handleUpload` (note the file and line range).
2. Edit with an exact-match replacement of a distinctive part of that body. Keep the match
   inside the shown range so it cannot hit a same-looking block elsewhere.
3. Run the tests that cover the file.

## Rename a symbol

1. `vin-nav.mjs refs oldName` and save the list (`--json` is handy).
2. Change the definition, then each use from the list. Skip hits inside unrelated symbols of the
   same name (the "in" column shows where each hit sits).
3. `vin-nav.mjs refs oldName` again: expect 0 uses. `vin-nav.mjs find newName`: expect 1 definition.

## Change a signature

1. `refs` the function; count call sites.
2. Change the definition. Update each call site, file by file, reading only the enclosing symbol
   of each hit (`show <enclosing name>`).
3. Run the type checker or tests.

## Move a function to another file

1. `show fnName` and copy the exact text.
2. Add it to the new file; delete it from the old one (exact match on the shown text).
3. `refs fnName` across the repo to fix imports.

## Understand a call chain

`refs a` shows what calls `a` and from where; `show` each caller you care about. Three levels
of this usually explain a feature without opening a single whole file.
