#!/usr/bin/env bash
# What VinSkills needs to develop and test, and how to fix anything missing.
set -u
ok=1
say() { printf '%-5s %s\n' "$1" "$2"; }
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then say ok "node $(node -v)"; else say FAIL "Node.js 22+ is needed: https://nodejs.org"; ok=0; fi
command -v git >/dev/null 2>&1 && say ok "git" || { say FAIL "git is needed"; ok=0; }
if [ -d node_modules/playwright-core ]; then say ok "playwright-core (npm ci)"; else say warn "run 'npm ci' for the vin-site-qa browser test"; fi
command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 && say ok "Chrome/Chromium" || say warn "no Chrome: the site-qa end-to-end test is skipped ('npx playwright-core install chromium')"
command -v pdftotext >/dev/null 2>&1 && say ok "pdftotext" || say warn "no pdftotext: PDF tests are skipped (apt install poppler-utils / brew install poppler)"
command -v claude >/dev/null 2>&1 && say ok "claude CLI (plugin validate test runs)" || say warn "no claude CLI: the 'claude plugin validate' test is skipped"
[ "$ok" = 1 ] && echo "Ready: npm test" || { echo "Fix the FAIL lines above."; exit 1; }
