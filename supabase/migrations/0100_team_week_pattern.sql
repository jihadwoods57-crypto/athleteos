-- OnStandard — per-team weekly training/rest pattern (the source that resolves day-type scoring).
--
-- 0086 added an optional dayType (any/training/rest) to requirement items but "resolution is a
-- later slice": the app had no way to know whether TODAY is a training or a rest day. This supplies
-- it. One row per team holds a 7-element pattern indexed by day-of-week (0=Sunday .. 6=Saturday);
-- the athlete's client reads it and drops items whose dayType doesn't match the day being scored
-- (requirements.js filterItemsByDayType). No row = no gating: every item applies every day, so the
-- scored day is unchanged until a coach sets a pattern (parity).
--
-- RLS: team MEMBERS read (their own scored day depends on it) and staff read+write. Forward-only,
-- idempotent.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (founder applies via
-- `supabase db push` + `npm run test:rls` at the next go-live batch).

create table if not exists team_week_pattern (
  team_id    uuid primary key references teams(id) on delete cascade,
  -- 7 strings, index 0=Sun .. 6=Sat, each 'training' | 'rest'. Default = a full training week
  -- (the same "every item applies" behavior as no row, made explicit once a coach opens the editor).
  pattern    jsonb not null default '["training","training","training","training","training","training","training"]'::jsonb
    check (jsonb_typeof(pattern) = 'array' and jsonb_array_length(pattern) = 7),
  -- on delete set null so a staff member's account erasure (0079) is never blocked by this FK.
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table team_week_pattern enable row level security;

-- Members (athletes on the team) may read their team's pattern; staff may read it too.
drop policy if exists twp_read on team_week_pattern;
create policy twp_read on team_week_pattern
  for select using (
    is_team_staff(team_id)
    or exists (
      select 1 from team_members m
      where m.team_id = team_week_pattern.team_id
        and m.athlete_id = auth.uid() and m.status = 'active')
  );
drop policy if exists twp_staff_insert on team_week_pattern;
create policy twp_staff_insert on team_week_pattern
  for insert with check (is_team_staff(team_id));
drop policy if exists twp_staff_update on team_week_pattern;
create policy twp_staff_update on team_week_pattern
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));

comment on table team_week_pattern is
  'Per-team weekly training/rest pattern (jsonb array[7], 0=Sun..6=Sat). Resolves requirement-item '
  'dayType (0086) for the scored day. No row = no gating (every item applies every day).';
