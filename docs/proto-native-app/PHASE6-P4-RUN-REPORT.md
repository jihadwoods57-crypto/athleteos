# Phase 6 — Priority 4 run report: role wiring landed

**Branch:** `feat/activation-scoring-ops` · **P4 range:** `ae39dcd` → `440db10`
**Status:** all 11 implementation slices from `PHASE6-P4-SCOPE.md` are done. `npm test` = **124
suites / 1555 tests green**, `npm run typecheck` clean after every slice. Score parity intact
(no scoring math touched).

Everything is wired the way the RN app does it — supabase-js in the WebView, RLS as the authz,
the exact same tables/RPCs as the `db.*` seam, **no new endpoints**. Every backend call is
best-effort → honest empty/loading state, so the UI degrades cleanly wherever a table/RPC isn't
applied yet (verified: all nine role screens render with no client bound).

## Slices (with commit SHAs)

| # | Slice | SHA | What landed |
|---|---|---|---|
| 1 | athlete `meals` write | `ae39dcd` | logMeal inserts a real `meals` row + persists `mealId` — the unblocker for review/comments |
| 2 | `roles.js` data layer | `4d6e8b2` | db.* mirror over window.sb (teams/roster/days/comments/targets/trust/nudge + trainer), `window.__render` |
| 3 | coach roster | `b742b36` | real team_roster + linked days, RLS-scoped; honest "No logs today"; Copilot over the real roster |
| 4–5 | coach review + meal thread | `cbe109e` | real day/meals/signed-photos + coach_views receipt; the REAL meal_comments thread both sides |
| 6 | coach targets | `9c01397` | per-athlete editor writing `coach_set_goals`; free-text plan note dropped |
| 7 | trust pass | `fc7a12d` | athlete reads the real active pass; coach grant/end RPCs with real eligibility errors |
| 8 | join requests | `60041b5` | pending_team_requests inbox → approve/decline real team_members |
| 9 | trainer view | `7422a08` | real practice_roster book; client detail; note = real send-push |
| 10 | cut no-backend fakes | `1a262e9` | assignments/leaderboard/plan-notes → honest coming-soon; removed demo squad/roster |
| 11 | parent | `e3ecdb5` | honest pending state (no parent→child data path in v1) |
| — | cleanup | `440db10` | dropped dead notification branches for the removed fakes |

## What is now real
- **Coach:** signs in → their own team roster (RLS-scoped) with real live scores; taps an athlete
  → real day + logged meals (signed photos) + a "seen your day" receipt; comments on a meal
  (real `meal_comments` + a push to the athlete); sets nutrition targets (`coach_set_goals`);
  grants/ends a Trust Pass; approves/declines join requests.
- **Athlete:** their meal-detail conversation is the real coach thread (reads/writes
  `meal_comments`); Trust Pass reflects a real granted pass or is honestly inactive.
- **Trainer:** real client book via `practice_roster`; client review; a note is a real push.
- **Parent:** honest "access being set up" — no fabricated child data.

## Deliberately NOT wired (no backend / out of these slices) — now honest coming-soon
- **Assign-a-requirement** — no table; the real levers are targets + comments + nudges.
- **Coach-controlled leaderboard / squad** — `comp_mode` is unused; no server leaderboard.
- **Free-text plan-update notes** — coach changes are real targets, not a notes feed.
- **The athlete's Plan tab** (phase/swaps/windows/coach note) is still demo — broader plan
  wiring was outside these slices; the coach's targets persist server-side but the athlete Plan
  display isn't yet reading `athlete_profiles.targets` (a clean follow-up).

## Founder gates still open (from the scope doc — can't be done from the cloud)
1. **Confirm the applied migration set** on the live project. The role layer needs `team_roster`
   (0040), `meal_comments` (0046), `trust_passes` (0033/0039), `coach_views` (0043), `coach_set_goals`
   (0002), and `0036_fix_table_grants` — several are "authored, founder applies at go-live." Until
   applied, the wired screens degrade to their honest empty states.
2. **`send-push` null-origin allowlist** — nudges + coach-comment pings from the `file://` WebView
   present `Origin: null`; the edge function must allowlist it (JWT is the real authz).
3. **Guardian consent backend** — the parent role stays a pending state until guardianship linking +
   minor-consent verification (a service_role endpoint) exist.

## Verification
Logic verified in Node with a mock `window.sb` (day.js + state.js + roles.js importable): meals
insert + mealId persist; roster merges real members with day rows (honest "No logs today");
coach review writes coach_views + renders real meals/photos; meal_comments post + nudge; targets
save via coach_set_goals; trust pass grant/end + eligibility error; join approve/decline flip
team_members; trainer note → send-push; all role screens render with no client bound. Real
browser + live-backend QA is the founder's (this environment can't apply migrations or call live
services). No fabricated data about a real user remains on any of the four role surfaces.
