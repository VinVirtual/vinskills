# The house build, step by step

## 1. Brief

One file the build agent reads before anything else. Keep it short enough to be read in
full. It must answer:

- What is being built, in one sentence a user would understand.
- Where: the folder, and that nothing outside it may change.
- Done: the exact checks (tests, example, README sections, CI file, privacy scan).
- Rules: the agent rules in SKILL.md, pasted in, not linked.
- Report: the format of the final message (see `brief-template.md`).

## 2. Build

- Study two finished repos of the same kind first and copy their *shape*, not their code.
- Write the core logic as small pure functions so it can be tested without the heavy tools.
- Tests cover: the main path, bad input (missing file, wrong type, huge input), and safety
  (paths cannot escape a folder, commands run with argument arrays, no shell strings built
  from user input).
- Commit in steps with Conventional Commit messages (`feat:`, `fix:`, `test:`, `docs:`).

## 3. Run it for real

Run the full pipeline on a real example. Look at the output yourself: open images, read the
generated HTML, listen to audio. Commit the example output if it is small. If something cannot
be verified on this machine (no GPU, missing system library), say so in the report.

## 4. Fresh-clone check

```bash
scripts/fresh-clone-check.sh /path/to/repo            # npm test, pytest or check_env.sh
scripts/fresh-clone-check.sh /path/to/repo make test  # or your own command
```

## 5. Independent review

Start a reviewer agent with: the repo path, the brief, and "find bugs, security problems and
places the README promises more than the code does; report by severity with file:line". Do not
give it the builder's summary: it should form its own view.

## 6. Fix

Fix critical and high findings. For each, add a test that fails before the fix. Re-run the
whole suite and the fresh-clone check. Repeat the review once if the first round found
anything critical.

## 7. Privacy scan

```bash
node scripts/privacy-scan.mjs /path/to/repo --private-words ~/.config/private-words.txt
```

`private-words.txt` holds one word per line: client names, internal project names, your work
domain. The scan masks what it finds. Mark a deliberate test fixture with a
`vin-privacy: allow` comment on the same line.

Also check the history, not just the tree: `git log -p | grep -n "@"` for addresses that were
committed and later removed. If history holds something private, start a fresh history before
the first push.

## 8. Ask

Show: repo name, one-line description, licence, test count, the example media, the privacy
scan result. Wait for "yes". Approval is per repository and per action (create, push, release).

## 9. Publish

```bash
gh repo create <owner>/<name> --public --source . --description "..." --push
gh repo edit <owner>/<name> --add-topic claude-code --add-topic claude-skill --add-topic <topic>
gh run watch --repo <owner>/<name>             # wait for CI to go green
gh release create v0.1.0 --notes-file notes.md   # notes from the real commits
```

Then install it from GitHub the way a user would, in a clean folder, and run the quick start.
