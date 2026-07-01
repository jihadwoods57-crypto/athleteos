# Spec — Subscription & Consumer-Protection Compliance

**Date:** 2026-06-29
**Status:** assessment + the build contract for when billing turns on
**TL;DR:** the app does **not** currently violate the billing rules — because there is
**no checkout yet** (the subscription seam is inert; every account reads "Free
preview"). The billing-disclosure rules (1–4) become mandatory the moment a real
checkout is added; this doc is the contract for building it correctly. The app-wide
rules (5–8) apply today, and the app is in good shape on most — the gaps are
legal-review + hosting, not code.

## Which rulebook applies (important)
The chosen model is **coach/org pays per athlete, billed via Stripe (off-platform
web)**. That means:
- **Coach/org billing (Stripe):** governed by the **FTC** + state auto-renewal laws
  (e.g. California ARL, the "Negative Option" rule) — NOT Apple/Google IAP rules.
- **Optional later consumer rail (in-app):** if a solo athlete/parent ever buys
  inside the app, **that** flow must use Apple/Google IAP and follow StoreKit/Play
  auto-renew disclosure + their cancellation surfaces.
Either way the disclosure substance below is the same; only the cancellation
surface differs (Stripe Billing Portal vs. the OS subscription settings).

---

## The 8 requirements — status + what's required

### 1. No hidden subscription terms — show price, frequency, renewal, trial, cancellation BEFORE checkout
**Status: not built (no checkout exists).** When built, the checkout/confirm screen
must show, in plain sight (not behind a "terms" link):
- the price and billing frequency ("$X per athlete / month");
- that it **auto-renews** until canceled;
- the renewal date / period;
- trial length + what happens when it ends (if any trial);
- how to cancel.
*Blocker to building: a pricing decision (amount, frequency, trial). Can't render
"$6.99/mo" honestly until that's set.* The disclosure should be a single reusable
component fed those values.

### 2. Clear consent before charging
**Status: not built.** The purchase button itself must carry the terms, e.g.
**"Start subscription — $X/athlete per month, auto-renews"**, with auto-renewal in the
button/adjacent line, never buried. A pre-checked "I agree" is a dark pattern — avoid.

### 3. Easy cancellation
**Status: seam ready, UI not built.** The model already favors this: a Stripe
**Billing Portal** link cancels in two taps, in-app or web, no phone call. Build a
"Manage plan" row in Account that opens it. (For the optional IAP rail, deep-link to
the OS subscription settings.) `isPro()` already reflects status so the UI can show
"canceled / reactivate" honestly.

### 4. No dark patterns
**Status: aligned by existing convention.** The app already bans em-dashes + fabricated
data, uses honest "Sample" tags, and shows real empty states. Carry that into billing:
symmetric cancel/subscribe buttons, no fake urgency, no hidden fees, trial terms stated
up front.

### 5. Accurate app claims (AI / performance)
**Status: strong today.** AI is gated (`isAiConfigured`) and labeled "AI" only when a
real model runs (`aiPrefix`); every AI coaching surface carries a **medical disclaimer**
("Nutrition education, not medical advice…") and a scope note addressing clinical
overreach. The Starting Score is described as "estimated from your habits," not a
guarantee. **Action:** keep marketing copy (landing page, App Store) to process claims
("log meals, get a score, stay accountable"), not outcome guarantees ("improves
performance"); if an outcome claim is used, it needs substantiation on file.

### 6. Reviews / testimonials must be real
**Status: clean.** There are **no testimonials or review claims in the app**; the demo
names (Coach Davis, the Squad leaderboard) are clearly seeded showcase, gated behind
"Sample"/`isReal` so a real user never sees fabricated social proof. **Action:** just
don't add fake ones later; disclose any paid influencer posts.

### 7. Privacy matches reality
**Status: good foundation, needs legal + hosting.** A DRAFT policy
(`docs/legal/PRIVACY-POLICY.md`) covers what's collected, use, the **third-party AI
(Anthropic) meal analysis**, who can see data, minors/parental consent, FERPA,
retention, and **rights (access/deletion/export)** — and the app actually implements
**Export my data** + **Delete account**. The consent summary discloses the AI analysis
before it happens. **Gaps:** it's a draft, the URL (`onstandard.app/privacy`) isn't
hosted, and it needs counsel review — all already on the launch checklist (Phase 0).

### 8. Kids / teens (COPPA)
**Status: strong posture, two decisions for counsel.** Onboarding allows ages from 8,
so under-13 users are possible and **COPPA applies**. The gate is robust: a minor's
real data **stays on-device until a guardian is _verified_** (not a self-tapped
checkbox) via the `guardian_consent` flow — i.e. verifiable parental consent *before*
collection, which is the COPPA standard, and it **fails closed**. The policy has a
minors section. **Gaps/decisions:** (a) wire the VPC verification vendor (on the
checklist); (b) decide with counsel whether to set a **13+ floor** to avoid full COPPA,
or keep under-13 with full VPC; (c) confirm data minimization for minors.

---

## What to build when pricing is decided (the contract)
1. A reusable **`SubscriptionTerms` disclosure** component (price, frequency, renewal
   date, trial, cancellation) shown on the confirm screen + summarized on the CTA.
2. The **purchase button** with terms in the label (req. 2).
3. A **"Manage plan"** Account row → Stripe Billing Portal (req. 3), gated on a paid
   plan.
4. Copy review against reqs. 1/2/4 before submission.

Until pricing is set, the seam stays inert and the app is compliant by virtue of not
charging. Reqs. 5–8 are live now; 7 + 8 finish in Phase 0 (legal + VPC vendor).
