-- 0135 — Training log: lightweight "did the session + how'd it go + notes" records. Athlete-owned,
-- coach-visible via can_view. TRACKED-NOT-SCORED — completion still rides days.checked_tasks (0112)
-- and the parity-locked score core (day.js computeComponents/scoreFor) never reads either. This
-- table only holds the notes / feel / history that days.checked_tasks ({id:true}) has no room for.
--
-- Coach programming needs NO schema here: a coach session is just a customized title + a free-text
-- `desc` on the existing kind:'lift' item in requirement_sets.items (0055 validate_requirement_items
-- requires only id/title/kind/proof and ignores extra keys).

create table if not exists public.training_logs (
  id             uuid primary key default gen_random_uuid(),
  athlete_id     uuid not null references profiles(id) on delete cascade,
  log_date       date not null default (now() at time zone 'utc')::date,
  title          text,
  note           text,
  feel           smallint check (feel between 1 and 5),   -- optional "how'd it go" 1-5
  source         text not null default 'self' check (source in ('coach','self')),
  requirement_id text,                                     -- optional link to the programmed lift item
  created_at     timestamptz not null default now()
);
create index if not exists training_logs_athlete_idx on public.training_logs(athlete_id, log_date desc);

alter table public.training_logs enable row level security;

-- read: athlete or any active link (coach/trainer/parent). insert/update/delete: owner only.
drop policy if exists training_logs_read on public.training_logs;
create policy training_logs_read on public.training_logs
  for select using (athlete_id = auth.uid() or can_view(athlete_id));
drop policy if exists training_logs_insert on public.training_logs;
create policy training_logs_insert on public.training_logs
  for insert with check (athlete_id = auth.uid());
drop policy if exists training_logs_update on public.training_logs;
create policy training_logs_update on public.training_logs
  for update using (athlete_id = auth.uid());
drop policy if exists training_logs_delete on public.training_logs;
create policy training_logs_delete on public.training_logs
  for delete using (athlete_id = auth.uid());

-- 0013 revoked the default authenticated write grants; RLS alone still 42501s without this.
grant insert, update, delete on public.training_logs to authenticated;
