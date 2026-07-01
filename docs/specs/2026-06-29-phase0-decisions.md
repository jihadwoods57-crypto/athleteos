# OnStandard — Phase-0 Go-Live Decision Brief

**For:** the founder + counsel. **Date:** 2026-06-29. **Status:** DECISION SUPPORT.

> **This is not legal advice and not an implementation spec.** It is a decision-ready
> brief so the founder and the lawyer can settle three Phase-0 go-live questions quickly.
> Each section gives a one-line recommendation, why, the cheapest defensible option, and
> the exact questions counsel must bless before the relevant flag flips. No code changes
> were made producing this document.

These three map to three open items on `docs/LAUNCH-CHECKLIST.md` Phase 0 (parent
verification, email sender, minors-messaging) and to G2/G3/H3 in
`docs/SECURITY-AUDIT-2026-06-29.md`.

---

## Recommendations at a glance

- **Decision 2 — Parental consent (13–17):** Ship the **lightweight parent
  email-confirmation flow already built** (the `guardian_consent_requests` table + emailed
  token). Treat a full identity/payment VPC vendor as a fallback only if counsel insists.
- **Decision 3 — Email sender:** Use **Resend** (runner-up: **Postmark**). Free tier
  covers beta, native SMTP for Supabase Auth, and a one-line HTTP call from the Deno Edge
  Function for the guardian link.
- **Decision 4 — Minors messaging:** **Keep it OFF at launch** until counsel blesses it.
  The code already restricts a minor to authorized adults; do not enable delivery yet.

---

## Decision 2 — Parental-consent path for 13–17 minors

> **Recommendation:** Ship the lightweight **parent email-confirmation flow** the app
> already supports (`guardian_consent_requests` + emailed token). Do **not** buy a full
> verifiable-parental-consent (VPC) identity/payment vendor unless counsel specifically
> requires heavier verification.

### Why

- **The triggering law is out of scope by construction.** COPPA governs children **under
  13**. The app now bars under-13 at signup — `MIN_SIGNUP_AGE = 13` in
  `src/core/constants.ts`, and the onboarding age stepper floors at 13. By design the app
  does not knowingly collect data from anyone COPPA covers, so COPPA's **verifiable
  parental consent** mandate (the thing that forces identity/payment-grade vendors) does
  **not** attach to a 13–17 user. The code comments were corrected to say "minor guardian
  consent," not "COPPA," to reflect exactly this.
- **The 13–17 gate is an app-store / minors-health-data prudence gate, not a COPPA VPC
  mandate.** The app still treats 13–17 as minors and fails closed: `realDataConsent()` in
  `src/core/consent.ts` blocks a minor's real data from leaving the device until
  `guardianStatus === 'verified'` (it also blocks on backend-off, no-consent, and
  "pause all sharing"). A self-tapped checkbox is explicitly rejected. That invariant is
  the protection; the open question is only **how strong** the guardian-side verification
  must be.
- **The lightweight flow is already built and already fails closed.** Migration
  `0008_guardian_consent.sql` creates `guardian_consent_requests` (athlete_id, guardian
  email, status `pending|verified|revoked`, an opaque per-send `token`, RLS that lets the
  athlete only **read** their row) and the `request_guardian_consent` RPC that records a
  **pending** request. A minor **cannot self-verify** — `verified` is settable only by the
  service-role verify endpoint. So a parent clicking an emailed token-link, confirmed by a
  service-role Edge Function, is enough to flip the row to `verified` and unblock the minor.
  This is "send the parent a link, parent confirms" — the email-confirmation model — not an
  identity/payment check.
- **A full VPC vendor adds cost, friction, and PII you don't otherwise hold** (parent ID /
  card data), for a population (13–17) that the consent-grade law doesn't require it for.
  That is the opposite of data minimization for a teen-health app.

### Cheapest defensible option

The lightweight path, which is **already coded and tested**:

1. Minor enters a guardian email → `request_guardian_consent` RPC writes a `pending` row
   with a fresh `token` (already built; migration `0008`).
2. A service-role Edge Function emails the guardian a link carrying that token (the email
   sender is **Decision 3**; the function is the Phase-1 "wire the verify step" checklist
   item).
3. Guardian clicks → a service-role verify endpoint validates the token, records consent
   (capture timestamp + a record of what was disclosed), and sets the row to `verified`.
4. Client hydrates the server-set `verified` back on sign-in (security **G2** — already
   shipped 2026-06-29 per the launch checklist) and the minor unblocks.

Incremental cost beyond what's built: **$0 in new vendors** — it reuses the Decision-3
email sender. The only work is the verify Edge Function, which is on the Phase-1 list
regardless.

### State-minor-privacy-law considerations (flag for counsel, do not self-resolve)

A handful of states are tightening **teen** (not just under-13) rules in 2026. These are
mostly aimed at "social media platforms," targeted advertising to under-18s, and
age-appropriate-design duties — **not** a blanket "parent must consent to open any
account" mandate — but a teen health/nutrition app handling sensitive data should have
counsel confirm fit:

- **Connecticut (CTDPA amendments, eff. July 1, 2026):** bans sale of minors' data,
  prohibits targeted advertising to under-18s, requires data-protection impact assessments
  for profiling minors. OnStandard already runs no ads and no analytics/tracking SDK (per
  the security audit), which lines up well — counsel to confirm.
- **California:** SB 976 (addictive-feed parental-consent) and the Age-Appropriate Design
  Code Act — the latter remains **enjoined** as of early 2026, so its design-code mandates
  are not currently enforceable; counsel to confirm current status at launch.
- **Maryland (MODPA / age-appropriate design):** stricter minors' data-use and
  data-minimization duties; counsel to confirm applicability to a health-data app.
- General point: several of these turn on whether the product is a "social media
  platform" and on data-minimization/no-sale duties — OnStandard is neither ad-driven nor a
  social platform, which helps, but **counsel makes that call.**

### Exact questions counsel must bless

1. **Confirm COPPA is out of scope** given `MIN_SIGNUP_AGE = 13` and the hard under-13
   signup bar — i.e., that **verifiable parental consent (identity/payment-grade)** is
   **not** legally required for 13–17 users.
2. **Bless the lightweight parent email-confirmation flow** as the consent mechanism for
   13–17: a guardian email + emailed token-link + service-role confirmation, with the
   minor's data staying on-device until `verified`. Is that "sufficient consent" for your
   liability posture for minors' health data?
3. **What must the consent record capture and how long must it be retained?** (Guardian
   email, timestamp, the exact disclosure text the guardian saw, IP/token — and retention
   window. This also feeds the privacy-policy blanks, security finding **G3**.)
4. **Set the age floor:** stay at 13, or raise to **14** (the launch checklist explicitly
   flags this as an open call). Does any target-state law push you to 14+?
5. **State-law fit:** do CT/CA/MD (or any beachhead state where you'll recruit coaches)
   impose any teen-specific duty (no-sale, no targeted ads, age-appropriate design, DPIA)
   that the current build must satisfy before go-live?
6. **FERPA:** if coaches are school employees acting in a school context, does the
   school's FERPA posture change who must consent or how data is handled? (Flagged in the
   launch checklist's COPPA/FERPA sign-off item.)

### Fallback vendors — only if counsel insists on heavier verification

If counsel requires identity/payment-grade verification (e.g., they read a target-state
law as demanding it, or want belt-and-suspenders on minors' health data), the established
options are:

- **PRIVO** — FTC-approved COPPA Safe Harbor (since 2004); offers a just-in-time,
  risk-based VPC framework and a compliance audit of the product/privacy policy. Heaviest,
  most "blessed" option; contact for pricing (not public).
- **Veratad** — identity-verification provider with a COPPA parental-consent product
  (KBA + AI biometrics at higher assurance). Lighter-touch than a full Safe-Harbor program;
  contact for pricing (not public).

Both add per-verification cost and parent friction; recommend only as a counsel-driven
fallback, not the default.

---

## Decision 3 — Transactional email sender

> **Recommendation:** **Resend.** Runner-up: **Postmark.** Resend's permanent free tier
> covers the closed beta, it offers native SMTP (drop-in for Supabase Auth), and sending
> the custom guardian-link email from a Deno Edge Function is a single authenticated HTTPS
> POST.

This sender does **two** jobs: (1) Supabase Auth's sign-up confirmation / password-reset
emails via **SMTP**, and (2) the **custom guardian-approval link** sent from the
`request_guardian_consent` verify Edge Function (Decision 2).

### Why Resend

- **Supabase SMTP integration is first-class.** Resend exposes standard SMTP host/port/
  user/password, which is exactly what Supabase Auth's custom-SMTP settings want. Critical
  context: Supabase's **built-in** email is throttled to **2 messages/hour and only to
  project-team addresses** — unusable for real signups. You **must** configure custom SMTP
  regardless; this rules out "Supabase built-in email" as a launch answer. (After wiring
  custom SMTP, also raise the Supabase Auth rate-limit off its default 30/hour.)
- **Edge-Function send is trivial.** From the Deno `analyze`/verify Edge Function, the
  guardian link goes out as one `fetch('https://api.resend.com/emails', { method: 'POST',
  headers: { Authorization: 'Bearer ' + RESEND_API_KEY }, body: JSON.stringify({ from, to,
  subject, html }) })`. No SDK required in Deno; an HTTPS POST is enough.
- **Price at beta scale: free.** Resend's free tier is **3,000 emails/month (100/day cap)**
  — ample for 3–5 coaches and their athletes. Pro is **$20/mo for 50,000** when you grow.
  The 100/day cap is the only watch-item; trivial at beta volume.
- **Transactional deliverability is its core focus** (modern transactional-first provider),
  which is what auth + consent links need.

### Why Postmark as runner-up

- Strongest reputation specifically for **transactional deliverability and speed**, which
  matters for time-sensitive auth + a guardian-consent link a parent is waiting on. Also
  supports SMTP for Supabase and an HTTP API for the Edge Function.
- Cost: **no usable free tier (100 emails/month)**; paid starts at **~$15/mo for 10,000
  emails** (Basic). So it costs from day one, where Resend is free through beta — hence
  runner-up, not the pick, at this stage. If deliverability problems ever appear on Resend,
  Postmark is the clean upgrade.

### The rest, briefly (why not)

- **AWS SES** — cheapest at scale ($0.10/1k) and fine deliverability, but its free tier is
  **12-month/expiring** (3,000/mo) and it carries the most setup overhead (sandbox removal,
  IAM, SMTP credentials). Over-engineered for a closed beta; revisit at scale.
- **SendGrid** — the **permanent free tier was retired (May 2025)**; new accounts get a
  60-day trial then paid from ~$19.95/mo. No free-tier advantage and a heavier console;
  pass.
- **Mailgun** — free tier is only 100 emails/day and it's more marketing-oriented; no
  reason to pick it over Resend here.
- **Supabase built-in email** — **not viable for launch** (2/hour, team addresses only);
  it exists only to bootstrap before you attach custom SMTP.

### Concrete integration points

1. **Supabase Auth (sign-up confirmation + password reset):** Dashboard → Project Settings
   → **Authentication → SMTP Settings** → enter the Resend SMTP host/port/user/password and
   a verified `from` sender; then raise the Auth **rate limit** off the 30/hour default to
   your expected signup volume. (This is the launch-checklist item "turn on email
   confirmation in the dashboard" — the config file is already set to ON.)
2. **Guardian-link email (custom, from the verify Edge Function):** store the API key as an
   Edge-Function secret (`RESEND_API_KEY`, set via `supabase secrets set` — **never** an
   `EXPO_PUBLIC_*` var); the function POSTs to `https://api.resend.com/emails` with the
   token-link URL it built from the `guardian_consent_requests.token`. Verify your sending
   **domain** in Resend (SPF/DKIM) so both paths deliver.

### Questions counsel/founder must confirm

- **Sending domain + DPA:** confirm the legal entity and sending domain; sign the email
  vendor's standard DPA (the vendor becomes a **subprocessor** that handles parent +
  athlete email addresses — disclose it in the privacy policy alongside Anthropic, per
  finding G3).
- **No PII in email bodies beyond what's necessary** (the guardian email should carry the
  consent link and disclosure, not the minor's health data).

---

## Decision 4 — Minors-messaging posture at launch

> **Recommendation:** **Keep messaging OFF at launch.** Do not enable delivery until
> counsel blesses it. The code already restricts a minor to messaging only their authorized
> coach/trainer/guardian and is honest that nothing is delivered while off — leave it there.

### Why

- **Already off, and honest about it.** With the backend off, `messageDeliveryNote()` in
  `src/core/messaging.ts` labels a sent message "Saved on this device... not yet
  delivered." The launch checklist lists "turn messaging on" as a deliberate
  post-legal-review toggle, not a launch default.
- **The hard part — an unsupervised adult↔minor channel — is already gated, in code and at
  the database.** `messagingAllowed()` (app layer) blocks a minor from any counterpart who
  isn't an authorized relationship; the real enforcement is server-side RLS. Migration
  `0006` first added the gate, and the security audit (**H3**) caught that `0006` was
  **one-directional** — an adult could put themselves in the `athlete_id` slot and a minor
  in `counterpart_id` and slip through. `0013_security_hardening.sql` makes the gate
  **symmetric** (a registered minor on *either* side requires an authorized adult on the
  other), validated on a throwaway Postgres. So the safety floor is solid — but a chat
  channel for minors is a distinct **legal/operational** decision (reporting, retention,
  moderation), and those duties aren't satisfied by an access gate alone.
- **Messaging is the highest-liability surface in a minors app** and the least reversible
  if mishandled (a bad message can't be un-sent). It is the right thing to hold.

### Exact questions counsel must answer before messaging turns on

1. **Mandatory-reporting posture:** if a coach (or the platform) sees a message indicating
   abuse, self-harm, or a disordered-eating crisis, what is the company's duty and process?
   Are coaches mandated reporters in the beachhead states, and does the app need to surface
   that obligation?
2. **Message retention:** how long are messages stored, and is there a legal hold / deletion
   obligation? (Ties to the same retention question as Decision 2 and the privacy-policy
   blanks, G3.) Must messages be included in a data-export / data-deletion request?
3. **Blocking & reporting:** is an in-app **report-message / block-user** affordance
   required before a minor may use messaging? (Most minors-safety frameworks expect one.)
4. **Monitoring duty:** does the platform have any duty to **monitor** minor↔adult threads
   (proactive scanning) versus react-on-report only? This shapes whether messaging can ship
   at all in v1.
5. **Scope of authorized counterparts:** the gate currently authorizes coach / trainer /
   guardian. Confirm that set is acceptable and that parents being looped in later doesn't
   change the posture.

### Smallest safe v1, *if* counsel says yes

- Minor ↔ **a single authorized adult only** (the existing symmetric `0013` gate; no
  minor↔minor, no minor↔arbitrary-adult).
- **Text only** (no photos/attachments in minor threads — avoids a CSAM-handling surface).
- **Server-side retention + full export/delete coverage** so messages are in the data-rights
  process (the launch checklist's "who answers a delete request" runbook).
- **In-app report + block** on every minor thread, routed to the monitored `SUPPORT_EMAIL`
  inbox.
- Keep the existing honest delivery labeling; ship behind the same per-flag toggle so it's
  reversible (instant kill-switch parity with `EXPO_PUBLIC_BACKEND_LIVE`).

---

## Sources

- [Resend Pricing](https://resend.com/pricing) · [Resend Pricing 2026 (Nuntly)](https://nuntly.com/resend-pricing)
- [Postmark Pricing 2026 (SaaSPricePulse)](https://www.saaspricepulse.com/tools/postmark) · [Postmark Pricing FAQ](https://postmarkapp.com/support/article/1285-pricing-billing-faq)
- [Supabase custom SMTP docs](https://supabase.com/docs/guides/auth/auth-smtp) · [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Amazon SES Pricing](https://aws.amazon.com/ses/pricing/) · [SendGrid free-tier retirement (Dreamlit)](https://dreamlit.ai/blog/best-sendgrid-alternatives)
- [PRIVO Verifiable Parental Consent](https://www.privo.com/verifiable-parental-consent) · [Veratad COPPA Compliance](https://veratad.com/regulatory-compliance/coppa-compliance)
- [State Kids' Privacy 2025/2026 (Keller & Heckman)](https://www.khlaw.com/insights/kids-and-teens-privacy-2025-look-back-and-2026-predictions-part-ii-state-privacy-patchwork) · [US Children's Data Laws 2026 (OneTrust)](https://www.onetrust.com/blog/us-childrens-data-laws-and-consent-what-businesses-need-to-know-in-2026/)
