#!/usr/bin/env bash
# Run OnStandard's adversarial RLS / authorization suite against a database that has the
# migrations applied (local or staging — NEVER production).
#
#   supabase/tests/run.sh
#   DATABASE_URL=postgres://user:pass@host:5432/db supabase/tests/run.sh
#
# Default target is the local Supabase db (`supabase start` → port 54322). The suite seeds a
# cast of actors, probes every RLS policy as each actor, and ROLLS BACK — it leaves no data.
# Exits non-zero (and prints the offending checks) if any authorization boundary is breached.
#
# Note: revoke_viewer_test.sql is a *separate*, self-contained test that builds its own objects
# on a BLANK database; run it directly per its own header, not through this runner.
set -euo pipefail
cd "$(dirname "$0")"

# If psql isn't on PATH (the usual case on Windows), fall back to the one inside the local
# Supabase Postgres container. Without this the runner just dies with "psql: command not found"
# and the whole suite silently stops being run.
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if command -v psql >/dev/null 2>&1; then
  run_sql() { psql "$DB" -v ON_ERROR_STOP=1 -f "$1"; }
else
  CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_onstandard}"
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "psql not found and container '$CONTAINER' is not running — start Supabase first." >&2
    exit 1
  fi
  echo "    (psql not on PATH — running inside container '$CONTAINER')"
  run_sql() {
    docker exec -i "$CONTAINER" \
      psql "postgresql://postgres:postgres@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 < "$1"
  }
fi

# EVERY SUITE RUNS, EVEN AFTER ONE FAILS — and the summary at the bottom names each one.
#
# This used to be a straight sequence of `run_sql` calls under `set -e`, which meant the FIRST
# failure killed the script and every suite behind it never ran. That is not hypothetical: 35061ba
# shipped migration 0194 and left rls_authz_test.sql red (a fixture seeded `checkin.submitted` as a
# timestamp where the shipped writer sets a boolean). It is the first suite in this file, so from
# that day forward the audit-fix, spend-gate, admin-auth, admin-monitor and trainer-funded suites
# were ALL silently not running. Nobody noticed for weeks, because the output looked like a normal
# failure rather than a failure plus five unknowns.
#
# So: collect a verdict per suite, print them together, and exit non-zero if any failed. A suite
# that did not run must never look like a suite that passed.
SUITES=(
  # 0001+ the adversarial RLS / authorization core: seeds a cast of actors, probes every policy as
  # each of them, rolls back.
  "RLS authz|rls_authz_test.sql"
  # 0169/0170/0171 audit fixes (security audit 2026-07-30): code entropy, the staff-code attempt
  # budget, storage mime/size bounds, and the has_premium_access grant. Needs >=3 profiles to exist
  # (it picks three actors out of `profiles`), so it is skipped rather than failed on an empty db.
  "audit-fix (0169-0171)|code_entropy_and_limits_test.sql"
  # 0174: the spend gate reserves what it approves — the read-then-decide race the 2026-07-30
  # audit deferred. Needs only app_config; safe on an empty db.
  "spend-gate (0174)|spend_gate_test.sql"
  # 0130 admin auth gate + 0131 monitor. These existed since 2026-07-22 and were run by NOTHING —
  # a suite nobody runs is a suite nobody trusts, and both cover the aal2 choke point that every
  # admin RPC (including the marketplace ones) leans on.
  "admin auth-gate (0130)|admin_auth_test.sql"
  "admin monitor (0131)|admin_monitor_test.sql"
  # 0166/0167 trainer-funded access — the grant/expiry mechanics the marketplace now shares.
  "trainer-funded (0166-0167)|trainer_funded_test.sql"
  # 0196 Trust Pass rewards. An operator can move an athlete's score without the athlete logging,
  # so the grant/spend walls are pinned here rather than trusted to review.
  "trust-pass (0196)|pass_test.sql"
  # 0217 + 0248 the roll call kill switch: every push / Live Activity / alarm-code / notice / read
  # path answers nothing while verified_commitments is killed, an athlete's tap is still recorded,
  # and releasing the switch brings each 0248 path back.
  "roll call off (0217, 0248)|rollcall_off_test.sql"
  # 0250 food preferences + the plan-ideas cache: the owner writes their own prefs, linked staff
  # read them, a teammate, an outsider and a guardian see nothing; only the function writes ideas.
  "food prefs + plan ideas (0250)|food_prefs_test.sql"
  # 0251 no photo, no meal: an athlete's (or the service role's) insert without a photo in their
  # own folder is refused with 23514 photo_required; a photo can never be stripped or swapped;
  # past no-photo rows stay readable; the Trust Pass and pro corrections still work.
  "no photo, no meal (0251)|meal_photo_test.sql"
  # 0252 + 0253 + 0254 the season phase, adaptive targets and the targets door: only standards
  # editors set the team's phase (RPC or direct update), a solo athlete sets their own,
  # season_phase_for resolves team > practice (none) > self; suggestions are adult gain/lose only,
  # one per 14 days, anchored to the stored targets and bounded, decided (and applied, atomically)
  # by staff with target-edit rights or by a solo athlete; coach_set_goals is gated the same way.
  "season phase + target suggestions + targets door (0252-0254)|season_targets_test.sql"
  # 0255 dining hall menus: standards editors write halls, uploads and DRAFT menus; only
  # publish_dining_day / unpublish_dining_day move a menu's status; the team's athletes read
  # PUBLISHED menus only; view-only staff, position coaches, other teams, guardians and outsiders
  # never write (and outside the team never read); the bucket is editor-only per team folder.
  "dining hall menus (0255)|dining_hall_test.sql"
)

echo "==> SQL suites against: ${DB%%\?*}"

PASSED=(); FAILED=()
for entry in "${SUITES[@]}"; do
  label="${entry%%|*}"; file="${entry##*|}"
  echo ""
  echo "==> ${label}  (${file})"
  # The `if` is load-bearing: it suspends errexit for this call so a red suite records a verdict
  # instead of killing the run.
  if run_sql "$file"; then PASSED+=("$label"); else FAILED+=("$label"); fi
done

echo ""
echo "──────── ${#SUITES[@]} SQL suites ────────"
for s in "${PASSED[@]:-}"; do [ -n "$s" ] && echo "  PASS  $s"; done
for s in "${FAILED[@]:-}"; do [ -n "$s" ] && echo "  FAIL  $s"; done
echo ""

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "✗ ${#FAILED[@]} of ${#SUITES[@]} SQL suites failed: ${FAILED[*]}" >&2
  exit 1
fi
echo "✓ all ${#SUITES[@]} SQL suites passed."
