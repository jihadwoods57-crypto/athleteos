-- OnStandard — Tier 2 Trust & safety: minor-messaging governance gate
--
-- Day-2 shipped athlete<->counterpart messaging whose RLS (0002) allowed ANY thread
-- participant to read/write, with no age or relationship governance — a minor athlete
-- could sit in an unsupervised thread with an arbitrary adult. For the closed beta
-- (HS coaches + their athletes; parents not yet looped in), a minor's only permitted
-- counterpart is an AUTHORIZED relationship: a coach on a team they belong to, a
-- trainer whose practice they are a client of, or an active guardian. Fail-closed: a
-- missing base_age is treated as a minor.
--
-- Mirrors the pure app-layer guard `messagingAllowed` in src/core/messaging.ts (the UI
-- reads that so it never offers a channel this policy would reject); THIS is the real,
-- server-side enforcement.
--
-- NOT runtime-verified by this run (no live DB; do NOT `supabase db push` without the
-- founder's per-migration sign-off, decision D1). Review + run against a LOCAL supabase
-- stack (the path the P0 round-trip used) before applying. See docs/FOUNDER-DECISIONS.md D10.

-- ---------------------------------------------------------------- relationship helpers
-- Parameterized by BOTH parties (the 0002 helpers key on auth.uid(), which is wrong here:
-- when a minor athlete sends in their own thread, auth.uid() is the athlete, not the
-- counterpart, so an auth.uid()-based coach/guardian check would falsely fail). These
-- ask "is `adult` an authorized relationship for `athlete`?" independent of who is acting.
create or replace function is_coach_link(adult uuid, athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members m
    join team_staff s on s.team_id = m.team_id
    where m.athlete_id = athlete and m.status = 'active'
      and s.staff_id = adult and s.status = 'active');
$$;

create or replace function is_trainer_link(adult uuid, athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from practice_clients pc
    join practices p on p.id = pc.practice_id
    where pc.client_id = athlete and pc.status = 'active'
      and p.owner_id = adult);
$$;

create or replace function is_guardian_link(adult uuid, athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardianships g
    where g.athlete_id = athlete and g.guardian_id = adult and g.status = 'active');
$$;

-- Fail-closed minor check: unknown / NULL base_age => treated as a minor.
create or replace function is_minor(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select base_age from athlete_profiles where athlete_id = athlete), 0) < 18;
$$;

-- Is a thread between `t_athlete` and `t_counterpart` a governed-permitted channel?
-- Adult athlete -> always. Minor athlete -> only an authorized coach/trainer/guardian.
create or replace function messaging_authorized(t_athlete uuid, t_counterpart uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    not is_minor(t_athlete)
    or is_coach_link(t_counterpart, t_athlete)
    or is_trainer_link(t_counterpart, t_athlete)
    or is_guardian_link(t_counterpart, t_athlete);
$$;

-- ---------------------------------------------------------------- tighten messaging RLS
-- Replace the 0002 policies: keep the participant check AND add the governance gate so a
-- minor's thread can't be created or written outside an authorized relationship.
drop policy if exists threads_rw on threads;
create policy threads_read on threads for select
  using (athlete_id = auth.uid() or counterpart_id = auth.uid());
create policy threads_write on threads for insert
  with check (
    (athlete_id = auth.uid() or counterpart_id = auth.uid())
    and messaging_authorized(athlete_id, counterpart_id));
create policy threads_update on threads for update
  using (athlete_id = auth.uid() or counterpart_id = auth.uid())
  with check (messaging_authorized(athlete_id, counterpart_id));

drop policy if exists messages_write on messages;
create policy messages_write on messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from threads t where t.id = thread_id
          and (t.athlete_id = auth.uid() or t.counterpart_id = auth.uid())
          and messaging_authorized(t.athlete_id, t.counterpart_id)));
