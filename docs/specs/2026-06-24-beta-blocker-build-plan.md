# AthleteOS — Beta-Blocker Build Plan (2026-06-24)

Derived from [the 7-persona review](../PERSONA-REVIEW-2026-06-24.md). This is the
sequenced plan to turn "a polished demo wearing real clothes" into a product a real
coach will adopt. It is scoped to the review's recommended beta: **HS / sports-perf
coaches with ~15-40 athletes, parents not yet in the loop, sold honestly as a
nutrition-compliance + accountability tool** (not a full performance system).

Each item is tagged:
- **[AUTO]** — safe for an autonomous crew (pure code/copy, gates stay green, revertible).
- **[FOUNDER]** — needs Bo's decision or an irreversible/outward step (real accounts,
  product naming, audience scope). Do not auto-execute.

The crew is already handling the **[AUTO]** honesty/copy slice (Run 2, 7pm). This plan is
the ordered backlog for the real builds after that.

---

## Root causes (what the personas actually found)

All 7 personas, independently, reduced to six roots:

1. **Nothing on screen is real** — hardcoded demo values shown as live (the #1 trust-killer).
2. **The score is a nutrition + self-report number wearing a "performance" jersey.**
3. **Athlete-first, everyone else bolted on as a skin.**
4. **The only coach/trainer action is a blind one-tap nudge.**
5. **AI output is canned but presented as measured fact.**
6. **No consent / data-governance for minors and student-athletes.**

---

## Sequence

### Phase 0 — Honesty & copy (in flight: Run 2, 7pm) **[AUTO]**
Label all fabricated data as "Sample," fix trust-damaging copy (surveillance framing →
athlete-first, cut invented stats, soften canned AI claims), add estimate/confidence
labels to macros, add a "what's in this score?" breakdown. Acceptance: nothing fake
masquerades as live; gates green. *This buys honesty, not function — Phases 1+ buy function.*

### Phase 1 — The keystone: real data pipeline **[FOUNDER]**
Everything in root #1 is downstream of "there is no backend, so screens fall back to
seeds." The Supabase scaffold exists, flag-gated and inert (`src/lib/supabase`,
`src/store/sync.ts`).

- **1a. Auth go-live** — email/password (or magic link) for athlete + coach. Stands up
  **real accounts** → this is the FOUNDER gate (irreversible, outward-facing).
- **1b. Invite → roster → athlete link** — a real invite code that binds an athlete to a
  coach's roster (replaces the static `EAGLES24`).
- **1c. Real per-athlete day data** — read each athlete's real meals/score/weight/check-in
  instead of the seeded roster (Silva/Cole/Jihad).

Acceptance: a coach signs up, invites an athlete, the athlete joins and logs, and the
coach sees that athlete's **real** numbers — no seeds. Kills most of root #1 at once.
Until 1a ships, Phases 2-5 run against seeded data and stay labeled "Sample."

### Phase 2 — A defensible, honestly-named score **[AUTO for 2a/2b, FOUNDER for 2c]**
- **2a. Kill the `weightScore = 95` stub [FOUNDER decision — was thought AUTO]** —
  derive the weight sub-score from the app's existing `seasonGoalProgress` instead of a
  constant. **Finding (attempted 2026-06-24, reverted to keep gates green):** the fake
  `95` was load-bearing — it quietly propped *every* perfect-compliance day up to an A.
  Wired to real progress, a flawless day caps at ~85 mid-season (the demo athlete is only
  54% to their weight goal: 178 of a 171→184 range). Five tests that encode "a complete
  perfect day is an A (>=90)" / "B day (>=80)" failed. Lowering those thresholds would be
  silently redefining what an A means, so this is a founder call, **coupled to 2c**:
  - **Option A — weight as real progress:** honest, but a perfect daily effort can't earn
    an A until season weight progress is high (weight is partly outside daily control).
  - **Option B — rebalance the daily score:** drop/shrink weight's 20% in the *daily*
    score and show weight as a separate long-arc indicator, so daily effort earns the A.
    (Pairs naturally with renaming to "Accountability Score.")
  - **Option C — keep weight, neutral baseline early:** real progress once tracking, but a
    neutral baseline for longer so early-season daily effort still earns an A.
  Recommended: **B** (rebalance + rename) — it matches what the score actually measures
  and removes the inflation without punishing a great day.
- **2b. Disclose inputs [AUTO]** — in the "what's in this score?" panel, mark which inputs
  are self-reported (recovery/check-in) vs logged (nutrition/tasks) vs progress (weight).
- **2c. Earn the name [FOUNDER]** — either add ONE real performance signal (a weekly
  lift/sprint PR entry) so "Athlete Score" is defensible, OR rename it "Accountability
  Score." Recommended: rename now (free, honest), add the perf signal later.

Acceptance: no constant masquerading as a measurement; the score's composition is visible
and honestly labeled; the name matches what it measures.

### Phase 3 — Real, editable meal analysis **[AUTO]**
Note: Claude vision is **already live behind the AI flag** — the "same meal every time"
critique is the deterministic *fallback*, not the real path.

- **3a.** Make detected foods/portions **editable**, and recompute macros + quality + score
  on edit (kills the RD's dead-stepper / "Re-analyze" no-op complaint).
- **3b.** Keep the Phase-0 confidence labels; ensure they reflect real vs fallback analysis.
- **3c.** Shift AI coaching voice from prescriptive ("have a shake tonight") → educational
  ("general guidance; your nutritionist sets the plan").

Acceptance: a wrong estimate can be corrected and the score moves; coaching reads as
guidance, not a prescription.

### Phase 4 — A real coach action beyond the blind nudge **[AUTO]**
Not full messaging. A nudge gains an **attachable note** and leaves a **record**
("Nudged + note · Jun 24"). Satisfies the coach's documentation-trail need and the
trainer's communication need without scope creep.

Acceptance: a coach can attach a note to a nudge and later see what was sent and when.

### Phase 5 — Coach dashboard at real scale **[AUTO]**
For the strongest user (the 40-athlete HS coach): **position-group filter, search, a
"who hasn't logged today" view, and honest empty states** instead of a seeded 6-person
room. UI buildable now; fills with real data once Phase 1 lands. Widen the college roster
band past "51+" to 85-110.

Acceptance: the dashboard is usable and truthful at 40+ athletes, grouped by position.

### Phase 6 — Consent / athlete-first (fast-follow, unlocks deferred audiences) **[FOUNDER]**
Athlete-controlled sharing toggles + a minor-consent step + role-based visibility. The
copy half ships in Phase 0; the consent *mechanism* is a FOUNDER gate (legal/privacy
posture for minors). Per the review, **defer parent + college + RD audiences** until this
exists — so it is a fast-follow that *opens* those markets, not a beta blocker for the
coach-only cohort.

---

## Out of scope for autonomous work (the "NEEDS YOU" list)
Real account standup (1a), product naming (2c), the performance-signal decision (2c),
minor-consent legal posture (6), and any external send. The crew flags these; Bo decides.

## Recommended execution order
Phase 0 (done) → **2a+2c DONE** (Option B shipped 2026-06-24, commit `383f1e9`:
Accountability Score, weight pulled out of the daily score and tracked separately) →
**5 DONE** (dashboard scale shipped 2026-06-24, commit `67f4008`: position-group filter,
search, "not logged today", honest empty states, college roster bands) →
**4 DONE** (nudge + attachable note + documentation trail shipped 2026-06-24, commit
`a60f919`) → **next:** 3 (editable macros, safe) →
**1 (keystone, founder gate)** → 6.
The safe phases (2,3,4,5) can proceed against labeled sample data; Phase 1 makes them real.
