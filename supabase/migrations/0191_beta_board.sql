-- OnStandard — Beta Feedback Board (2026-08-06). TestFlight external testing needs a place for
-- testers to report what they hit, and the founder needs it to arrive already sorted. The app's
-- existing feedback screen writes support_tickets one at a time: six people hitting the same slow
-- photo upload read as six unrelated tickets. This is the beta-only twin — posts collapse into
-- THEMES, themes rank by severity then heat, and testers can see their report landed.
--
-- SCOPE: this is NOT the product. It is a side surface reached by a secret link, handed out with
-- the TestFlight invite, and retired with the beta. The 2026-07-29 decision NOT to build a public
-- idea board inside the app still stands — a visible feed of other users' submissions collides with
-- the "no team feed, no leaderboard" promise in Settings. No real user ever reaches this.
--
-- SECURITY MODEL — READ BEFORE ADDING A POLICY:
-- RLS is enabled on all three tables with NO POLICIES AT ALL, and there are NO grants to anon or
-- authenticated. That is deliberate, not an oversight, and it is the opposite of the usual
-- supabase-table-grants gotcha. The board page holds no Supabase session — the visitor is an
-- anonymous browser with a URL token — so a policy keyed on auth.uid() would be meaningless and
-- `grant ... to anon` would be a real hole (anyone with the publishable key could read and write
-- every row). Everything goes through the beta-board edge function's service-role client, which
-- bypasses RLS, after it has verified BETA_BOARD_KEY. Deny-everything plus one server door.
--
-- Forward-only, idempotent.

-- ---------------------------------------------------------------------------------------------
-- Themes: the unit the founder actually reads. One row per distinct issue.
-- ---------------------------------------------------------------------------------------------
create table if not exists beta_themes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  summary     text not null default '',
  -- what KIND of feedback this is; drives the badge on the board and nothing else.
  kind        text not null default 'bug'
                check (kind in ('bug', 'confusing', 'idea', 'praise')),
  -- 1 (cosmetic) .. 5 (crash / data loss). Set once by the AI at theme creation from a single
  -- report, before anyone else has weighed in — the founder can override it.
  severity    int not null default 3 check (severity between 1 and 5),
  status      text not null default 'open'
                check (status in ('open', 'fixing', 'shipped', 'wontdo')),
  -- Denormalized counters so the board is one SELECT. Kept true by the edge function.
  post_count  int not null default 0,
  vote_count  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table beta_themes enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Posts: what the tester actually typed, kept VERBATIM. The theme summary is a convenience and
-- never a replacement for the words — a founder reading a cluster must be able to see the raw
-- report that produced it.
-- ---------------------------------------------------------------------------------------------
create table if not exists beta_posts (
  id           uuid primary key default gen_random_uuid(),
  -- on delete set null so deleting a bad cluster never destroys the reports inside it; the post
  -- falls back to unsorted and can be re-triaged.
  theme_id     uuid references beta_themes(id) on delete set null,
  author_name  text not null default 'Anonymous',
  body         text not null,
  app_version  text,
  created_at   timestamptz not null default now()
);
alter table beta_posts enable row level security;
create index if not exists beta_posts_theme_idx on beta_posts(theme_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Votes: "this happened to me too". voter_id is a random id the browser generates and keeps in
-- localStorage — trivially bypassable by design. These are people who were handed an invite link;
-- ballot-stuffing a beta board has no prize, and the alternative is a login wall in front of
-- leaving feedback.
-- ---------------------------------------------------------------------------------------------
create table if not exists beta_votes (
  theme_id   uuid not null references beta_themes(id) on delete cascade,
  voter_id   text not null,
  created_at timestamptz not null default now(),
  primary key (theme_id, voter_id)
);
alter table beta_votes enable row level security;

-- Defense-in-depth over the 0005 DEFAULT PRIVILEGE, which hands `authenticated` a blanket SELECT on
-- every new table in public. RLS-with-no-policies already returns zero rows to that role, so this
-- revoke changes no behaviour today — it means a future migration that adds a policy for an
-- unrelated reason cannot accidentally open the whole board. Same posture as ai_usage_key_daily (0030).
revoke all on table beta_themes from anon, authenticated;
revoke all on table beta_posts  from anon, authenticated;
revoke all on table beta_votes  from anon, authenticated;

comment on table beta_themes is
  'Beta Feedback Board — one row per distinct issue, AI-clustered from beta_posts. Ranked severity '
  'desc then heat (2*votes + posts). Service-role only: RLS on with no policies, by design (see 0191 header).';
comment on table beta_posts is
  'Beta Feedback Board — raw tester reports, kept verbatim. Service-role only.';
comment on table beta_votes is
  'Beta Feedback Board — one "me too" per browser per theme. voter_id is a localStorage id, not an account.';

-- ROLLBACK:
--   drop table if exists beta_votes;
--   drop table if exists beta_posts;
--   drop table if exists beta_themes;
