---
name: vin-scriptlens
description: Run a small JavaScript snippet over a large JSON document (an API response, a log export, a data dump) so that only the snippet's result enters the context window. The snippet runs in a separate Node process with the permission system on (no file writes, no child processes, no workers), an empty environment, a fresh V8 context with no require, import, fetch or process, string eval disabled, a CPU timeout, a memory cap and a result size limit, and the tool reports how much smaller the result is than the input. Helpers include count, groupBy, sum, pick, uniq, sortBy, top and get. Use when a command or API returns more JSON than you need (GitHub, Jira, Stripe, cloud CLIs, analytics exports), when you need counts, filters, joins or a few fields from a big response, or when asked to process, aggregate or extract from JSON without pasting it all into the conversation.
---

# vin-scriptlens

Do the data work in a script; bring back only the answer.

## Use

```bash
gh api repos/OWNER/REPO/issues --paginate \
  | node scripts/vin-lens.mjs -e 'return count(data, i => i.state)'

node scripts/vin-lens.mjs export.json -e '
  const slow = data.requests.filter(r => r.ms > 1000)
  return { slow: slow.length, worst: top(slow, 5, r => r.ms).map(r => pick(r, "path", "ms")) }' --pretty

node scripts/vin-lens.mjs dump.json -f my-summary.js
```

Paths are relative to this skill's folder. The script is a function body: end with `return`.
`data` is the parsed JSON. The output ends with a size line, for example
`[vin-lens] data 25449 chars → result 670 chars (-97%)`.

## Writing good lens scripts

1. **Look at the shape first** if you do not know it: `return Object.keys(data)` or
   `return data.slice(0, 1)`, or squeeze it with the `vin-squeeze` skill.
2. **Return small things**: counts, top-N lists, a handful of fields per item, yes/no answers.
3. **One question per run.** Several small runs beat one script that returns everything.
4. `console.log(...)` lines are printed before the result (up to 200 lines), useful for checks.

Helpers available inside the script:

| Helper | Does |
|---|---|
| `count(xs, f)` | `{key: n}` occurrences of `f(x)` |
| `groupBy(xs, f)` | `{key: [items]}` |
| `sum(xs, f)` | numeric sum of `f(x)` |
| `pick(o, ...keys)` | object with only those keys |
| `uniq(xs)` | distinct values |
| `sortBy(xs, f, desc)` / `top(xs, n, f)` | sorted copy / first n by `f` descending |
| `get(o, "a.b.c")` | safe nested read |

More recipes: `references/recipes.md`.

## Isolation

| Layer | What it does |
|---|---|
| Child process | separate Node process, empty environment, killed after 10 s wall clock |
| Node permission model | `--permission` with read access only to the runner file: no other file reads or writes, no child processes, no worker threads |
| V8 context | fresh context; the data is parsed inside it and helpers are defined inside it, so no host object (and no `process`, `require`, `fetch`, `import`) is reachable |
| Code generation | `eval` and `new Function` disabled |
| Limits | 2 s CPU per script (`--timeout`), 256 MB heap, 100 MB input, 20,000-character result (`--max-result`) |

This is strong enough for running scripts you write yourself over data you fetched. It is not a
security boundary for running code from strangers: Node's permission model does not restrict
network sockets, so a V8 escape would have network access.

## Limits

- Input must be JSON (an object or array). For JSON Lines, wrap it first: `jq -s .` or
  `node -e` with a split.
- JavaScript only.
