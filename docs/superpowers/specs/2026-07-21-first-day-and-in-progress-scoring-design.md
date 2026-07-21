# First-day activation fix + in-progress day framing — Design

**Date:** 2026-07-21
**Branch:** compliance-fixes
**Surface:** proto/redesign-2026-07 (the shipped WebView UI)
**Author:** brainstorm with founder (jihadwoods57@gmail.com)

## Problem

A brand-new athlete account shows the Home screen as **"Off Standard / 0 / OVERDUE"**
immediately after signup — punishing the user for windows (breakfast, lunch, dinner,
morning weigh-in) that closed before their account existed.

Two distinct causes, fixed together:

### Cause 1 — a stale activation timestamp (bug)

The first-day activation system (`js/activation.js`, shipped 2026-07-18) is supposed to
make a new account read "Not scored yet / Ready to begin" and mark pre-signup windows
"Not required." It decides "is today the activation day?" by comparing an activation stamp's
local date to the day being scored (`state.js` `get activation()` → `activationInfo(activationStamp(), DAY.date)`).

`activationStamp()` (state.js:397) returns `RT.activationDate || RT.profile.committedAt`.
Both are **client-remembered** and survive on the device:
- `RT.activationDate` is stamped once in `persistOnboarding` under `if (!RT.activationDate)`
  (state.js:1629) and cleared only by a full `_wipeUserScopedState`.
- `RT.ob.committedAt` survives sign-out via `keepPendingOb` (state.js:1240, signOut→1257),
  and is written to the server `committed_at` by `_stampConsent` (state.js:1602-1609).

Live DB evidence (2026-07-21): the newest athlete row was `created_at` **2026-07-21 02:47**
(minutes old) but `committed_at` **2026-07-10 12:35** — an 11-day-old stamp carried from an
earlier onboarding run on the same device. `activationInfo` compares July 10 to July 21,
concludes "activated 11 days ago → fully active," and the grace never fires.

Impact: any device that has **ever** onboarded shows every subsequent new account as a
"day-N veteran who's behind" — 100% reproducible for the founder testing repeatedly, and a
real (rarer) hazard for reused devices (coach demos, then hands the phone to an athlete).

### Cause 2 — a verdict delivered on a day that isn't over (design)

Even with activation working, the daily model resets to 0 each morning and `tier(score)`
(state.js:121) returns **"Off Standard" (red)** for any score < 60 — including at 8am when
nothing has happened yet. Requirement pills show red **"Overdue"** (exec.js:31-32) the moment
a window closes, regardless of whether the day is still winnable. A day the user can still
save looks like a day they've already failed. New users are the most painful case of a
universal problem.

## Non-goals / constraints

- **The score math does not bend** (founder decision D3). Weights (`WEIGHTS` state.js:106),
  denominators, streaks, and `computeScore` are untouched. `scoreParity.test.ts` must stay
  byte-identical. This change is presentation, labeling, and verdict-*timing* only.
- **No multi-day new-user grace mode.** A genuinely unproductive **decided** day for an
  established user still shows the honest low verdict — that is the point of a standard. New
  users are covered by correct day-one grace (Part A) + the in-progress framing (Part B), not
  by a special week-long mode. A softer first *week* is a possible clean follow-on, explicitly
  out of scope here.

---

## Part A — Anchor activation to the account's server birthday

The account's real creation time (`profiles.created_at`) is the authoritative, tamper-proof,
device-independent answer to "when was this account born." It cannot be stale — the row did
not exist until the account did.

### A1. Hydrate `created_at`
In the profile-load select (state.js:1158) add `created_at`:
```
.select('full_name,committed_at,created_at')
```
Patch it into profile state (near state.js:1166): `if (prof && prof.created_at) patch.createdAt = prof.created_at;`
Add `createdAt: null` to the profile shape / defaults as needed.

### A2. Derive the activation stamp from creation, refined by commit only when same-day
Rewrite `activationStamp()` (state.js:397) to:
1. `created = RT.profile?.createdAt` (server birthday — the floor).
2. `committed = RT.activationDate || RT.profile?.committedAt` (may refine the minute).
3. If `created` exists:
   - if `committed` exists **and** `parseActivation(committed).date === parseActivation(created).date`
     → return `committed` (same-day, keeps the finer minute-of-signup).
   - else → return `created` (rejects a stale/cross-day commit like July 10).
4. If `created` is missing (older clients / pre-change) → fall back to the current
   `RT.activationDate || RT.profile.committedAt` (existing behavior; nobody affected retroactively).

Existing real users: `created_at` is in the past → `isActivationDay` false → fully active,
identical to today. Only accounts born **today** flip to activation-day grace — the intent.

### A3. Stop writing stale stamps
- `persistOnboarding` (state.js:1629): when stamping `RT.activationDate`, if the carried
  `ob.committedAt` is **not** today's local date, use `new Date().toISOString()` instead of the
  stale value. (The OB2 commit step already stamps fresh; this guards the carry-over path.)
- `_stampConsent` (state.js:1602): write `committed_at` from the same today-guarded value, so a
  stale scratch can never poison the server backstop again.
- Optional hardening: drop `committedAt` from the `ob` kept by `keepPendingOb` so it can't leak
  across accounts. (Belt-and-braces; A2 already makes it non-authoritative.)

### A4. The already-poisoned test account
The founder's current test row has `committed_at = July 10` in the DB. After A2 it is ignored
in favor of `created_at`, so no data cleanup is required. (If the founder wants the row tidy,
a one-line `update profiles set committed_at = created_at where id = …` is optional, not needed.)

---

## Part B — Don't deliver a verdict on a day that isn't over

All of Part B is presentation. The number still climbs live; we change its **label, color, and
when a negative verdict is allowed to appear**, plus the pill vocabulary.

### B1. The "decided" rule (new pure helper)
A day is **decided** when no required window is still open on time — every required item is
`done`/`done_late` or already past its close, i.e. none remain in an on-time-actionable state.

Add a pure function (new `js/dayverdict.js`, no imports/DOM/Date — callers pass state):
```
export function dayDecided(items, { hasOpenRequired }) { ... }
```
Concretely: decided = there is **no** required item whose state is `locked` (not yet open),
`ready` (open, in window), or `due_soon`. If all required items are `done`/`done_late`/`overdue`
(or `not_required`), the on-time day is over → decided. Expose via a `state.js` getter
`S.dayDecided` computed from `S.exec.items`.

### B2. Hero verdict timing (`home.js`)
Selection order in the default render (home.js:366+, after the existing `S.notYetScored`
branch at 372 which is unchanged):
- **Activation day** (`S.notYetScored`) → existing "Not scored yet / Ready to begin" (now fires
  correctly thanks to Part A). Unchanged.
- **Day live AND below passing** (`!S.dayDecided && S.tier` is the red "Off Standard" band,
  score < 60) → new **"In progress"** hero: the live climbing `scoreRing` number, a
  "`met` of `total` done — `total-met` to go" line, neutral/blue treatment, **no** red tier pill,
  **no** "Off Standard", **no** negative `deltaChip`. Frames what's left, not what's failed.
  (Label copy: **"In progress"** — deliberately distinct from the existing 60-75 tier named
  "Building" to avoid a name clash. Final wording is the founder's call.)
- **Otherwise** (day decided, OR already at a passing tier ≥ 60) → the existing `hero(e)`
  (home.js:224) with the real `S.tier` — celebratory green when earned, and an honest red
  "Off Standard" only once the day is decided. Positive verdicts (good tier) always show
  immediately, even mid-day.

`headSub` (home.js:178) already reads "N requirements remaining today" — reuse it; the
in-progress hero leans on that framing.

### B3. Pill ladder (`exec.js`)
Reframe the `overdue` state so red is reserved for a finished miss. Two treatments for the same
underlying "past its window, required, not done" condition, chosen by `dayDecided`:

| Condition | State/label today | New label | New color |
|---|---|---|---|
| Not yet open | `locked` "Upcoming" grey | Upcoming | grey (unchanged) |
| Open, in window | `ready` "Open" gold | Due | blue/gold |
| Near close | `due_soon` "Due soon" gold | Due soon | amber (unchanged) |
| Past window, **day live** | `overdue` "Overdue" **red** | **Late — still counts** | **amber** |
| Past window, **day decided** | (same red) | **Missed** | **red** |
| Pre-signup (activation) | `not_required` "Not required" grey | Not required | grey (unchanged) |

Implementation: thread `dayDecided` into the exec build (it already threads `activationMin`,
exec.js:67-72). Keep the internal `overdue` state name for ordering/denominator continuity
(NOW-list ordering at exec.js:110/124 and the score are unaffected), but drive its **COLOR/PILL/
sub** from `dayDecided`: live → amber "Late — still counts" (sub keeps "Was due HH:MM — still
counts, log it late", exec.js:82); decided → red "Missed". The `COLOR`/`PILL` maps (exec.js:31-32)
gain a decided-aware branch rather than a static lookup for the `overdue` key.

### B4. Copy
"Overdue" → "Late" (live) / "Missed" (decided). Late sub-text stays as-is (honest, actionable).
"In progress" hero line: "`N` to go — your day is still open." (founder to finalize).

---

## Files touched

- `js/activation.js` — no change (pure; still the date math).
- `js/dayverdict.js` — **new** pure `dayDecided`.
- `js/state.js` — hydrate `created_at` (A1); rewrite `activationStamp()` (A2); today-guard the
  stamps in `persistOnboarding` + `_stampConsent` (A3); add `S.dayDecided` getter; thread
  `dayDecided` into `get exec`.
- `js/exec.js` — decided-aware COLOR/PILL/sub for the past-window required state (B3).
- `js/screens/home.js` — the "In progress" hero branch + selection order (B2).
- Tests (below).

No migration. `profiles.created_at` already exists (a standard column since 0001).

## Testing

Pure unit tests (no DOM, callers pass the clock — match the `activation.test` pattern):
- `dayverdict.test`: decided true only when no required item is locked/ready/due_soon; false while
  any on-time window is open; done-heavy and all-missed cases.
- activation-from-created-at: stale `committed_at` (different day) is rejected in favor of
  `created_at`; same-day `committed_at` refines the minute; missing `created_at` falls back to old
  behavior; existing past-dated user → not activation day.
- pill ladder: past-window required → amber "Late" while live, red "Missed" when decided; optional
  items and `not_required` unaffected.
- hero selection: below-passing + live → in-progress state (no red, no Off-Standard); ≥ passing or
  decided → real tier.

Live/wiring:
- `firstDayActivation*.test` extended for the created-at anchor.

Parity:
- `scoreParity` / `standardDay` stay green — proves `computeScore` and denominators did not move.

Browser QA (served proto, module-mutation seed per the proto-headless recipe), three cases:
1. Fresh account created today → "Not scored yet / Ready to begin", pre-now windows "Not required".
2. Day-two morning (created yesterday, windows open) → "In progress" hero + Upcoming/Due pills, no red.
3. Day-two evening with a real miss (windows closed) → honest tier + "Missed" pills (red allowed).

## Rollout

- Presentation + client-logic only; ship in the proto, rebuild proto.zip.
- The `created_at` hydration is the only new server read (existing column, existing RLS on
  `profiles` self-select). No new grants, no migration, no edge-function change.
