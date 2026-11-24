---
name: vin-house-build
description: The house flow for building and shipping a skill, tool or small project with agents, from brief to release. Covers writing the brief, the build agent, a fresh-clone check, an independent review, fixes, a privacy scan, and publishing only after the owner says yes, then topics, CI and a release. Includes the agent rules (local commits only, GitHub no-reply identity, no attribution lines, random ports 41000-49999, kill only your own PIDs, never pkill or killall, do not wait on dev servers) and two scripts, a privacy scan and a fresh-clone test. Use when the user wants to build, finish, harden, review or publish a skill, plugin, CLI or repo, asks "ship this", "make this public", "get this ready for GitHub", "run the house build", or when you are about to start agents on a build and need the rules they must follow.
---

# vin-house-build

The way a skill or small project goes from idea to a public repo without surprises.
Every step leaves evidence (a test run, a screenshot, a report) rather than a claim.

## The flow

1. **Brief.** Write one brief file before any code: goal, the folder to work in, what
   "done" means (tests, example output, docs), the hard rules below, and how to report.
   Template: `references/brief-template.md`.
2. **Build agent.** One agent per item, in its own folder. It studies two existing repos
   of the same kind first and matches their shape (README, SKILL.md, tests, CI, examples).
   It commits locally as it goes.
3. **It really runs.** The pipeline is run end to end on this machine and the outputs are
   looked at (open the PNG, play the MP4, read the HTML). No invented numbers: anything
   measured comes from an actual run.
4. **Fresh-clone check.** `scripts/fresh-clone-check.sh <repo>` clones the last commit into
   `<repo>/.scratch/` and runs the tests there. This catches files that were never committed.
5. **Independent review.** A second agent that did not write the code reviews it, given the
   code and the brief, not the builder's summary. Ask for findings by severity with file:line.
6. **Fixes.** Fix every critical and high finding; re-run tests and the fresh-clone check.
   A second review round when the first found anything serious.
7. **Privacy scan.** `node scripts/privacy-scan.mjs <repo> --private-words <file>` finds
   e-mail addresses (GitHub no-reply allowed), key-shaped tokens, home-folder paths and any
   words you list (client names, internal project names). Zero errors before publishing.
8. **Ask.** Show the owner what will become public: repo name, description, licence, the
   report. **Publish only after an explicit yes.** A yes for one repo is not a yes for others.
9. **Publish.** Create the repo, push, add topics, check the CI run goes green on GitHub,
   then tag a release with notes taken from the real commits.

Details for each step, with commands: `references/flow.md`.

## Agent rules (put these in every brief)

- Work only inside your own folder. Scratch files go in `<folder>/.scratch/` (gitignored).
- Commit locally with the no-reply identity and no attribution lines:
  `git -c user.name="<Name>" -c user.email="<id>+<user>@users.noreply.github.com" commit -m "feat: ..."`
- Never push, never create a remote repository, never publish a package, until the owner approves.
- Servers: pick a random port in 41000-49999, record the PID you started, stop that PID when done.
  Never `pkill -f`, never `killall`: other agents run on the same machine.
- Do not start a dev server and then wait on it as background work. Start, check, stop, inside one step.
- Never install into system Python or another project's environment; use a local venv or node_modules.
- Never delete anything outside your folder.
- No personal e-mail, tokens or absolute home paths in committed files.
- Do not invent facts, benchmarks or quotes. Third-party assets need a licence that allows
  redistribution, recorded in the README or ASSETS.md.

More rules and the reasons behind them: `references/agent-rules.md`.

## Done means

- Tests pass locally and in a fresh clone; CI workflow present with actions pinned by SHA and
  `permissions: contents: read`.
- An example made by running the real pipeline, with its output committed if small (< 15 MB).
- README: one-line promise, demo media, install, quick start, how it works, limits, licence.
- Privacy scan clean. Local commits on `main`.
- A short report: what it does, test count, example paths, known limits, anything unverified.

## Troubleshooting

- **Fresh clone fails but local passes**: a file is untracked or gitignored. `git status --ignored`.
- **Review keeps finding the same class of bug**: add a test for the class, not the instance.
- **An agent stalls on a server**: it probably waited on a background process. Kill that PID and
  restate the rule: start, check, stop in one step.
