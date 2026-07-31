# Going live: onstandard.app → web/landing

`web/landing/` is the COMPLETE public site in one folder, no build step:

```
index.html          the homepage
privacy.html        Privacy Policy   → serves at /privacy
terms.html          Terms of Service → serves at /terms
reset.html          password-reset completion page → /reset (the app's
                    forgot-password emails already point here; finished, no edits)
css/ js/ fonts/ assets/
```

`web/landing-src/` is not part of the deploy (image-gen sources + QA artifacts).

## LIVE NOW — how onstandard.app is actually served (verified 2026-07-30)

The site is a **Cloudflare Worker**, not Cloudflare Pages: the source of truth
is `web/landing-src/deploy/wrangler.jsonc` —

```jsonc
{
  "name": "onstandard-site",
  "main": "worker.js",
  "assets": { "directory": "../../landing", "binding": "ASSETS" },
  "kv_namespaces": [{ "binding": "WAITLIST", "id": "…" }],
  "send_email": [{ "name": "NOTIFY", "destination_address": "…" }]
}
```

`worker.js` serves every static file straight out of `web/landing/` via the
`ASSETS` binding, and layers two API routes on top:

- `POST /api/waitlist` — validates the waitlist form, writes to the `WAITLIST`
  KV namespace, and sends the founder a notification email via the `NOTIFY`
  send_email binding. This is what `js/site.js`'s dialog submit posts to.
- `GET /api/leads` — lists captured leads, gated behind an `x-admin-key` header.

**Deploy:**

```
cd web/landing-src/deploy
npx wrangler deploy
```

That's the entire release step — no build, no asset upload dance, no
nameserver juggling. `onstandard.app` and `www.onstandard.app` already route to
this Worker; DNS, TLS, and the KV/email bindings are live in production.

`web/landing-src/` itself (image-gen sources, QA artifacts, this `deploy/`
folder) is not part of what ships — only `web/landing/` is served.

## Post-deploy checklist

- [ ] Homepage loads over TLS, dial animates, console clean
- [ ] `/privacy`, `/terms`, `/reset` answer (Apple submission needs the first two)
- [ ] `assets/og.png` resolves; paste the URL into a Slack/iMessage to see the card
- [ ] Submit the waitlist dialog once and confirm `POST /api/waitlist` succeeds
      and the notification email arrives
- [ ] `GET /api/leads` with the correct `x-admin-key` still returns the list

## Measured bars (Lighthouse 12, throttled mobile, final pass)

Performance 96 · Accessibility 100 · Best Practices 100 · SEO 100
LCP 1.6 s · TBT 140 ms · CLS 0 · zero console errors · no-JS fallback verified

Re-measure after content edits:
`npx lighthouse@12 http://localhost:8130 --form-factor=mobile --screenEmulation.mobile`
(serve first: `cd web/landing && python -m http.server 8130`)
