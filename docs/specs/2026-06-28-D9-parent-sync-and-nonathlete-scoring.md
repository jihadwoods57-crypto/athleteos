# D9 spec — Parent "last synced" + non-athlete (trainer-client) scoring

**Status:** DRAFT for founder/board review. Authored 2026-06-28 per the D9 ratification
("start speccing now"). Neither item ships before the backend is live; this is the design
so the build is a known quantity when the flag flips. No code in this doc.

Two unrelated items were bundled under D9 because both surfaced from the persona play-test
and both need either the live backend or a product decision before building. They are
specced separately below.

---

## Part A — A real "last synced" time on the Parent view

### Problem
The Parent dashboard implies live data but shows no honest freshness signal. A parent can't
tell if they're looking at today's numbers or a three-day-old snapshot. The play-test parent
persona flagged this as a trust gap ("is this even current?").

### Goal
Show a truthful "Last synced: <relative time>" on the Parent view, derived from real sync
activity, never a fabricated value. If data is stale (e.g. > 36h), say so plainly.

### Data model
- The athlete's `days` row already carries `updated_at` (0001_schema.sql) and the client
  stamps `computed_at` on push. The parent read path (`fetchLinkedDays`) should return the
  most recent `updated_at` across the child's synced days.
- Add `lastSyncedAt: string | null` to the parent-facing linked-athlete view model (null =
  never synced / not yet linked).

### Pure core (testable without a backend)
- `lastSyncedLabel(iso: string | null, now: Date): string` -> "Synced just now" / "Synced
  2h ago" / "Synced yesterday" / "Last synced Jun 24" / "Not synced yet". Reuse the relative
  -time conventions already in the codebase; no em dash; no guilt copy.
- `syncFreshness(iso, now): 'fresh' | 'stale' | 'none'` with a stale threshold (proposed
  36h) so the UI can show a quiet amber note when a child hasn't synced in a while WITHOUT
  alarming the parent (factual, e.g. "No new data since Tuesday").

### UI
- A small line under the child's name on ParentView: the label + a dot whose color follows
  `syncFreshness` (neutral when fresh, amber when stale, gray when none).
- Replace any current static/sample freshness text; gate behind `isBackendLive` so the
  demo build shows an honest "Demo data" state instead of a fake timestamp.

### Dependencies / open questions
- Needs the backend live + the parent read path returning `updated_at` (P1 go-live work).
- Q: stale threshold — 36h proposed; confirm against real athlete logging cadence.
- Q: do we want a "nudge your athlete" affordance when stale, or is that overstepping for a
  parent? (Default: no nudge button for parents; observation only.)

### Phasing
1. Pure `lastSyncedLabel` + `syncFreshness` + tests (can land now, behind the flag).
2. Thread `lastSyncedAt` through `fetchLinkedDays` -> ParentView (needs backend).
3. UI line + freshness dot (needs 2).

---

## Part B — Scoring for a trainer's non-athlete (general-fitness) clients

### Problem
The Development Score is built for athletes (protein-first, performance framing). A personal
trainer's book includes general-fitness / weight-loss clients for whom "athlete development"
is the wrong lens. The trainer persona said the app clearly understands trainers but scores
their clients as if they were all athletes. Today every client is scored on the athlete model.

### Goal
A second, opt-in scoring profile — "general fitness" — that reuses the SAME deterministic
engine shape (sub-scores -> weighted headline) but with weights + targets tuned for a
non-athlete goal, so a weight-loss client's number reflects adherence to THEIR plan, not an
athlete standard. One engine, two profiles; never a second formula bolted on.

### Approach (deterministic, pure core)
- Introduce a `ScoringProfile = 'athlete' | 'general'` carried on the client/account.
- `athlete` (today): nutrition 0.5 / recovery 0.25 / tasks 0.15 / check-in 0.1, protein-led
  nutrition sub-score (unchanged — do not disturb the validated model).
- `general` (new): re-weight toward the levers a general client controls. Proposed starting
  point (NEEDS founder/nutrition sign-off, not a final number):
  - nutrition sub-score driven by calorie-target adherence + meal consistency rather than a
    raw protein floor (protein still counts, weighted lower);
  - recovery + check-in retained; tasks retained;
  - a goal-aware target set (calorie deficit/surplus by goal) instead of the athlete protein
    target.
- The score stays 0..100 with the same band language so a trainer reads one consistent scale
  across their whole book.

### Data model
- `scoringProfile` on the athlete/client profile (defaults to 'athlete' so nothing changes
  for existing data). A trainer sets a client's profile at link time or in client settings.

### UI
- Trainer client detail: a profile selector ("Athlete" / "General fitness").
- The client's own app: copy adapts (no "scholarship"/performance framing for a general
  client) — reuse the existing role-aware copy seams.

### Dependencies / open questions
- The re-weighting is a PRODUCT + nutrition-science decision, not an engineering one. The
  numbers above are a strawman; they need founder + (ideally) an RD sign-off before build,
  same bar we hold the athlete model to.
- Per-client profile assignment needs the backend (trainer writes a client's profile) for
  the real path; the pure engine + a local toggle can be built and tested first.
- Q: do general clients see the same "Development Score" name, or a neutral "Progress Score"?
  (Naming matters for the non-athlete framing; recommend a profile-aware label.)

### Phasing
1. Pure: `ScoringProfile` + a `general` weight/target set + `computeDerived` honoring the
   profile, with tests proving the athlete path is byte-for-byte unchanged (default profile).
2. Trainer client-detail profile selector (local first, then backend-persisted).
3. Profile-aware copy + score label.

---

## Recommendation
Both are real, both are post-backend. Part A is small and low-risk (mostly pure label logic +
one read-path field). Part B is a model-design decision that should NOT be built until the
re-weighting is signed off to the same standard as the athlete score. Suggest landing Part A's
pure helpers opportunistically and holding Part B's weights for an explicit founder/RD review.

---

## APPROVAL NEEDED — concrete "general" scoring weights (v1 proposal)

This is the strawman from Part B made specific, for founder (and ideally RD) sign-off. It
becomes critical-path the moment a trainer's general-fitness clients are in the product.
Nothing is built until these numbers are approved. The athlete profile is UNCHANGED.

### The two profiles side by side
| Component | Athlete (today, unchanged) | General (proposed) | Why the shift |
|---|---|---|---|
| **Headline mix** | Nutrition .50 / Recovery .25 / Tasks .15 / Check-in .10 | **Nutrition .55 / Recovery .20 / Tasks .15 / Check-in .10** | A general client is nutrition-driven, not training-load-driven, so nutrition up, recovery down. |
| **Nutrition sub-score (of 100)** | Protein 65 / Meals-on-time 35 | **Calorie-target adherence 45 / Protein 25 / Meal consistency 30** | For fat-loss/general, hitting the calorie *target* is the lever; protein matters for satiety/lean mass but isn't dominant. |
| **Primary target** | Protein floor (180g default) | **Calorie target** (deficit/maintenance/surplus by goal); protein ~0.7 g/lb | Athletes chase a protein floor; general clients chase a calorie number. |

### The exact general nutrition sub-score
- **Calorie adherence (45):** full 45 when within ±10% of the calorie target; linear falloff to
  0 at ±40%. **Both over AND under lose points** (crash-undereating is penalized, not rewarded —
  this is the honest, safe choice and the thing an RD will care about most).
- **Protein (25):** `min(proteinToday, proteinTarget) / proteinTarget * 25`, same shape as the
  athlete protein term, lower weight, lower target.
- **Meal consistency (30):** `loggedOnTime / expectedMeals * 30` (expectedMeals configurable,
  default 3 for general vs 4 for athletes).
- Recovery / Tasks / Check-in: unchanged from the athlete engine.

### Worked example (fat-loss client)
Targets: 2000 kcal (deficit), 120g protein, 3 meals. Day: 3 meals on time, ate 1,900 kcal,
95g protein, check-in not submitted.
- Calorie adherence: |1900-2000|/2000 = 5% -> full **45**
- Protein: 95/120 * 25 = **20**
- Consistency: 3/3 * 30 = **30**
- Nutrition = **95**
- Headline = .55(95) + .20(86 recovery default) + .15(100 tasks) + .10(0 check-in) = **~84**

A clean fat-loss day scores ~84 ("on the bubble / solid"), and it would have *dropped* if she'd
blown past 2000 or crash-dieted to 1,200. That's the behavior we want to reward.

### What needs your decision (the sign-off)
1. **The headline mix** (.55/.20/.15/.10) — approve or adjust.
2. **The nutrition split** (45 calories / 25 protein / 30 consistency) — approve or adjust.
3. **The calorie-adherence band** (±10% full credit, 0 at ±40%, two-sided penalty) — this is the
   most RD-sensitive number; confirm the two-sided penalty (penalize under-eating) is right.
4. **The general protein target** (~0.7 g/lb vs the athlete 1 g/lb) — set the number.
5. **Naming:** does a general client see "Development Score" or a neutral "Progress Score"?
   (Recommend profile-aware label so the athlete framing doesn't read wrong to a 35-year-old.)

### Guardrail
Same standard as the athlete score: deterministic, transparent, reproducible. The general
profile is a re-weighting of the SAME engine, never a second formula. Default profile stays
'athlete' so every existing user and test is byte-for-byte unchanged. Once approved, the build
is: `ScoringProfile` flag -> the general weight set -> `computeDerived` honors it -> tests prove
the athlete path is untouched.
