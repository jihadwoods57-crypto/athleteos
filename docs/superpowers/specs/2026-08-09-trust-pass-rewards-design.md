# Trust Pass, rebuilt as a reward a trainer can give

**Date:** 2026-08-09
**Status:** design approved, not implemented
**Prod baseline:** migration 0194, OTA 7fcbe2b1

---

## Why

The Trust Pass exists (0033 / 0039 / 0097 / 0099), is live in prod, and has **zero rows**. Two
reasons it never got used:

1. **Trainers cannot grant one.** `grant_trust_pass` checks `is_team_coach_of` and nothing else.
   The trainer capability map marks `trustPass: 0` as permanent by design
   (`coach-data.js:45`). An independent trainer working 1:1 has no way to reward a client.
2. **It does nothing.** The reward the UI promises, "one-tap your trailing nutrition median
   instead of a photo", is implemented in `src/core/trustPass.ts` and `src/core/scoring.ts`, the
   legacy React Native engine. The shipped app is the proto WebView (`app/index.tsx` renders
   `ProtoApp`), and the proto scorer never consults a pass: `mealScored()` requires a real logged
   meal and `computeScore()` has no pass branch. Today a pass gives a shield badge and evidence
   ceiling immunity (0193) and no credit at all. An athlete who trusts the copy and skips logging
   still scores zero nutrition.

This design closes both gaps and reshapes the pass into something a trainer would actually reach
for: a reward they hand a client by name.

## What we are building

A pass is a grant of camera-free meals, in one of two shapes, from a coach **or** a trainer, to a
client who has earned it.

| Shape | `credits_total` | `covers_from` / `covers_until` | Feels like |
| --- | --- | --- | --- |
| Weekend / vacation window | `null` (unlimited inside range) | Sat, Sun | a holiday, nothing to manage |
| N meal credits | `3` | `null` (any day until expiry) | currency you choose when to spend |
| N credits fenced to a window | `3` | Sat, Sun | both |

The nullability **is** the shape. There is deliberately no `kind` enum: an enum would make the
third row illegal, and that combination falls out for free. Reading rule:

- `credits_total is null` then it is a window
- `covers_from is null` then it is credits
- both set then it is credits restricted to a window

### Behavior per shape

**Window is passive.** Every required slot inside the range auto-covers. No taps, no counter.

**Credits are currency.** The client taps "Use a pass" on a specific slot. That tap is most of
the reward feeling: you are holding something and deciding when to spend it. This is the
distinction that keeps the two shapes from being redundant.

### Spend rules

- **One credit per slot, ever.** Unique index on `(athlete_id, day_date, slot)`. You cannot burn
  three credits on one dinner.
- **Logging refunds.** A real meal landing in a slot that has a spend row deletes that row and
  returns the credit. Implemented as a database trigger on the meal write, not a client call, so
  it fires whether or not the app is open.
- **Credits expire but never silently.** A nudge at two days remaining. Same lesson as the
  trainer claim codes: someone holding something they cannot use is the alarm, not an
  acceptable steady state.
- **Every grant carries an optional note** from the trainer, one line, shown in the push and on
  the pass card. It is the cheapest item in this spec and most of why the thing reads as a gift
  from a person rather than a system event.

### The two bounds that keep it honest

A reward that damages the score is not a reward, and an unbounded one is a hole.

1. **Pass-covered days are excluded from the trailing median source.** Without this the median
   eats its own output and decays toward nothing across a long window. Credit comes from real
   photo-earned days only, which is already what the client-facing copy promises
   (`trust.js:82`).
2. **A thin history cannot be credited.** If the trailing ten holds fewer than five real earned
   days, the covered slot is **excused** (leaves the nutrition denominator) rather than credited
   from almost nothing. Without this rule, granting a pass to a barely-active client silently
   tanks their score, the exact opposite of the intent.

The window cap drops from the current 60 days to **14**. Sixty camera-free days is not a reward,
it is an off switch.

---

## Data and server (migration 0195)

Both `trust_passes` and `trust_pass_policy` are empty in prod, so 0195 drops and recreates them
rather than stacking six `alter` statements. The resulting file is readable, which matters more
than migration purity when there is no data to preserve.

```
trust_passes
  id, athlete_id, granted_by
  team_id      uuid null references teams(id)      on delete cascade
  practice_id  uuid null references practices(id)  on delete cascade
    check (num_nonnulls(team_id, practice_id) = 1)      -- the 0136 dual-owner pattern
  credits_total  int  null    check (credits_total is null or credits_total between 1 and 14)
  covers_from    date null
  covers_until   date null
    check (num_nonnulls(covers_from, covers_until) in (0, 2))
    check (covers_until is null or covers_until - covers_from <= 13)
    check (credits_total is not null or covers_from is not null)   -- must be one shape
  expires_on     date not null
    check (covers_until is null or expires_on >= covers_until)
  note           text null
  ended_at       timestamptz null
  created_at     timestamptz not null default now()

  unique index one_active_pass on (athlete_id) where ended_at is null

pass_spends
  id, pass_id references trust_passes(id) on delete cascade
  athlete_id, day_date date, slot text, created_at
  unique index one_per_slot on (athlete_id, day_date, slot)
```

`slot` is free text, not an enum. A coach standard (0055 `requirement_sets`) can reshape a day
into up to six slots with custom keys such as `meal-5`, and an enum would erase those rooms.

### RPCs

All `security definer`, `revoke all from public, anon`, `grant execute to authenticated`. There
are **no insert / update / delete policies** on either table: the RPCs stay the only writers,
which is what makes self-granting impossible.

| RPC | Caller | Authorization and guards |
| --- | --- | --- |
| `grant_pass(athlete, credits, covers_from, covers_until, expires_on, note)` | coach or trainer | `is_team_coach_of(a) or is_trainer_of(a)`. Resolves the owning team or practice, reads that owner's policy, enforces eligibility, ends any active pass first. |
| `end_pass(athlete)` | coach or trainer | same authorization wall |
| `spend_pass(day, slot)` | **athlete, self only** | active pass, credits remaining, day inside `covers_*` when set, day `<= expires_on`, slot not already spent |
| refund | nobody, it is a trigger | `after insert on meals`, deletes any matching `pass_spends` row |

`is_trainer_of` (0002) resolves through `practice_clients` joined to `practices.owner_id`, which
is the same wall every other trainer surface uses.

### Policy table

`trust_pass_policy` goes dual-owner alongside the grant table:

```
  team_id / practice_id      check (num_nonnulls(team_id, practice_id) = 1)
  default_credits      int default 3
  default_window_days  int default 2      -- a weekend
  eligibility_days     int default 7
  max_credits          int default 5
  updated_by, updated_at
  unique index on (coalesce(team_id, practice_id))
```

**The 0136 trap:** with `team_id` nullable you cannot key this on `team_id`. SQL treats nulls as
distinct, so every practice row would slip past a `team_id` primary key and the table would
enforce nothing across practices. Hence the surrogate id plus the `coalesce` unique index.

### Three things that will bite if not written down

1. **New tables need an explicit `grant ... to authenticated`.** RLS alone leaves them
   unreadable. This repo has been bitten by it before (`supabase-table-grants-gotcha`).
2. **Eligibility is a lifetime count, not a trailing one.** The 0039 query is
   `count(distinct day_date) from meals where photo_path is not null` with no date bound, so once
   a client crosses seven they stay eligible forever, including after months of dormancy. We are
   keeping that. Re-locking someone who already earned it feels punitive, and it is exactly why
   the thin-history rule above has to exist as the second line of defense.
3. **The `trust_pass` feature flag is `default_on = false` in prod and nothing shipped reads it.**
   Only `src/store/flagsStore.ts`, the legacy store, references it. 0195 wires it against
   `grant_pass` only, failing closed, and flips `default_on` to true. It must never gate spend or
   read: killing the switch has to stop new grants without stranding a client who is already
   holding credits. This mirrors the claim-code lookup decision in 0166.

---

## The scorer

This is the part that does not exist today, and the design hinges on picking the right seam.

**Do not patch each nutrition part.** `nutritionScore()` composes protein, calorie, timing,
hydration, quality and awareness (`day.js:329`). Injecting a pass into six places would drift
apart within a release.

**Instead, synthesize the missing meal.** For each covered slot, fill in that slot's macros from
the athlete's trailing median for **that specific slot** (a median breakfast is not a median
dinner), then run the existing scorer unchanged. Protein, calories, timing and quality all follow
from one place because they already read the same slot data.

### The seam

New module `proto/redesign-2026-07/js/pass.js`, pure and Node-importable, matching the convention
`day.js` already uses for its compute functions.

```js
// covered slots for a date, given the active pass and its spend rows
export function passCoverage(dateISO, pass, spends) -> Set<slotKey>

// per-slot median from real photo-earned days only, or null when the history is too thin
export function slotMedians(history) -> { [slot]: {protein, kcal, ...} | null }

// a CLONE of the day with covered slots filled; never mutates the live DAY
export function withPassCredit(day, coverage, medians) -> day'
```

`computeComponents(withPassCredit(day, ...), std)` is the only call-site change.

**Why a clone matters:** the live `DAY` must keep telling the truth so the UI can distinguish
"logged" from "covered". If the injection mutated `DAY.meals[k] = true`, `mealScored()` would
report the slot as logged and the client would see a meal they never ate presented as one they
did. Scoring reads the clone; display reads the real day.

**Thin history:** when `slotMedians` returns `null` for a covered slot (fewer than five real
earned days in the trailing ten), that slot is dropped from the denominator instead of filled.
`effectiveMeals` and the standard's `mealsRequired` both shrink by one.

### Server side

- **0193's evidence ceiling** already has gate (d) for an active pass. It needs rewriting against
  the new shape: covered by `covers_from`/`covers_until`, **or** a `pass_spends` row exists for
  that date. The gate stays inside the existing `v_nutrition` coalesce and the fail-closed shape
  check above it is untouched.
- The credit magnitude is computed client-side, like every other score input. That is acceptable
  under the existing model because the **ceiling** is the wall: a client cannot fabricate
  coverage without a real pass row and, for credits, a real spend row, both of which only the
  RPCs can write.

### History source

Per-slot macros live in `days.checkin.slotMacros`. The trailing-ten fetch needs to exclude days
that were themselves pass-covered (bound 1 above). Whether an existing fetcher can be reused or a
new one is needed is an implementation question for the plan, not a design fork.

---

## Surfaces

### Trainer and coach (identical, practice or team swapped)

- **Client profile, a "Reward" row** opening a grant sheet: shape toggle (Meals / Window),
  amount, optional note, and preset chips for Weekend, Travel, Rest day.
- **A prompt on the operator home** when a client hits a milestone, currently 14 consecutive
  on-standard days: one tap to grant with the policy default filled in. This is what stops the
  feature from sitting at zero grants the way it does today. The trainer still gives it, so the
  client thanks a person.
- **Roster and Grow rows** show an active pass and its remaining credits.
- **End / revoke** from the same row.
- **Defaults screen** (the existing `#trust-pass-policy`) gains `default_credits` and
  `max_credits`, and works for a practice as well as a team.

### Client

- **Shield in the Home header** (already built) now reads "3 left" or "Weekend pass, day 1 of 2".
- **"Use a pass" on a meal slot** in the exec list, rendered only when credits remain and the
  slot is unlogged and unspent.
- **The trainer's note** in the grant push and on the pass card.
- **Progress toward earning** shown before any pass exists: "4 of 7 photo-logged days". This
  turns the eligibility gate into a visible motivator instead of an invisible wall, which is
  worth as much as the reward itself.
- **The Trust Pass detail screen needs a rewrite.** Its decay-curve chart models the old
  fixed 10-day window and is meaningless for credits.

### Notifications

Grant ("Coach Dee gave you 2 camera-free meals"), expiry at two days out, and refund ("You
logged it anyway, pass refunded"). All copy is em-dash free per the DESIGN.md ban.

---

## Testing

- **`pass.js` unit tests** as a Node `.mjs` suite alongside `score-v2.test.mjs`: coverage
  resolution for all three shapes, per-slot medians, the thin-history fallback, and the
  no-mutation guarantee on the live day.
- **SQL suite** modeled on `supabase/tests/trainer_funded_test.sql`, covering both authorization
  directions: a trainer cannot grant to a non-client, a coach cannot grant to another team's
  athlete, an athlete cannot self-grant or spend for someone else. Plus the eligibility gate, the
  one-spend-per-slot index, the refund trigger, expiry, and revoke.
- **Ceiling invariants** in the style of Score v2's 11,160-case sweep: no pass configuration may
  produce a displayed score above what the server ceiling permits.
- **RLS additions** to `rls_authz_test.sql`, replacing its two existing `grant_trust_pass` cases.
- **Router role test**: the grant surfaces must not appear in an athlete shell
  (`router-roles.test.mjs` already guards this shape for other routes).

## Rollout

1. Migration **0195** applied to prod (currently 0194) **before** the client OTA. The ceiling
   change must land first, or a pass-credited day is clamped by the old gate and the athlete
   silently loses points. This is the same ordering trap as the Score v2 ceiling migration.
2. `trust_pass` flag flipped `default_on = true`, `kill_switch` false.
3. `proto.zip` rebuilt, `protoVersion.ts` bumped, OTA shipped, manifest md5-verified.

## Open questions for the founder

- **Milestone threshold.** 14 consecutive on-standard days is a guess. Any number works; it just
  needs to be rare enough that the prompt is not noise.
- **Whether the milestone prompt should also fire for team coaches** with large rosters, where
  several clients could cross in the same week and the prompt becomes a queue rather than a
  moment.

## Related

`docs/council/2026-07-02-trust-pass.md` (the original design),
`2026-07-30-trainer-funded-access-design.md` (the dual-arm entitlement pattern and the kill-switch
lesson), `2026-08-09-score-breakdown-v2-design.md` (the ceiling and the cutover).
