#!/usr/bin/env bash
# Says what vin-site-qa needs and how to get anything that is missing.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
ok=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 20 ]; then echo "ok    node $(node -v)"; else echo "FAIL  node $(node -v): need 20 or newer"; ok=0; fi
else
  echo "FAIL  node not found: install Node.js 20+ (https://nodejs.org)"; ok=0
fi
if node -e "
const {createRequire}=require('module');
const bases=[process.cwd()+'/', '$here/', ...(process.env.VIN_PLAYWRIGHT_DIR?[process.env.VIN_PLAYWRIGHT_DIR+'/']:[])];
for (const b of bases){ for (const m of ['playwright-core','playwright']) { try { createRequire(b)(m); process.exit(0) } catch {} } }
process.exit(1)" 2>/dev/null; then
  echo "ok    playwright-core"
else
  echo "FAIL  playwright-core not found: run 'npm i -D playwright-core' in your project, or install it in a"
  echo "      scratch folder and set VIN_PLAYWRIGHT_DIR to that folder"; ok=0
fi
chrome=""
for c in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then chrome="$c"; break; fi
done
if [ -n "$chrome" ]; then echo "ok    $chrome"; else echo "warn  no system Chrome/Chromium: run 'npx playwright-core install chromium'"; fi
if [ -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ] && ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" | grep -q '^webkit-'; then
  echo "ok    WebKit downloaded (it may still need system libraries: npx playwright-core install-deps webkit)"
else
  echo "warn  WebKit not downloaded: 'npx playwright-core install --with-deps webkit' (the iPhone pass is skipped without it)"
fi
[ "$ok" = 1 ] && echo "vin-site-qa is ready." || { echo "Fix the FAIL lines above."; exit 1; }
