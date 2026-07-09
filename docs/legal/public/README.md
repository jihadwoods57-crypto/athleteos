# Your site — how to finish + host it

This folder is your whole public site, ready to host:
- **`index.html`** — the OnStandard landing page (homepage at `onstandard.app`)
- **`privacy.html`** — Privacy Policy (`onstandard.app/privacy`)
- **`terms.html`** — Terms of Service (`onstandard.app/terms`)
- **`reset.html`** — Password-reset completion page (`onstandard.app/reset`) — **finished, no edits needed**

Host the **whole folder** and you get the homepage plus both legal pages at the URLs the app links to
(and the ones Apple requires for App Store submission). The landing page is finished and needs no
edits. The two legal pages need a few blanks filled first — see Step 1.

## Password reset (`reset.html`) — one Supabase setting to flip

The app's "Forgot password?" sends an email whose link lands on **`https://onstandard.app/reset`**.
That page (in this folder) lets the user set a new password and is done — it uses the same public
Supabase URL + anon key the app uses. **One prerequisite** so Supabase will actually redirect there:

> Supabase dashboard → **Authentication → URL Configuration → Redirect URLs** → add
> `https://onstandard.app/reset` (and, if you host on a preview domain first, that URL too).
> Also confirm **Site URL** is `https://onstandard.app`.

Without that allowlist entry Supabase ignores the redirect and sends users to the Site URL instead.
Nothing else to configure — once this folder is hosted and that URL is allowlisted, forgot-password
works end to end.

## Step 1 — Fill the highlighted blanks (10 minutes)

Open each `.html` file in any text editor and search for the yellow-highlighted `[BRACKETED]` bits.
Here's every one and what to put:

| Blank | What to put | Who decides |
|---|---|---|
| `[LEGAL ENTITY NAME]` | Your business's legal name (your LLC, or your name if sole proprietor) | You |
| `[ADDRESS]` | A business mailing address (can be a registered-agent / PO box) | You |
| `[SET THE DATE YOU PUBLISH THIS]` | The date you post the page (e.g. July 3, 2026) | You |
| Retention window `[N — e.g. 30]` | How many days to complete deletion after a request. **30** is a safe, common default | You |
| Eating-disorder resources (privacy §5) | Already filled with U.S. defaults (NEDA 1‑866‑662‑1235, 988). Adjust if you operate elsewhere | You |
| Governing law (terms §10) | Your state, e.g. "State of Florida" | You / lawyer |
| Liability cap (terms §7) | A standard cap (often "the amount you paid in the last 12 months") | Lawyer |
| Subprocessor DPAs (privacy §7) | Just confirm the list is right (Supabase, Resend, Anthropic) | You |
| Anthropic retention/training (privacy §4) | Leave as-is until you've read Anthropic's commercial terms/DPA | You |
| International transfers (privacy §13) | If you only serve the U.S. at launch, a lawyer can shorten this | Lawyer |
| FERPA addendum (privacy §9) | Only relevant if you sell to schools — skip for an adults/gyms launch | Later |

**For an adults-first / gyms launch, the minor-specific and school items matter less** — but the
pages are accurate to keep, and a lawyer review is still the right move before you scale. The
must-do-before-Apple items are just: entity name, address, date, and hosting them.

## Step 2 — Host them (10 minutes, free) — Cloudflare Pages

Since your domain is set up, the simplest free host is **Cloudflare Pages**:

1. Rename the files so the URLs are clean: `privacy.html` → serve at `/privacy`, `terms.html` → `/terms`.
   (Cloudflare Pages serves `privacy.html` at both `/privacy.html` and `/privacy` automatically.)
2. Go to **https://dash.cloudflare.com** → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
3. Drag this whole folder in, name the project (e.g. `onstandard-legal`), and Deploy.
4. **Custom domain:** in the Pages project → **Custom domains** → add `onstandard.app` (or a subdomain).
   Cloudflare wires the DNS for you since the domain is on Cloudflare.
5. Visit `https://onstandard.app/privacy` and `/terms` to confirm they load.

*(Any static host works — Netlify Drop, GitHub Pages, Vercel. Cloudflare is easiest if your DNS is
already there. If your registrar isn't Cloudflare, Netlify Drop at https://app.netlify.com/drop is a
drag-and-drop alternative, then point your domain at it.)*

That's it — once these answer at those two URLs, the App Store submission has its required privacy
link, and the app's in-app "Terms / Privacy" links work.
