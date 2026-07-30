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

echo "==> RLS authz suite against: ${DB%%\?*}"
run_sql rls_authz_test.sql

# 0169/0170/0171 audit fixes (security audit 2026-07-30): code entropy, the staff-code attempt
# budget, storage mime/size bounds, and the has_premium_access grant. Needs >=3 profiles to exist
# (it picks three actors out of `profiles`), so it is skipped rather than failed on an empty db.
echo "==> audit-fix suite (0169-0171)"
run_sql code_entropy_and_limits_test.sql
