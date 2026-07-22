-- 0129 — premium monthly report cache. One final report per (athlete, completed month).
create table if not exists public.monthly_reports (
  athlete_id  uuid not null references profiles(id) on delete cascade,
  period      text not null,               -- 'YYYY-MM' (athlete-local completed month)
  payload     jsonb not null,              -- rendered report: deterministic sections + AI narrative
  created_at  timestamptz not null default now(),
  primary key (athlete_id, period)
);
alter table public.monthly_reports enable row level security;
-- Athlete reads only their own reports; no client insert/update (service-role fn is the only writer).
drop policy if exists monthly_reports_read_own on public.monthly_reports;
create policy monthly_reports_read_own on public.monthly_reports
  for select using (athlete_id = auth.uid());
