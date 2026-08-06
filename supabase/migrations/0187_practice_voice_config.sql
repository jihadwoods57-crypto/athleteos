-- OnStandard — AI Nutritionist voice for PRACTICES (2026-08-06). coach_voice_config keys on
-- team_id (PK -> teams FK), so a trainer's practice structurally could not have a voice config —
-- the AI Nutritionist customization page did nothing for a trainer. This is the practice twin:
-- one row per practice, same { tone, level, approved:[], prohibited, length, instructions } config
-- shape, same version bump on real change (reusing 0110's trigger function). Owner-scoped RLS —
-- a practice has exactly one operator (practices.owner_id), no staff table.
-- HARD LIMITS unchanged and enforced in the edge functions: the AI is always labeled as AI, never
-- signs as the trainer, never creates requirements / changes deadlines / alters scores / gives
-- medical advice. Forward-only, idempotent.

create table if not exists practice_voice_config (
  practice_id  uuid primary key references practices(id) on delete cascade,
  enabled      boolean not null default true,
  config       jsonb not null default '{}'::jsonb,  -- { tone, level, approved:[], prohibited, length, instructions }
  version      int not null default 1,
  -- on delete set null so an account erasure (0079) is never blocked by this FK.
  updated_by   uuid references profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);
alter table practice_voice_config enable row level security;

drop policy if exists pvc_owner_read on practice_voice_config;
create policy pvc_owner_read on practice_voice_config
  for select using (exists (select 1 from practices p where p.id = practice_id and p.owner_id = auth.uid()));
drop policy if exists pvc_owner_insert on practice_voice_config;
create policy pvc_owner_insert on practice_voice_config
  for insert with check (exists (select 1 from practices p where p.id = practice_id and p.owner_id = auth.uid()));
drop policy if exists pvc_owner_update on practice_voice_config;
create policy pvc_owner_update on practice_voice_config
  for update using (exists (select 1 from practices p where p.id = practice_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from practices p where p.id = practice_id and p.owner_id = auth.uid()));

-- Direct-write table => explicit grants (RLS is the wall; grants are the door — see the
-- supabase-table-grants gotcha: RLS tests pass without this and the client still 42501s).
grant select, insert, update on practice_voice_config to authenticated;

-- Same bump-on-real-change semantics as coach_voice_config (0110); reuses its trigger function.
drop trigger if exists trg_bump_practice_voice_version on practice_voice_config;
create trigger trg_bump_practice_voice_version
  before update on practice_voice_config
  for each row execute function bump_coach_voice_version();

comment on table practice_voice_config is
  'Per-practice AI Nutritionist voice config { tone, level, approved:[], prohibited, length, instructions }. '
  'The AI is labeled AI, never impersonates the trainer, and never creates requirements / changes deadlines / '
  'alters scores / gives medical advice — enforced in the edge functions, not this table.';
