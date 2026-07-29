-- OnStandard — commitment_locations: the missing INSERT grant AND insert policy (split from 0150).
--
-- WHY THIS IS SEPARATE FROM 0150. Verified against live prod on 2026-07-26: commitment_locations
-- does not exist there. 0138 (Verified Commitments) is authored-but-not-applied, along with the
-- rest of 0133-0146 — while 0147 and later WERE applied, so prod's history is deliberately out of
-- order. Keeping this in 0150 would have aborted that migration on prod and blocked its three
-- genuinely-live fixes (team_rooms, team_week_pattern, device_tokens).
--
-- THE BUG. 0138 created the table with a cl_read SELECT policy and a SELECT-only grant. There is
-- no insert policy AND no insert grant, so js/commitment-data.js:218 saveLocation() can never
-- succeed — it catches the error and returns null, so a coach saving a geofence location gets
-- silence. Verified Commitments would ship with its location-creation path dead.
--
-- The policy mirrors cl_read's authorization exactly (same helper, same arguments), so a coach may
-- create a location only for a team or practice they actually staff.
--
-- ORDER: 0153 > 0138, so a fresh database and any future prod push of the pending batch both get
-- the table first and this second. Guarded anyway, so applying it early is a no-op rather than an
-- error.

do $$
begin
  if to_regclass('public.commitment_locations') is null then
    raise notice '0153: commitment_locations does not exist yet (0138 not applied) — skipping.';
    return;
  end if;

  grant insert on public.commitment_locations to authenticated;

  drop policy if exists cl_staff_insert on public.commitment_locations;
  create policy cl_staff_insert on public.commitment_locations for insert
    with check (commitment_owner_is_staff(team_id, practice_id));
end $$;

-- ROLLBACK:
--   revoke insert on public.commitment_locations from authenticated;
--   drop policy if exists cl_staff_insert on public.commitment_locations;
