-- OnStandard — Trust Pass. An earned, coach-granted camera-free reward (a proven athlete's daily
-- one-tap credits his own trailing nutrition median instead of a photo). A coach grants a pass to a
-- LINKED athlete; the athlete can READ their own pass but can NEVER write one (no self-grant). All
-- writes go through SECURITY DEFINER RPCs so server-side eligibility (>=7 real on-standard days) and
-- the coach-link are enforced. See docs/council/2026-07-02-trust-pass.md.
create table trust_passes (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references profiles(id) on delete cascade,
  granted_by   uuid not null references profiles(id) on delete cascade,
  granted_date date not null default (now() at time zone 'utc')::date,
  length_days  int  not null default 10 check (length_days between 1 and 60),
  ended_at     timestamptz,                       -- non-null once revoked / ended early
  created_at   timestamptz not null default now()
);
create index trust_passes_athlete on trust_passes(athlete_id, created_at desc);
-- At most one live (un-ended) pass per athlete.
create unique index trust_passes_one_active on trust_passes(athlete_id) where ended_at is null;

alter table trust_passes enable row level security;

-- Athlete reads their own passes; a linked team coach reads passes for their athletes. There is
-- deliberately NO insert/update/delete policy: the SECURITY DEFINER RPCs below are the only writers,
-- so an athlete can never self-grant by writing the table directly.
create policy trust_passes_read on trust_passes
  for select using (athlete_id = auth.uid() or is_team_coach_of(athlete_id));

-- Grant a pass to a linked athlete. Coach-only (must be the athlete's active team coach) and the
-- athlete must have >= p_min_on_standard real on-standard (score >= 80) days on record — proof he
-- built a baseline, so a pass can never be earned from nothing. Ends any active pass first (the
-- partial unique index guarantees one live pass). Returns the new pass id.
create or replace function grant_trust_pass(p_athlete uuid, p_length int default 10, p_min_on_standard int default 7)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on_standard int;
  v_id uuid;
begin
  if not is_team_coach_of(p_athlete) then
    raise exception 'not authorized to grant a trust pass to this athlete';
  end if;
  if p_length < 1 or p_length > 60 then
    raise exception 'invalid pass length';
  end if;
  select count(*) into v_on_standard from days d where d.athlete_id = p_athlete and d.score >= 80;
  if v_on_standard < p_min_on_standard then
    raise exception 'athlete not eligible: % of % on-standard days', v_on_standard, p_min_on_standard;
  end if;
  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;
  insert into trust_passes (athlete_id, granted_by, length_days)
    values (p_athlete, auth.uid(), p_length)
    returning id into v_id;
  return v_id;
end;
$$;

-- End (revoke) the athlete's active pass. Coach-only. Idempotent (no-op if none active).
create or replace function end_trust_pass(p_athlete uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_team_coach_of(p_athlete) then
    raise exception 'not authorized to end this athlete''s trust pass';
  end if;
  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;
end;
$$;

grant execute on function grant_trust_pass(uuid, int, int) to authenticated;
grant execute on function end_trust_pass(uuid) to authenticated;
