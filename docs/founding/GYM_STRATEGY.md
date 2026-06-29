# GYM_STRATEGY — the gym/performance-facility platform (board altitude)

> **Status:** FOUNDING DEEP-DIVE. This document **elevates and integrates** the gym material already
> scattered across the ratified set into one board-readable strategy. It does **not** override or
> re-derive the canon. Numbered `04`/`05` are taken in `docs/founding/`, so this is named by subject.
> Sources it consolidates (cite these for the mechanics): `02_ENTERPRISE_ARCHITECTURE` §5/§6/§10/§12,
> `03_PRICING_AND_GTM` §1.1/§5/§6, `00_STRATEGIC_QUESTIONS` §3/§11/§14/§18, `05_SYNTHESIS_AND_CHALLENGES`
> §E (SD-1, SD-2) + RT-9, `docs/architecture/01` (org model), `docs/architecture/10` Scenario 21
> (the leaderboard seam). The seven keystone decisions (D1-D7) remain canon.

## A. The gym in one page

**The buyer and the sale.** The gym (a private performance/strength facility or community gym) is the
**ratified launch beachhead** (SD-1): the owner is the buyer, the sale is one conversation with no
procurement, and clients are often 18+ so consent is not on the revenue critical path. The gym is also
the **distribution channel** into the consumer market we refuse to chase head-on (`03` §6.4): a member
with a real record becomes a graduated-athlete conversion when their membership ends, on the gym's CAC.

**What the gym is actually buying.** Not nutrition logging. Five reasons, retention first (`03` §6):
retention, daily engagement, a markable premium tier ($15-$40/mo upsell), added revenue, and
community/brand. The pitch (`03` §6.1): *turn the 25 days a month a member is not in the building from
invisible into a retention engine the gym can charge for.*

**The line that governs gym scope:** ship the gym **narrow** at launch (SD-2): owner roll-up dashboard +
the opt-in leaderboard seam. TV-mode, rewards, and the business-intelligence layer are **post-PMF**.
Win the retention story first; sparkle later.

## B. The org model (already built / designed, do not re-invent)

"Everything is an org" (keystone **D2**). A gym is the highest-value instance of the universal
`organization -> program -> group` hierarchy, not a new product surface (`02` §10).

- **Gym = `organization(kind='gym')`** on one billing relationship.
- **Trainer's book = `program`/`group`** scoped to that trainer (the position-coach scope model, `02`).
- **Class/cohort = `group`** ("Tue 6am", "Varsity"): a display + scope layer.
- **Member = athlete/client profile** that the member **owns forever** and takes with them when they
  leave (keystone **D1**). The gym owns *access*, never the record.
- **Active-participant metering** is the gym-unlock rule (`02` §5): a seat is consumed by being *active*
  (membership status + recency); graduated/archived/inactive seats free up automatically, no manual reclaim.

## C. Pricing and the ROI story (ratified)

Tiers price by **active participants**, not total membership (`03` §1.1, ratified `STRATEGIC-DECISIONS` #3):

| Tier | Active participants | Price | Per active/mo |
|---|---|---|---|
| Starter | up to 30 | $249/mo | ~$8.30 |
| Growth | up to 75 | $499/mo | ~$6.65 |
| Performance | up to 150 | $799/mo | ~$5.33 |
| Enterprise | custom | custom | - |

Hold these **low for the land phase** and instrument ROI so the anchor can be raised later from proof
(`05` RT-8). The closing math (`03` §6.3): a $499 Growth plan pays for itself ~2x if accountability
retains **just 3 members** who would have churned at $80/mo, and a 75-member gym typically churns more
than three a month; package it as a $20/mo premium tier and 40 premium members is +$301/mo net over the
$499 cost. **Never hardcode pricing** (catalog is data, `03`).

## D. The community surface (the one real safety edge)

A leaderboard/challenge surface is a core retention mechanic the gym is buying, and it sits against the
Constitution's anti-vanity-metric stance. The reconciliation is **already ratified** (`02` §10.3, `05`
§D Tension-1): the *same* primitive is legitimate or harmful depending on context. The locked rules:

- **Opt-in, OFF by default**, reads the **one platform-owned score** (no second number, computed on read
  so it cannot drift). Architected in `architecture/10` Scenario 21 (`leaderboard_settings` +
  athlete-self-write `leaderboard_optouts`).
- **Execution metrics only** (`compliance`, `streak`, `days_on_plan`, `score`). Never raw weight, never
  PRs, never the kid instead of the execution.
- **Adults (gym community):** opt-in is a real, freely-given choice; members chose a community gym for
  exactly this energy. The board celebrates **top movers and most consistent, recognition over ranking**.
- **Minors (HS, later step):** default off; a minor appears only if **guardian-verified AND opted in**.
- An org may **enable** a board but can **never force an athlete onto it** (athletes own visibility, **I1**).

## E. What ships at launch vs. post-PMF

| Now (launch, SD-2) | Post-PMF (after retention is proven) |
|---|---|
| Owner roll-up dashboard (one contract, every trainer + member) | TV-mode: a thin opt-in *projection* of the board, only after a real gym asks |
| Opt-in, execution-only leaderboard seam (already-built math) | Rewards: hard rule, may attach only to *executing the plan*, never to the score or a ranking (`05` RT-9) |
| Member "at-risk" surface = the **platform score trend** (see F) | The full business-intelligence layer (see F) |

## F. The harvest: gym business intelligence (post-PMF, guarded)

The new founding prompt articulates a gym BI layer (Member Risk Score, Challenge Analytics, ROI
Reporting, "members likely to cancel," "trainer performance," "revenue opportunities"). It is worth
building, **after PMF**, under two hard constraints:

1. **The Member Risk Score IS the platform Development/Execution Score trend, not a new number** (`02`
   §10.2 forbids a second score; keystone **I3** score integrity). The retention dashboard is the
   intervention dashboard (flagship #4) pointed at churn, reading the one score everywhere.
2. **It rides the honest-naming and no-per-coach-formula rules** (`05` SD-5, keystone **D3**): the gym
   cannot re-weight the formula for its members; org customization is weights within evidence-based
   rails only. The number means the same thing in every gym, which is the entire point of the credential.

Trainer-performance and revenue-opportunity analytics are roll-ups of the *same* execution data, not new
collection. ROI reporting (retained members x avg membership value vs. plan cost) is the value-metric
story that lets the org-tier anchor rise later.

## G. The one hypothesis the beta must prove

This is the most load-bearing assumption in the whole gym thesis, and it is currently **asserted, not
measured**: *that nutrition-accountability adherence is a leading indicator of gym retention, and that a
gym will pay for it.* The indispensability thesis (`00` §14) and the entire ROI story are built on it.

**Make the beta test exactly this, before any BI/ROI feature is built:** does a member's execution-score
trend actually predict cancellation, and does a real gym owner pay real money for the retention story?
If that curve is flat or gyms balk at the price, the gym strategy is revisited *before* the runway demands
it, not after. The graveyard of fitness software is full of "gyms will pay for engagement" that never
validated. We treat it as the #1 beta question, not a settled strategy (`05` RT-1).

---

**Deference footer.** Where this doc and the canon touch the same subject, the canon governs the
mechanics and this governs the board-readable synthesis. Mechanics: `02`/`03`/`00`/Scenario 21. Ratified
calls: `STRATEGIC-DECISIONS` #1-#3, `05` §E SD-1/SD-2 + RT-1/RT-8/RT-9. Keystones: D1 (athlete owns data),
D2 (everything is an org), D3 (platform owns the formula), I1 (athlete owns visibility), I3 (one score).
