# 03 — Pricing & Go-To-Market (the founding commercial doctrine)

> **Status:** FOUNDING DOCUMENT — the board-level commercial strategy the company sells, prices, and
> expands against. Authored 2026-06-29 in the voice of the CEO / CPO / VC partner / Gym Owner /
> Athletic Director, ratified by the executive team. This doc does **not** restate the Constitution
> (`docs/founding/01_PRODUCT_CONSTITUTION.md`), the 20 strategic calls
> (`docs/founding/00_STRATEGIC_QUESTIONS.md`), or the billing architecture
> (`docs/architecture/06-billing-licensing-subscriptions.md`, the `plans`/`plan_prices` catalog and
> the org-keyed `resolveEntitlement` resolver). It **decides** who we sell to, in what order, at what
> price, with what motion, and how one sale compounds into ten. Where it touches pricing mechanics it
> cites the architecture; where it touches strategy it cites §00; it relitigates neither.
>
> **How to read this:** §00 decided *who we dominate first* (the competitive-sport coach /
> performance-trainer wedge, §00.6) and *what we ignore* (§00.7); the DECISION-MEMO ratified
> *org-keyed pricing-as-data* (D4). This document turns those calls into a **commercial machine** —
> named segments, named buyers, named prices as configurable data, a named beachhead, a named
> expansion motion, and a named gym channel. Every number here is a **seed row in the catalog
> (`plans`/`plan_prices`), never a constant in code** (D4, `06` §3.2). Pricing is a dial we turn; this
> doc sets the *opening position*.

---

## 0. The one-paragraph commercial thesis (everything ladders to this)

We do not sell a nutrition app, and we never price like one. We sell **execution accountability as
infrastructure**, and the unit we monetize is the **active relationship between a person invested in
an athlete and that athlete doing the work** — not a logged meal, not a seat that sits idle. We charge
the **organization** (D4), because the org is who derives the economic value (retention, development,
proof, premium positioning) and who can actually pay; the athlete is the user and never the payer
while attached. We **land through one coach and expand across their roster, then to the next org that
athlete joins**, because the portable athlete profile (§00.3, D1) makes every new org find the athlete
*already on the platform* — turning customer acquisition into a network effect instead of a cost line.
The wedge is the **competitive-sport coach and the sports-performance facility (the gym)**; the gym is
not just a customer, it is our **distribution channel into the consumer market we deliberately refuse
to acquire head-on**. Pricing is data, GTM is sequenced, and the moat is that our cheapest channel
(coach→roster→multi-org) is the incumbents' most expensive one (paid CAC against free trackers).

---

## 1. PRICING — the ratified tiers as configurable DATA

The DECISION-MEMO (D4) and architecture `06` §3.2 are explicit: **no dollar amount, plan name, seat
limit, trial length, or feature bundle lives in code.** What follows is the **opening seed** of the
`plans` + `plan_prices` catalog — the prices we launch with, every one of them changeable by an admin
edit (or a future admin console) with **zero app release** (the FTC/ARL agility point, D4). Treat this
table as the canonical seed; treat the *mechanism* as architecture `06`.

### 1.1 The opening price card (seed rows)

| `plans.code` | Display | Audience | Who pays | Seat model | Price (seed) | Rail |
|---|---|---|---|---|---|---|
| `individual` | **Individual** | consumer | the athlete/parent | none | **$14.99 / mo** | IAP (deferred) |
| `professional` | **Professional** | trainer / RD / private coach | the professional | client_seats (50 incl.) | **$124.99 / mo** + **$1.99–$2.49 / seat over 50** | Stripe |
| `program_starter` | **Program — Starter** | small program / gym | the org | active_athletes ≤30 | **$249 / mo** | Stripe |
| `program_growth` | **Program — Growth** | program / gym | the org | active_athletes ≤75 | **$499 / mo** | Stripe |
| `program_performance` | **Program — Performance** | large program / dept / facility | the org | active_athletes ≤150 | **$799 / mo** | Stripe |
| `enterprise` | **Enterprise** | athletic dept / multi-site / franchise | the org | unlimited (custom) | **custom** (`pricing_mode='custom'`) | Stripe / manual |

Effective per-active-athlete economics of the org tiers (the number that wins the deal): Starter
**$8.30**, Growth **$6.65**, Performance **$5.33** per active athlete / month — *decreasing with
scale, which is correct* (bigger programs get a volume break; it rewards expansion, which is the whole
land-and-expand thesis). Note this is materially **below** the $14.99 individual price — deliberate:
the org tier is a *wholesale* price, the individual is *retail*. The athlete who graduates off an org
plan and keeps their record converts at retail (§5.4, §8).

### 1.2 The pricing levers — all data, all promotions modeled in the catalog

Every commercial motion below is already expressible in `plan_prices` (`06` §3.2: `region`,
`promo_code`, `grandfathered`, `active_from/active_to`, `per_seat`, `max_active`). We name the ones we
will actually pull:

- **Trials — `plans.trial_days`.** Open with a **14-day Professional trial** and a **30-day Program
  trial** (a season's worth of "see your roster light up"). $0 trials only; the compliance doc
  requires trial terms disclosed before checkout (`subscription-compliance.md` §1). Individual gets a
  **7-day** trial when the IAP rail ships.
- **Founding-coach / design-partner pricing — `promo_code` + `grandfathered=true`.** The first ~50
  wedge coaches get **50% off for 12 months, then grandfathered** at a locked price forever. This is
  not a discount; it is **paying for proof** (§00.8 Proof pillar) and reference logos. The
  `grandfathered` flag means they are *never* auto-migrated when we raise list price — a promise we
  can keep structurally.
- **Annual prepay — a `plan_prices` row with `interval='year'`.** ~2 months free (≈17% off) for
  annual. This is our **cash-flow + retention lever**: an annual program contract survives a coaching
  change mid-season (the #1 org-churn event).
- **Regional — `region` column.** Reserved seam; we do **not** populate non-US pricing at launch
  (§00.7: international is `[DON'T BUILD YET]`). When we do, it is a row, never a rebuild.
- **Nonprofit / Title-IX / under-resourced-school pricing — a `promo_code`.** A reserved goodwill +
  land lever for public HS programs; **named now so sales doesn't improvise discounts that corrupt the
  price anchor.** Discounts are *catalog rows with a code*, never a rep's spreadsheet.

### 1.3 What is explicitly NOT in the price (the anti-tracker discipline)

We never introduce a per-meal, per-log, per-photo, or per-AI-call meter. The moment pricing meters
*usage of the tracker*, we have conceded we are a tracker (§00.2 bright line #1). We meter **active
relationships** (active athletes / client seats), because that is the unit of value we actually
create. AI meal analysis, the Daily Game Plan, the score — all are **included**, never metered. (Cost
control on the AI is an architecture concern, `05`, not a pricing lever; we eat it as COGS.)

---

## 2. CUSTOMER SEGMENTS + BUYER PERSONAS (BUYER vs USER vs PAYER, and the JOB)

The single sharpest commercial insight in this company: **the buyer, the user, and the payer are
almost never the same person**, and the incumbents who lose to us are the ones who confused them. We
name all three for every segment, plus the **Job-To-Be-Done** they hire us for. (Personas grounded in
`docs/PERSONA-REVIEW-2026-06-24.md`.)

| Segment | BUYER (decides) | USER (daily) | PAYER (card) | Plan | The JOB they hire us for |
|---|---|---|---|---|---|
| **Individual athlete** (Jayden, 17) | the athlete | the athlete | **the parent** (or nobody) | `individual` | "Tell me exactly how to win today and prove I'm doing the work for a scholarship." |
| **Personal trainer** (Marcus) | the trainer | trainer **+** clients | the trainer | `professional` | "Keep my clients compliant between sessions so they don't quit — my income is retention." |
| **Nutritionist / RD** (Dana) | the RD | RD **+** clients | the RD | `professional` | "Watch adherence between visits without attaching my license to an AI number I didn't set." |
| **Gym owner** (Sports-perf facility) | the owner | owner + trainers + members | the gym | `program_*` | "Cut member churn and create a premium, markable accountability tier — NOT meal tracking." |
| **HS coach / AD** (Tucker, the AD) | **AD/admin** buys; **coach** champions | coach + athletes | the school/booster | `program_*` | "Roster-wide accountability at a 3-second glance, defensible to parents and recruiters." |
| **College program** (Vance) | procurement/AD | staff + athletes | the department | `enterprise` | "Protect the investment; prove development; clear compliance/FERPA." |

**The three commercial rules that fall out of this table:**

1. **The champion is rarely the payer.** In schools the *coach* falls in love (the Needs-Attention
   dashboard, §00.13) but the *AD/booster* signs. Our sales motion must **arm the champion to sell
   internally** (an ROI one-pager, a "what your parents will see" sheet), not just convert the user.
2. **The trainer/RD is the only segment where buyer = user = payer.** That is *exactly why it is the
   wedge* — the sale is one conversation, one card, no procurement (§00.6, the within-wedge order).
   Frictionless purchase is a segment property, not a sales-skill property.
3. **The athlete is never the launch payer.** Jayden is 17 with no card and MyFitnessPal-grade
   willingness-to-pay (persona review, pay 2/10). We monetize the athlete **only at graduation**, off
   the portable record (§5.4) — never as a cold consumer acquisition (§00.7).

---

## 3. GO-TO-MARKET — the beachhead, the motion, the wedge-to-expand

### 3.1 The beachhead we dominate FIRST (ratified from §00.6, sharpened commercially)

**The private sports-performance / strength facility and the competitive-sport HS coach running a
roster of ~15–40 athletes** — sold a **nutrition-accountability + retention tool**, explicitly NOT a
performance system. §00.6 ratified the *segment*; this doc commits the *commercial sequence within it*:

> **Beachhead order (each step un-gates the next):**
> **(1) Private performance/strength facilities (the GYM)** — owner is the buyer, decision is one
> conversation, no procurement, clients are often 18+ so the minor-consent layer isn't the gate
> (`subscription-compliance.md` §8). **This is where revenue starts.**
> **(2) HS competitive programs** — bigger rosters, the credential story begins, the coach champions
> and the AD/booster pays; minor consent becomes load-bearing (D7).
> **(3) College / department tier** — procurement, FERPA, multi-program tree; a 12–18 month sale we do
> **not** chase pre-proof (§00.7 un-ignore trigger: a real second org pulls the multi-org tree).

We start where **the sale is one conversation, the payer holds a card, and consent isn't the gate.**
The gym is the beachhead-of-the-beachhead. (This is why §6 — Gym GTM — is the load-bearing section of
this doc.)

### 3.2 The sales motion per segment (self-serve → assisted → enterprise)

| Segment | Motion | Mechanics | CAC posture |
|---|---|---|---|
| **Trainer / RD** (`professional`) | **Self-serve, PLG** | Land page → 14-day trial → Stripe Checkout → Billing Portal. No human in the loop. | Lowest. Content + coach communities + referral. |
| **Gym** (`program_starter/growth`) | **Low-touch assisted** | One demo call (the ROI story, §6.3) → trial → Stripe Checkout. Owner self-serves the seat. | Low. The gym then becomes a *channel* (§6.4) — negative effective CAC. |
| **HS program** (`program_*`) | **Champion-led assisted** | Coach trials free → arms the AD with the ROI one-pager → booster/school PO → Stripe (or invoice). | Medium. The champion does the internal selling. |
| **College / dept** (`enterprise`) | **Enterprise / pulled-not-pushed** | Inbound only pre-proof; procurement, security review, custom contract (`pricing_mode='custom'`). | Highest; **deliberately not staffed until §00.7 trigger fires.** |

**The discipline:** we build a **self-serve bottom** (trainer/gym) that funds and feeds an
**enterprise top** (program/dept) we let the wedge *pull* into existence. We never invert this and
sell top-down into procurement before the bottom proves the loop — that is the §00.18-B push-back
(capability is not strategy).

### 3.3 The wedge-to-expand motion (the one-sentence growth engine)

**One coach adopts → 30 athletes onboard (cross-side network effect, §00.5) → those athletes join
other orgs that find them already on the platform → each new org is a warm sale against an existing
record.** The coach→roster flow is the *engine*; the multi-org density is the *compounding*. We design
the product so the **second org an athlete joins is the cheapest sale we ever make** — the athlete is
already activated, the record already exists, and the new coach sees value on day one instead of an
empty roster (the persona review's #1 onboarding failure, fixed by the portable profile).

---

## 4. COMPETITIVE POSITIONING — execution+accountability, NOT tracking

### 4.1 The category line

**Trackers measure the athlete and walk away. OnStandard measures whether the plan a trusted human set
got *done*, puts it in front of that human, and carries the proof across every org the athlete ever
joins.** We are not on the tracker shelf. (§00.2 bright line #1: if we are ever compared
feature-for-feature to MyFitnessPal, we have already lost.)

### 4.2 The map (where each incumbent lives, and why they structurally can't follow)

| Incumbent | What they own | Why they can't become us |
|---|---|---|
| **MyFitnessPal / Cronometer** | Food-DB breadth, self-logging | Consumer-solo, no coach graph, no accountability loop, no org. Monetizes the *logger*; we monetize the *relationship*. |
| **MacroFactor** | Best-in-class adaptive macro math | A brilliant *calculator* for a solo user. No coach, no org, no portable credential. Adjacent, not competitive — we'd *consume* this as a feature before we'd fear it. |
| **Trainerize / TrueCoach** | Trainer→client workout delivery | **Org owns the client.** Client data dies when the trainer relationship ends — the exact team-trapping model D1 displaces. They have a graph but no portable profile. |
| **TeamBuildr / Bridge Athletic** | Strength programming for teams | Team-stamped data, graduation = data death. Programming-first, accountability-thin, nutrition-absent. |
| **Hudl** | Film + team identity | Owns the *team's* record, not the *athlete's*. The athlete's history is the team's asset; ours is the athlete's. Different ownership model = different moat. |
| **Whoop** | Recovery score, wearable data | A *device*-tethered solo number; no coach plan, no execution-of-a-plan, no org. We borrow their *playbook* (own one word — "Recovery" → our "Development Score") but in the accountability layer, not the sensor layer. |

### 4.3 The wedge against every team-trapping incumbent: the portable athlete profile

This is the single positioning weapon (§00.3 moat #1, D1). Every team incumbent stamps data with the
org; when the athlete leaves, the record dies. **Ours follows the athlete for a decade across six
orgs.** The sales line to a *coach* is "your athletes' history is theirs, so they actually trust you
with it"; the line to an *athlete/parent* is "your record is yours forever, even when you transfer";
the line to a *college* is "you inherit a recruit's multi-year HS execution history as a join, not a
migration" (§00.8). One architectural fact (D1), three different value propositions, zero incumbents
able to copy it without rebuilding their data model. **That is the moat made into a sales script.**

---

## 5. REVENUE MODEL — seat economics, NRR, and the compounding profile

### 5.1 The unit economics that matter

- **Active-athlete metering (D4, `06` §3.4):** orgs pay only for athletes who are `active` AND synced
  within the inactivity window (default 60 days). **Idle seats free up automatically.** This is a
  feature, not a leak: it makes the price *honest* (a gym in off-season doesn't pay for benched
  members), which kills the #1 churn objection ("I'm paying for people who don't use it"). We trade a
  little revenue smoothness for a lot of retention and trust — the right trade for a 10-year company.
- **Professional seat economics:** $124.99 includes 50 client seats = **$2.50/seat floor**, with
  overage at **$1.99–$2.49/seat**. A trainer with 50 clients paying $124.99 while charging clients
  $200–$600/mo each is paying us **<0.5% of the revenue we help them retain.** (This is the WTP
  argument we defend in §7.)
- **Gross margin:** software margins (~80%+) minus AI-inference COGS (meal analysis), which we treat
  as a managed cost line, not a metered price (§1.3). At wedge scale AI COGS is trivial; we monitor
  it, we never pass it through per-call.

### 5.2 Net Revenue Retention — the number the VC partner watches

**Target NRR ≥ 115%** within 18 months of a paying cohort. The expansion vectors that drive it:

1. **Seat growth within an org** — a roster grows; a program adds a sport; a gym adds members. Active-
   athlete metering means *we grow when they grow*, automatically (Starter→Growth→Performance via
   `auto_upgrade`/`soft_warn`, `06` §3.5).
2. **Tier-up across the org tree** — single team → athletic department (one contract, many programs,
   `06` §3.8). The biggest single expansion event.
3. **Professional → Program** — a trainer's book grows past a facility's worth of clients, or a gym
   absorbs an independent trainer. The `professional` tier is a **feeder** into `program_*`.
4. **Graduated-athlete retail conversion** (§5.4) — the only consumer-revenue vector we pursue, and we
   pursue it as a *designed surface*, not a funnel.

Counter-pressure on NRR is **org churn** (a coach leaves, a gym closes). Our defense is structural:
the lock-in accrues to the **athlete and the relationship** (§00.4), not just the org admin — so when
an org churns, the athletes (and often the champion coach, now at a new org) **stay on the platform**.
Athlete-anchored retention is what makes our NRR survive org churn; it is the §00.4 thesis turned into
a revenue number.

### 5.3 The gym revenue-share / monetization angle (the channel economics)

The gym tier is priced so the gym **makes money reselling it** (detailed in §6). Two models, both
expressible as catalog data:

- **Markup model (launch):** gym pays us the org tier; the gym packages accountability into a
  **premium membership upsell** ($15–$40/member/mo) and keeps 100% of the markup. We don't touch their
  member billing; we just power the layer. Clean, no rev-share plumbing, ships day one.
- **Rev-share / affiliate model (later, reserved):** when a gym's members convert to **individual**
  plans (post-membership, or family members not on the gym roster), the gym earns a referral share. A
  `promo_code` + attribution column models it; **[DON'T BUILD YET]** — reserve the seam, build when a
  gym asks. The strategic point: the gym is a **distribution channel** (§6.4), and channels get paid.

### 5.4 The graduated-athlete conversion surface (the §00.18-E mandate, made a revenue motion)

§00.18-E flagged the **graduation cliff**: the moment an athlete leaves an org, they either pay $14.99
or churn — and §00 said we have *no proven conversion motion for that hand-off*. **This doc commits to
building one, because the portable record IS the consumer conversion lever we otherwise leave on the
table.** The motion:

- **The hook is loss-aversion on the record they already own:** "Keep your Development Score history,
  your meal record, and your plan — they're yours. $14.99/mo to keep them live and keep your Daily
  Game Plan." We are not selling a new product; we are selling **continuity of a thing they're already
  attached to** (§00.4 switching cost #1 = accumulated, irreplaceable history).
- **The trigger is the lifecycle event** (`graduated`/`transferred`/`left`), already in the membership
  lifecycle (`06` §3.4). The instant the org seat frees, the athlete sees a *designed* "your record is
  yours — keep it live" surface, not a dead end.
- **The rail is IAP** (`individual`, RevenueCat) — `[DON'T BUILD YET]` (§00.7, s6) until this funnel
  is independently proven, but **this is the first place we prove it**, because the user is already
  activated and attached. This is the lowest-CAC consumer conversion we will ever have, and it is the
  *only* consumer motion §00 sanctions.

This is the cross-doc dependency §00.18-E demanded the Pricing doc honor: **graduation is a designed
revenue surface, not an assumption that the org model covers it.**

---

## 6. GYM GO-TO-MARKET (the required section — the beachhead-of-the-beachhead and the channel)

### 6.1 Why a gym buys — and what they are NOT buying

A gym does **not** buy meal tracking. A gym's existential threat is **churn** (the average gym loses
~30–50% of members annually; member lifetime is the whole business). A gym buys OnStandard for five
reasons, **none of which is nutrition logging**:

1. **Retention** — the #1 reason. Members who feel *seen and accountable between visits* stay. A gym
   that can *prove* it keeps members on track between sessions retains measurably better (§00.14).
2. **Engagement** — the daily loop (Daily Game Plan + the trainer noticing you slipped) is a reason to
   stay connected to the gym on the ~25 days/month the member isn't physically there.
3. **Premium membership tier** — accountability is a **markable upsell** ($15–$40/mo premium) that
   costs the gym almost nothing and differentiates it from the box gym down the street.
4. **Additional revenue** — the markup (§5.3) and, later, member→individual conversion rev-share.
5. **Community + brand** — the gym becomes "the place that actually keeps you accountable," a
   positioning no equipment or class schedule can copy.

The pitch to a gym owner is **never** "track your members' macros." It is: **"turn the 25 days a month
your members aren't here from invisible into a retention engine you can charge for."**

### 6.2 The gym as an ORGANIZATION (why this is free architecturally)

"Everything is an org" (D2) means a gym is just a **facility-scoped org**: the owner sees roll-ups
across every trainer and member, each trainer sees their own sub-roster (scoped access, `02`), and
members get the daily loop. No special-case code — the same `program_*` tiers, the same active-athlete
metering, the same roll-up view that serves a HS program serves a gym (§00.14). The gym GTM rides
entirely on architecture that already exists for the wedge.

### 6.3 The ROI story (what closes the gym owner)

The owner cares about one equation. We make it concrete:

> A **Growth** plan is **$499/mo** for up to 75 active members = **$6.65/member/mo**. If
> accountability retains **just 3 additional members** who'd otherwise churn (at, say, $80/mo
> membership), that's **$240/mo retained revenue** — the plan pays for itself ~2x on three saved
> members, and a 75-member gym typically churns far more than three a month. Everything above three is
> margin. **And** the gym can package it as a **$20/mo premium tier**: 40 members on premium =
> **$800/mo new revenue** against a **$499** cost = **+$301/mo net, before counting a single retained
> member.**

The ROI is **retention + upsell**, doubly. The break-even is so low (≈3 saved members **or** ~25
premium upsells) that the deal is a rounding error against the value. This is the deal that closes in
one demo call (§3.2, low-touch assisted).

### 6.4 The gym as a DISTRIBUTION CHANNEL (the strategic payload of this whole doc)

This is why the gym is the most important segment in the company beyond its own revenue: **a gym is a
warm pipeline of pre-activated individual users and future buyers.**

- **Members become individual users.** Every gym member is an activated OnStandard user with a real
  record. When their gym membership ends — they move, the gym closes, they go solo — they are a
  **graduated-athlete conversion** (§5.4) at near-zero CAC. The gym **acquired the consumer for us**,
  on their dime, which is precisely how we enter the consumer market §00.7 forbids us to acquire
  head-on.
- **Members become future buyers.** A member who becomes a trainer, opens a gym, or coaches their
  kid's team is a warm `professional`/`program_*` lead who already trusts the product.
- **Trainers inside the gym become independent buyers.** A trainer who leaves the gym to go
  independent takes their muscle memory (and often their book) to a `professional` plan.
- **The gym validates the consumer thesis cheaply.** §00.7's un-ignore trigger for the consumer market
  is "a solo-buyer funnel is independently proven." The gym member→individual conversion is *exactly*
  that proof, generated as a byproduct of B2B revenue — we get the consumer signal without paying
  consumer CAC.

**The compounding loop:** gym buys → members activate → members carry the portable profile (D1) → some
graduate to individual / become professionals / open their own orgs → each is a warm node that finds
the platform already populated → the network densifies → the next coach/gym's athletes are
*increasingly likely to already be on the platform* (§00.5 multi-homing density). The gym is where we
buy network density with someone else's CAC.

---

## 7. WHERE WE PUSH BACK (the mandate — challenge the prices and the cap)

We owe the founder seat-economics reasoning, not agreement. Four commercial assumptions we believe are
wrong or under-examined, each with a recommended alternative.

### A. The $14.99 Individual price is set by tracker-anchoring, not value — and it strands the best moat
**The challenge:** $14.99 is suspiciously close to MyFitnessPal Premium (~$19.99) and Whoop (~$30) —
it reads like we *anchored to the tracker shelf we swore never to stand on* (§00.2). If the individual
plan is what a **graduated athlete** pays to keep a multi-year, irreplaceable, portable Development
Score record (§5.4) — a thing **no competitor can offer at any price** — then $14.99 underprices our
single most differentiated asset to match products that don't have it. **Recommended alternative:**
hold $14.99 as the *introductory / graduation-conversion* price (loss-aversion, low friction at the
hand-off), but **architect a second individual price point — `individual_plus` at ~$24.99** — that
unlocks the *portable credential* framing (shareable scholarship/NIL card, full multi-org history,
"your record, forever"). Price the *continuity of an irreplaceable record* like the moat it is, not
like a macro subscription. The catalog already supports two prices on a plan (`plan_prices`); this is a
row, not a rebuild. **We push back on pricing our one uncopyable consumer asset at tracker parity.**

### B. The 50-client Professional cap is the wrong line drawn in the wrong place
**The challenge:** $124.99 for **50 clients** = $2.50/client. For a *personal trainer*, 50 active
clients is a near-impossible book (most run 15–35); for a *gym or a busy RD practice*, 50 is small.
**The cap simultaneously over-includes for the solo trainer (who'll never use 50 and may balk at
$124.99 for the 20 they have) and under-includes for the practice that needs 80.** A single 50-seat
cap serves neither well. **Recommended alternatives, in order of preference:**
1. **Split Professional into two seed rows:** **`professional_solo`** at ~**$59–$79/mo for 25
   clients** (the real solo trainer/RD — lower entry, faster self-serve conversion, matches actual
   book size) and **`professional` at $124.99 for 50** (the multi-trainer practice / power user). The
   $124.99-for-50 single tier likely **suppresses self-serve conversion** at the exact segment that is
   our PLG engine (§3.2). A lower entry point with seat overage captures more trainers and *expands*
   them up — better for NRR than a high floor that scares off the 20-client trainer.
2. If we keep one tier, **lower the floor and meter sooner:** include **25 seats at ~$79**, overage
   from seat 26. The seat overage (`per_seat`) already exists in the catalog; use it to make the entry
   cheap and the expansion automatic.

The seat-economics logic: **willingness-to-pay for a trainer scales with their client revenue, and a
20-client trainer's WTP is well below $124.99 — but their *expansion* WTP (per added client) is high
because each new client is $200–$600/mo of their revenue.** Price the floor to their *current* book
and let metering capture their *growth*. A high flat cap leaves the small-trainer market — the literal
top of our PLG funnel — underconverted. **We push back on a 50-client cap that mis-serves both ends of
the Professional segment.**

### C. The org tiers may be UNDER-priced relative to the retention value they create
**The challenge:** $249/$499/$799 prices the org tiers like *software seats* ($5–$8/athlete), but
we're not selling seats — we're selling **retention** (a gym member's LTV is hundreds to thousands of
dollars) and, for schools, **defensible development proof to recruiters/parents**. A Performance-tier
program at $799 for 150 athletes is paying **$5.33/athlete to protect outcomes worth orders of
magnitude more.** That is *generous to the buyer* — which is fine for land-grab, but we should know
we're leaving value on the table. **Recommended alternative:** hold these prices for the **land phase**
(low friction wins the wedge, §3.1) but **build the value-metric story now** so we can raise the price
anchor later from a position of proven ROI: track and surface *retained members* (gym) and *score-
to-outcome* proof (school), so the renewal conversation is "you retained 12 members worth $11k; your
plan was $6k" — at which point a price increase is a no-brainer and `grandfathered` protects early
believers. **We push back on treating the org price as fixed; it should be a deliberately low *opening*
anchor we earn the right to raise.**

### D. "Athletes never pay while attached" + "$14.99 if they leave" is a cliff, not a strategy
**The challenge:** this is §00.18-E and we are escalating it: the model has a beautiful B2B core and a
**zero-conversion edge**. Without §5.4 built as a real surface, every graduating senior is a 100% churn
event — and graduating seniors are the athletes with the *longest, most valuable records* (the moat at
its peak value, walking out the door). **Recommended alternative (committed in §5.4):** the graduated-
athlete conversion surface is **not optional and not deferred indefinitely** — it is the **first IAP
build**, sequenced the moment the wedge proves the loop, because it is the lowest-CAC, highest-intent
consumer conversion we will ever have. **We push back on shipping the org model without the graduation
conversion surface as a first-class, funded revenue motion** — leaving the moat's most valuable cohort
as an unmonetized churn statistic.

---

## 8. The five commercial decisions that matter most (distilled)

1. **We charge the organization for active relationships, never the athlete for usage** (D4, §1.3).
   The org derives the value and holds the card; metering active athletes makes the price honest and
   kills the #1 churn objection. This is the anti-tracker discipline made into a price model.

2. **The gym is the beachhead-of-the-beachhead AND the distribution channel** (§3.1, §6). It is the
   one-conversation sale with no consent gate, and it acquires the consumer market — on the gym's CAC
   — that we are forbidden to chase head-on (§00.7). The gym is how we get consumer density without
   consumer acquisition cost.

3. **The portable profile is the positioning weapon against every team-trapping incumbent** (§4.3,
   D1). One architectural fact, three sales scripts (coach/athlete/college), zero incumbents able to
   copy it. The sale is "your record is yours forever," and no tracker or team app can say it.

4. **Land self-serve at the bottom (trainer/gym), let the enterprise top be pulled into existence**
   (§3.2). Never invert it and sell into procurement before the loop is proven (§00.18-B). NRR ≥115%
   comes from seat growth + tier-up + the professional→program feeder, and survives org churn because
   lock-in is athlete-anchored (§5.2).

5. **The graduated-athlete is a designed revenue surface, not a cliff** (§5.4, §7-D). The moat's most
   valuable cohort (long-record seniors) must not walk out unmonetized. This is the first IAP build and
   the only consumer motion we sanction.

---

## 9. Cross-doc dependencies the other founding docs MUST honor

- **Constitution doc (`01`):** the anti-tracker pricing discipline (§1.3 — never meter usage, always
  meter relationships) is a *commercial* expression of bright-line #1 (`00` §2). The constitution must
  carry it forward as a non-negotiable: a pricing meter on logs/photos/AI-calls is a violation of "we
  are not a tracker," not just a pricing choice.
- **Strategic Questions (`00`):** this doc **discharges the §00.18-E mandate** (graduation conversion
  as a real revenue motion, §5.4) and **holds the §00.7 ignore-list as GTM scope** (consumer = gym-
  channel-pulled only; college = §00.7-trigger-pulled only; parent = consent-tailwind only). No GTM
  motion may contradict the §00.7 un-ignore triggers.
- **Architecture / Billing (`06`):** every price, tier, trial, promo, and grandfather clause in §1 is a
  **seed row in `plans`/`plan_prices`**, never code (D4). The push-backs in §7 (a second `individual`
  price, a `professional_solo` tier, regional/nonprofit promo codes) are **all expressible in the
  existing catalog with zero schema change** — the doc-06 author must confirm the seed includes them as
  *available rows*, even if launch only populates a subset. Active-athlete metering (`06` §3.4) is the
  honest-pricing mechanism §1.3/§5.1 depend on; it must not regress to flat-seat billing.
- **Roadmap doc (future):** must sequence the **graduated-athlete IAP conversion surface (§5.4)** as
  the *first* consumer rail build (post-wedge-PMF), the **gym roll-up + premium-tier packaging (§6)** as
  a wedge-phase priority (it rides existing `program_*` architecture), and the **`professional_solo`
  split (§7-B)** as a fast catalog-seed change, not a build. It must **not** sequence the enterprise
  contract engine (`06` `[DON'T BUILD YET]`) until the §00.7 college trigger fires.
- **Subscription-compliance (`subscription-compliance.md`):** the trial terms (§1.2: 14-day Pro / 30-
  day Program / 7-day Individual) and the founding-coach grandfathered pricing are the concrete values
  the FTC/ARL disclosure component (`06` §, compliance §1) must render before any checkout. Pricing is
  now decided enough to *unblock the queued checkout build* (Task #6) for the Stripe B2B path; the
  Individual/IAP disclosure waits on the §5.4 rail.
