-- OnStandard — 0197: the trainer's book gets what the coach's book already had.
--
-- (1) practice_setup_state — the trainer's first-run checklist never persisted (founder pass,
--     2026-08-10): act.markCoachSetup only wrote coach_setup_state when a TEAM id existed, and
--     fetchCoachSetupState only read by team_id, so a trainer's "Finish setting up your practice"
--     progress lived in local RT alone and RESURRECTED on every reinstall or new device — the
--     checklist a trainer had finished kept coming back. Mirror of 0092, keyed to the practice,
--     staff-scoped via is_practice_staff (0136). Forward-only, idempotent.
--
-- (2) practices.discipline — the Nutrition Pro onboarding (ob2-nutrition) lands its graduate on
--     the trainer dashboard with server role 'trainer' and NO durable signal that this operator
--     is a dietitian/nutritionist, so nothing downstream can ever render their lens. One column,
--     written at create_practice time, readable by the same surfaces that read the practice.
--     'training' is every existing row's truth; 'nutrition' is the RD/dietitian lane (any sport —
--     the discipline is about what the operator does, not who they serve).

create table if not exists practice_setup_state (
  practice_id uuid not null references practices(id) on delete cascade,
  -- client step keys (RT.coachSetup), verbatim — same contract as coach_setup_state (0092).
  step        text not null check (step in ('sharedCode','standard','notif','staff','group')),
  state       text not null default 'not_started'
                check (state in ('not_started','in_progress','completed','skipped','failed')),
  -- on delete set null: right-to-erasure must never be blocked by a bookkeeping row (0079 rule).
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (practice_id, step)
);
alter table practice_setup_state enable row level security;

drop policy if exists pss_staff_read on practice_setup_state;
create policy pss_staff_read on practice_setup_state
  for select using (is_practice_staff(practice_id));
drop policy if exists pss_staff_insert on practice_setup_state;
create policy pss_staff_insert on practice_setup_state
  for insert with check (is_practice_staff(practice_id));
drop policy if exists pss_staff_update on practice_setup_state;
create policy pss_staff_update on practice_setup_state
  for update using (is_practice_staff(practice_id)) with check (is_practice_staff(practice_id));

-- 0098's lesson, permanent: RLS is not a grant. A new table without an explicit grant 42501s
-- through PostgREST for every authenticated user no matter what the policies say.
grant select, insert, update on practice_setup_state to authenticated;

comment on table practice_setup_state is
  'Per-practice trainer first-run setup steps (mirror of coach_setup_state/0092). Required '
  'completion is derived from real signals; this table syncs progress across the trainer''s devices.';

-- ---------------------------------------------------------------- practice discipline

alter table practices add column if not exists discipline text not null default 'training'
  check (discipline in ('training', 'nutrition'));

comment on column practices.discipline is
  'What this operator does: ''training'' (trainer) or ''nutrition'' (team dietitian / nutritionist, '
  'any sport). Written once by create_practice from the onboarding flow the owner chose.';

-- create_practice grows a defaulted p_discipline. The old 3-arg signature must be DROPPED, not
-- shadowed: with both signatures live, a named-args PostgREST call that omits the new parameter
-- matches both overloads and 300s. (Function-drop lesson from the 0110-era punchlist: dropping
-- also drops its grants, so they are restated below.)
drop function if exists create_practice(text, text, boolean);

create or replace function create_practice(
  practice_name text,
  practice_handle text default null,
  is_discoverable boolean default false,
  p_discipline text default 'training'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create a practice';
  end if;
  new_code := gen_join_code();
  insert into practices (owner_id, name, join_code, handle, discoverable, discipline)
  values (auth.uid(), coalesce(nullif(practice_name, ''), 'My Practice'),
          new_code, nullif(practice_handle, ''), coalesce(is_discoverable, false),
          case when p_discipline in ('training', 'nutrition') then p_discipline else 'training' end);
  return new_code;
end; $$;

revoke all on function create_practice(text, text, boolean, text) from public, anon;
grant execute on function create_practice(text, text, boolean, text) to authenticated;
