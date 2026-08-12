-- OnStandard — Beta star ratings (2026-08-12). The feedback conversation asks each tester,
-- at most once per browser per day, "1 to 5, how's the app treating you?" This is where the
-- answer lands. Same deny-all posture as 0191: RLS on, NO policies, NO grants — the visitor
-- holds a URL token and no session, so the beta-board edge function's service-role client is
-- the only door. device_key is the page's existing per-browser voter id: trivially forgeable
-- by design, these are ten invited testers, and nothing is authorized on its basis.
--
-- Forward-only, idempotent.

create table if not exists beta_ratings (
  id          uuid primary key default gen_random_uuid(),
  device_key  text not null,
  day         date not null default current_date,
  stars       int  not null check (stars between 1 and 5),
  note        text not null default '',
  name        text not null default '',
  tester_set  int,
  created_at  timestamptz not null default now(),
  unique (device_key, day)
);
alter table beta_ratings enable row level security;
revoke all on table beta_ratings from anon, authenticated;

comment on table beta_ratings is
  'Daily 1-5 app rating from beta testers, asked in the feedback conversation (2026-08-12). '
  'Service-role only: RLS on with no policies, by design — see 0191''s header for the pattern. '
  'One row per browser per day; re-rating the same day overwrites.';

-- ROLLBACK: drop table if exists beta_ratings;
