---
name: vin-squeeze
description: Shrink big command output, logs and JSON before they enter the context window, without losing the parts that matter. Strips colour codes, collapses repeated and same-shaped lines with counts, shortens stack traces to their first and last frames, always keeps error and warning lines, keeps the head and tail, and summarises large JSON as one line per field path (type, count, array lengths, number ranges, enum values) plus error-like fields and short samples. The untouched original is saved to a private temp file whose path is printed, so details can be opened later. Use when a command, test run, build, install, log file or API response is likely to be long (more than a few hundred lines or tens of kilobytes), when output was cut off or flooded the context, or when asked to summarise a log, trim output, save tokens or reduce context.
---

# vin-squeeze

Pipe long output through it. Read the short version. Open the original only if you need a detail.

## Use

```bash
npm test 2>&1 | node scripts/vin-squeeze.mjs
node scripts/vin-squeeze.mjs build.log --max 6000
gh api repos/OWNER/REPO/issues --paginate | node scripts/vin-squeeze.mjs
docker compose logs --no-color api | node scripts/vin-squeeze.mjs --frames 2
```

Paths are relative to this skill's folder. The last line always says what happened:

```
[vin-squeeze] text: 19698 → 334 chars (~4925 → ~84 tokens, -98%); original: /tmp/vin-squeeze/2026-...txt
```

Token counts there are a rough 4-characters-per-token estimate.

## When to reach for it

- Test suites, builds, package installs, linters with many warnings.
- Server and container logs.
- Any JSON API response bigger than a few kilobytes, when you need its shape or a few fields.
  If you already know exactly what to extract, the `vin-scriptlens` skill is better: run a small
  script over the JSON and get only the answer.

Do **not** squeeze output you must read exactly (a diff you will apply, a file you will edit).

## What it keeps

Text:
1. Every line that looks like an error or warning (error, fail, exception, traceback, panic,
   denied, timeout, not found, assert ...).
2. The first 40 and last 60 lines.
3. One example of each group of same-shaped lines (numbers, ids, timestamps and quoted values
   ignored when comparing) with a `[+N similar lines]` count.
4. Stack traces as the first frames, a `… N more frames` line, and the last frame.

JSON (only when it is over the budget):
- `Shape:` one line per path, such as `$[].commit.author.name  string  ×30  values "A", "B"`.
- `Error-like fields`: anything under keys named error, errors, exception, failure, warnings.
- `Sample`: the first items of each array with long strings cut.

Options: `--max <chars>` (default 12000), `--mode text|json`, `--frames <n>`, `--samples <n>`,
`--keep-dir <dir>`, `--no-keep`. Inputs over 200 MB are refused.

## Limits

- It decides by patterns, not meaning. An important line with no error-like word in the middle of
  a huge log can be dropped; it is still in the saved original.
- The saved original is in your temp folder (mode 600) and is not cleaned up automatically.
