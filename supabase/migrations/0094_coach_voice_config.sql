-- OnStandard — Coach Voice config (tone / accountability level / approved phrases / prohibited
-- words), one row per team. The AI edge function reads this to reinforce the coach's standards in
-- their tone — the consumer wiring is a SEPARATE change; this migration only persists the config a
-- coach sets. HARD LIMITS (enforced in the edge function, not here): the AI is always labeled as AI,
-- never signs as the coach, and never creates requirements, changes deadlines, alters scores, or
-- gives medical advice. Staff-scoped RLS. Forward-only, idempotent.

create table if not exists coach_voice_config (
  team_id     uuid primary key references teams(id) on delete cascade,
  enabled     boolean not null default true,
  config      jsonb not null default '{}'::jsonb,  -- { tone, level, approved:[], prohibited }
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now()
);
alter table coach_voice_config enable row level security;

drop policy if exists cvc_staff_read on coach_voice_config;
create policy cvc_staff_read on coach_voice_config
  for select using (is_team_staff(team_id));
drop policy if exists cvc_staff_insert on coach_voice_config;
create policy cvc_staff_insert on coach_voice_config
  for insert with check (is_team_staff(team_id));
drop policy if exists cvc_staff_update on coach_voice_config;
create policy cvc_staff_update on coach_voice_config
  for update using (is_team_staff(team_id)) with check (is_team_staff(team_id));

comment on table coach_voice_config is
  'Per-team Coach Voice config { tone, level, approved:[], prohibited }. The AI is labeled AI, never '
  'impersonates the coach, and never creates requirements / changes deadlines / alters scores / gives '
  'medical advice — enforced in the edge function, not this table.';
