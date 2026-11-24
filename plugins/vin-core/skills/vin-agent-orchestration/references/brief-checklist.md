# Brief checklist

Copy, fill, delete what does not apply.

```
GOAL
  <one sentence>. This is used for <purpose>.

CONTRACT (done means)
  - <file or output 1>
  - <tests that must pass: command>
  - <format of any data it returns>

SCOPE
  Owns:      <paths it may create or change>
  Read-only: everything else. Shared files (<list>) are owned by <who>.

ALREADY KNOWN
  - <fact you checked, with how>
  - <approach you ruled out, and why>

READ FIRST
  - <path or URL>: <why it matters>

RULES
  - Stage only your own files: git add <paths>; never git add -A.
  - Local commits only, no-reply identity, no attribution lines. No push.
  - Servers on a random port 41000-49999; kill only the PID you started; never pkill/killall.
  - Do not wait on background servers. Start, check, stop in one step.
  - <project-specific rules>

REPORT (end with exactly this)
  DONE / PARTIAL / BLOCKED
  What changed:
  Evidence:
  Not verified:
  Decisions needed:
```

## Common brief failures

| Symptom in the report | Missing from the brief |
|---|---|
| "I improved several things" | A contract with concrete outputs |
| Redid research you already did | "Already known" |
| Edited files another agent owned | Scope and ownership |
| Confirms your hypothesis with no new evidence | You gave the conclusion instead of the question |
| Long narrative, no commands | Report format with an Evidence line |
| Stopped at the first obstacle | What to do when blocked (report BLOCKED with the exact error) |
