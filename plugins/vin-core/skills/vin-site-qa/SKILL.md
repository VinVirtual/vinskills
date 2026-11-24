---
name: vin-site-qa
description: Ship-check a web page in real browsers before it goes live. One command takes screenshots at 390, 1024 and 1440 pixels in light and dark themes, an iPhone pass in WebKit when WebKit can run, a reduced-motion pass, and reports console errors, failed requests, sideways scrolling on phones, missing or weak Content-Security-Policy, what crawlers see before JavaScript runs (title, description, canonical, Open Graph, h1, prerendered text), quick accessibility problems (alt text, unnamed buttons and links, unlabeled inputs, heading jumps, duplicate ids, small tap targets) and load numbers (LCP, CLS, JavaScript and total bytes transferred). Works on a URL or a built site folder. Use before shipping or merging web work, after a redesign, when asked to QA, check, test or screenshot a site or page, check dark mode, mobile layout, CSP, SEO or prerendering, or "does this look right on a phone".
---

# vin-site-qa

Look at the page the way users and crawlers will, then fix what the report lists.

## Run it

```bash
node scripts/site-qa.mjs https://example.org/pricing --out qa/pricing
node scripts/site-qa.mjs ./dist --path /about/ --out qa/about     # a built folder, served on 127.0.0.1
```

Paths are relative to this skill's folder. It needs `playwright-core` (found from the current
project, this folder, or `VIN_PLAYWRIGHT_DIR`) and a Chromium; system Chrome works.
`scripts/check_env.sh` says what is missing and how to add it.

Options: `--widths 390,1024,1440`, `--themes light,dark`, `--full` (full-page shots),
`--page-type landing` (stricter JS budget), `--no-webkit`, `--json`.

Exit code 0 means no errors, 1 means errors were found, 2 means it could not run.

## What it checks

| Pass | Browser | Finds |
|---|---|---|
| Raw HTML (no JS) | fetch | title, description, canonical, og:title/og:image, viewport, lang, noindex, h1 and word count before JS |
| Headers | fetch | CSP (missing, `'unsafe-inline'` without nonce/hash, `'unsafe-eval'`, wildcards, object-src, base-uri, frame-ancestors), nosniff, Referrer-Policy, HSTS |
| Widths x themes | Chromium | screenshots, console errors, uncaught exceptions, failed or 4xx/5xx requests, a11y quick checks, sideways scroll on phones |
| Reduced motion | Chromium | looping animations that keep running with `prefers-reduced-motion: reduce` |
| Load | Chromium 1440 | LCP, CLS, JS and total bytes transferred, request count, images without width/height |
| iPhone | WebKit | screenshots in both themes, exceptions, sideways scroll |

Budgets come from `scripts/lib/qa-core.mjs` (`BUDGETS`): LCP < 2.5 s, CLS < 0.1,
JS < 300 KB for an app page or < 150 KB for a landing page.

## Then

1. **Look at every screenshot.** Read the PNGs. Automated checks miss ugly.
2. Fix errors first, then warnings. Re-run until the report is clean or every remaining item is a
   deliberate choice you can explain.
3. Do the things a script cannot: tab through the page with the keyboard, read it with a screen
   reader for a minute, test on a real phone.

Checklist for a full release, including what this script does not cover: `references/checklist.md`.

## Limits

- Load numbers are from one unthrottled run on this machine, not field data. Treat them as a
  regression signal, not as your Core Web Vitals.
- The accessibility checks are quick heuristics, not a WCAG audit. Contrast is not checked.
- WebKit needs its system libraries. When it cannot start, the report says so under
  "Not checked" with the install command; the Chromium passes still run.
- One page per run. Loop over your important routes in a small shell script.

## Troubleshooting

- **playwright-core not found**: `npm i -D playwright-core` in your project, or set `VIN_PLAYWRIGHT_DIR`.
- **No Chromium could start**: pass `--chrome /path/to/chrome`, or `npx playwright-core install chromium`.
- **Every page shows a 404 console error**: usually a missing `/favicon.ico`.
