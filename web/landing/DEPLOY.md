# Going live: onstandard.app → web/landing

`web/landing/` is the COMPLETE public site in one folder, no build step:

```
index.html          the homepage
privacy.html        Privacy Policy   → serves at /privacy on Pages/Netlify
terms.html          Terms of Service → serves at /terms
reset.html          password-reset completion page → /reset (the app's
                    forgot-password emails already point here; finished, no edits)
css/ js/ fonts/ assets/
```

`web/landing-src/` is not part of the deploy (image-gen sources + QA artifacts).

## Current reality (checked 2026-07-13)

- `onstandard.app` and `app.onstandard.app` both resolve to **Porkbun parking**
  (`pixie.porkbun.com`) — DNS is managed at Porkbun.
- No Cloudflare / Netlify / Vercel / Porkbun credentials exist on this machine,
  so the DNS flip and host creation are founder steps (~10 minutes, free).

## Founder to-dos BEFORE flipping DNS (5 minutes)

1. ~~Fill the legal blanks~~ **DONE (2026-07-14).** Both pages are complete:
   operator "Jihad Woods, doing business as OnStandard", Orlando FL address,
   Florida governing law (Orange County venue), $50-or-12-months liability cap,
   30-day deletion window, auto-renewal/cancellation billing terms. Have a
   lawyer review before scaling; if you form an LLC later, the entity name is a
   find-and-replace in `privacy.html` + `terms.html`.
2. ~~Decide app.onstandard.app~~ **RESOLVED for launch.** Every CTA now goes to
   `mailto:support@onstandard.app` as a "Get early access" / "Request your
   trial" action, so nothing points at the parked `app` subdomain. When the app
   goes public, restoring the app CTAs is a small one-commit change — ask.
3. **REQUIRED — make the CTA mailbox real.** Every button on the site emails
   `support@onstandard.app`. At **Porkbun → onstandard.app → Email Forwarding**,
   add `support@onstandard.app` → your inbox (free, ~2 minutes). Until this
   exists, CTA emails bounce and the launch is silently broken.

## Option A — Cloudflare Pages (recommended, ~10 min)

1. Create a free Cloudflare account → **Add site** → `onstandard.app` (Free plan).
   Cloudflare shows two nameservers.
2. At **Porkbun → onstandard.app → Nameservers**, replace with Cloudflare's pair.
   (Propagation is usually minutes, up to a few hours.)
3. Cloudflare dashboard → **Workers & Pages → Create → Pages → Upload assets** →
   drag the CONTENTS of `web/landing/` in → name it `onstandard-site` → Deploy.
   (Or from a logged-in terminal:
   `npx wrangler pages deploy web/landing --project-name onstandard-site`.)
4. Pages project → **Custom domains** → add `onstandard.app` and `www.onstandard.app`.
   Cloudflare writes the DNS records and issues TLS automatically.
5. Verify: `https://onstandard.app` (dial animates 0→94), `/privacy`, `/terms`,
   `/reset`, and `https://onstandard.app/assets/og.png`.

Pages serves `privacy.html` at `/privacy` automatically, so the footer links and
Apple's required URLs work with no config.

## Option B — Netlify Drop (no nameserver change)

1. https://app.netlify.com/drop → drag the `web/landing` folder in.
2. Site settings → **Domain management** → add `onstandard.app`.
3. At Porkbun → **DNS records** for onstandard.app: `ALIAS`/`A` apex record and
   `CNAME www` exactly as Netlify displays them (delete the parking records).
4. Same verification list as above. Netlify's "pretty URLs" serve `/privacy` etc.

## After DNS is live (2 minutes, makes forgot-password work)

Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL** = `https://onstandard.app`
- **Redirect URLs** += `https://onstandard.app/reset`

Without that allowlist entry, password-reset emails ignore the redirect.

## Post-deploy checklist

- [ ] Homepage loads over TLS, dial animates, console clean
- [ ] `/privacy`, `/terms`, `/reset` answer (Apple submission needs the first two)
- [ ] `assets/og.png` resolves; paste the URL into a Slack/iMessage to see the card
- [ ] Send yourself a test email via the hero "Get early access" button and
      confirm it arrives (proves Porkbun forwarding works)
- [ ] Supabase redirect URL added

## Measured bars (Lighthouse 12, throttled mobile, final pass)

Performance 96 · Accessibility 100 · Best Practices 100 · SEO 100
LCP 1.6 s · TBT 140 ms · CLS 0 · zero console errors · no-JS fallback verified

Re-measure after content edits:
`npx lighthouse@12 http://localhost:8130 --form-factor=mobile --screenEmulation.mobile`
(serve first: `cd web/landing && python -m http.server 8130`)
