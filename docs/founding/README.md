# The founding set: what is live, and what is history

*Written 2026-09-15, when the founder said the strategy docs needed rewriting against the state
the app is actually in.*

**Read this first.** Fifteen of the sixteen documents in this folder were written between
2026-06-29 and 2026-07-05, **before the product shipped**. That is roughly 3,900 lines of strategy
authored against a hypothesis. Much of the thinking is good and still holds. None of it was
checked against a customer, because at the time there were none, and there still are none.

The failure mode this file exists to prevent: reading a forecast as a result. The original
`BUSINESS_MODEL.md` scorecard carried five green ticks against a business with zero revenue. That
is not dishonesty, it is a planning document doing its job, but it has to be labelled.

---

## Status of every document here

**LIVE. Current, checked, safe to act on.**

| File | What it is |
|---|---|
| `BUSINESS_MODEL.md` | **Rewritten 2026-09-15.** The authoritative strategy doc. Ground truth measured from production, what survived the evidence, what it falsified, the open solo-versus-scale ruling, and the near-term plan. Start here. |
| `LAUNCH-PRICING.md` | The price catalog of record, last correct 2026-09-08. `src/core/pricing.ts` is the real source of truth; this mirrors it. |

**FOUNDING CANON. Ratified, still directionally right, written pre-product.**

Good thinking, none of it market-tested. Treat as intent, not as fact. Where any of these
disagrees with `BUSINESS_MODEL.md`, the latter wins because it is the only one with evidence in it.

| File | Note |
|---|---|
| `01_PRODUCT_CONSTITUTION.md` | The charter. The principles have held up well and the product visibly obeys them. |
| `00_STRATEGIC_QUESTIONS.md` | The load-bearing strategic logic the others cite. |
| `05_SYNTHESIS_AND_CHALLENGES.md` | The capstone and the reading order for the set. |
| `02_ENTERPRISE_ARCHITECTURE.md` | Board-altitude architecture synthesis. The one-engine bet described here is real in the code and was the right call. |
| `03_PRICING_AND_GTM.md` | **Prices here are stale.** The catalog moved on 2026-07-04, 2026-09-07 and 2026-09-08. Read the GTM reasoning, take the numbers from `LAUNCH-PRICING.md`. |
| `04_PRODUCT_ROADMAP.md` | A phased plan written before the build. The actual build diverged. Historical value only. |

**DEEP-DIVES. Subject strategy, pre-product, unvalidated.**

| File | Note |
|---|---|
| `AI_STRATEGY.md` | Still broadly accurate about how the app uses AI. Cost claims are unmeasured: `ai_usage_daily` counts calls and carries no cost column. |
| `COMPETITIVE_ANALYSIS.md` | Honest at the time. Nine months old in a fast category. Re-run before any positioning decision. |
| `GYM_STRATEGY.md` | Never pursued. Park. |
| `ROLE_EXPERIENCE_ARCHITECTURE.md` | Superseded in part by `2026-06-30-role-architecture-redesign.md`. |
| `2026-06-30-role-architecture-redesign.md` | Ratified and **shipped**. The roles in the app match this. |
| `STRATEGIC-DECISIONS.md` | The plain-English sign-off sheet for the 2026-06-29 calls. Useful as a record of what was decided and when. |

**SUPERSEDED. History only.**

| File | Note |
|---|---|
| `ACADEMICS_MODULE.md` | A design spec for a pillar that has **zero lines in the app**. Still the right second pillar; it should follow the first ten paying accounts, not precede them. |
| `RECONCILIATION-2026-06-29-new-founding-prompt.md` | A one-time note reconciling a proposed process against the existing set. No ongoing value. |

---

## The three facts that should be in your head before reading any of the above

Measured 2026-09-15 from production and App Store Connect:

1. **Revenue, all time, is zero.** No subscription, no payment, no Connect charge, ever.
2. **One profile has been active in the last seven days.** Weekly meal-logging athletes peaked at
   six in mid-August. Every team row is seeded demo data.
3. **Nothing can be bought on either rail.** The consumer rail has zero in-app purchase products
   and zero subscription groups. The org rail has never had its Stripe live key switched on, and
   entitlement is enforced client-side only.

Every strategic claim in this folder is downstream of fixing item 3 and then learning something
real from item 2.

---

## How to keep this folder honest

- A document that makes a numeric claim states whether it is **measured**, **decided** or
  **assumed**. `BUSINESS_MODEL.md` §6 models the convention.
- When a number moves from assumed to measured, it moves into `BUSINESS_MODEL.md` §0 and the
  forecast that predicted it gets marked.
- The founding canon does not get edited to match reality. It is a record of what was believed on
  2026-06-29. `BUSINESS_MODEL.md` is the file that tracks the present.
