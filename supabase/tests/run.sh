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

DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
echo "==> RLS authz suite against: ${DB%%\?*}"
psql "$DB" -v ON_ERROR_STOP=1 -f rls_authz_test.sql
