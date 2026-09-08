-- 0227: reporting a person's messages (2026-09-08, first App Store submission)
--
-- App Store Review Guideline 1.2: an app with user-generated content must let a user REPORT
-- objectionable content and BLOCK the person who posted it, and must act on reports promptly.
-- The meal threads, the nutrition chat and team announcements are all user-generated, and until
-- now the only report intake was for marketplace coaches (coach_reports, 0184). This is the
-- same shape pointed at a message: who reported, whom, in which thread, why.
--
-- BLOCKING is client-side and immediate (RT.mutedUsers in state.js; layoutThread drops a muted
-- author's messages on every renderer). Nothing about a mute is stored here: a mute is the
-- reader's own preference on their own device, and a server copy would be one more thing to
-- delete on account erasure. A REPORT is stored, because a person on the OnStandard team has to
-- read it and answer within the window the guideline expects.
--
-- Additive: one table, insert-own and read-own, no change to any existing policy. Reviewed by the
-- founder through the same `--linked` read every other intake uses; an admin section can follow.

create table if not exists public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references profiles(id) on delete cascade,
  -- the person whose message is reported; null when the reporter could not identify them
  subject_id   uuid references profiles(id) on delete set null,
  -- where it happened: a meal thread (meal_id), a team announcement (team_id), or the nutrition
  -- chat (meal_id null, team_id null). comment_id when the renderer knows the exact row.
  meal_id      uuid,
  team_id      uuid references teams(id) on delete set null,
  comment_id   uuid,
  reason       text not null check (reason in ('harassment', 'inappropriate', 'spam', 'safety', 'other')),
  detail       text not null default '',
  status       text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution   text not null default '',
  resolved_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists content_reports_status_idx on public.content_reports (status, created_at);

alter table public.content_reports enable row level security;
revoke all on table public.content_reports from anon, authenticated;
grant select, insert on public.content_reports to authenticated;

drop policy if exists content_reports_own_read on public.content_reports;
create policy content_reports_own_read on public.content_reports
  for select using (reporter_id = auth.uid());

drop policy if exists content_reports_own_insert on public.content_reports;
create policy content_reports_own_insert on public.content_reports
  for insert with check (reporter_id = auth.uid() and status = 'open'
                         and resolution = '' and resolved_by is null and resolved_at is null);
