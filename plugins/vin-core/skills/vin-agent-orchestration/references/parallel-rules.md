# Running agents in parallel

## Picking the split

Split by **ownership**, not by step. "Agent A builds the parser, agent B builds the CLI that uses
it" creates a dependency and a shared interface they will both guess at. "Agent A builds tool X,
agent B builds tool Y" does not.

If two pieces must meet at an interface, write the interface first yourself (types, function
signatures, a JSON example) and put it in both briefs.

## Shared repository, shared working tree

Agents in one working tree share one git index. Problems and the rule that prevents each:

| Problem | Rule |
|---|---|
| Agent commits another agent's half-written file | Stage by path. Check `git diff --cached --stat` first. |
| Two agents edit README.md at once, one loses | README has a single owner; others send their section in the report. |
| Lockfile churn and conflicts | Only the owner runs `npm install`; others list the dependency they need. |
| A formatter rewrites the whole repo | Format only the files you own: `prettier --write <paths>`. |
| Tests fail because of another agent's work in progress | Run only your own tests while building; run the full suite at the end, once. |
| One agent's server port is taken | Random port 41000-49999, retry on EADDRINUSE. |
| An agent "cleans up" by killing processes | Kill only PIDs it started. Never pkill/killall. |

When edits to the same files are unavoidable, give each agent its own worktree:

```bash
git worktree add ../repo-agent-a -b agent-a
git worktree add ../repo-agent-b -b agent-b
# later: merge each branch, resolve, remove the worktrees
git worktree remove ../repo-agent-a
```

## How many at once

As many as are truly independent and as many reports as you will actually read carefully.
On one machine, also count CPU and RAM: heavy jobs (video renders, model downloads, browser
farms) should run a few at a time, not all at once.

## Waiting

You are told when an agent finishes. Do not poll its files, and never guess its result before
the report arrives. Use the time for independent work.

## Merging results

1. Read each report's Evidence line; re-run one check yourself.
2. Merge in dependency order. Run the full test suite once after everything is in.
3. Write down decisions the agents raised and answer them, or pass them to the owner.
