-- OnStandard — account-erasure unblock for staff (GDPR/CCPA right-to-erasure completeness).
-- Forward-only, idempotent.
--
-- THE GAP THIS CLOSES
-- 0007_delete_account() erases a user by deleting auth.users(id) -> cascade to profiles ->
-- cascade to every athlete-owned row. But the coach-OS "actor" columns (created_by / author_id
-- / coach_id) were deliberately shipped as `references profiles(id)` with the DEFAULT on-delete
-- action = NO ACTION (0055/0061/0072/0073/0074, each citing the "0055 idiom"). NO ACTION BLOCKS
-- the parent delete: a coach who ever created a requirement set, a group, a template, an
-- announcement, a staff invite, a coach note, or logged an intervention CANNOT delete their
-- account today — the cascade to profiles raises a foreign-key violation and the whole
-- delete_account() transaction aborts. That is a right-to-erasure hole for every working coach.
--
-- THE FIX (declarative, so delete_account() itself needs no change)
-- Flip each actor FK to ON DELETE SET NULL and make the column nullable. When the creator's
-- account is erased, the TEAM-OWNED artifact survives (a departed coach's standards, groups,
-- and history are institutional data the team still needs) and only the personal attribution is
-- anonymized to NULL — the standard erasure pattern. The columns keep their `default auth.uid()`,
-- so normal inserts still stamp the author; only account-deletion ever nulls them.
--
-- NOT TOUCHED: athlete_id columns stay ON DELETE CASCADE (0072) — a row fundamentally ABOUT an
-- athlete goes with that athlete. teams/orgs ownership on a HEAD-COACH deletion is a separate
-- product decision (what becomes of an orphaned team) and is intentionally out of scope here;
-- this migration only unblocks the erasure FK violation for staff-created artifacts.
--
-- Every (table,column) below was enumerated from the LIVE catalog: FKs to profiles(id) whose
-- confdeltype was NO ACTION. Idempotent: dropping an already-nullable NOT NULL is a no-op, and
-- the constraint is dropped-if-exists then re-added with the SET NULL action on every run.

do $$
declare
  r record;
  fk text;
begin
  for r in
    select * from (values
      ('announcements',           'author_id'),
      ('athlete_exceptions',      'created_by'),
      ('coach_groups',            'created_by'),
      ('coach_interventions',     'coach_id'),
      ('coach_notes',             'author_id'),
      ('requirement_assignments', 'created_by'),
      ('requirement_sets',        'created_by'),
      ('requirement_templates',   'created_by'),
      ('staff_invites',           'created_by'),
      ('staff_invites',           'used_by')
    ) as t(tbl, col)
  loop
    fk := r.tbl || '_' || r.col || '_fkey';
    execute format('alter table %I alter column %I drop not null', r.tbl, r.col);
    execute format('alter table %I drop constraint if exists %I', r.tbl, fk);
    execute format(
      'alter table %I add constraint %I foreign key (%I) references profiles(id) on delete set null',
      r.tbl, fk, r.col);
  end loop;
end $$;

-- delete_account() hardening (surfaced while gating 0079): newer Supabase projects install a
-- guard that REJECTS a direct `delete from storage.objects` ("Direct deletion from storage
-- tables is not allowed. Use the Storage API instead."). 0007's erasure runs that DELETE as its
-- FIRST statement, so on a current project the whole function aborts and NO account can be
-- deleted — an erasure/compliance outage far bigger than the staff-FK gap this migration targets.
-- Wrap the photo cleanup in a best-effort sub-block: if the platform blocks it, swallow the error
-- and let the real erasure (delete auth.users -> cascade profiles -> SET NULL/cascade dependents)
-- proceed. Orphaned photos are swept out-of-band (a storage lifecycle rule / service-role job);
-- an uncleaned photo is a hygiene item, a blocked account deletion is a rights violation.
create or replace function delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'must be signed in to delete account';
  end if;

  -- 1) best-effort meal-photo cleanup (never aborts the erasure)
  begin
    delete from storage.objects
    where bucket_id = 'meal-photos'
      and (storage.foldername(name))[1] = uid::text;
  exception when others then
    raise notice 'delete_account: storage cleanup skipped (%) — photos swept out-of-band', sqlerrm;
  end;

  -- 2) the real erasure: cascades to profiles and every dependent row (0079 SET NULLs the
  --    coach-OS actor columns so team artifacts survive with anonymized attribution)
  delete from auth.users where id = uid;
end; $$;
grant execute on function delete_account() to authenticated, service_role;

-- org_memberships sync-trigger hardening (the OTHER erasure blocker, surfaced by the 0079 gate).
-- 0034 mirrors team_staff/team_members links into org_memberships via AFTER-trigger. On a profile
-- erasure the cascade deletes the member's team_staff/team_members row, which fires the trigger's
-- DELETE branch — and that branch UPSERTS an org_memberships row (status 'removed') keyed by the
-- member being deleted. org_memberships.member_id -> profiles is ON DELETE CASCADE, so the row is
-- already going away; the upsert just re-inserts it against a profile that no longer exists ->
-- 23503 org_memberships_member_id_fkey, aborting delete_account for ANY athlete or coach on a team.
-- Guard both DELETE branches: when the member's profile (or the team) is itself gone, skip the
-- sync — the org_memberships row cascade-cleans with its parent. Bodies are 0034's verbatim, plus
-- the one guard at the top of each DELETE branch.
create or replace function tg_team_staff_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_role membership_role;
begin
  if TG_OP = 'DELETE' then
    if not exists (select 1 from profiles where id = OLD.staff_id)
       or not exists (select 1 from teams where id = OLD.team_id) then
      return OLD; -- member/team being erased; org_memberships cascade-cleans it — no sync
    end if;
    v_role := case when OLD.role = 'head_coach' then 'head_coach'::membership_role
                   else 'assistant_coach'::membership_role end;
    v_org := ensure_team_org(OLD.team_id);
    perform sync_org_membership(v_org, OLD.staff_id, v_role, OLD.team_id, 'removed');
    return OLD;
  end if;
  v_role := case when NEW.role = 'head_coach' then 'head_coach'::membership_role
                 else 'assistant_coach'::membership_role end;
  v_org := ensure_team_org(NEW.team_id);
  perform sync_org_membership(
    v_org, NEW.staff_id, v_role, NEW.team_id, link_status_to_membership(NEW.status)
  );
  return NEW;
end $$;

create or replace function tg_team_member_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if TG_OP = 'DELETE' then
    if not exists (select 1 from profiles where id = OLD.athlete_id)
       or not exists (select 1 from teams where id = OLD.team_id) then
      return OLD; -- member/team being erased; org_memberships cascade-cleans it — no sync
    end if;
    v_org := ensure_team_org(OLD.team_id);
    perform sync_org_membership(v_org, OLD.athlete_id, 'athlete', OLD.team_id, 'removed');
    return OLD;
  end if;
  v_org := ensure_team_org(NEW.team_id);
  perform sync_org_membership(
    v_org, NEW.athlete_id, 'athlete', NEW.team_id, link_status_to_membership(NEW.status)
  );
  return NEW;
end $$;

comment on function delete_account() is
  'Erases the caller''s account. Photo cleanup is best-effort (platform storage guard can block it, must not abort erasure). Athlete-owned rows cascade; coach-OS actor columns (created_by/author_id/coach_id) SET NULL per 0079 so team artifacts survive with anonymized attribution. The 0034 membership-sync triggers skip a member/team that is itself being erased.';
