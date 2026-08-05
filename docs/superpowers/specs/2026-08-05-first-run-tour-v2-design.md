# First-run tour v2 — longer, role-complete, first-signup-only

**Date:** 2026-08-05
**Founder ask:** "The current interactive tour needs to be way better, way more descriptive and
longer. Every role needs to have it, and it only needs to appear when a person first signs up and
logs in for the first time."

## What exists (v1, shipped 2026-07-30)

`js/tour-plan.js` (pure planner, `tour-plan.test.mjs` is the spec) + `js/tour.js` (DOM driver).
Spotlight tour on the role's landing screen, `data-tour` anchors, seen-flag in `RT.tourSeen`
mirrored to `profiles.tour_seen_at` (migration 0165, live on prod). Athlete 4–6 steps, coach/trainer
4 shared, parent 3. Replay from Settings → Help.

## The three gaps this closes

1. **Too thin.** One-line bodies that name a surface without explaining what to do with it.
2. **Not actually role-complete in practice.** A brand-new coach with zero athletes lands on the
   empty-team dashboard, which has **no anchors at all** — `filterSteps` drops everything and the
   brand-new coach (the person who most needs orientation) silently gets nothing. The seen flag
   isn't written, so it ambushes them days later once the board fills in — exactly the wrong moment.
3. **Not gated to first signup.** The only suppression is the seen flag, so every *existing*
   account that predates the feature (or any future copy change that adds a new tour id) gets
   toured on their next OTA. The founder wants it for brand-new signups only.

## Design

### A. First-signup-only gate (the "only on first login" ask)

`planTour(ctx)` gains two fields: `createdAt` (the server birthday — `profiles.created_at`,
already hydrated into `RT.profile.createdAt` by `_loadProfileIntoRt` and used as the activation
anchor for first-day scoring) and `now` (ms). New pure helper:

```
isNewAccount(createdAt, nowMs)  // true iff createdAt parses and age <= 7 days
```

Gate order in `planTour`: unknown-role → wrong-route → already-seen → **no-birthdate** →
**existing-account**. `replay: true` (Settings) bypasses seen + both new gates, nothing else.

- **Missing `createdAt`** (profile fetch failed / offline) → suppress with reason `no-birthdate`.
  Self-healing like the `authRole: null` case: the seen flag is never written, so the tour runs on
  a later boot once the profile hydrates. Failing *silent* beats touring an account of unknown age.
- **Window = 7 days**, not "literally the first session": covers signup-on-one-device /
  first-app-open-days-later, and a first session that got interrupted before the landing screen.
  The seen flag still guarantees at-most-once; the window only excludes *old* accounts.
- Existing accounts without `tour_seen_at` now simply never auto-tour. No backfill migration
  needed — the gate makes the column's null state harmless.

### B. Contextual tips unblock for old accounts

`maybeShowTip` required the role's main tour to have been seen (so a brand-new user isn't
spotlighted twice in one session). With the age gate, an existing account would never satisfy that
and tips would be dead forever. New rule: tips run when the main tour was seen **or** the account
is not new (no double-spotlight risk — old accounts get no main tour).

### C. Longer, more descriptive step lists

Copy voice: the app's own — short declarative sentences, second person, no hype. Bodies grow from
one line to 2–3 sentences that say what the surface *does* and what to *do* with it. Tour card
widens 300 → 320px; everything else in the driver is untouched (it already re-measures).

New anchors (all on surfaces that exist on the landing routes):

| anchor | where | note |
|---|---|---|
| `progress`, `profile` | athlete tab bar (router.js) | join existing `plan` |
| `create` | operator FAB (router.js) | was explicitly untagged in v1 |
| `tab-roster`, `tab-inbox`, `tab-you` | operator tab bar (router.js) | names avoid colliding with the board's `roster` anchor |
| `invite` | empty-team dashboard wrapper (coach-home.js) | wraps invite card *or* create-team form |
| `link` | parent "Link an athlete" row (coach.js) | |

**Athlete** (6 core + 2 conditional): score → log → plan (goal tail kept) → progress →
coach-seen* → standards* → profile → close. (*conditional, as v1)

**Coach / trainer** (shared list, role-conditional nouns, richer trainer copy): invite → roster
scope → priority → activity → followups → create → tab-roster → tab-inbox → tab-you.
`invite` is planned unconditionally and DOM-filtered: on a populated board the invite card doesn't
render so the step drops; on the empty board the four board anchors drop and the new coach gets a
real 5-step orientation (invite, create, three tabs) instead of v1's nothing. Trainer keeps its own
tour id (a coach-who-is-also-a-trainer hears both).

**Parent** (4): children → link → visibility → funding. The parent surface is honestly small;
four meaty steps beat padding.

The closing athlete step and each role's `tab-you`/profile step name the replay path, so
discoverability of "Replay app tour" is part of the tour itself.

### D. What deliberately does not change

- Driver mechanics (settle delay, scrim panels, same-route hashchange guard, seen-at-first-paint,
  min-2-survivors rule, placeCard).
- Storage: same `tour_seen_at` column, same per-id `RT.tourSeen`. No migration.
- `tip:progress` stays a tip.

## Testing

`tour-plan.test.mjs` updated as the spec: new step lists per role (full + empty-board coach via
filterSteps), age-gate matrix (new / old / missing / unparseable `createdAt`, replay bypass,
boundary at 7 days), `isNewAccount` unit tests, all v1 invariants (goal tails, audience nouns,
suppression, garbage tolerance, filterSteps, placeCard) carried forward.
