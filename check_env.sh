#!/usr/bin/env bash
# What VinSkills needs to develop and test, and how to fix anything missing.
set -u
ok=1
say() { printf '%-5s %s\n' "$1" "$2"; }
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then say ok "node $(node -v)"; else say FAIL "Node.js 22+ is needed: https://nodejs.org"; ok=0; fi
command -v git >/dev/null 2>&1 && say ok "git" || { say FAIL "git is needed"; ok=0; }
command -v gh >/dev/null 2>&1 && say ok "gh (for --pin)" || say warn "no gh CLI: 'node scripts/build-marketplace.mjs --pin' needs it (https://cli.github.com)"
command -v claude >/dev/null 2>&1 && say ok "claude CLI (plugin validate test runs)" || say warn "no claude CLI: the 'claude plugin validate' test is skipped"
[ "$ok" = 1 ] && echo "Ready: npm test" || { echo "Fix the FAIL lines above."; exit 1; }
