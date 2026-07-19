-- OnStandard — per-team Trust Pass defaults (length + eligibility) layered over the existing engine
-- (0033 trust_passes / 0039 eligibility). Additive: a team with no row uses the shipped defaults
-- (a 10-day pass earned after 7 on-standard photo-logged days), so nothing changes until a coach
-- configures it. The server eligibility check in the grant path remains the authoritative wall —
-- this table only supplies the coach-chosen defaults a future grant reads. Staff-scoped RLS.
-- Forward-only, idempotent.

create table if not exists trust_pass_policy (
  team_id           uuid primary key references teams(id) on delete cascade,
  length_days       int not null default 10 check (length_days between 1 and 60),
  eligibility_days  int not null default 7  check (eligibility_days between 1 and 30),
  updated_by        uuid references profiles(id),
  updated_at        timestamptz not null default now()
);
alter table trust_pass_policy enable row level security;

drop policy if exists tpp_staff_read on trust_pass_policy;
create policy tpp_staff_read on trust_pass_policy
  for select using (is_team_staff(team_id));
drop policy if exists tpp_staff_insert on trust_pass_policy;
create policy tpp_staff_insert on trust_pass_policy
  for insert with check (is_team_staff(team_id));
drop policy if exists tpp_staff_update on trust_pass_policy;
create policy tpp_staff_update on trust_pass_policy
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));

comment on table trust_pass_policy is
  'Per-team Trust Pass defaults (length_days, eligibility_days). No row = shipped defaults. The '
  'server eligibility check in the grant path stays authoritative; this only supplies coach defaults.';
