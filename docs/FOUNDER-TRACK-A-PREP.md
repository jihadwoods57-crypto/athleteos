# Track A Prep Pack — legal, vendors, RD

**For:** Bo. **Updated:** 2026-06-30. Everything I can do to make Track A of the go-live checklist fast.
This does NOT edit the legal docs (so no suggested value ships as final by accident) — it's the fill-in guide,
the vendor recommendations, and the RD review sheet.

---

## 1. Privacy Policy + Terms — the exact blanks + what to tell your lawyer

The docs ([`docs/legal/PRIVACY-POLICY.md`](legal/PRIVACY-POLICY.md), [`TERMS-OF-SERVICE.md`](legal/TERMS-OF-SERVICE.md))
are drafted and internally consistent. Only these blanks remain:

| Blank | Where | What goes there |
|---|---|---|
| `[LEGAL ENTITY NAME]`, `[ADDRESS]` | both docs, throughout | Your LLC/Inc name + registered address. **Only you know this.** |
| `[DATE]` effective date | both, header | The date you publish. |
| Data-retention `[N] days` | Privacy §(retention) | A policy decision. **Common default: keep active-account data while the account is active; complete deletion within 30 days of a delete request.** Have counsel confirm. |
| Anthropic §4 `[FOUNDER/DPA TO CONFIRM]` | Privacy §4 | Fill once the DPA is signed (item 2). |
| "remove viewer" `[FOUNDER TO CONFIRM]` | Privacy §7 | Truth today: the in-app "remove viewer" is local-only until the `revoke_viewer` RPC lands on the live backend. Don't claim server-side revocation until it's wired. |
| Verifiable-consent mechanism `[FOUNDER + COUNSEL TO COMPLETE]` | Privacy §8 | Fill once you pick the guardian-consent approach (item 3). |
| Liability cap, arbitration / governing law | Terms §7, §10 | **Counsel's call.** Common SaaS default: cap at fees paid in the prior 12 months; binding arbitration + class-action waiver with a small-claims carve-out. Don't publish paid-plan terms until billing ships. |

**The 5 questions to ask your lawyer (this is the whole review):**
1. We **bar under-13** at signup (so we believe COPPA is out of scope). Confirm. For **13–17** minors, what's the
   required consent bar — formal verifiable parental consent, or a lighter verifiable guardian email-consent?
2. Are we OK FERPA-wise if a school/team is the customer, or do we need a school data-processing addendum?
3. Bless the retention windows (30-day deletion default) and the arbitration/liability clauses.
4. Any state-law specifics (e.g. CA/CT/MD minor-privacy or age-appropriate-design rules) that change the above?
5. Add an eating-disorder / mental-health helpline referral line — confirm the wording.

## 2. Anthropic DPA — where + what to confirm

- **Where:** Anthropic Console → your org's commercial terms / data-processing addendum (Anthropic publishes a DPA;
  enterprise/commercial API accounts can execute it). If you don't see it, ask Anthropic support for the DPA.
- **What to confirm and write into Privacy §4:** (a) Anthropic does **not** train on your API inputs/outputs under
  the commercial terms; (b) the retention period for submitted images/data (commercial API offers zero-/short-retention);
  (c) sub-processing + international-transfer mechanism. **Verify against the DPA actually in force** — don't publish
  §4's claims from memory.
- **Subprocessor line to add** (once confirmed): *"We use Anthropic, PBC (Claude API) to analyze meal photos and
  generate coaching text. Images and meal data are processed under our Data Processing Agreement with Anthropic;
  Anthropic does not use this data to train its models."*

## 3. Guardian-consent vendor — decide AFTER counsel answers Q1 above

Because you bar under-13, the bar for 13–17 may be **lighter than COPPA VPC**. Two paths:

- **If counsel says lighter "verifiable guardian consent" is enough (likely for 13–17):** your existing flow may
  suffice — the two-step `guardian-verify` email endpoint (already built) + possibly a small identity signal. Cheapest;
  no heavy vendor. Validate the wording with counsel.
- **If counsel says you need formal VPC-grade verification:**
  - **PRIVO** — FTC-approved COPPA **Safe Harbor since 2004**, the conservative/most-defensible pick; multiple consent
    methods (card, ID, last-4 SSN, phone). Best if you want maximum legal cover. [privo.com/verifiable-parental-consent](https://www.privo.com/verifiable-parental-consent)
  - **k-ID** — modern, **API-first**, purpose-built for teen apps; part of the 2026 OpenAge reusable-age-check network
    (Persona, Incode, Veratad joined). Best developer fit for your stack. [docs.k-id.com](https://docs.k-id.com/concepts/access-features-consent/vpc/)
  - **Veratad** — KBA + AI biometrics for parental consent; also on OpenAge. [veratad.com](https://veratad.com/regulatory-compliance/coppa-compliance)

**My recommendation:** ask counsel Q1 first. If lighter consent is allowed → ship the existing email flow (free).
If formal VPC is required → **k-ID** (API-first, fits the dev stack) or **PRIVO** (most conservative). I can wire whichever
into the existing `guardian-verify` endpoint.

## 4. Email sender — recommendation: Resend (start), Postmark (if deliverability is critical)

- **Resend** — **3,000 emails/mo permanent free tier**, the best Supabase integration docs, easiest setup. Perfect for
  the beta. This matches the runbook's existing recommendation. [supabase SMTP docs](https://supabase.com/docs/guides/auth/auth-smtp)
- **Postmark** — best **transactional deliverability** (auth confirmations, resets, guardian links land fast/reliably).
  Upgrade here if email deliverability becomes the bottleneck. [postmark + supabase](https://postmarkapp.com/support/article/integrating-postmark-with-supabase-via-smtp)
- **AWS SES** — cheapest at scale ($0.10/1k) only if you're already on AWS.

**My pick: Resend for the beta** (free, fast to wire, good Supabase fit). Both your sign-up confirmation AND the
guardian-approval link ride this, so deliverability matters — if you see auth emails spam-boxing, switch to Postmark.
Either way: verify your sending domain (SPF/DKIM) so emails don't spam-box.

## 5. RD review sheet — every tunable number, ready to bless

Hand this to the dietitian. These are the only numbers that need sign-off; all are tunable constants (a one-line edit,
no rebuild).

**Execution Score weights:** Nutrition 50% · Recovery 25% · Tasks 15% · Check-in 10%.

**Nutrition sub-score, by goal profile:**
- **Performance (athlete):** protein 65% + on-time meals 35%.
- **Lose / Maintain (general):** calorie-target adherence 45% + protein 25% + meal consistency 30%. Calorie band is
  **two-sided**: full credit within ±10% of target, zero at ±40% (penalizes under- *and* over-eating).
- **Gain:** calorie **floor** 40% + protein 35% + meal consistency 25%. One-sided: full at/above target, zero at 60%
  (never penalizes a surplus).

**Goal-derived daily targets (from bodyweight in lb):**
| Goal | Protein | Calories | Weight target |
|---|---|---|---|
| Lose | 0.9 g/lb | 12 kcal/lb | 0.92 × current (~8% loss) |
| Gain | 1.0 g/lb | 17 kcal/lb | 1.08 × current |
| Maintain | 0.8 g/lb | 15 kcal/lb | = current |
| Performance | 180 g fixed | 3,200 fixed | 184 lb fixed (legacy default) |

**Safety floors (hard):** never prescribe below **1,500 kcal/day** or **80 g protein/day**, regardless of the per-lb
formula (protects a low-bodyweight 13+ user).

**Questions for the RD:**
1. Are these reasonable *default* targets for an **unsupervised solo client** (a coach can override per-client)?
2. Is the lose deficit (~12 kcal/lb, 8% weight target) safe as a starting default, or too aggressive?
3. **Should a 13–17 minor be offered a fat-loss deficit at all**, or should "lose" map to "maintain + activity" for minors?
4. Protein ranges OK (0.8–1.0 g/lb), or do you want higher for the lose/gain cases?

---

## What I do next on each
- **Legal:** once you have the entity name + counsel's answers, I'll fill the blanks in the docs (clearly, for your
  final review) and add the Anthropic subprocessor line.
- **Vendor picks:** tell me k-ID/PRIVO (or "email flow is enough") + Resend, and I'll wire them into the existing
  `guardian-verify` + SMTP config.
- **RD:** if the RD changes any number, it's a one-line edit per value in `goalMapping.ts` / `scoringProfiles.ts`.

**Sources:** [PRIVO VPC](https://www.privo.com/verifiable-parental-consent) · [k-ID VPC](https://docs.k-id.com/concepts/access-features-consent/vpc/) · [Veratad COPPA](https://veratad.com/regulatory-compliance/coppa-compliance) · [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Postmark + Supabase](https://postmarkapp.com/support/article/integrating-postmark-with-supabase-via-smtp)
