# The Solo Athlete — the record is the witness

> **Status:** DESIGN, approved 2026-08-01. Scope: "make the record real."
> Solo = the top of the funnel, not a destination. The athlete's accumulating record is what
> holds them; connecting a coach is what it converts into.
>
> Out of scope, deliberately, each needing its own spec: the full GDPR export path
> (migration 0065 unapplied + capacity audit F25 OOM) and multi-org surfacing
> (`limit(1).maybeSingle()` collapsing two teams / coach+trainer to one).

## 0. Why this exists

A coachless athlete is not blocked today — a self-set personal standard governs their scored day
(`stdFromSolo`, `js/requirements.js:249`), the AI answers in the thread with no team check
(`meal-chat/index.ts:220-225`), and local reminders, streak, and daily commitment all run solo.

They are, however, told several things that are not true. That is the starting problem, and it is
worse than a gap: a gap is honest.

### The four strategic decisions this design rests on

1. **Solo is the on-ramp, not a destination.** Success is measured by connection rate, not solo LTV.
   Building a standalone self-accountability product would walk onto MyFitnessPal's turf, which
   `docs/founding/COMPETITIVE_ANALYSIS.md` §B names as a fight we lose on database depth.
2. **The record is the witness.** Not an AI counterpart (copyable, expensive), not social stakes.
   The thing watching is the athlete's own accumulating, portable record — the one story MFP
   structurally cannot tell, because their log dies with their app.
3. **Conversion fires when the record is worth something**, not at signup and not at the moment of
   pain. Threshold-triggered, shown once, then resting in Profile.
4. **The Individual tier is repriced in language, not in dollars** — it stops selling a connected
   supporter to people who have none.

### What we verified before designing around it

The D1 keystone is **real at the layer that matters**. `days`, `meals`, `meal_comments`,
`training_logs`, `progress_photos` are each keyed to `profiles(id)` with **no `team_id` or
`practice_id` column**. Coaches have no write path. Revocation provably touches access only —
`supabase/tests/rls_authz_test.sql:1014` asserts it.

**And the funnel mechanic already works.** There is no date predicate anywhere in `can_view()`
(`0081_guardian_scoped_access.sql:27-34`). An athlete joins a team and the coach's next query
returns the entire history back to day one. "Your record walks in with you" is mechanically true
today and requires no new engineering — only disclosure (§4.2) and a card that says it (§3.5).

Two findings make that pitch a lie if we lean on it unrepaired, and §4 fixes both.

---

## 1. The honesty pass

| Claim | Location | Resolution |
|---|---|---|
| *"I've flagged it for your coach so they can pick it up."* — nobody is notified | `supabase/functions/meal-chat/index.ts:441` | Resolve the recipient **before** composing the decline, not after (today the `team_members` lookup happens at :450, after the message is already written). Solo gets an honest hand-off naming a real category of person — doctor, athletic trainer, coach who knows their history. |
| *"Your coach still sees this."* on the daily AI cap | `js/screens/meal.js:1389` | Gate on `S.coach.hasCoach`. |
| *"Team Discussion"* heading a two-participant You+AI thread | `js/screens/meal.js:863` | Conditional label. The facepile below it already reads "You, AI Nutritionist" (`js/chat-view.js:54-63`). |
| *"one connected supporter"* sold to the coachless | `js/ob2.js:372` | §5. |
| *"You can download or delete everything, below"* | `js/screens/settings.js:290` | Narrow to what the export actually ships (4 tables, no media — `js/state.js:2437-2464`) until the real export lands. Deletion **is** fully wired (`0007_delete_account.sql:21-37`); only the download half overstates. |

### 1.1 The solo standard is never actually asked

`mealsPerDay` is hardcoded to the literal `3` for every OB2 athlete:

```js
// js/screens/ob2-athlete.js:310-313
capture({
  committedAt: new Date().toISOString(),
  standard: { mealsPerDay: (o.standard && o.standard.mealsPerDay) || 3, pressure: o.pressure || 'steady' },
});
```

`o.standard.mealsPerDay` is only ever written by the **legacy** flows (`screens/onboarding.js:426`,
`screens/roles.js:990`) which OB2 never runs. `stdFromSolo`'s own docstring still describes
"onboarding's 2/3/4 chip" — a chip OB2 deleted.

**Add the step.** An athlete authoring their own standard is the entire premise of the solo product;
silently scoring them against a number they never chose is the opposite of it.

### 1.2 Stop discarding the `supporters` answer

The *"Who holds you to it?"* step (`js/screens/ob2-athlete.js:173-193`) already offers a
**"Nobody yet"** chip. `supporters` is read in exactly one place downstream — a line of copy at
`:246` — and is absent from `persistOnboarding` (`js/state.js:2511-2571`). It reaches no server and
branches nothing.

It is more valuable than it looks, because it separates two very different people who are currently
treated identically:

- **Picked "My coach" / "A trainer" / "My parents", then skipped the join code.** This athlete
  *already has* a coach and simply did not have the code in hand. The hottest lead in the product.
- **Picked "Nobody yet".** Genuinely independent. A different conversation entirely.

Persist it. It drives the conversion segmentation in §3.5.

### 1.3 The intensity dial does nothing

Onboarding writes `pressure` ∈ `all-in` | `steady` | `building` (`js/screens/ob2-athlete.js:278-285`).
The consumer matches on different vocabulary:

```js
// js/exec.js:16-21
if (s.includes('gentl') || s.includes('support')) return 'gentle';
if (s.includes('max') || s.includes('intens') || s.includes('high')) return 'max';
return 'accountable';
```

**No OB2 value matches either branch** — all three collapse to `accountable`, and an athlete who
chose "All in" lands on "Direct" in Settings, whose picker uses a third vocabulary that *does* map
(`js/screens/settings.js:542`).

With a coach this is cosmetic. Solo, scheduled notifications **are** the accountability mechanism,
so the dial has to actually turn. Reconcile the three vocabularies onto one.

---

## 2. The record as the witness

### 2.1 The Home record line

`#seen-row` (`js/screens/home.js:646`, painted at `:779-803`) is where "a real human opened your day"
appears. Solo it is permanently empty — and the source comment at `:794-795` calls that receipt
*"the core differentiator."* So the product's stated differentiator is structurally absent for this
user, in a slot already reserved for it.

Fill it, solo only, with a true statement of what the record has accumulated — days on standard,
current streak. **Honest by construction, exactly like `keepRecordCard`:** a thin record renders
nothing at all rather than a hollow "0 days."

### 2.2 Milestones as real moments

At 7 / 30 / 100 scored days. Reuse `js/lock-moment.js` and `js/share-card.js` from the premium
polish pass — no new motion primitives.

**State is one monotonic integer** (highest milestone celebrated), not a set of booleans, and not a
flag set during animation. This is deliberate: `__render()` re-runs `mount()`, which has produced
three separate replay bugs in this codebase already (see `premium-polish-2026-07-29`). A monotonic
counter cannot replay by construction.

### 2.3 Reminders that carry the record's weight

`js/notify-plan.js` is a pure planner, already runs solo, and already treats `coachName` as optional
with every use site conditional (`:121`, wired at `js/state.js:1291`). Pass it the record's weight so
the evening reminder has stakes behind it rather than generic copy.

Pure function in, pure strings out — directly unit-testable.

---

## 3. The conversion moment

### 3.1 Trigger

First 7-day streak **or** 14 scored days, whichever lands first. `streakInfo()` (`js/day.js:492-534`)
already computes the streak, grace-aware, with zero coach input.

### 3.2 Frequency

Once. Then it rests permanently in Profile, where a connect entry already exists
(`js/screens/profile.js:69`).

### 3.3 Placement

The same Home slot as `keepRecordCard`, mutually exclusive with it. `keepRecordCard` requires
`RT.hadRoster` (`js/screens/home.js:251`), so it serves athletes who *had* a roster and lost it; this
card is its never-linked sibling. One mechanism, two audiences, no overlap.

### 3.4 Seen-state lives on the server

`RT.hadRoster` is local-only (`js/state.js:235`, persisted via `save()`), so a reinstall or a device
switch loses the churn parachute entirely. Do not repeat that here — a conversion card that re-nags
on every new device is worse than one that never fires.

### 3.5 What it says

The pitch is true today and needs no new engineering (see §0): **coaches see all of it, from day one,
not from today.**

Segmented by the now-persisted `supporters` answer:

- **Named a supporter but skipped the code** → they have one. "Connect them — they'll see all 21 days."
- **"Nobody yet"** → record-first framing, with trainer discovery as the softer secondary path.

---

## 4. Integrity — what makes the pitch true

### 4.1 The athlete-owned proof ledger

`commitment_responses` and `requirement_assignments` cascade from `teams`
(`0138_verified_commitments.sql:80-81`, `0055_requirements.sql:112`). Geofenced arrivals,
acknowledgements, and completions are destroyed when a coach deletes a team — while
`keepRecordCard` continues to promise *"every day you proved is still here."*

This is the hardest evidence in the product and the most mortal, which is precisely backwards.

**Options considered.** Soft-deleting teams, or `ON DELETE SET NULL` on the org FK, is the smaller
change — but those columns are `NOT NULL`, and it leaves athlete proof living inside an org-shaped
table. It reads as org-stamped because it is.

**Chosen: an athlete-owned proof ledger.** At the moment proof is *earned*, write an immutable row
keyed to `profiles(id)` with no org FK. Org tables then cascade freely and the athlete's copy is
permanently theirs.

This is not a new pattern — it is the pattern the schema already uses for every athlete-owned thing
(`0001_schema.sql:3-4`: *"one athlete = one source of truth"*). Requires a backfill of existing rows.

### 4.2 Disclose retroactive visibility at connect

`js/screens/connect.js:59-60` lists what a coach will see, in the present tense. It does not say that
joining also hands over everything logged *before* they met — which is what `can_view()` actually
grants (§0), in a product with minors in it.

Add it. It is simultaneously the required disclosure and the most persuasive sentence on the screen.

---

## 5. Packaging

No price change. The Individual tier ($14.99/mo, `js/ob2.js:371-378` and `src/core/pricing.ts:46`)
stops selling *"one connected supporter"* — a thing the solo athlete does not have — and starts
selling what solo actually delivers: the score, the history, the portable record, with connecting a
coach framed as free and available rather than as a purchased feature.

Billing is go-live gated (`js/screens/paywall.js:42-45`), so nothing charges today regardless. This
is copy and framing only.

---

## 6. Testing

`src/core/soloStandardWiring.test.ts` is the template: jsdom globals installed **before** requiring
the proto state graph.

**Pure-function coverage**
- Milestone counter is monotonic and cannot replay across repeated `__render()` → `mount()` cycles.
- Conversion threshold fires at exactly one of (7-day streak | 14 scored days), once.
- `notify-plan` record-aware copy, with and without a record, with and without a coach name.
- `mapPressure` accepts all three onboarding vocabularies after reconciliation (§1.3).
- The solo standard from §1.1 governs `dayStandard()` — extends the existing suite.

**Migration**
- The proof ledger survives team deletion. Model on the existing leave-team assertion,
  `supabase/tests/rls_authz_test.sql:1009-1025`.

**The rule every new surface follows.** Use the `{ error: true }` sentinel already established
throughout `js/roles.js` (e.g. `fetchMyTeams:22`, `fetchMealComments:478`). If a record fetch fails
and the UI paints "0 days," we have broken the one thing this product is about. **An outage must
never render as an empty record** — it renders as last-known, or as nothing.

---

## 7. Sequencing

1. **§1 honesty pass** — independently shippable, no dependencies, and it stops active harm.
2. **§4.2 connect disclosure** — one line, unblocks honestly leaning on the pitch.
3. **§1.1 / §1.2 / §1.3** — the onboarding data the rest of the design consumes.
4. **§2 record surfaces** — retention.
5. **§3 conversion card** — needs §1.2's persisted `supporters` and §3.4's server flag.
6. **§4.1 proof ledger** — migration plus backfill; the largest single piece, and the one that must
   land before the portable-record pitch is marketed anywhere outside the app.

---

**Deference footer.** Positioning: `docs/founding/COMPETITIVE_ANALYSIS.md` §A/§C. Anti-tracker
non-negotiable: `docs/founding/01_PRODUCT_CONSTITUTION.md`. D1 keystone (portable athlete-owned
record): `docs/founding/00_STRATEGIC_QUESTIONS.md` §3 moat #1. Pricing catalog: `src/core/pricing.ts`.
