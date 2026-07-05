# OnStandard — Business Model

*Author: Bo Woods · Date: 2026-07-05 · Status: Founding decision doc*

> **Thesis in one line:** OnStandard is a **whole-athlete accountability platform** —
> nutrition *and* academic eligibility on one score — sold to **club/academy programs**
> through the **coach network**, priced **per-seat on Stripe**, run **solo and profitable**.

This doc is the reasoning behind the model, the pricing, the go-to-market, and the unit
economics — with the target-vs-model scorecard and the assumptions spelled out. It supersedes
nothing; it sits alongside `03_PRICING_AND_GTM.md` and `LAUNCH-PRICING.md` as the owner-level
"why this shape."

---

## 0. The owner's north star

**Profitable solo business.** Maximize take-home cash with minimal team and ops. The metrics
below (85%+ gross margin, 60%+ net, <3% monthly churn, 5:1+ LTV:CAC, <1-month payback) are the
*point*, not vanity — they describe a one-person company that could run indefinitely without a
raise, while staying architected so a raise or sale is *possible* later.

**The scarcest resource is the owner's time.** Every model choice below optimizes for *dollars
per account* and *low account count*, because support load scales with the number of accounts,
not the number of dollars. "Death by a thousand $99 support tickets" is the single most common
way a solo SaaS owner gets buried — the entire model is built to avoid it.

---

## 1. What OnStandard is (the reframe)

The brand was never "a nutrition app." It's **OnStandard — held to a standard.** Nutrition is
module #1. The product is an **accountability engine** that any "standard" can plug into.

At launch we run **two standards as a co-wedge**:

1. **Nutrition** — the athlete logs meals; AI estimates macros; a daily commitment and score
   hold them accountable; parents/coaches see the truth.
2. **Academic eligibility** — the athlete uploads their class schedule and syllabi; AI extracts
   deadlines and exam dates; the same daily/weekly commitment loop holds them accountable;
   parents, coaches, **and academic advisors** see risk *before* the athlete becomes ineligible.

Eligibility is often the **sharper pain** than body composition: a coach's worst nightmare after
injury is losing a starter to a failed class; parents lose more sleep over grades than macros.
Leading with "whole-athlete accountability" speaks to a hotter pain with the same audience, and
deepens the switching cost (two modules of accumulated history, not one).

### The discipline that keeps the same standard as nutrition

We **never touch official academic records.** We track the *behavior that produces the grade*,
not the grade itself:

- **Do** ingest syllabi/schedules and hold the athlete to *self-reported, stakeholder-verified*
  commitments ("assignment turned in? study block done? showed up?").
- **Don't** integrate the school LMS/SIS (Canvas/Banner), pull official grades, or store
  protected education records. That path is FERPA + institutional IT + procurement — the exact
  glacial friction the whole model is designed to avoid, and a legal minefield for minors.

Same principle as nutrition: **we don't do the work, we hold them to the standard.**

---

## 2. The engine (one engine, two standards)

The move that makes the co-wedge survivable for a solo owner: **do not build two products.**
Build **one accountability engine** with a pluggable "standard" type. Both modules are the same
five steps — they differ only in the artifact ingested and the commitment list produced.

```
  upload artifact   →   AI extracts commitments   →   daily/weekly check   →   verify        →   score & digest
  ---------------       -----------------------       ------------------       ------------      ---------------
  meal photo            macros / portions            yes / partial / no       parent            whole-athlete score
  syllabus + schedule   deadlines / exam dates       yes / partial / no       coach / advisor   risk flags → coach
```

Consequence: **academics adds one artifact parser and one content type — not a second product,
a second support surface, or a second engineering vertical.** The syllabus parser reuses the
same vision-extraction capability as the meal-photo pipeline. The daily academic check-in reuses
the existing yes/partial/no commitment primitive and runs on cheap text (Haiku), not vision.

This is what protects the 60%-net and stay-solo constraints while still shipping the co-wedge.

---

## 3. Who pays — the tier stack

One economic anchor, with feeder and byproduct tiers around it.

| Tier | Buyer | Rail | Role in the model |
|---|---|---|---|
| **Org / Team** ⭐ | Club/academy program (coach or owner) | **Stripe** | **The anchor.** One sale covers a 30–150 athlete roster. Best margin, lowest support-per-dollar, becomes the acquisition channel for everything above and below. |
| **Pro** | Independent trainer **or dietitian (RD)** | Stripe | Self-serve feeder tier. RDs are the *best* small-account segment — licensed, credible, sticky. |
| **Consumer** | Individual / graduating athlete | Apple/Google IAP | **Free byproduct only.** Inherited from org rosters at ~$0 CAC. Never a paid-acquisition target. |

### Why club/academy is the anchor (not consumer, not solo-trainer-alone)

- **Consumer fails four of five metrics as an anchor:** IAP's 30% cut caps gross margin ~65%,
  teen churn runs 5–8%/mo, paid CAC breaks payback, LTV:CAC lands <2:1. Valuable only as a free
  byproduct of the channel.
- **Club/academy is the cleanest org payer:** private/parent money (swipe today, no purchase
  orders), one decision-maker, year-round usage, and it sits exactly where the owner's coaching
  credibility converts. It also *contains* the HS- and college-bound athletes, so we reach them
  without touching school procurement.

### Expansion down the same product (same build, different payer friction)

A club, a HS team, and a college program are the **identical product** — "a coach with a
roster." Only the payer and cycle change:

- **Club / academy** → private money, fast. *The wedge.*
- **High school** → thin budgets, PO/AD friction, seasonal. *Fast-follow; great for word-of-mouth
  and credibility.*
- **College** → real money and prestige logos, but glacial procurement and they may already staff
  a dietitian. *Trophy expansion, later.*

**The dietitian is the wedge that cracks college.** "They already have an RD" is not an objection
— that RD is drowning trying to cover 80–120 athletes they see a few times a semester. Sell
OnStandard as *their* force-multiplier and the staff dietitian becomes the internal champion and
seller. Likewise, the **academic advisor** is the champion for the academics module inside schools.

### Positioning guardrail for the Pro tier

The AI must be framed as **the professional's leverage, not their replacement.** To an RD or
trainer, "AI nutritionist" reads as competition. Reframe: the AI handles the daily
logging-and-accountability grind *between sessions*; the human owns the expertise and the plan.
Same engine, different framing — it unlocks the professional segment instead of alienating it.

*(Deferred: an RD **marketplace** — connecting teams without a dietitian to human RDs — is real
revenue but means managing humans and service delivery. That breaks "stay solo." Park it.)*

---

## 4. Pricing & packaging

Prices are the existing catalog (`src/core/pricing.ts`, `LAUNCH-PRICING.md`). The model doesn't
change the numbers — it changes the **cadence default** and the **COGS discipline underneath**.

### Cadence: monthly **and** annual — annual incentivized, never forced

- **Monthly stays a first-class, prominent option.** (Owner ruling.)
- **Annual is the better deal** (≈ 2 months free), highlighted at checkout — but a *nudge*, not
  a gate. ~30–50% of B2B buyers self-select annual for the discount; we get the cash-flow and
  churn benefit from *them* without punishing monthly buyers.
- Annual is the relief valve for the one cost of keeping monthly: 12 renewal decisions a year
  instead of 1 (a bigger churn surface).

### The org bands (per-seat is the margin engine)

| Plan | Monthly | Annual | Seats | $/seat/mo | Overage |
|---|---|---|---|---|---|
| Starter | $249 | $2,490 | 30 | $8.30 | — |
| Growth | $499 | $4,990 | 75 | $6.65 | — |
| Performance | $799 | $7,990 | 150 | $5.33 | $10/seat |
| Enterprise | Custom | Custom | 150+ | — | — |

Overage seats ($10 vs ~$1 marginal cost) run ~90% margin — clean expansion revenue as a roster
grows.

### Academics as expansion revenue

Ship academics as an **add-on module / tier bump on proven accounts**, not a discount. It grows
revenue with **zero new CAC** — the single best growth lever for a solo owner (see NRR, §6).

---

## 5. Go-to-market — coach-led, near-zero CAC

The owner **is a Power-4 coach.** That is the unfair advantage the entire GTM is built on:

- **Warm intros to the coaching tree** — coaches trust coaches and talk constantly. Referral
  density drives CAC toward zero, which is what makes 5:1 LTV:CAC and <1-month payback trivial.
- **Peer credibility** no outside SaaS founder can buy, and native language (no "AI-slop"
  translation problem).

**Sales motion: low-touch, not zero-touch.** A club needs a demo, and the owner is the demo. The
fix is a **single, repeatable ~20-minute ROI demo → Stripe self-checkout.** Record it, template
it, and let the buyer self-serve the seats. That keeps the model solo-scalable.

**Channel flywheel:** club roster → graduating athletes convert to free→paid consumer at ~$0 CAC
→ those athletes carry a portable record to their next team → new org lead. The cheapest channel
(coach → roster → next org) is the incumbents' most expensive one (paid CAC against free trackers).

**Sequence:** clubs/academies now → HS programs (word-of-mouth, credibility) → college (trophy
logos, via the staff-RD wedge) → consumer as a *pull* from graduating athletes, never a *push*.

---

## 6. Unit economics — the scorecard

**COGS reality:** the "$2/user" figure is worst-case *heavy* user. Blended reality per *rostered*
seat, with the caps already shipped (12 vision calls/day, prompt caching, Haiku on text):

- AI COGS ≈ **$0.80–1.10/seat/mo** blended (not every rostered athlete is a daily heavy user).
- **Academics barely moves it:** syllabus extraction is ~1 vision call *per term* (~$0.02/mo
  amortized); daily academic check-ins are cheap text.
- Stripe ≈ 3%; hosting is pennies/seat.

Against $5.33–8.30/seat revenue → **~85–90% gross margin at the org tier.**

### Target vs. this model

| Target | Model delivers | Why | Watch-out |
|---|---|---|---|
| **Gross margin 85%+** | ✅ 85–90% | Stripe rail (no Apple tax) + per-seat + AI caps already shipped | Org tier only; consumer stays ~65%, so it stays a byproduct |
| **Net profit 60%+** | ✅ Achievable | Solo owner + near-zero CAC + no payroll; owner draw *is* profit | Conditional: no hires, no paid ads — either one drops it fast |
| **Monthly churn <3%** | ✅ ~2–3% | Two modules + parent + coach + advisor + accumulated history = deep switching cost; eligibility stickier than macros | Monthly billing widens the surface; annual nudge is the relief valve |
| **LTV:CAC 5:1+** | ✅ ~15–25:1 | $3–10k/yr accounts × ~4yr life vs warm-intro CAC ≈ $0 | Holds only while the channel is organic; paid ads erode it |
| **Payback <1 month** | ✅ Day-1 to <1mo | High ACV: one monthly payment ($210–680 gross profit) > a warm-intro CAC | Breaks instantly if anchored on the $15 consumer |

### Metrics not named, but a buyer/investor will look at

- **Net Revenue Retention >100%** — the compounding engine for a solo owner: academics module +
  seat growth + tier-ups grow revenue with zero new CAC. The co-wedge feeds this directly.
- **Negative working capital** — annual buyers fund the business; growth on customer cash, not a
  raise or savings.
- **Revenue concentration** — keep no single club/academy above ~10–15% of MRR (the real risk in
  a low-account-count model).
- **Gross Revenue Retention >90%** — the honest churn floor before expansion masks it; track
  separately from NRR.
- **Support load per account** — the true solo ceiling. The org anchor's low account count is
  what protects it; drifting toward consumer volume is what would bury the owner.

---

## 7. What breaks the model (the two disciplines)

Every target above hinges on the same two rules. Breaking either one collapses the scorecard:

1. **Stay on the org / Stripe rail.** Consumer + IAP is a ~65%-margin, high-churn, long-payback
   business. Keep it as a free byproduct; never anchor on it.
2. **Keep the channel organic.** The coach network is what drives CAC to ~$0. The moment paid ads
   or a sales hire enters, LTV:CAC and net margin both fall. Grow through referral and expansion
   (NRR), not paid acquisition.

Corollary risks to monitor: **focus** (co-wedge doubles the promise — the one-engine architecture
is the mitigation, hold the line on it), **concentration** (§6), and **owner-dependence** (for
future optionality, systematize and document so the business is sellable, not just runnable).

---

## 8. Roadmap implications (what this model asks the product to be)

Not a build plan — the constraints the model puts on the product:

1. **Refactor to one accountability engine** with a pluggable "standard" type; nutrition and
   academics are content configs, not separate stacks.
2. **Syllabus/schedule parser** reusing the meal-photo vision pipeline; academic check-ins on the
   existing commitment primitive (cheap text).
3. **Advisor stakeholder type** alongside parent/coach; whole-athlete score that blends modules.
4. **Org self-serve checkout** (Stripe) with monthly + annual, annual incentivized; a recorded
   ~20-min ROI demo as the top of funnel.
5. **Academics packaged as an add-on module** on org accounts (expansion revenue), gated so it's
   a tier bump, not bundled free.
6. **RD/advisor "leverage" framing** in the Pro-tier product surfaces and copy.

---

*Living document. Revisit when the nutrition + academics loop proves out on the first cohort of
clubs, and again at the first HS and first college close.*
