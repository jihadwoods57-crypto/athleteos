# Release Checklist

Scope: releasing the work on `feat/production-transformation`. **Not a general-launch checklist** —
see EXECUTIVE_SUMMARY for the go/no-go, which is NO-GO for general launch.

## Recommended sequence

The work splits into two independently shippable pieces. Ship them separately.

### Piece 1 — migration 0150, on its own, soon

Three coach-facing features are broken on production **right now**, silently. This is a pure grant
addition: no schema change, no data change, documented rollback.

- [ ] `supabase db reset` locally — all 151 migrations apply cleanly
- [ ] `supabase/tests/run.sh` — **419/419**
- [ ] Confirm a current database backup exists **and** its restore path has been exercised
- [ ] Apply `0150_fix_direct_write_grants.sql` to production
- [ ] Verify privileges (query in ROLLBACK_PLAN); expect:
      `team_rooms` DELETE,INSERT,SELECT,UPDATE · `team_week_pattern` INSERT,SELECT,UPDATE ·
      `device_tokens` DELETE,SELECT · `commitment_locations` INSERT,SELECT
- [ ] Smoke test as a real coach: create a position room, rename it, delete it
- [ ] Smoke test: save a team week pattern
- [ ] Smoke test: sign out, confirm the device token row is gone
- [ ] Watch error rates for 42501 for 24h

### Piece 2 — migration 0151 + the client bundle

- [ ] Apply `0151_revoke_truncate_trigger.sql`
- [ ] Verify `anon` and `authenticated` no longer hold TRUNCATE/TRIGGER/REFERENCES, and that DML
      grants are unchanged (62 SELECT / 38 INSERT / 37 UPDATE / 30 DELETE for `authenticated`)
- [ ] `npm run verify` — typecheck, XSS lint, jest (2,574), proto tests (41), iOS bundle
- [ ] `node scripts/qc-capture.mjs --themes dark,light --widths 320,390,430` — no new failures
- [ ] Confirm `css/focus.css` is present in the built proto zip (`build-proto-zip.mjs` walks the
      directory, so it should be automatic — verify, do not assume)
- [ ] Ship the client as an **OTA update**, so rollback is a re-publish rather than a store cycle
- [ ] Verify on a real device, both themes: sign-in screen copy, AI meal analysis labels,
      roll-call row tap, parent Fund-a-plan (no athlete tab bar), account deletion as a coach

## Before any general launch — blockers

- [ ] **Resolve the streak drift** (KNOWN_RISKS #1). Founder decision required.
- [ ] **Cap anonymous AI spend** (KNOWN_RISKS #2). Hard dollar ceiling plus kill-switch.
- [ ] **Decide light mode**: finish the token migration or ship dark-only and remove the toggle.
      A half-migrated light mode is the worst of the three options.
- [ ] **Delete the dead `src/` tree** before the next binary build — it is compiled in today.
- [ ] Raise the 59 sub-44px touch targets to the tap floor.
- [ ] Give `monthly-report` a timeout, error state and retry.

## Device QA still outstanding from prior work

Carried forward, not verified in this pass:

- [ ] Geofenced arrival (Verified Commitments) — needs a physical device
- [ ] Lock-screen roll call "I'm Up" quick action, including cold start
- [ ] Live camera capture inside the WebView on real iOS and Android hardware
- [ ] Push delivery end to end

## Things this pass deliberately did not do

No production data was modified. No production secret was read or rotated. Nothing was deployed.
No push, email or message was sent to any real user. `master` was not touched.
