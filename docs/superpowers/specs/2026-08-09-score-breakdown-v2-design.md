# Score Breakdown v2 — design

**Date:** 2026-08-09
**Status:** Design approved, not yet planned or implemented
**Supersedes:** the four-component daily score shipped since the RN engine port

---

## 1. Why

The daily 0–100 has four components. Two of them — Daily Commitment (15%) and Weekly
Check-In (10%) — are not measurements. They are attendance. Reading the engine turned up four
concrete defects:

**The check-in is paid twice.** One recovery check-in fills Recovery *and* flips Weekly Check-In
green. `breakdown-model.js:266-269` says so out loud: *"tonight's recovery check-in both fills
Recovery and keeps this green."* One action, two line items, on the one screen whose whole job is
being trustworthy about the number.

**The 10 points are a seven-day annuity.** `checkinReal()` (`day.js:337`) is true for any check-in
in the trailing week. Check in Monday, collect 10 points Tuesday through Sunday for nothing.

**Recovery carries too.** `recoveryParts()` (`day.js:330-331`) hands Monday's recovery number back
as *today's* recovery all week. Combined with the above: an athlete who checked in Monday and logs
nothing on Thursday still banks ~31 points. Tap the commitment and it is ~46.

**Daily Commitment punishes honesty.** `commitmentScore()` (`day.js:336`) pays 100 for "yes", 60 for
"partial", 0 for an honest "no". The app asks for a truthful self-report and charges 15 points for
the truthful answer — while already *knowing* whether the athlete executed, from meals, protein and
the check-in. It is a self-graded duplicate of a day already measured, with a built-in reason to lie
about it. The coach reads that answer.

Net: **a quarter of the number is attendance, not evidence.**

---

## 2. What the number means

> The daily score is **what you did today.**

Nothing carries from a previous day. Nothing is self-graded. A day you did not show up for reads
zero.

This is the single rule every decision below derives from.

---

## 3. The model

Two pillars the athlete sees. Three slots the engine uses.

| Engine slot | Old | New | Earns it |
|---|---|---|---|
| `nutrition` | .50 | **.76** | Plates logged, protein to target, on time |
| `checkin` | .10 | **.12** | Check-in submitted **tonight** — binary, guaranteed |
| `recovery` | .25 | **.12** | How you answered |
| `commitment` | .15 | **0** | Removed from scoring (see §6) |

Per scoring profile:

```
athlete   nutrition .76   checkin .12   recovery .12
general   nutrition .78   checkin .12   recovery .10
gain      nutrition .76   checkin .12   recovery .12
```

### What the athlete reads

**One Recovery card worth 24**, with two rows inside it:

```
Recovery                          22 / 24
  Checked in tonight               +12   guaranteed
  How you answered              10 / 12
```

The two-slot split is an implementation detail. It exists because the engine already has a binary
`checkin` slot and a graded `recovery` slot, so reusing them avoids restructuring
`computeComponents` — but it is never presented to the athlete as two categories.

### Recovery is mostly paid for *doing it*, not for *how you are*

Sleeping badly, being sore after a hard lift, and feeling flat are not things you did. They are how
you are. Scoring them heavily teaches athletes to inflate the answers, which poisons the exact data
the coach and the AI read. Twelve points for submitting and twelve for the answers means a rough
night costs a few points, not a third of the day — so there is no reason to lie.

### Plan styles stop carrying weights

`STYLE_WEIGHTS` (`plan-style.js:78-93`) is nine rows: three styles × three profiles. For the athlete
profile all three styles are already byte-identical; general and gain vary by 2–3 points. Under two
pillars that variation buys nothing.

**Collapse to one row per profile.** Style keeps shaping *how nutrition is computed* through the
knobs (`knobsFor`), which is where it earned its keep. `weightsFor(style, profile)` keeps its
signature and ignores `style`, so no call site changes.

---

## 4. The two deletions that do most of the work

```
day.js:337   checkinReal()    — drop the `ciLast` branch. "This week" becomes "tonight."
day.js:330-331  recoveryParts() — drop the weekly carry branch.
```

Everything else is reweighting and presentation.

---

## 5. Why these weights and not the obvious ones

The first pass put Recovery at 32 (20 for checking in + 12 for answers), with nutrition at .68. It
produced a collision that inverts the product's own values:

| | .68 / .20 / .12 | **.76 / .12 / .12** |
|---|---|---|
| A: 4 meals on time, 90% protein, **no check-in** | 64 | **71** |
| B: 2 of 4 meals, 50% protein, **check-in** | 64 | **60** |

At .68/.20/.12 the athlete who ate on standard all day ties the athlete who logged half their food
and dragged sliders for eight seconds. At .76/.12/.12 effort outranks attendance, and skipping the
check-in still costs a real 24 points.

### Honest accounting of what the 12 points are

The `checkin` slot is still points for a tap. It is defensible — it must happen *tonight*, it is
timestamped, and it expires nightly instead of weekly — but the weekly arithmetic should be on the
record:

- Old: **10 participation points per week**, bought with one check-in.
- New: **12 per day = 84 per week**, bought with seven check-ins.

Participation points were not eliminated. They were repriced and their expiry shortened from seven
days to one. That is a behavioral improvement — seven closes beat one — but it is not the same claim
as removing them.

---

## 6. The reflection survives, unscored

The Daily Commitment screen (`screens/commitment.js`) stays. The answer keeps riding to the coach as
the intent-vs-execution signal coaches actually use. `commitmentFocus` (the written intention) is
untouched. It simply stops being worth points, so an honest "no" costs nothing and the data becomes
truthful.

`commitmentScore()` stays in the engine and keeps computing; its weight is 0, so it contributes
nothing. This keeps the four-key component shape intact for `dayFromHistoryRow` and the parity
tests.

**Recorded risk:** unscored screens get abandoned. If reflection completion craters after launch,
that reveals it was only ever being done for points — which is itself worth knowing. Instrument
completion rate before and after cutover.

---

## 7. The empty morning

Stripping the carry removes a cushion nobody noticed was there. Today an athlete wakes holding ~31
points from Monday. Under v2 they open the app at 7am on **0** and stay near zero until breakfast
lands — and the home ring is the screen they see most.

**The ring shows earned and reachable together.**

```
  7:00 AM      0        Possible: up to 100
 12:30 PM     34        Possible: up to  96
  9:00 PM     82        Possible: up to  82
```

Inner arc is earned; a faint outer arc is still reachable. The gap between them *is* the day's
remaining work. No points are invented — `reachPlan` (`breakdown-model.js:92`) already computes the
exact reachable ceiling, sum-exact against `maxPossibleScore`. This is wiring, not new math.

---

## 8. History is frozen

Past days keep the number the athlete earned. The new model starts on a cutover date. Streaks
continue unbroken.

Recomputing history is technically possible — `dayFromHistoryRow` can rebuild a past day from the
stored `meals` + `checkin` jsonb — and is explicitly rejected. Every athlete's average would drop
overnight and every coach-facing number would move, for a consistency nobody asked for.

Progress shows the line across the boundary with the change **labeled**, not hidden.

---

## 9. Bands are unchanged

`ON_STANDARD = 80`, `CLOSE = 60`, OnStandard at 90 (`score-band.js`). These thresholds were recently
unified across the whole app after a real 75-vs-80 drift bug; reopening them is not worth it.

They do not need to move, because the distribution **stretches** rather than shifting:

| The day | Old | New | Band |
|---|---|---|---|
| 4 meals on time, protein hit, check-in | 100 | 98–100 | OnStandard |
| 4 meals, protein 90%, check-in | 93 | 93 | OnStandard |
| 4 meals, protein 90%, **no check-in** | 93 | **71** | OnStandard → Building |
| 2 of 4 meals, protein 50%, check-in | 71 | 60 | Building |
| Nothing logged, checked in Monday, tapped commitment | 46 | **0** | Off Standard |

Compliant days land where they always did. Half-days sag. Empty days finally collapse to zero
instead of banking 46.

**Accepted consequence:** a perfect food day with no check-in caps at 71 — "Building", not "Locked
In". Closing the day out every night is the standard, and the number says so. Expect loud feedback
in week one from athletes who ate perfectly and read Building. That feedback is the design working.

---

## 10. The server trigger is the dangerous edit

`supabase/migrations/0041_score_evidence_ceiling.sql:77-80` hardcodes the old weights **in SQL** and
clamps every write:

```sql
v_ceiling := least(100,
    (case when v_nutrition then 55 else 0 end)
  + (case when v_checkin  then 35 else 0 end)   -- recovery 25 + check-in 10
  + (case when v_commit   then 15 else 0 end));
```

Two requirements, both non-negotiable:

**1. Ship the new ceiling in the same release as the client weights.** Not after. A release gap
means every perfect food day computes 76 and is silently clamped to 55 on write — corrupting real
athlete data with no error surfaced. New ceiling:

```
nutrition evidence  →  78   (max across profiles)
checkin evidence    →  24   (recovery 12 + check-in 12)
commitment evidence →   0
```

**2. A cutover-date guard.** Old rows had a legitimate 15-point commitment slot that no longer
exists. A pre-cutover row whose only evidence was a commitment answer had a valid ceiling of 15;
under the new ceiling it is 0. Without a date check, anything that touches a historical row
re-clamps it under new rules and rewrites frozen history — exactly what §8 promises will not happen.
The trigger must apply the old ceiling to rows dated before cutover and the new one on or after.

`src/core/scoreIntegrity.ts` derives `MAX_SUBSCORE_WEIGHT` from `PROFILE_WEIGHTS`, so the TS mirror
follows the weights automatically. The SQL does not. They must be verified equal by the existing
property test in `scoreIntegrity.test.ts`, extended to cover both sides of the cutover date.

---

## 11. Blast radius

**Proto engine** (`proto/redesign-2026-07/js/`) — the shipped UI

- `day.js` — `PROFILE_WEIGHTS` (L18-22); `checkinReal()` (L337); `recoveryParts()` (L330-331);
  `evidenceCeiling()` (L370-376)
- `plan-style.js` — `WEIGHT_CAPS` (L67); `STYLE_WEIGHTS` (L78-93) collapse to profile-only
- `breakdown-model.js` — `explainCategories` returns 2 cards not 4; `reachPlan` drops the commitment
  row (L132-141) and rewords the recovery row (L121-131); `maxDay` drops `dailyCommitment` (L80)

**RN core + parity** (`src/core/`)

- `scoringProfiles.ts`, `scoring.ts`, `commitment.ts`, `scoreIntegrity.ts`
- `scripts/score-parity` must stay green — it proves proto and RN agree byte-for-byte
- Tests asserting the old weights: `scoringProfiles.test.ts`, `scoreIntegrity.test.ts`,
  `planStyleCaps.test.ts`, `planStyleParity.test.ts`, `planStyleEngine.test.ts`,
  `standardDay.test.ts`, `breakdownModel.test.ts`, `protoProjectionDecay.test.ts`,
  `protoStreakGrace.test.ts`, `protoCoachScoreThreading.test.ts`

**UI**

- `screens/breakdown.js` — four category cards to two
- `screens/home.js` — four-segment score bar to two; the cyan Weekly Check-In segment retires
- `screens/progress.js` — the cutover boundary label
- `screens/commitment.js` — copy must stop promising points
- `requirements.js` — check-in and commitment requirement rows and accents
- `state.js` — `S.breakdown`, the requirement list

**Server** — one new migration (§10)

**Copy** — an in-app notice on cutover day. Changing how someone's score works without telling them
burns exactly the most engaged users.

---

## 12. Explicitly out of scope

**Training as a third pillar.** It is the right third pillar and the only real candidate — sleep is
device-gated (and `connected-standards.js:6` already rules that a device failure never becomes a
miss), hydration is a slider you drag to 3L, weight is ungradeable. Training is deferred because
today's training log is a self-typed note (`roles.js:512`) — a tap in disguise, which is the exact
thing this spec removes. It earns pillar status once Verified Commitments (roll call + geofence) or
coach confirmation backs it. **That is its own brainstorm with its own evidence design.** Nothing is
reserved for it here.

**Weight logging in the score.** Rejected. It is not daily (the standard schedules it Mon/Wed/Fri),
it is not gradeable (you can score *that* it was logged, never *what it said*), and putting points on
a teenager stepping on a scale is a real harm vector in a product used by high-school and college
athletes. The app already tells athletes "Season trend · not scored" in onboarding, on the
requirement row, and in the coach's standard editor. Weigh-in consistency belongs on the coach's
roster as "logged 3 of 3 this week", not in the athlete's number.

**Improving the nutrition sub-score.** v2 reweights; it does not change how nutrition is measured.
The protein-65 / meals-35 formula is unchanged. Note that nutrition now carries 36% more weight, so
any error in it costs proportionally more — a reason to schedule a nutrition-accuracy review after
cutover, not a reason to change the formula inside this spec.

---

## 13. Known weaknesses of this design

Recorded so they are not rediscovered as surprises.

1. **This is openly a food-logging score.** Three-quarters of an athlete's development number is
   "did you photograph your plates." A kid sleeping five hours and skipping lifts can read 94. The
   old model was no better at this, but four categories *looked* broad; two makes the narrowness
   visible. Deferring training means shipping that visibility.

2. **12 points still buy a tap.** See §5. Repriced and shortened, not removed.

3. **Fewer categories means less coaching surface.** Four categories gave a coach four things to
   talk about on the breakdown screen. Two gives two.

4. **Migration risk is real.** This changes the number every athlete looks at daily and every coach
   trusts, across two engines held in byte-parity, ten test files, three thread renderers, and a
   Postgres trigger with hardcoded constants. The parity script and the `scoreIntegrity` property
   test are the load-bearing safety net; neither may be weakened to make the change land.

---

## 14. Success criteria

- `scripts/score-parity` green — proto and RN engines agree byte-for-byte on the new weights.
- `scoreIntegrity.test.ts` proves the SQL ceiling never clamps an honest score, on **both** sides of
  the cutover date.
- A day with no logs and no check-in scores exactly 0.
- A check-in submitted tonight is the only thing that unlocks the Recovery pillar; nothing carries.
- `reachPlan` rows still sum exactly to `maxPossible − score` with the commitment row removed.
- No historical row's score changes.
- The breakdown screen and `reachPlan` never disagree about what is still earnable.
