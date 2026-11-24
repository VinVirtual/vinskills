# How vin-burn counts

## Input

Every `*.jsonl` file under the transcripts folder (default `~/.claude/projects`), searched up to
six folders deep, symlinks not followed. Files last modified before the start of the period are
skipped. Only `user` and `assistant` lines are parsed; other line types are ignored.

## One turn = one API response

Claude Code can write one transcript line per content block of the same response, each carrying
the same usage numbers. vin-burn groups lines by session and message id (falling back to the
request id) and keeps the largest value of each usage field, so a response is counted once.

Usage fields read from `message.usage`:

| Field | Meaning |
|---|---|
| `input_tokens` | uncached input |
| `output_tokens` | output, including thinking |
| `cache_creation.ephemeral_5m_input_tokens` | cache writes, 5-minute lifetime |
| `cache_creation.ephemeral_1h_input_tokens` | cache writes, 1-hour lifetime |
| `cache_creation_input_tokens` | total cache writes (used when the split is missing) |
| `cache_read_input_tokens` | cache reads |

## Cost

`cost = (input x input_rate + output x output_rate + write5m x cache_write_5m + write1h x cache_write_1h + read x cache_read) / 1,000,000`

Rates are looked up by exact model id, then the id without a date suffix, then the longest
known prefix. No match means cost 0 and an entry under "Not priced".

## Tasks and categories

A task starts at each real user prompt (not tool results, not meta lines, not subagent prompts)
and holds every assistant turn until the next prompt. Category rules, first match wins:

1. Prompt words: debugging (fix, bug, error, fails, crash ...), testing (test, coverage, pytest ...),
   refactor (refactor, clean up, rename ...), docs (readme, docs, changelog ...), review (review,
   audit ...), feature (add, build, implement, create ...). A more specific word beats "feature":
   "add tests" is testing.
2. Tools used by the task's turns: none = conversation; test commands = testing; edits = coding;
   agents = delegation; web = research; mostly git = git; deploy/docker/ssh = ops;
   reads or shell = exploration.

## JSON output

```json
{
  "period": "7d (163 transcript files)",
  "total":   { "input": 0, "output": 0, "cacheWrite5m": 0, "cacheWrite1h": 0, "cacheRead": 0, "cost": 0, "turns": 0 },
  "tasks": 258,
  "byDay":      [{ "key": "2026-11-24", "...": "same fields as total" }],
  "byProject":  [], "byModel": [], "byTool": [], "byCategory": [],
  "unpriced":   [{ "model": "x", "turns": 3 }]
}
```

Projects are labelled by the last two parts of the session's working folder.
