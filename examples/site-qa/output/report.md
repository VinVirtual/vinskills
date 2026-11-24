# Site QA: examples/site-qa/site (served at http://127.0.0.1:44008/)

6 errors, 4 warnings, 7 notes. Run 2026-11-24T05:22:09.339Z.

## Load (Chromium, desktop 1440, no throttling)

| LCP | CLS | JS transferred | All transferred | Requests |
| --- | --- | --- | --- | --- |
| 28 ms | 0.000 | 0 KB | 3 KB | 2 |

## Findings

- **error** `a11y/control-name` (chromium 390 light: a.icon): 1 link(s)/button(s) with no accessible name.
- **error** `a11y/img-alt` (chromium 390 light: img): 1 visible image(s) without an alt attribute (use alt="" for decoration).
- **error** `a11y/input-label` (chromium 390 light: input): 1 form field(s) without a label.
- **error** `console/error` (chromium 390 light): Failed to load resource: the server responded with a status of 404 (Not Found)
- **error** `console/exception` (chromium 390 light): Cannot set properties of null (setting 'textContent')
- **error** `layout/overflow-x` (chromium 390 light): Page scrolls sideways at 390px wide (content is 560px).
- **warn** `a11y/lang`: <html> has no lang attribute.
- **warn** `csp/missing`: No Content-Security-Policy (header or meta). Add one; start with default-src 'self'.
- **warn** `motion/reduced`: 1 looping animation(s) still run with prefers-reduced-motion: reduce (span.spin).
- **warn** `seo/description`: No meta description.
- **info** `a11y/heading-skip` (chromium 390 light: h3): Heading level jumps from h1 to h3.
- **info** `a11y/tap-target` (chromium 390 light: a.icon): 1 tap target(s) smaller than 24px.
- **info** `headers/nosniff`: Set X-Content-Type-Options: nosniff.
- **info** `headers/referrer`: No Referrer-Policy header (browsers default to strict-origin-when-cross-origin).
- **info** `perf/img-size`: 1 image(s) without width and height attributes (layout shift risk).
- **info** `seo/canonical`: No canonical link.
- **info** `seo/og`: Missing og:title or og:image, so link previews will be plain.

## Screenshots

- chromium 390 light: `examples/site-qa/output/chromium-390-light.png`
- chromium 1024 light: `examples/site-qa/output/chromium-1024-light.png`
- chromium 1440 light: `examples/site-qa/output/chromium-1440-light.png`
- chromium 390 dark: `examples/site-qa/output/chromium-390-dark.png`
- chromium 1024 dark: `examples/site-qa/output/chromium-1024-dark.png`
- chromium 1440 dark: `examples/site-qa/output/chromium-1440-dark.png`
- chromium 1024 reduced motion: `examples/site-qa/output/chromium-1024-reduced-motion.png`

## Not checked

- WebKit iPhone pass: WebKit could not start here (║ Host system is missing dependencies to run browsers. ║). Install it with: npx playwright-core install --with-deps webkit

Automated checks catch a lot, not everything: still look at the screenshots, try the keyboard, and run a full accessibility audit before launch.
