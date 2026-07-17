-- OnStandard — Coach OS FK-to-profiles hardening (review fix on 0071).
-- Separate migration because 0071_coach_os_core.sql is ALREADY APPLIED to the linked live
-- project (its three tables exist there right now) — this file is forward-only and additive,
-- never edits 0071 in place.
--
-- WHY: 0007_delete_account.sql's erasure path deletes auth.users(id), which cascades to
-- profiles (0001), which is only guaranteed to reach every dependent row if that row's FK
-- to profiles(id) is declared `on delete cascade`. 0071 shipped coach_interventions.athlete_id,
-- coach_interventions.coach_id, coach_groups.created_by, athlete_exceptions.athlete_id, and
-- athlete_exceptions.created_by as BARE uuid columns with no FK at all — rows that carry notes
-- and absence reasons naming an athlete would silently survive that athlete's account erasure
-- (orphaned uuid, no cascade to remove them). This migration restores the invariant.
--
-- IDIOM (matches 0055_requirements_engine.sql / 0061_staff_invites.sql, the current "0055
-- idiom" 0071 itself cites):
--   - athlete-owned columns (the row is fundamentally ABOUT that athlete, e.g. 0055's
--     requirement_assignments.athlete_id) -> references profiles(id) on delete cascade.
--     Applied here to coach_interventions.athlete_id and athlete_exceptions.athlete_id.
--   - actor / created_by-style columns (0055's requirement_sets.created_by, requirement_
--     assignments.created_by; 0061's staff_invites.created_by) -> references profiles(id)
--     with NO explicit on-delete action (defaults to NO ACTION), same as here for
--     coach_interventions.coach_id, coach_groups.created_by, athlete_exceptions.created_by.
--
-- Also adds a check constraint forbidding NULL elements in coach_groups.athlete_ids (reviewer
-- finding #2) so a bulk-target array can never carry a null placeholder into RPCs that fan out
-- over it.
--
-- Guarded with pg_constraint existence checks so this migration is idempotent / safe to re-run.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_interventions_athlete_id_fkey') then
    alter table coach_interventions
      add constraint coach_interventions_athlete_id_fkey
      foreign key (athlete_id) references profiles(id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_interventions_coach_id_fkey') then
    alter table coach_interventions
      add constraint coach_interventions_coach_id_fkey
      foreign key (coach_id) references profiles(id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_groups_created_by_fkey') then
    alter table coach_groups
      add constraint coach_groups_created_by_fkey
      foreign key (created_by) references profiles(id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'athlete_exceptions_athlete_id_fkey') then
    alter table athlete_exceptions
      add constraint athlete_exceptions_athlete_id_fkey
      foreign key (athlete_id) references profiles(id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'athlete_exceptions_created_by_fkey') then
    alter table athlete_exceptions
      add constraint athlete_exceptions_created_by_fkey
      foreign key (created_by) references profiles(id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coach_groups_athlete_ids_no_null') then
    alter table coach_groups
      add constraint coach_groups_athlete_ids_no_null
      check (array_position(athlete_ids, null) is null);
  end if;
end $$;
