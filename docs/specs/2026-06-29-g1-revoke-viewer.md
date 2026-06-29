# G1 — revoke_viewer: draft + validation plan (NOT yet applied)

**Status:** DRAFT. The SQL below is **unvalidated** (no Postgres available to the crew) and carries
one **design decision the founder must make**. Do NOT apply it until it is validated on a throwaway
Postgres against your real org structure. The CLIENT half is shipped and inert until this lands.

## The problem (security audit G1)

`removeViewer(kind)` only filters a local label array (`supportTeam`). Once the backend is live, a
removed coach/guardian still passes `can_view`, so the "Remove viewer" button promises a revocation
it does not deliver. **This must be real before any minor's data syncs.**

## The schema facts (read from the migrations)

- `link_status` enum = `('active', 'invited', 'removed')` (`0001`). Setting a link to `removed`
  drops it from every `can_view` predicate (they all filter `status = 'active'`).
- Subject-side link tables: `team_members(athlete_id, status)`, `practice_clients(client_id, status)`,
  `guardianships(athlete_id, guardian_id, status)`.
- **The complication:** after `0012`, coach access routes through `org_memberships`
  (`can_view = can_view_via_memberships(athlete) OR is_trainer_of(athlete) OR is_guardian_of(athlete)`,
  `0013`). Teams were backfilled into `org_memberships`; trainers/guardians were NOT yet. So:
  - revoking a **trainer/guardian** = deactivate their legacy link (still the live predicate);
  - revoking a **coach** = deactivate the athlete's **team-side `org_memberships`** (the legacy
    `team_members` row alone no longer drives coach `can_view`). And the membership model has **one
    athlete membership per org**, so "remove just the coach" is not cleanly expressible from the
    athlete's subject row, deactivating it removes that org's whole oversight.

## The design decision (founder must pick)

1. **Link/membership deactivation (audit's approach).** `revoke_viewer(kind)` flips the athlete's
   matching subject-side rows to `removed`. Simple, matches `can_view`. Caveat: for a coach it is
   org-coarse ("leave that team's oversight"), not per-individual-coach.
2. **Per-viewer visibility flag.** A new `athlete_visibility(athlete, viewer, hidden)` row that
   `can_view` also checks, so the athlete hides a specific overseer without dismantling the
   membership. Cleaner for "athletes own visibility" (I1), but a new predicate + a `can_view` change.
3. **Hybrid:** flag for granular per-coach hiding; deactivation for "leave the org entirely".

**Recommendation:** ship **option 1** for the wedge now (an athlete removing a coach is, in the
one-team wedge, leaving that team), and add **option 2** when multi-coach granularity is real. Keep
the bright line: this only ever touches the **access half**, never the athlete's profile/data (D1).

## DRAFT RPC (option 1) — VALIDATE before applying

```sql
-- DRAFT 0014_revoke_viewer.sql — UNVALIDATED. Validate on a throwaway Postgres on top of 0001-0013.
-- Sets the signed-in athlete's matching subject-side links to 'removed', which can_view excludes.
create or replace function revoke_viewer(viewer_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'must be signed in'; end if;

  if viewer_kind = 'coach' then
    -- legacy team membership ...
    update team_members set status = 'removed' where athlete_id = uid and status = 'active';
    -- ... AND the team-side org_memberships that now drive coach can_view (post-0012).
    -- [VALIDATE: confirm this targets the athlete's team-org athlete-membership and nothing wider.]
    update org_memberships set status = 'revoked'
      where member_id = uid and role = 'athlete' and status = 'active'
        and organization_id in (select organization_id from teams);  -- team-type orgs only
  elsif viewer_kind in ('trainer', 'nutritionist') then
    update practice_clients set status = 'removed' where client_id = uid and status = 'active';
  elsif viewer_kind in ('parent', 'guardian') then
    update guardianships set status = 'removed' where athlete_id = uid and status = 'active';
  end if;
end; $$;

grant execute on function revoke_viewer(text) to authenticated, service_role;
```

> The `org_memberships` clause is the part most likely to be wrong against your real org shape (the
> `teams.organization_id` join and the membership_status value `'revoked'` must match `0011`). Treat
> it as a stub to validate, not as correct.

## Validation plan (throwaway Postgres)

1. Apply `0001-0013` + this draft on a throwaway DB with representative rows.
2. Seed: athlete A in a team (coach C sees A via memberships), a practice (trainer T sees A), a
   guardian G.
3. Assert BEFORE: `can_view(A)` is true from C, T, G.
4. Run `revoke_viewer('coach')` as A; assert `can_view(A)` from C is now **false**, and from T and G
   still **true** (no over-revocation). Repeat for 'trainer' and 'parent'.
5. Idempotency: a second call is a no-op. Confirm the athlete's profile/data rows are untouched.

## Client status (shipped, inert)

`db.revokeViewer(kind)` + `removeViewer` calling it when `isBackendLive` are **already wired** and
tested (local filter unchanged; the live call is gated + best-effort). The moment the validated RPC
is applied, the button becomes a real revoke with no further app change.
