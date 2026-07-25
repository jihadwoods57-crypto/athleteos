# Rollback Plan

Every change in this pass is reversible. Nothing was deployed and nothing was merged to `master`.

## Whole-branch rollback

All work is on `feat/production-transformation`, branched from `feat/founder-command-center`.
Abandoning the branch reverts everything; no shared state was mutated.

```bash
git checkout feat/founder-command-center      # nothing else to undo
```

## Migration 0150 — table grants

**Risk: very low.** Pure privilege addition plus one INSERT policy. No schema change, no data
change, no destructive operation. Idempotent (re-granting is a no-op; the policy is
`drop policy if exists` first).

```sql
revoke insert, update, delete on team_rooms           from authenticated;
revoke insert, update         on team_week_pattern    from authenticated;
revoke delete                 on device_tokens        from authenticated;
revoke insert                 on commitment_locations from authenticated;
drop policy if exists cl_staff_insert on commitment_locations;
```

Rolling back restores the broken-but-safe status quo: the three live features return to failing
with 42501. It leaks nothing — RLS still gates every row, and a table grant alone authorizes no
unpolicied access.

## Migration 0151 — TRUNCATE / TRIGGER / REFERENCES revoke

**Risk: very low.** All three are DDL-adjacent privileges used only by migrations, which run as
the table owner. No client code path can be affected.

```sql
grant truncate, trigger, references on all tables in schema public to anon, authenticated;
alter default privileges in schema public
  grant truncate, trigger, references on tables to anon, authenticated;
```

Only needed if some future path is found to run DDL as `anon`/`authenticated` — which would
itself be the real bug.

## Client changes (proto WebView)

Ship as an OTA update, so rollback is a re-publish of the previous bundle rather than an App
Store cycle. The affected files:

```
proto/redesign-2026-07/css/{tokens,app,screens,flows,coach,focus}.css
proto/redesign-2026-07/index.html
proto/redesign-2026-07/js/router.js
proto/redesign-2026-07/js/state.js
proto/redesign-2026-07/js/screens/*.js
```

`css/focus.css` is a new file referenced from `index.html`. Reverting `index.html` alone disables
the focus layer without removing the file. `scripts/build-proto-zip.mjs` walks the directory
recursively, so no manifest needs updating either way.

To revert just the client:

```bash
git revert b8d9f18            # design system foundation
git revert e9cf5e3            # four UI defect fixes
# nav fix: revert the navigation commit
```

Each commit is independent and touches a disjoint set of concerns, so they can be reverted
individually without conflict.

## Pre-flight before any production migration

1. `supabase db reset` locally — confirm all 151 migrations apply cleanly.
2. `supabase/tests/run.sh` — confirm **419/419**.
3. `npm run verify` — typecheck, XSS lint, jest, proto tests, iOS bundle.
4. Confirm a current database backup exists and its restore path has been exercised.
5. Apply 0150 and 0151 **separately**, verifying privileges between them:

```sql
select table_name, string_agg(privilege_type, ',' order by privilege_type)
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_name in ('team_rooms','team_week_pattern','device_tokens','commitment_locations')
group by table_name order by table_name;
```

Expected after 0150:

```
commitment_locations -> INSERT,SELECT
device_tokens        -> DELETE,SELECT
team_rooms           -> DELETE,INSERT,SELECT,UPDATE
team_week_pattern    -> INSERT,SELECT,UPDATE
```

(Before 0151 these rows also carry REFERENCES/TRIGGER/TRUNCATE; after 0151 they should not.)

## What has no rollback path and was therefore not done

- No production data was modified, deleted or experimented on.
- No production secret was read, printed, rotated or committed.
- Nothing was deployed; no edge function was published.
- No push notification, email or message was sent to any real user.
- `master` was not touched.
