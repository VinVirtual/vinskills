# Web release checklist

Tick what the script checked from its report; do the rest by hand.

## Looks right
- [ ] Screenshots at 390, 1024, 1440 in light and dark: nothing cut off, overlapping or unreadable.
- [ ] iPhone (WebKit) screenshots: safe areas, sticky headers, 100vh sections, font rendering.
- [ ] Both themes feel designed, not inverted: images, shadows and borders work in dark.
- [ ] Reduced motion: looping and parallax motion stops; content is still reachable.
- [ ] No sideways scroll at 320 and 390.

## Works
- [ ] No console errors or uncaught exceptions on load and after the main interaction.
- [ ] No failed requests (404 assets, blocked by CSP, mixed content).
- [ ] Forms: labels, errors announced, submit works with the keyboard.
- [ ] Links: no dead internal links (crawl the sitemap).

## Accessible (quick)
- [ ] Every image has alt (empty for decoration). Every button and link has a name.
- [ ] One h1; headings in order. `lang` on `<html>`. A `<main>` landmark.
- [ ] Keyboard: visible focus, logical order, no traps, skip link on long pages.
- [ ] Colour contrast checked with a real tool (not covered by the script).
- [ ] Tap targets at least 24 px on phones.

## Found by search and link previews
- [ ] Title (< 60 chars) and meta description per page.
- [ ] Canonical URL; no accidental `noindex`.
- [ ] og:title, og:description, og:image (1200x630) and twitter:card.
- [ ] Main content and h1 are in the HTML before JavaScript (prerender or server-render).
- [ ] sitemap.xml and robots.txt present and correct.

## Safe
- [ ] Content-Security-Policy as a header: no `'unsafe-inline'` scripts without nonce or hash,
      no `'unsafe-eval'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors`.
- [ ] HSTS on HTTPS, `X-Content-Type-Options: nosniff`, Referrer-Policy.
- [ ] Third-party scripts loaded async, pinned, with SRI where served from a CDN.

## Fast
- [ ] LCP < 2.5 s and CLS < 0.1 on a mid-range phone profile (field data when you have it).
- [ ] JS within budget (landing < 150 KB, app < 300 KB gzipped).
- [ ] Images: width and height set, modern formats, lazy below the fold, hero preloaded.
- [ ] Fonts: at most two families, `font-display: swap`, subset.
