# Test Coverage

## Current state

| Suite | Command | Count | Status |
|---|---|---|---|
| TypeScript | `npm run typecheck` | — | clean |
| Jest | `npm test` | **2,574** across 212 suites | pass |
| Proto modules | `npm run test:proto` | 41 | pass |
| RLS authorization | `supabase/tests/run.sh` | **419** | pass |
| XSS lint | `npm run lint:xss` | — | clean |
| QC screen sweep | `node scripts/qc-capture.mjs` | 61 screens × themes × widths | see below |

Baseline on arrival was 2,571 jest tests and **417/419** RLS.

## Added in this pass

### `src/core/directWriteGrants.test.ts` (3 tests)

Guards the bug class that migrations 0036, 0098 and 0150 have each had to fix. Reads what the
shipped WebView client actually writes (`.from('t').insert/update/upsert/delete`) and requires a
matching grant in the migrations.

It encodes the *real* rule rather than a naive one: 0005 issued an immediate
`grant … on all tables`, and 0013 revoked only the **default privileges** for future tables — so
only tables created after 0013 need an explicit grant. Demanding one from `days` would be a false
alarm, and a test that cries wolf gets disabled.

It includes a self-check (`writes.size > 5`) so a silently-failing regex cannot make every
assertion vacuously pass.

**It earned its place immediately**: it found `device_tokens` and `commitment_locations`, which
the human audit had missed.

### `router-roles.test.mjs` — role regression assertions

Negative cases for all four roles:
- a shared screen must render in the **parent** shell for a parent, never the athlete one;
- `fund-plan`, `funded-plans`, `my-trainer-offers` specifically;
- every signed-in role must be able to render `delete-account`, driving `RT.authRole` the way the
  running app does rather than asserting against a null session.

The `delete-account` assertion surfaced a third instance of the bug the audit had not found.

### `supabase/tests/rls_authz_test.sql` — de-flaked

Two `vc2` checks only held between 04:00 and 08:30. The fixture's generated instance is now
anchored to `now()`, so the suite is honest at any hour. **417/419 → 419/419.**

### `scripts/qc-capture.mjs` — machine screen audit

Not a unit test; a measuring instrument. Per screen it reports horizontal overflow, elements wider
than the viewport, touch targets under 44px, text clipped by its container, WCAG contrast
failures, uncaught JS errors, and empty/stuck screens. Emits `report.json` plus an HTML contact
sheet.

Measured deltas this pass:

| | Before | After |
|---|---|---|
| Light-mode contrast failures | 5 | **0** |
| Dark-mode contrast failures | 0 | 0 |
| JS errors | 1 (`#meal-questions`) | **0** |
| Focus rings on suppressed fields | 0 / 9 | **9 / 9** |
| Sub-44px touch targets | 59 | 59 *(not addressed — see KNOWN_RISKS #5)* |

## Where coverage is genuinely weak

1. **Streaks have no parity test** and the two implementations have already drifted. `history.test.ts`
   and `protoStreakGrace.test.mjs` assert **contradictory** semantics and both pass. This is the
   worst coverage gap in the repo: green tests are actively certifying a contradiction.
2. **`scoreParity.test.ts` has three holes.** It compares nutrition / recovery / checkin / total
   across the TS and JS engines over 19 fixtures — genuinely two-sided, which is better than most
   codebases manage. But it never asserts the `commitment` sub-score, never exercises the coach
   standard path (`STD` is null in every fixture, so grace, late-credit policy and
   `mealsRequired` denominators are outside the net), and never compares `gradeFor` / `tierFor` /
   `evidenceCeiling`.
3. **Sync-by-comment concepts have no test at all** — grades (3 copies incl. plpgsql), tier bands
   (3 copies), pricing (**4 copies, money**), `styleShowsNumbers` (the edge copy is tested only
   against itself). Each is a <30-line parity test away from being guarded.
4. **No end-to-end test** of the meal state machine across upload → analysis → correction →
   confirm → score. The states exist and are handled individually; nothing walks the whole path.
5. **No visual-regression baseline.** The QC harness produces the artifacts for one; nothing yet
   diffs successive runs.
6. **63 of the 166 `src/core/*.test.ts` files actually test the proto**, importing
   `proto/redesign-2026-07/js/**`. The proto's real test suite lives under `src/core` and runs on
   a different runner from the proto's own 7 `.test.mjs` files. Two runners, one implementation.

## Recommended next tests, in value order

1. Streak parity — after the founder picks the semantics.
2. Pricing parity across all four copies. Money drifting silently is the highest-cost failure here.
3. Extend `scoreParity` to the coach-standard path and the commitment sub-score.
4. Grade/tier parity including the plpgsql copy in migration 0041.
5. A meal-logging E2E over the state machine, including failure and retry.
6. Wire `qc-capture` into CI as a visual-regression gate on a fixed screen set.
