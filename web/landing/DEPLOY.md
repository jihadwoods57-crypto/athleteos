# Deploying onstandard.app

`web/landing/` is the complete site. Plain static files, no build step, no framework,
no external requests (fonts, images, and scripts are all self-hosted). Deploy = copy
this folder to any static host and point the `onstandard.app` apex at it.

## What ships

```
index.html          the page (single route)
css/site.css        all styling
js/site.js          motion + dial driver (deferred)
js/dial3d.js        WebGL dial, lazy-loaded on capable desktops only
fonts/pjs.woff2     Plus Jakarta Sans variable (latin), 27 KB
assets/             favicon, apple-touch-icon, og.png, photography (webp),
                    real product screenshots (webp)
```

`web/landing-src/` is **not** part of the deploy: it holds the original PNG image-gen
sources and QA artifacts (screenshots, the OG-image composer `qa/og.html`).

## Preview locally

```bash
cd web/landing
python -m http.server 8130      # then open http://localhost:8130
```

## Option A — Cloudflare Pages (recommended)

1. `npx wrangler pages project create onstandard-landing`
2. `npx wrangler pages deploy web/landing --project-name onstandard-landing`
3. In the Cloudflare dashboard: Pages project → Custom domains → add `onstandard.app`
   (and `www.onstandard.app`). Cloudflare provisions TLS automatically.
4. DNS (if the zone is on Cloudflare, this is automatic): apex `CNAME`/flattened to
   `onstandard-landing.pages.dev`.

## Option B — Netlify

```bash
npx netlify deploy --dir web/landing --prod
```
Then Site settings → Domain management → add `onstandard.app`; set the DNS
`A`/`ALIAS` records Netlify shows you.

## Option C — Vercel

```bash
cd web/landing && npx vercel --prod
```
Add `onstandard.app` under Project → Domains and set the shown DNS records.

## Option D — any nginx / S3+CloudFront box

Copy the folder to the web root. Suggested headers:

```
/fonts/*  /assets/*      Cache-Control: public, max-age=31536000, immutable
/index.html /css/* /js/* Cache-Control: public, max-age=300
```

Everything is content-hashed by nature of being tiny; if you edit assets, bump names
or shorten the cache.

## Post-deploy checklist

- `https://onstandard.app` loads with the dial animating 0 → 94.
- `https://onstandard.app/assets/og.png` resolves (share-card image).
- The two footer pages `onstandard.app/privacy` and `onstandard.app/terms` must be
  served by the same host or redirected wherever those documents live today —
  the landing page links to them but does not contain them.
- Primary CTA points at `https://app.onstandard.app` — confirm that host serves the
  app (or temporarily redirect it to TestFlight/the waitlist until it does).

## Performance / a11y bars (measured 2026-07-13, Lighthouse 12, throttled mobile)

Performance 100 · Accessibility 100 · Best Practices 100 · SEO 100
LCP 1.6 s · TBT 50 ms · CLS 0

If you change hero content, re-run:

```bash
npx lighthouse@12 http://localhost:8130 --form-factor=mobile --screenEmulation.mobile --quiet
```
