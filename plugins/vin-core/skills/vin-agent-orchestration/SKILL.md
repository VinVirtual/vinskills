---
name: vin-agent-orchestration
description: How to brief subagents so they come back with work you can trust, and how to run several at once without them colliding. Covers the brief (goal, contract, what is already ruled out, files to read), coordination when agents share a repository (who owns which files, stage only your own files, no reformatting other code, lockfile and generated-file rules), when to parallelise and when not to, review agents that get the code instead of your conclusion, and a fixed report format. Use when you are about to start one or more agents, split a task across agents, run builds in parallel, or when agents keep stepping on each other, returning vague summaries, or redoing each other's work; also for "spin up agents for these", "parallelise this", "brief a subagent", "fan out".
---

# vin-agent-orchestration

An agent knows only what you put in its brief, and you see only what it reports.
Both handoffs lose detail. Most bad agent runs are bad briefs.

## Before starting an agent

Ask: is this a handful of tool calls I could do myself? Then do it yourself. Start an agent
when the work is independent, long, or reads many files whose content you do not need to keep.

## The brief

Write it like a note to a capable colleague who has never seen the project. Include:

1. **Goal** in one sentence, and why it matters (what the result is used for).
2. **Contract**: exactly what "done" is. Files to create, tests that must pass, output format.
3. **Scope**: the folder or files it owns. Everything else is read-only.
4. **Known facts**: what you already checked or ruled out, so it does not redo it.
5. **Pointers**: files and docs worth reading first (paths, not pasted content).
6. **Rules**: the house rules that apply (ports, PIDs, commits, no publishing).
7. **Report format**: fixed sections (below), so reports can be compared.

Template with every section: `references/brief-checklist.md`.

## Several agents, one repository

- **One owner per file.** List which agent owns which paths. Shared files (README, package.json,
  lockfiles, CI config) belong to one agent or to you, never to "whoever gets there first".
- **Stage only your own files.** `git add <paths>`, never `git add -A` or `git commit -a`.
  Check `git diff --cached --stat` before committing.
- **No drive-by changes.** Do not reformat, rename or "tidy" code you do not own.
- **Lockfiles and generated files**: only the owner regenerates them, once, at the end.
- **Commit often, small.** Rebase is not available to agents that share a working tree, so small
  commits keep conflicts small. If a commit fails because the index has someone else's staged
  files, unstage only yours and retry; never reset theirs.
- **Separate worktrees** (`git worktree add`) when two agents must edit the same files; merge after.

More detail and failure cases: `references/parallel-rules.md`.

## When to run in parallel

Parallel: independent items (different repos or folders), research that fans out over sources,
reviews of separate modules. Sequential: anything where step B needs A's result, or two agents
would touch the same file. Do not start more agents than you can read reports from.

## Reviews

Give a reviewer the code and the brief, not your conclusion. "Here is my fix, confirm it works"
gets a confirmation. "Find what is wrong with this change" gets findings. Ask for severity,
file:line and a suggested fix for each finding.

## Report format

Ask every agent to end with:

```
DONE / PARTIAL / BLOCKED
What changed: <files, one line each>
Evidence: <commands run and their result, test counts, output paths>
Not verified: <anything it could not check, and why>
Decisions needed: <questions for the owner>
```

## After reports come back

Read the evidence, not the adjectives. Spot-check one claim per report yourself (run the test,
open the file). An agent's mistake reads exactly as confident as its correct findings.
