# Subscription re-map — design

**Date:** 2026-09-21
**Status:** awaiting founder review
**Supersedes:** the pricing half of `docs/founding/BUSINESS_MODEL.md` §3 and the catalog in
`src/core/pricing.ts`. Does **not** supersede the funded-access model (sponsor / trainer /
parent), which this design leans on rather than replaces.

---

## §0 Measured ground truth (2026-09-21)

Every number here was read from live prod on the date above. A claim below is labelled
**measured**, **decided**, or **assumed** per the convention in `docs/founding/README.md`.

| | Value | Source |
|---|---|---|
| Revenue, all time | **$0** | measured — `subscriptions`, `payments`, `offer_payments`, `offer_claims`, `sponsored_access`, `trainer_funded_access`, `plan_assignments` all 0 rows |
| Profiles / active in 7 days | 60 / **4** | measured |
| Weekly meal-logging athletes | **1** (peak 6, week of 2026-08-17) | measured |
| **AI cost, heaviest real athlete, Sept** | **$3.61/month** (179 calls) | measured — `ai_call_costs` |
| AI cost per meal-analysis call | **$0.0168** | measured |
| AI cost per meal-chat call | **$0.0126** | measured |
| Share of AI spend that is `analyze-meal` | **93%** | measured |
| AI cost of a *paying* athlete | **unmeasured** | `deep-analysis`, `monthly-report`, `plan-generate` have **zero calls ever** |

**The $3.61 is a floor, not a ceiling.** It is what a free-shaped athlete costs (photo logging
plus chat). The three premium AI functions a paying subscriber unlocks have never been invoked by
anyone, so their cost is unknown. Re-measure after the first ten paying athletes before trusting
any margin below.

### What already exists (and was wrongly assumed missing)

- **Cost telemetry is complete.** `ai_calls` (one row per paid Anthropic call, with token
  counts), `ai_model_prices`, the `ai_call_costs` view, `ai_cost_daily`, `ai_cost_per_meal`,
  `ai_spend_pending`. Recording since 2026-07-22 via `supabase/functions/_shared/ai-telemetry.ts`.
  A prior note claimed cost was uninstrumented; it had only checked `ai_usage_daily`, which
  carries a call count and no dollars. **No new instrumentation is required.**
- **`book_access(kind, book)` exists** (migration 0223) and already answers the entitlement
  question, with a 14-day preview, grandfathering from 2026-09-08, and read-only-not-locked-out
  semantics. **Nothing calls it.**
- **Rooms are position groups.** `team_rooms` (with `staff_owner_id`), `team_members.room_id`,
  and requirement sets scoped `team | position | group | athlete`.
- **Staff exist and are scoped** — `team_staff` with `scope_kind in ('position','group')`.

---

## §1 The catalog

The pricing metric is the **active athlete-month** — an athlete who logged ≥
`ACTIVE_DAYS_THRESHOLD` days in the calendar month (migration 0163). Idle athletes cost nothing
and count for nothing.

**That metric is internal.** Customers see flat roster bands. A school needs to know what the
bill is; it must never read "$X plus $Y per athlete who logged N days."

| Plan | Monthly | Annual | Active athletes | Per athlete | Rail |
|---|---|---|---|---|---|
| Coach | Free | Free | **3** | — | — |
| Room | $99 | $990 | 10 | $9.90 | Stripe |
| Team 30 | $249 | $2,490 | 30 | $8.30 | Stripe |
| Team 75 | $499 | $4,990 | 75 | $6.65 | Stripe |
| Team 100 | $649 | $6,490 | 100 | $6.49 | Stripe |
| Team 150 | $899 | $8,990 | 150 | $5.99 | Stripe |
| **School** | **$1,499** | **$14,990** | **300, unlimited teams & sports** | **$5.00** | Stripe |
| Enterprise | Custom | Custom | 300+, districts & colleges | — | Stripe |
| Individual | $19.99 | $199.99 | 1 | $19.99 | IAP |
| Family | $24.99 | $249.99 | 4 | $6.25 | IAP |

**Annual is ten months for twelve** on every Stripe plan. Consumer annual lands on the nearest
real App Store price point ($199.99 / $249.99, not $199.90 / $249.90) — no round figure exists on
Apple's ladder, and the store must never charge more than the paywall printed.

### Checks this catalog passes

- **Per-athlete cost decreases monotonically** across every band: 9.90 → 8.30 → 6.65 → 6.49 → 5.99.
- **No band arbitrage.** 2 × Team 30 = $498 for 60; Team 75 = $499 for 75.
- **No Room arbitrage.** 3 Rooms = $297 for 30; Team 30 = $249 for the same 30. Rooms stop being
  the cheap answer at exactly three — see §3.
- **Family beats 2 × Individual** by $14.99/mo at the modal two-athlete household. (At the prior
  $9.99 Individual it saved $0.99, which is not a reason to choose a plan. Any future Individual
  price change **must** re-check Family against 2×; this trap has bitten twice.)

### Margin at the measured $3.61/athlete

| Plan | Net of fees | AI | Contribution | Margin |
|---|---|---|---|---|
| Room | $96 | $36 | $60 | 61% |
| Team 30 | $242 | $108 | $134 | 54% |
| Team 75 | $484 | $271 | $213 | 43% |
| Team 100 | $630 | $361 | $269 | 43% |
| Team 150 | $873 | $542 | $331 | 38% |
| Individual | $13.99 | $3.61 | $10.38 | 52% |
| Family (2 active) | $17.49 | $7.22 | $10.27 | 41% |
| Family (4 active) | $17.49 | $14.44 | $3.05 | **12%** |

**The margin curve runs backwards** — 61% at the smallest band, 38% at the largest — because the
per-athlete discount deepens while the per-athlete AI cost stays flat. This is tolerable at
$3.61 and becomes a problem if the paying-athlete cost lands materially higher. **Decided:** hold
these prices through the first ten programs; revisit the discount depth once §0's unmeasured
figure is measured.

**Family at four active athletes is the weakest account in the catalog** (12%). Accepted: the
modal family is two, and policing household composition costs more than the leakage.

### School is the best margin in the catalog, and it inverts the curve

`teams.org_id` already hangs many teams — each with its own `sport` — off one org, so this tier
needs no new data model. A typical American high school runs 7–10 varsity programs and
**250–350 athletes** under one athletic director: the same person who has to approve a single
football deal. Selling one sport into that building leaves 80% of it unsold in a conversation
that already had to happen.

**Seasons stagger, and the billing metric is active athletes.** Football is fall, basketball
winter, baseball and track spring. Roughly a third of a school's athletes are in season at once,
so a School account bills 300 and serves ~120.

| | |
|---|---|
| Billed | 300 athletes |
| Typically active | ~120 |
| AI at $3.61 | ~$433/mo |
| Net of fees | ~$1,455 |
| **Contribution** | **~$1,022 (70%)** |
| Floor, if all 300 were active at once | $372 (26%) |

At 70% this is the **highest-margin tier in the catalog** and it reverses the backwards curve in
§1 — every other band gets thinner as it grows because per-athlete price falls against flat
per-athlete cost; School gets *fatter* because it charges for a roster and serves a season.

Arbitrage runs the right way: 2 × Team 150 is $1,798 for the same 300, so consolidating is always
cheaper for the customer, which is the behaviour we want. Per-athlete cost stays monotonic —
9.90 → 8.30 → 6.65 → 6.49 → 5.99 → **5.00**.

**The pitch is $50 per athlete per year, whole school, one invoice** — less than most schools
already charge as a participation fee for a single sport, and well inside what §4's funding pool
covers across 300 families.

### Known, accepted leaks

- **Team 30 undercuts 30 Individuals by 58%** ($2,490 vs $5,999/yr). Thirty athletes could in
  principle self-organise under a nominal coach. Accepted — coordinating thirty payers is harder
  than it reads, and the team product is *governed* (a coach sets the standard), which a
  self-organised group does not want.
- **Four teammates are not a family.** Enforcement is app-side and thin. Accepted.
- **The 3-athlete free floor is a fraud surface** — a trainer with 9 clients can open three coach
  accounts. Worth a cheap signal check (same email domain, same device), not real engineering.

---

## §2 What you get

**Staff are unlimited and free on every paid plan.** Only one of the ten Anthropic-calling
functions is staff-triggered (`coach-voice-nudge`); the entire cost base is athletes logging.
Per-coach pricing would make a head coach ration access, and the person cut is the position coach
— the one who would open it daily. Rationing your own engagement driver to collect a few hundred
dollars is a bad trade.

**Rooms are unlimited and free on every paid plan.** A room costs nothing to serve. Rooms are how
a roster gets organised, and organisation is what makes the product sticky. A room with an owning
coach and its own scoped standard, overriding the team standard, is a Power-4 staff structure
expressed in software — it is the differentiator, and gating it would be the wrong instinct.

| | Coach (free) | Room | Team 30+ |
|---|---|---|---|
| Roster, invites, athlete profiles | ✓ | ✓ | ✓ |
| Build standards | ✓ | ✓ | ✓ |
| Active athletes | 3 | 10 | band |
| Staff seats | 1 | 1 | unlimited |
| Rooms | 1 | 1 | unlimited |
| Team-scoped standards | — | — | ✓ |
| Announcements, week pattern | — | — | ✓ |
| Cross-room rollups & insights | — | — | ✓ |

**OnStandard Pay is off the roadmap** (founder ruling, 2026-09-21). The platform take rate —
15%, configured in `pay_platform_config`, wired through Stripe Connect on `marketplace-checkout`,
`pay-offer-checkout` and `public-offer-checkout` — is **not** part of this model and no revenue is
forecast from it. The code stays where it is; it is not being ripped out, and it is not being
maintained or sold either.

**Consequence that must be handled:** `CAPS` currently grants practice books
`offers: 1, payments: 1, packages: 1`, so a trainer sees offer and payment surfaces today. With
Pay off the roadmap those are dead ends. Set them to `0` in the same pass that wires
`book_access` into `CAPS` (§6 step 1) so a trainer never clicks into a feature that goes nowhere.

**Room is the entry SKU and the most important price in the catalog.** $249/mo needs an athletic
director. $99/mo is a position coach's own card, or a line item approved without a meeting. It is
the only price point a single coach can say yes to alone — and a single coach saying yes is the
only sale OnStandard has ever made. It also converts the free-rider it replaces: the position
coach with eight linebackers, who under a 10-athlete free tier would never have paid at all.

---

## §3 Room sprawl and the rollup

A program adopts bottom-up: the LB coach buys a Room, the OL coach follows, then DBs. Five rooms
later the school is paying $495/month across five cards, the head coach has no roster view, and
they are spending Team 75 money for less than Team 75.

**Trigger:** when a third room appears under the same org, show both the room owners and the head
coach a consolidation prompt. Credit paid-but-unused time against the first team invoice.

> West Orange Football is running 3 rooms — 30 athletes, $297/month. Team 30 covers the same 30
> for $249 and adds the head coach's roster view, team standards and announcements. Consolidate?

Three is the honest trigger because three is where the arithmetic flips. **One room is a coach;
three rooms is a team.** Sprawl is also the cheapest lead source available — five position
coaches paying out of pocket inside one building make the AD's decision for them.

---

## §4 The funding pool

A high-school coach cannot sign a $4,990 purchase order, and discounting will not fix an
authority problem. **Separate who uses OnStandard from who funds it.** One team entitlement, any
number of funders.

The coach shares one link. School athletics, the booster club, an NIL or sponsor partner, and
parents all contribute against the same total. Once funded, every athlete on the roster works
identically. **Coaches never see who contributed, and no athlete is ever marked paid or unpaid** —
paid/unpaid badges scattered across a roster destroy the coach's value proposition, which is a
single standard applied to everyone.

**The per-athlete figure must be derived, never set.** Pool total = the band price. Per-athlete =
band ÷ roster, displayed for parents deciding a share.

> West Orange Football · Team 75 · 50 athletes · **$4,990/season**
> School athletics $1,500 · Boosters $1,250 · Parents (18 families) $2,240 → **funded ✓**
> Even split across 50 athletes: $99.80 each

A worked example that set $8/athlete/month independently produced $4,000 against a $4,990
invoice — the pool filled to 100% and the team was $990 short. Derive it.

Implementation rides `sponsored_access` + `offers` + `sponsor-checkout`, all of which exist and
have zero rows.

---

## §5 Read-only, in both places

Read-only means: **everything already created stays visible and nothing new is produced.**

**Team, at trial end or lapse.** The 3 most recently active athletes stay active automatically —
the coach is never asked to pick three kids out of fifty, which is triage, not onboarding. The
rest go read-only: full history, scores and photos remain; they stop logging new meals and stop
receiving roll call. The coach may swap which 3 are active at any time. Funding restores everyone
instantly, with nothing lost. The greyed rows are the conversion mechanism — forty-one frozen
athletes explain the product faster than any email.

**Athlete, at graduation or lapse.** Free forever: history, past scores, meal photos, progress,
achievements, recruiting profile. Paid: continued logging, the AI Nutritionist, new scores, new
recovery data, coach/trainer connection, deep analysis.

**We never tell an athlete to pay or lose four years of their own data.** We monetise continued
value, not access to what they already created. This is also the strongest line on the consumer
paywall — nobody else in the category says it.

`book_access` (0223) already documents exactly this posture: it answers, the client gates
**writes**, and reads stay open.

---

## §6 Build order

Nothing here is worth anything until something can take money. Ordered by that.

1. ~~**Wire `book_access` into `CAPS`.**~~ **DONE 2026-09-21 — and most of it was already
   built.** This spec claimed nothing called `book_access`. That was wrong: `coach-data.js`
   already held `ACCESS`, `WRITE_CAPS` and `gatedCaps()`, `loadBookInner` already called
   `roles.bookAccess(kind, bookId)` → the RPC, and `CD.caps` already returned the gated set. The
   real gap was narrower and in two places:

   - **The gate had no test.** The one predicate the business model rests on could have been
     inverted or disconnected by any refactor and nothing would have caught it. Now covered by
     three passes in `operator-book.test.mjs`: unknown answer fails open, `entitled: true` keeps
     every write, `entitled: false` drops all 13 writes and keeps all 7 reads.
   - **Three screens wrote without consulting caps** — `coach-rooms` (5 writes, all through one
     `run()`), `coach-announce` (1), `pass-grant` (1). Gated at the action rather than the
     button, because a disabled button can be re-enabled from a console. Six other coach screens
     were checked and perform no writes.

   Practice `offers`/`payments`/`packages` set to `0` in the same pass (§2).
2. **Seat counting and the bands.** Surface the active-athlete count against the band, the
   3-athlete free floor, and the trial-end selection in §5.
3. **Throw the Stripe live key** and add the Room / Team 100 products.
4. **Catalog edit.** `src/core/pricing.ts` is truth; five mirrors must move with it —
   `pricing.test.ts`, `proto/js/pricing.js`, `proto/js/ob2.js`,
   `docs/founding/LAUNCH-PRICING.md`, `docs/go-live/CONSUMER-IAP.md`. `obPlanPricingParity` is the
   test that catches a mirror left behind.
5. **Consumer prices in App Store Connect.** The six existing products are priced at the old
   catalog; the store's price binds, so the console moves before the code claims the new figure.
   Individual Plus is retired — see §7.
6. **Funding pool** (§4).
7. **Room rollup prompt** (§3).

**Explicitly not in this spec:** RLS write policies consulting `book_access`. 0223 states the
boundary — that change must run the SQL authorization suite (`npm run verify:full`, needs a local
Supabase stack), and a wrong deny locks real coaches out of rosters they built. That is the one
failure worse than the gap.

---

## §7 Decisions made in this design

| Decision | Ruling |
|---|---|
| Free tier | Coach account + **3** active athletes, permanent, + one 14-day full-roster trial **per org**, not per coach |
| Individual Plus | **Retired.** It sold the recruiting card; `has_premium_access` never reads `tier`, so every paid athlete already had it. $5 for nothing. |
| Individual | $19.99 / $199.99 |
| Family | $24.99 / $249.99, unchanged — raising Individual closed the 2× trap |
| Team 150 | **$899.** Measured cost puts it at 38% margin, not underwater as feared |
| Team 100 | **New, $649.** A full program is 7–10 rooms and 90–100 athletes; without it they buy Team 150 and pay $8.99/athlete — worse per athlete than Team 30, for the best customer |
| Room | **New, $99 / 10 athletes.** Priced *above* Team 30 per-athlete so 3 Rooms never beat Team 30 |
| Band overflow | **Grace, not a block.** The 31st athlete activates and works; coach is notified; 30 days; plan moves up at the next billing date unless trimmed. Never a surprise line item — predictability is the sale. |
| Active-athlete metric | Internal only. Customers see flat bands. |
| Staff seats | Unlimited, free |
| Rooms | Unlimited, free |
| Graduation | **Read-only**, never dark |
| Sport | **Not a pricing dimension.** Eight sports ship; sport and position are profile fields feeding AI context and roster labels. No sport-specific logic exists, so there is nothing to sell. |

## §8 Open — founder rulings still owed

1. **Discount depth.** The margin curve runs backwards (§1). Holding these prices through the
   first ten programs is the recommendation, not a settled decision.
2. **Web checkout for consumer — verified 2026-09-21, and smaller than first claimed.** US App
   Store apps may include external payment links with no entitlement, no approval and no Apple
   commission (Guidelines 3.1.1/3.1.3, updated May 2025 after *Epic v. Apple*). Constraints: the
   link must open a **real browser**, not a webview; IAP must remain available alongside it; US
   storefront only (the EU needs an entitlement and still owes fees).

   The gain was overstated at +38%, which assumed Apple's 30% rate. Under $1M/yr OnStandard
   qualifies for the **Small Business Program at 15%**:

   | On $19.99 | Net |
   |---|---|
   | IAP at 30% | $13.99 |
   | IAP at 15% (Small Business) | $16.99 |
   | Own web checkout | $19.11 |

   So link-out is worth **~+12% today** and ~+37% only past $1M/yr. **Cheaper first move: confirm
   Small Business Program enrolment** — a form, worth $3/subscriber/month immediately. Link-out
   stays out of §6's build order until that is done and the numbers justify it.
3. **Enterprise floor.** No number. Athletic departments are the only path to ~10x ACV, and
   nothing in this catalog addresses them.
