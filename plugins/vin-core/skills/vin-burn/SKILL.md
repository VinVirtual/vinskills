---
name: vin-burn
description: See where Claude Code tokens and money go, from the session transcripts already on this machine. Reads ~/.claude/projects/**/*.jsonl, removes duplicate entries, and reports estimated cost and tokens (input, output, cache writes, cache reads, cache hit rate) by day, project, model, tool and task category (coding, debugging, feature, testing, refactor, docs, review, exploration, research, delegation, git, ops, conversation), as a terminal report, JSON or CSV. Prices come from an editable table; no network and no model calls. Use when the user asks what they spent, how many tokens a project or day used, which model or tool costs most, why usage is high, whether caching is working, for a weekly cost summary, a spend export for a spreadsheet, or "where did my tokens go".
---

# vin-burn

A cost lens over your own Claude Code transcripts. Read-only, local, fast.

## Run it

```bash
node scripts/vin-burn.mjs                 # last 7 days
node scripts/vin-burn.mjs today
node scripts/vin-burn.mjs 30d --project my-app
node scripts/vin-burn.mjs month --json > burn.json
node scripts/vin-burn.mjs --from 2026-11-01 --to 2026-11-15 --csv spend.csv
```

Paths are relative to this skill's folder. Periods: `today`, `yesterday`, `7d`, `30d`, `month`,
`all`, `<N>d`, `<N>h`. Other options: `--dir` (another transcripts folder), `--pricing <file>`,
`--limit <n>` rows per table, `--tz <zone>`.

## Reading the report

- **estimated cost**: list-price estimate. It is not your invoice and ignores plan discounts.
- **cache hit**: cache reads as a share of all input-side tokens. Long sessions should sit high;
  a low number on long work means the prompt prefix keeps changing.
- **By task category**: each user prompt starts a task. The task gets one category from the
  words of the prompt (fix, test, refactor, docs, review, add/build) and, failing that, from the
  tools its turns used (edits = coding, reads = exploration, web = research, agents = delegation).
  It is a rule-based label, useful for proportions, not a judgement of each task.
- **By tool**: a turn's cost is split evenly across the tools it called; turns with no tool show
  as `(text)`. Big `Read` or `Bash` shares usually mean large outputs entering context: see the
  `vin-squeeze` and `vin-scriptlens` skills.

How the numbers are computed, and the JSON shape: `references/how-it-counts.md`.

## Prices

Defaults live in `scripts/lib/pricing.json` (USD per million tokens, per model, with separate
cache-write and cache-read rates). Override or add models without editing it:

```json
{ "models": { "my-proxy-model": { "input": 3, "output": 15, "cache_write_5m": 3.75, "cache_write_1h": 6, "cache_read": 0.3 } } }
```

```bash
node scripts/vin-burn.mjs 30d --pricing my-prices.json
```

Models with no price are still counted in tokens and listed under "Not priced".

## Limits

- Only what is in the transcripts: sessions you deleted are gone, and other machines are not included.
- Costs are estimates from list prices; check your provider's console for billing.
- Subagent transcripts are included when Claude Code writes them under the projects folder.

## Troubleshooting

- **No transcripts folder**: pass `--dir` with the folder that holds your `*.jsonl` sessions.
- **"unreadable lines skipped"**: a session was being written while read, or a line was damaged. Harmless.
- **A new model shows under Not priced**: add it with `--pricing`.
