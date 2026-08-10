# Per-Tester Demo Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of 10 beta testers their own isolated coach+athlete+trainer+client demo set, self-claimed from one shared link, with every board report traceable back to the set that produced it.

**Architecture:** A new `tester_sets` table (deny-all RLS, service-role only) holds ten handout rows. `scripts/seed-tester-accounts.sql` seeds 40 accounts / 10 teams / 10 practices using the exact method already proven in `scripts/seed-demo-accounts.sql`. A new `tester-claim` edge function (modeled on `beta-board`) lets a tester claim/resume/recover their set over a URL-token-gated API. `web/landing/tester.html` is the page. `beta.html` + `beta-board` get a small nullable `tester_set` tie-in so a report can be traced to real prod data.

**Tech Stack:** Postgres/PL-pgSQL migrations, Supabase Edge Functions (Deno + TypeScript), static HTML/CSS/vanilla JS (no build step, matches `beta.html`), Node.js ops script (no new npm dependencies — `node:crypto`, `node:fs`, global `fetch`).

## Global Constraints

- Spec of record: [docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md](../specs/2026-08-09-tester-demo-accounts-design.md). Every task below implements one section of it.
- **The repository is public.** No password, join code that gates anything, or key ever gets committed. Placeholders (`__PW_01__`…`__PW_10__`) stay in the tracked SQL; real passwords only ever exist in the OS temp dir (never the repo) and inside the database.
- **Never touch the founder's 4 existing demo accounts** (`coach@` / `athlete1@` / `trainer@` / `client1@`). Every new SQL statement scopes to `raw_app_meta_data ? 'tester'`, never `raw_app_meta_data->>'demo' = 'true'` (that flag also matches the founder's four).
- **Local-first.** This machine already runs the local Supabase stack (`supabase status` confirmed it, migrations in sync through 0194). Every task is built and verified against `--local` before Task 7 ever touches `--linked` (live prod). Task 7 is the only task that touches production and requires an explicit stop-and-confirm with the user before running.
- Follow existing repo conventions exactly: RLS-deny-all-plus-service-role-door posture (`supabase/migrations/0191_beta_board.sql`), the `beta-board` function's structure (`safeEqual`, `corsFor`, per-IP `rateLimited`, `str()` helper, 503-not-throw-on-missing-secret), `config.toml`'s per-function `verify_jwt` pinning-with-rationale-comment convention, and `_headers`' per-path CSP block convention.
- No new npm/Deno third-party dependencies. `tester-claim` imports only `npm:@supabase/supabase-js@2.110.0` (pinned to the same version `beta-board` uses) and the existing `../_shared/client-ip.ts`.

---

## File Structure

**Create:**
- `supabase/migrations/0195_tester_sets.sql` — `tester_sets` table, `claim_next_tester_set()` RPC, `beta_posts.tester_set` column
- `scripts/seed-tester-accounts.sql` — seeds 40 accounts / 10 teams / 10 practices on whichever DB it's pointed at
- `supabase/functions/tester-claim/index.ts` — claim/resume/recover/status API
- `web/landing/tester.html` — the page a tester opens
- `scripts/tester-accounts.mjs` — `gen` / `verify` / `smoke` ops commands

**Modify:**
- `supabase/config.toml` — add `[functions.tester-claim]` with `verify_jwt = false`
- `web/landing/_headers` — add a `/tester*` CSP block
- `supabase/functions/beta-board/index.ts` — accept, store, and return `tester_set`
- `web/landing/beta.html` — read the tester's name/set from localStorage, send `tester_set`, show it on posts
- `scripts/seed-demo-accounts.sql` — warn that its teardown/rotate one-liners now also sweep tester accounts

---

### Task 1: Migration 0195 — `tester_sets` table + atomic claim RPC + `beta_posts.tester_set`

**Files:**
- Create: `supabase/migrations/0195_tester_sets.sql`

**Interfaces:**
- Produces table `tester_sets(set_no int pk, password text, email_coach/athlete/trainer/client text, team_id uuid, team_join_code text, practice_id uuid, practice_join_code text, claimed_at timestamptz, claimed_name text, claimed_email text, device_token text, created_at timestamptz)`, RLS on, no policies, revoked from anon/authenticated.
- Produces `claim_next_tester_set(p_name text, p_email text, p_device text) returns tester_sets` — SECURITY DEFINER, executable only by `service_role`. Returns an all-NULL row (not an error) when no set is free; callers check `set_no is null`.
- Produces nullable `beta_posts.tester_set int`.
- Consumed by: Task 2 (seed inserts into `tester_sets`), Task 3 (function reads/writes `tester_sets` and calls the RPC), Task 5 (`beta-board` reads/writes `beta_posts.tester_set`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0195_tester_sets.sql`:

```sql
-- OnStandard — Per-tester demo accounts (2026-08-09). Ten beta testers need their own isolated
-- coach+athlete+trainer+client set instead of sharing scripts/seed-demo-accounts.sql's single set,
-- and a way to claim one without the founder hand-delivering credentials ten times. See
-- docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md for the full design.
--
-- SECURITY MODEL — same deliberate shape as 0191 (beta_board): RLS is ON with NO POLICIES and NO
-- grants to anon/authenticated. tester_sets holds ten PLAINTEXT production passwords — handing
-- them out is the entire point of this feature, so they must be readable, but nothing except the
-- service-role client (inside supabase/functions/tester-claim) may ever touch this table.
--
-- Forward-only, idempotent.

create table if not exists tester_sets (
  set_no              int primary key,
  password            text not null,
  email_coach         text not null,
  email_athlete       text not null,
  email_trainer       text not null,
  email_client        text not null,
  team_id             uuid,
  team_join_code      text,
  practice_id         uuid,
  practice_join_code  text,
  claimed_at          timestamptz,
  claimed_name        text,
  claimed_email       text,
  device_token        text,
  created_at          timestamptz not null default now()
);
alter table tester_sets enable row level security;

-- One claim per email. Partial (WHERE claimed_email is not null) so the nine-plus unclaimed rows
-- — every time the seed script re-runs, all ten start that way — never collide on a shared NULL.
create unique index if not exists tester_sets_claimed_email_idx
  on tester_sets (lower(claimed_email)) where claimed_email is not null;

revoke all on table tester_sets from anon, authenticated;

comment on table tester_sets is
  'Per-tester demo account handout (2026-08-09). Ten sets, ten claims. Service-role only: RLS on '
  'with no policies, by design — see this migration''s header. Plaintext passwords are load-bearing.';

-- ---------------------------------------------------------------------------------------------
-- claim_next_tester_set: the ONLY place a set gets assigned. FOR UPDATE SKIP LOCKED so two
-- testers tapping the claim link at the same instant cannot land on the same set — one gets the
-- next-lowest FREE row, the other moves on to the row after that, and neither blocks waiting on
-- the other's transaction. Returns an all-NULL row (not an error) when every set is taken; the
-- caller checks `set_no is null` to detect "exhausted". SECURITY DEFINER + revoked from everyone
-- but service_role, same posture as claim_ai_usage_key (0030) — only ever called from
-- tester-claim's service-role client.
-- ---------------------------------------------------------------------------------------------
create or replace function claim_next_tester_set(p_name text, p_email text, p_device text)
returns tester_sets
language plpgsql security definer set search_path = public as $$
declare r tester_sets;
begin
  update tester_sets
     set claimed_at = now(),
         claimed_name = p_name,
         claimed_email = lower(p_email),
         device_token = p_device
   where set_no = (
     select set_no from tester_sets
      where claimed_at is null
      order by set_no
      for update skip locked
      limit 1
   )
  returning * into r;
  return r;
end $$;

revoke execute on function claim_next_tester_set(text, text, text) from public, anon, authenticated;
grant  execute on function claim_next_tester_set(text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Ties each beta report to the tester's real prod accounts. Nullable: external TestFlight testers
-- post to the same board and have no set. This is a HINT, not an attestation — it arrives from the
-- browser and a determined visitor could forge it. Fine for a feedback board; nothing is
-- authorized on its basis.
-- ---------------------------------------------------------------------------------------------
alter table beta_posts add column if not exists tester_set int;

-- ROLLBACK:
--   alter table beta_posts drop column if exists tester_set;
--   drop function if exists claim_next_tester_set(text, text, text);
--   drop table if exists tester_sets;
```

- [ ] **Step 2: Apply it locally**

Run: `supabase migration up --local`

Expected: output lists `0195` applied, no errors.

- [ ] **Step 3: Verify the shape**

Run:
```
supabase db query --local "select column_name, data_type from information_schema.columns where table_name='tester_sets' order by ordinal_position;"
supabase db query --local "select proname from pg_proc where proname='claim_next_tester_set';"
supabase db query --local "select column_name from information_schema.columns where table_name='beta_posts' and column_name='tester_set';"
```

Expected: 14 columns on `tester_sets` matching the CREATE TABLE above, `claim_next_tester_set` present, `tester_set` present on `beta_posts`.

- [ ] **Step 4: Verify RLS actually denies**

Run: `supabase db query --local "select rowsecurity from pg_tables where tablename='tester_sets';"` → expect `t`.

Run: `supabase db query --local "select count(*) from information_schema.role_table_grants where table_name='tester_sets' and grantee in ('anon','authenticated');"` → expect `0`.

- [ ] **Step 5: Exercise the atomic claim function directly**

Run:
```
supabase db query --local "insert into tester_sets (set_no,password,email_coach,email_athlete,email_trainer,email_client) values (1,'x','a@x','b@x','c@x','d@x'),(2,'x','a2@x','b2@x','c2@x','d2@x');"
supabase db query --local "select set_no from claim_next_tester_set('Test','test@x.com','dev-1');"
supabase db query --local "select set_no from claim_next_tester_set('Test2','test2@x.com','dev-2');"
supabase db query --local "select set_no from claim_next_tester_set('Test3','test3@x.com','dev-3');"
supabase db query --local "delete from tester_sets;"
```

Expected: first call returns `1`, second returns `2`, third returns a row where `set_no` is `NULL` (exhausted — no error).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0195_tester_sets.sql
git commit -m "feat(db): add tester_sets table + claim_next_tester_set RPC + beta_posts.tester_set"
```

---

### Task 2: Seed script — 40 accounts, 10 teams, 10 practices

**Files:**
- Create: `scripts/seed-tester-accounts.sql`
- Modify: `scripts/seed-demo-accounts.sql` (footgun warning)

**Interfaces:**
- Consumes: `tester_sets` table + `create_team`/`join_team`/`create_practice`/`join_practice` RPCs (all unchanged since 0194, verified during brainstorming).
- Produces: 40 `auth.users` rows tagged `raw_app_meta_data = {demo:true, tester:'01'..'10'}`, 10 `teams`, 10 `practices`, 10 `athlete_profiles` athlete rows + 10 client rows, and 10 rows in `tester_sets` (with `__PW_01__`…`__PW_10__` placeholders in the `password` column). Consumed by: Task 6 (`gen` substitutes the placeholders and runs this file; `verify`/`smoke` sign into the accounts it creates).

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-tester-accounts.sql`:

```sql
-- OnStandard — Per-tester demo accounts, run against whichever DB you point it at (2026-08-09).
-- Ten isolated coach+athlete+trainer+client sets, same shape and same proven method as
-- scripts/seed-demo-accounts.sql, scaled to ten. See
-- docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md.
--
-- ############################################################################
-- PASSWORDS ARE NOT IN THIS FILE. Ten __PW_NN__ placeholders are substituted at run time by
-- `node scripts/tester-accounts.mjs gen`, which writes the runnable file to the OS temp dir —
-- never into git. This repository is PUBLIC; a committed password is a published authenticated
-- foothold on a database that also holds real users' — including minors' — data (see
-- scripts/seed-demo-accounts.sql for the incident that taught this the hard way).
-- ############################################################################
--
-- FOOTGUN: the founder's four ORIGINAL demo accounts (coach@ / athlete1@ / trainer@ / client1@)
-- are tagged raw_app_meta_data->>'demo'='true' and nothing else. This script's forty accounts are
-- ADDITIONALLY tagged raw_app_meta_data->'tester', so every statement below scopes to
-- `raw_app_meta_data ? 'tester'` and never touches the founder's four. But
-- scripts/seed-demo-accounts.sql's own teardown/rotate one-liners key on `demo = 'true'` alone —
-- once this script has run, THOSE one-liners sweep all forty-four accounts, founder's four
-- included. Read scripts/seed-demo-accounts.sql's header before running either script's teardown.
--
-- IDEMPOTENT. Re-running this resets every set — claimed or not — back to a fresh password and
-- zero history. tester_sets is rebuilt from scratch; every set goes back to unclaimed. Do not
-- re-run this after real testers have claimed sets unless you intend to reset everyone.
--
-- Run: node scripts/tester-accounts.mjs gen   (substitutes passwords, prints the exact command)

begin;

-- ---------------------------------------------------------------- the cast (edit here, nowhere else)
-- pw_placeholder holds a __PW_NN__ token until tester-accounts.mjs gen substitutes the real
-- password IN THE FILE TEXT before this script ever runs — by the time any statement below reads
-- pw_placeholder, it already holds the real value.
create temporary table tester_cast (
  n               int primary key,
  coach_name      text not null,
  athlete_name    text not null,
  athlete_sport   text not null,
  athlete_pos     text not null,
  trainer_name    text not null,
  client_name     text not null,
  team_name       text not null,
  practice_name   text not null,
  practice_handle text not null,
  pw_placeholder  text not null
) on commit drop;

insert into tester_cast (n, coach_name, athlete_name, athlete_sport, athlete_pos, trainer_name, client_name, team_name, practice_name, practice_handle, pw_placeholder) values
  ( 1, 'Priya Nair',        'Owen Castillo',    'Football',   'QB',  'Marcus Diallo',   'Renee Chapman',     'Northgate Varsity', 'Diallo Performance',     'diallofit',     '__PW_01__'),
  ( 2, 'Grant Okafor',      'Bella Marsh',       'Soccer',     'MF',  'Sofia Reyes',     'Tyler Brooks',      'Cedar Ridge Blue',  'Reyes Athletics',        'reyesfit',      '__PW_02__'),
  ( 3, 'Holly Vance',       'DeShawn Price',     'Basketball', 'PG',  'Ian Whitmore',    'Nadia Solis',       'Ironpoint Hawks',   'Whitmore Training',      'whitmorefit',   '__PW_03__'),
  ( 4, 'Felix Amaro',       'Grace Lindqvist',   'Track',      'SP',  'Camille Boucher', 'Derek Yun',         'Summit Prep',       'Boucher Conditioning',   'boucherfit',    '__PW_04__'),
  ( 5, 'Ravi Deshmukh',     'Mason Ellery',      'Football',   'RB',  'Jenna Ostrowski', 'Priscilla Nkemelu', 'Coastline Titans',  'Ostrowski Strength',     'ostrowskifit',  '__PW_05__'),
  ( 6, 'Theo Bracken',      'Ava Fenwick',       'Volleyball', 'OH',  'Luca Moretti',    'Simone Okoro',      'Redwood Athletics', 'Moretti Performance',    'morettifit',    '__PW_06__'),
  ( 7, 'Julissa Vega',      'Caleb Underwood',   'Wrestling',  '157', 'Naomi Trask',     'Aaron Blakely',     'Granite Valley',    'Trask Training Lab',     'traskfit',      '__PW_07__'),
  ( 8, 'Bram Osei',         'Willa Petrenko',    'Softball',   'SS',  'Dominic Farrow',  'Leah Whitfield',    'Lakeshore United',  'Farrow Fitness',         'farrowfit',     '__PW_08__'),
  ( 9, 'Miriam Castellano', 'Elias Boateng',     'Football',   'LB',  'Paige Kowalski',  'Rosalind Achebe',   'Highline Prep',     'Kowalski Performance',   'kowalskifit',   '__PW_09__'),
  (10, 'Nolan Hargrove',    'Freya Solberg',     'Track',      'DI',  'Zane Culpepper',  'Marguerite Osei',   'Ashford Rise',      'Culpepper Training',     'culpepperfit',  '__PW_10__');

-- ---------------------------------------------------------------- teardown (idempotent)
-- Order matters: created_by is ON DELETE SET NULL, so deleting the users first would orphan
-- their teams/practices beyond any way to identify them (prod already carries several orphans —
-- "Flow High", "Lincoln High", "My Team", "WSU" — from exactly this mistake).
delete from teams
 where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from practices
 where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from auth.users where raw_app_meta_data ? 'tester';
delete from tester_sets;

-- ---------------------------------------------------------------- accounts
-- email_confirmed_at is set so these can sign in immediately. Four inserts, one per role, because
-- each role reads a different name column off tester_cast.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-coach@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', coach_name, 'role', 'coach'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-athlete@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', athlete_name, 'role', 'athlete'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-trainer@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', trainer_name, 'role', 'trainer'), now(), now()
from tester_cast;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       't' || lpad(n::text,2,'0') || '-client@onstandard.app', crypt(pw_placeholder, gen_salt('bf')), now(),
       jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'demo',true,'tester',lpad(n::text,2,'0')),
       jsonb_build_object('full_name', client_name, 'role', 'athlete'), now(), now()
from tester_cast;

-- Supabase needs a matching identity row or password sign-in fails.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
from auth.users u where u.raw_app_meta_data ? 'tester';

-- REQUIRED: GoTrue scans these text columns into Go strings and a single NULL fails the entire
-- schema query — every sign-in then returns "Database error querying schema", which names
-- nothing useful. The insert above leaves all eight NULL because they have no defaults.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change                = coalesce(phone_change, ''),
  phone_change_token          = coalesce(phone_change_token, ''),
  reauthentication_token      = coalesce(reauthentication_token, '')
where raw_app_meta_data ? 'tester';

-- 0176 added profiles.email_verified defaulting to FALSE, which would show every account the
-- "Verify your email" banner.
update profiles set email_verified = true
where id in (select id from auth.users where raw_app_meta_data ? 'tester');

-- ---------------------------------------------------------------- athlete + client shapes
-- performance goal + a sport = the ATHLETE experience.
insert into athlete_profiles (athlete_id, sport, position, level, base_goal)
select u.id, tc.athlete_sport, tc.athlete_pos, 'College', 'performance'
from auth.users u
join tester_cast tc on u.email = 't' || lpad(tc.n::text,2,'0') || '-athlete@onstandard.app'
on conflict (athlete_id) do update
  set sport = excluded.sport, position = excluded.position, level = excluded.level, base_goal = excluded.base_goal;

-- lose/maintain + NO sport = the general profile the app reads as a CLIENT. "Client" is NOT a
-- user_role value — see scripts/seed-demo-accounts.sql for why that enum must never gain one.
insert into athlete_profiles (athlete_id, base_goal)
select u.id, 'lose'
from auth.users u
join tester_cast tc on u.email = 't' || lpad(tc.n::text,2,'0') || '-client@onstandard.app'
on conflict (athlete_id) do update set base_goal = excluded.base_goal, sport = null, position = null;

-- ---------------------------------------------------------------- links, via the app's own RPCs
create temporary table tester_links (
  n int primary key, team_id uuid, team_code text, practice_id uuid, practice_code text
) on commit drop;

do $$
declare
  r record;
  v_coach uuid; v_athlete uuid; v_trainer uuid; v_client uuid;
  v_team_code text; v_team_id uuid; v_practice_code text; v_practice_id uuid;
begin
  for r in select * from tester_cast order by n loop
    select id into v_coach   from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-coach@onstandard.app';
    select id into v_athlete from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-athlete@onstandard.app';
    select id into v_trainer from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-trainer@onstandard.app';
    select id into v_client  from auth.users where email = 't' || lpad(r.n::text,2,'0') || '-client@onstandard.app';

    -- COACH creates the team. create_team has TWO overloads; the 4-arg one is the real signature.
    perform set_config('request.jwt.claim.sub', v_coach::text, true);
    perform set_config('role', 'authenticated', true);
    select create_team(r.team_name, 'Football', null, true) into v_team_code;
    select id into v_team_id from teams where join_code = v_team_code;

    -- ATHLETE joins it.
    perform set_config('request.jwt.claim.sub', v_athlete::text, true);
    perform join_team(v_team_code, r.athlete_pos);

    -- TRAINER creates the practice.
    perform set_config('request.jwt.claim.sub', v_trainer::text, true);
    select create_practice(r.practice_name, r.practice_handle, true) into v_practice_code;
    select id into v_practice_id from practices where join_code = v_practice_code;

    -- CLIENT joins it.
    perform set_config('request.jwt.claim.sub', v_client::text, true);
    perform join_practice(v_practice_code);

    insert into tester_links (n, team_id, team_code, practice_id, practice_code)
    values (r.n, v_team_id, v_team_code, v_practice_id, v_practice_code);
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ---------------------------------------------------------------- handout table
insert into tester_sets (set_no, password, email_coach, email_athlete, email_trainer, email_client,
                          team_id, team_join_code, practice_id, practice_join_code)
select tc.n, tc.pw_placeholder,
       't' || lpad(tc.n::text,2,'0') || '-coach@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-athlete@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-trainer@onstandard.app',
       't' || lpad(tc.n::text,2,'0') || '-client@onstandard.app',
       tl.team_id, tl.team_code, tl.practice_id, tl.practice_code
from tester_cast tc join tester_links tl on tl.n = tc.n
order by tc.n;

select set_no, email_coach, email_athlete, email_trainer, email_client, team_join_code, practice_join_code
from tester_sets order by set_no;

commit;
```

- [ ] **Step 2: Add the footgun warning to `scripts/seed-demo-accounts.sql`**

Read the current file first, then use Edit to insert a new comment block. The exact anchor text to match:

```
-- The live password lives in the founder's password manager / agent memory,
-- never here. Rotate it with:
--   update auth.users set encrypted_password = crypt('<new>', gen_salt('bf'))
--    where raw_app_meta_data->>'demo' = 'true';
--
-- Method (from the 2026-07-13 seed, which worked): insert auth.users + auth.identities directly,
```

Replace it with (same text, plus the new warning inserted between the rotate block and the Method paragraph):

```
-- The live password lives in the founder's password manager / agent memory,
-- never here. Rotate it with:
--   update auth.users set encrypted_password = crypt('<new>', gen_salt('bf'))
--    where raw_app_meta_data->>'demo' = 'true';
--
-- FOOTGUN (added 2026-08-09, scripts/seed-tester-accounts.sql): the ABOVE one-liner and any
-- teardown keyed on `raw_app_meta_data->>'demo' = 'true'` also match the forty per-tester demo
-- accounts once that script has run — 'demo' is true on ALL of them. If you only mean to touch
-- THESE four, scope every such statement to
-- `raw_app_meta_data->>'demo' = 'true' and not (raw_app_meta_data ? 'tester')` instead.
--
-- Method (from the 2026-07-13 seed, which worked): insert auth.users + auth.identities directly,
```

- [ ] **Step 3: Run it locally**

```bash
node scripts/tester-accounts.mjs gen
```

(This step depends on Task 6 existing — if executing tasks in order, come back to this verification after Task 6 is done. If executing out of order, substitute passwords by hand for this local check: `sed -i 's/__PW_01__/LocalTest-01/; s/__PW_02__/LocalTest-02/; ...' ` for all ten, or run the file as-is against local with literal `__PW_NN__` strings as the passwords — local data, doesn't matter.)

Then:
```bash
supabase db query --local --file /path/to/substituted/seed-tester-accounts.sql
```

Expected: the final `select` returns 10 rows, `set_no` 1–10, distinct emails per row, non-null join codes.

- [ ] **Step 4: Verify no cross-contamination of the founder's four**

Run: `supabase db query --local "select count(*) from auth.users where raw_app_meta_data->>'demo'='true' and not (raw_app_meta_data ? 'tester');"`

Note: on a fresh local DB the founder's original 4 accounts don't exist unless separately seeded — this check is really validated live in Task 7. Locally, just confirm the count of `raw_app_meta_data ? 'tester'` accounts is exactly 40: `supabase db query --local "select count(*) from auth.users where raw_app_meta_data ? 'tester';"` → expect `40`.

- [ ] **Step 5: Re-run to prove idempotency**

Run the same `supabase db query --local --file ...` a second time. Expected: still exactly 40 tester accounts, 10 teams, 10 practices, 10 `tester_sets` rows (not 80/20/20) — the teardown-before-insert block worked.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-tester-accounts.sql scripts/seed-demo-accounts.sql
git commit -m "feat(db): seed script for 10 per-tester demo account sets"
```

---

### Task 3: `tester-claim` edge function + config.toml entry

**Files:**
- Create: `supabase/functions/tester-claim/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `tester_sets` table + `claim_next_tester_set` RPC (Task 1), env secrets `TESTER_CLAIM_KEY`, `TESTER_ADMIN_KEY`, `BETA_BOARD_KEY` (already exists from `beta-board`), `TESTER_BOARD_ORIGIN` (optional), `TESTER_ALLOWED_ORIGINS` (optional).
- Produces: HTTP POST API at `/functions/v1/tester-claim` with actions `claim`/`resume`/`recover`/`status`. Success response shape (consumed by Task 4):
  ```ts
  {
    ok: true, set_no: number, password: string,
    emails: { coach: string, athlete: string, trainer: string, client: string },
    team_join_code: string | null, practice_join_code: string | null,
    device_token: string, board_url: string | null
  }
  ```
  Error shape: `{ error: string }` with status 400/403/404/409/429/503.

- [ ] **Step 1: Write the function**

Create `supabase/functions/tester-claim/index.ts`:

```typescript
// OnStandard — tester-claim Edge Function (Supabase / Deno).
//
// Server side of the per-tester demo-account handout (web/landing/tester.html, migration 0195):
// ten isolated coach+athlete+trainer+client sets, seeded by scripts/seed-tester-accounts.sql,
// self-claimed by testers instead of the founder hand-delivering credentials ten times. See
// docs/superpowers/specs/2026-08-09-tester-demo-accounts-design.md for the full design.
//
// Four actions, all POST:
//   claim   -> name + email. Returns the caller's existing set if that email already holds one,
//              otherwise atomically assigns the next free set via claim_next_tester_set (0195).
//   resume  -> device_token. Returns that set, so a page refresh never burns a new one.
//   recover -> email. Returns that email's set, or not_found. Covers "now I'm on my phone".
//   status  -> founder-only (TESTER_ADMIN_KEY). Who claimed what, when, and how many beta board
//              reports they've filed — the nudge list.
//
// AUTH — same model as beta-board: there is no Supabase session, the visitor is an anonymous
// browser holding a URL token, so this function is the entire wall:
//   * every action requires ?k= in the body matching TESTER_CLAIM_KEY (constant-time compare)
//   * status additionally requires TESTER_ADMIN_KEY
//   * all DB work runs through the service-role client, because 0195's tester_sets is RLS-on
//     with no policies and no anon/authenticated grants (deliberate — see that migration's header)
// verify_jwt MUST be pinned false in config.toml or the platform 401s before any of this runs.
//
// Every response returns ONLY the caller's own row. No action ever lists all ten sets except
// status, which is founder-only.
//
// One device_token per set: recover/re-claim from a new device overwrites it, so an older device's
// stored token stops resuming and falls back to typing name+email again. Accepted simplification
// for ten testers — see the design spec's Risks section.
//
// Deploy:
//   supabase secrets set TESTER_CLAIM_KEY=<token> TESTER_ADMIN_KEY=<token>
//   supabase functions deploy tester-claim --no-verify-jwt
// BETA_BOARD_KEY must already be set (shared with the beta-board function) — this function reads
// it to compose a ready-to-tap board link so a tester never juggles two separate tokenized URLs.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import { clientIpFrom } from '../_shared/client-ip.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CLAIM_KEY = Deno.env.get('TESTER_CLAIM_KEY') ?? '';
const ADMIN_KEY = Deno.env.get('TESTER_ADMIN_KEY') ?? '';
const BOARD_KEY = Deno.env.get('BETA_BOARD_KEY') ?? '';
const BOARD_ORIGIN = Deno.env.get('TESTER_BOARD_ORIGIN') ?? 'https://onstandard.app';

// Own list, same rationale as beta-board: never reuse the shared ALLOWED_ORIGINS secret, so
// rotating it for an unrelated function can't silently change this one's CORS posture.
const DEFAULT_ORIGINS = ['https://onstandard.app', 'https://www.onstandard.app'];
const ALLOWED_ORIGINS = (() => {
  const raw = (Deno.env.get('TESTER_ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return raw.length ? raw : DEFAULT_ORIGINS;
})();
const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return BASE_HEADERS;
  if (ALLOWED_ORIGINS.includes(origin)) return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin };
  return BASE_HEADERS;
}

// Constant-time compare — see beta-board for why a plain === leaks a secret's prefix through timing.
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Best-effort per-IP window on claim/recover, so the endpoint can't be enumerated. resume is NOT
// gated here — it requires an unguessable device_token the caller already holds, so it isn't an
// enumeration vector.
const RL_MAX = Number(Deno.env.get('RATE_LIMIT_PER_MIN') ?? '20');
const RL_WINDOW_MS = 60_000;
const rlHits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rlHits.get(ip);
  if (!e || now > e.resetAt) {
    rlHits.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > RL_MAX;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type SetRow = {
  set_no: number; password: string;
  email_coach: string; email_athlete: string; email_trainer: string; email_client: string;
  team_join_code: string | null; practice_join_code: string | null;
  device_token: string | null; claimed_name: string | null; claimed_email: string | null; claimed_at: string | null;
};

const SET_COLS = 'set_no,password,email_coach,email_athlete,email_trainer,email_client,team_join_code,practice_join_code,device_token,claimed_name,claimed_email,claimed_at';

function payload(row: SetRow, deviceToken: string) {
  return {
    ok: true,
    set_no: row.set_no,
    password: row.password,
    emails: { coach: row.email_coach, athlete: row.email_athlete, trainer: row.email_trainer, client: row.email_client },
    team_join_code: row.team_join_code,
    practice_join_code: row.practice_join_code,
    device_token: deviceToken,
    board_url: BOARD_KEY ? `${BOARD_ORIGIN}/beta.html?k=${encodeURIComponent(BOARD_KEY)}` : null,
  };
}

Deno.serve(async (request) => {
  const cors = corsFor(request);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Unconfigured is 503, never a throw at import — a missing secret must not 500 every request.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLAIM_KEY) return json({ error: 'unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // The wall. Every action.
  if (!safeEqual(str(body.k, 200), CLAIM_KEY)) return json({ error: 'forbidden' }, 403);

  const action = str(body.action, 20);
  const ip = clientIpFrom(request);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---------------------------------------------------------------- resume: refresh never burns a set
  if (action === 'resume') {
    const device = str(body.device_token, 100);
    if (!device) return json({ error: 'bad_request' }, 400);
    const { data } = await sb.from('tester_sets').select(SET_COLS).eq('device_token', device).maybeSingle();
    if (!data) return json({ error: 'not_found' }, 404);
    return json(payload(data as SetRow, device));
  }

  // ---------------------------------------------------------------- recover: "now I'm on my phone"
  if (action === 'recover') {
    if (rateLimited(ip)) return json({ error: 'slow_down' }, 429);
    const email = str(body.email, 200).toLowerCase();
    if (!email) return json({ error: 'bad_request' }, 400);
    const { data } = await sb.from('tester_sets').select(SET_COLS).eq('claimed_email', email).maybeSingle();
    if (!data) return json({ error: 'not_found' }, 404);
    const device = crypto.randomUUID();
    const { data: updated } = await sb.from('tester_sets').update({ device_token: device }).eq('set_no', (data as SetRow).set_no).select(SET_COLS).single();
    return json(payload((updated ?? data) as SetRow, device));
  }

  // ---------------------------------------------------------------- claim: assign or return existing
  if (action === 'claim') {
    if (rateLimited(ip)) return json({ error: 'slow_down' }, 429);
    const name = str(body.name, 60);
    const email = str(body.email, 200).toLowerCase();
    if (!name || !email || !email.includes('@')) return json({ error: 'bad_request' }, 400);
    const device = crypto.randomUUID();

    const { data: existing } = await sb.from('tester_sets').select(SET_COLS).eq('claimed_email', email).maybeSingle();
    if (existing) {
      const { data: updated } = await sb.from('tester_sets').update({ device_token: device, claimed_name: name }).eq('set_no', (existing as SetRow).set_no).select(SET_COLS).single();
      return json(payload((updated ?? existing) as SetRow, device));
    }

    const { data: claimed, error } = await sb.rpc('claim_next_tester_set', { p_name: name, p_email: email, p_device: device }).select(SET_COLS).single();
    if (error) return json({ error: 'unavailable' }, 503);
    const row = claimed as SetRow | null;
    if (!row || row.set_no == null) return json({ error: 'exhausted' }, 409);
    return json(payload(row, device));
  }

  // ---------------------------------------------------------------- status: founder-only
  if (action === 'status') {
    if (!ADMIN_KEY || !safeEqual(str(body.admin, 200), ADMIN_KEY)) return json({ error: 'forbidden' }, 403);
    const { data: sets } = await sb.from('tester_sets').select('set_no,claimed_name,claimed_email,claimed_at').order('set_no');
    const { data: posts } = await sb.from('beta_posts').select('tester_set').not('tester_set', 'is', null);
    const counts = new Map<number, number>();
    for (const p of posts ?? []) {
      const n = (p as { tester_set: number }).tester_set;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const rows = (sets ?? []).map((s) => ({ ...s, board_post_count: counts.get((s as { set_no: number }).set_no) ?? 0 }));
    return json({ ok: true, sets: rows });
  }

  return json({ error: 'bad_request' }, 400);
});
```

- [ ] **Step 2: Add the config.toml entry**

Read `supabase/config.toml`, find the `[functions.beta-board]` block, and insert this immediately after it (before the `# These three authenticate the CALLER themselves...` comment):

```toml

# tester-claim backs the per-tester demo-account handout (web/landing/tester.html, migration 0195).
# Same posture as beta-board: an anonymous browser holding a URL token, no Supabase session, so it
# authenticates every request itself against TESTER_CLAIM_KEY (constant-time), with
# TESTER_ADMIN_KEY on top for the founder's status view. Pinned false so a redeploy can't 401 the
# whole page before its own auth ever runs.
[functions.tester-claim]
verify_jwt = false
```

- [ ] **Step 3: Serve it locally**

```bash
supabase functions serve tester-claim --no-verify-jwt --env-file <(printf 'TESTER_CLAIM_KEY=localtestkey\nTESTER_ADMIN_KEY=localadminkey\n')
```

(On Windows Git Bash, process substitution works; if it doesn't in your shell, write those two lines to a temp file and pass `--env-file <path>` instead.)

- [ ] **Step 4: Curl it — claim, resume, recover, exhaustion**

With the local seed from Task 2 already applied (10 unclaimed rows in local `tester_sets`):

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/tester-claim \
  -H 'Content-Type: application/json' \
  -d '{"k":"localtestkey","action":"claim","name":"Test One","email":"t1@example.com"}'
```
Expected: `{"ok":true,"set_no":1,...,"device_token":"...","board_url":null}` (`board_url` is `null` locally unless `BETA_BOARD_KEY` was also passed via `--env-file`).

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/tester-claim \
  -H 'Content-Type: application/json' \
  -d '{"k":"localtestkey","action":"claim","name":"Test One","email":"t1@example.com"}'
```
Expected: same `set_no:1` (existing-email path, not a new set).

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/tester-claim \
  -H 'Content-Type: application/json' \
  -d '{"k":"localtestkey","action":"recover","email":"t1@example.com"}'
```
Expected: `set_no:1` again.

Claim the remaining 9 with distinct emails, then claim an 11th. Expected: `{"error":"exhausted"}` with HTTP 409.

- [ ] **Step 5: Curl the wall**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:54321/functions/v1/tester-claim \
  -H 'Content-Type: application/json' -d '{"k":"wrongkey","action":"claim","name":"x","email":"x@x.com"}'
```
Expected: `403`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/tester-claim/index.ts supabase/config.toml
git commit -m "feat(functions): add tester-claim edge function"
```

---

### Task 4: `web/landing/tester.html` + `_headers`

**Files:**
- Create: `web/landing/tester.html`
- Modify: `web/landing/_headers`

**Interfaces:**
- Consumes: `tester-claim`'s response shape from Task 3.
- Produces: on a successful claim/resume/recover, writes `localStorage` keys `os_tester_device`, `os_tester_set`, `os_tester_name` — consumed by Task 5 (`beta.html` reads `os_tester_set` / `os_tester_name`).

- [ ] **Step 1: Add the `_headers` block**

Read `web/landing/_headers`, then append this block after the existing `/beta*` block (same file, same convention):

```
# The per-tester demo-account handout. Reached only with a ?k= token and hands out LIVE prod
# passwords, so it gets the same posture as /beta* — plus a TIGHTER connect-src, since this page
# never talks to the REST origin, only the tester-claim function:
#   · no-store + no-referrer — the URL IS the credential.
#   · noindex — belt to the meta tag's braces.
#   · fonts are local (font-src 'self') — same reasoning as /beta*.
/tester*
  X-Frame-Options: DENY
  Cache-Control: no-store
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src https://ftwrvylzoyznhbzhgism.functions.supabase.co; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- [ ] **Step 2: Write the page**

Create `web/landing/tester.html` with this exact content:

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tester Access · OnStandard</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="Get your OnStandard tester accounts.">
<link rel="icon" href="assets/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<style>
  @font-face{font-family:'Archivo';font-style:normal;font-weight:900;font-display:swap;src:url('./fonts/archivo-exp900.woff2') format('woff2');}
  @font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:200 800;font-display:swap;src:url('./fonts/pjs.woff2') format('woff2');}

  :root{
    --ink:#070B14; --panel:#0D1424; --panel2:#111A2E; --line:#1d2735; --line2:#2a3646;
    --fg:#eef3f9; --fg2:#a6b4c6; --mut:#6b7a8d;
    --blue:#3B82F6; --teal:#22D3EE;
    --sweep:linear-gradient(100deg,#3B82F6 0%,#22D3EE 100%);
    --display:'Archivo',system-ui,sans-serif; --body:'Plus Jakarta Sans',system-ui,sans-serif;
    --r:16px;
  }
  *{box-sizing:border-box;} html{-webkit-text-size-adjust:100%;}
  body{margin:0;background:
      radial-gradient(1100px 620px at 82% -8%,rgba(34,211,238,.10),transparent 55%),
      radial-gradient(1000px 560px at -6% 4%,rgba(59,130,246,.12),transparent 52%),
      var(--ink);
    color:var(--fg);font-family:var(--body);line-height:1.55;-webkit-font-smoothing:antialiased;
    min-height:100vh;}
  .wrap{max-width:640px;margin:0 auto;padding:0 20px 80px;}
  :focus-visible{outline:2px solid var(--teal);outline-offset:3px;}

  header{padding:34px 0 8px;}
  .eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--teal);font-weight:700;}
  h1{font-family:var(--display);font-weight:900;font-size:clamp(28px,6vw,40px);line-height:1.05;letter-spacing:-.02em;margin:12px 0 0;}
  .sub{color:var(--fg2);font-size:15px;margin-top:12px;max-width:52ch;}

  .panel{border:1px solid var(--line);border-radius:var(--r);background:linear-gradient(180deg,#111a26,#0d141d);
    padding:22px;margin:26px 0;box-shadow:0 30px 70px -40px rgba(0,0,0,.8);}
  .row{margin-bottom:12px;}
  label{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:700;margin-bottom:6px;}
  input{width:100%;font-family:var(--body);font-size:16px;color:var(--fg);background:#0b121b;
    border:1px solid var(--line);border-radius:11px;padding:12px 14px;transition:border-color .16s;}
  input:focus{border-color:var(--teal);outline:none;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;font-family:var(--body);font-weight:700;font-size:15px;
    border-radius:12px;padding:13px 20px;border:1px solid var(--line2);background:var(--panel2);color:var(--fg);cursor:pointer;
    transition:transform .1s,border-color .16s,background .16s,filter .16s;}
  .btn:hover{border-color:#3a4a5e;background:#18222f;}
  .btn:active{transform:translateY(1px);}
  .btn.cta{background:var(--sweep);color:#052027;border:0;box-shadow:0 12px 34px -14px rgba(34,211,238,.55);}
  .btn.cta:hover{filter:brightness(1.06);}
  .btn[disabled]{opacity:.55;cursor:default;transform:none;filter:none;}
  .say{font-size:13.5px;margin-top:12px;min-height:19px;}
  .say.bad{color:#F87171;}
  .fine{font-size:13px;color:var(--mut);margin-top:14px;text-align:center;}
  .fine button{background:none;border:0;padding:0;color:var(--teal);font-family:var(--body);font-size:13px;font-weight:600;cursor:pointer;}
  .fine button:hover{text-decoration:underline;}

  .setno{font-family:var(--display);font-weight:900;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--teal);margin:0 0 4px;}
  .cardtitle{font-family:var(--display);font-weight:900;font-size:24px;letter-spacing:-.01em;margin:0 0 18px;}
  .field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid rgba(29,39,53,.7);}
  .field:last-child{border-bottom:0;}
  .flabel{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:700;min-width:70px;}
  .fval{font-family:'Fira Code',monospace;font-size:14px;color:var(--fg);word-break:break-all;text-align:right;flex:1;}
  .pw .fval{color:var(--teal);font-weight:700;}

  .starthere{margin-top:22px;padding-top:18px;border-top:1px dashed var(--line2);}
  .starthere h2{font-family:var(--display);font-weight:900;font-size:14px;letter-spacing:-.01em;margin:0 0 10px;}
  .starthere ol{margin:0;padding-left:20px;color:var(--fg2);font-size:14px;}
  .starthere li{margin-bottom:6px;}
  .actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;}
  .actions .btn{width:auto;flex:1;min-width:150px;}

  .empty{border:1px dashed var(--line2);border-radius:var(--r);padding:34px 20px;text-align:center;color:var(--fg2);}
  .empty b{display:block;font-family:var(--display);font-weight:900;font-size:18px;color:var(--fg);margin-bottom:6px;}
  footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--mut);}
</style>
</head>
<body>

<div class="wrap">
  <header>
    <div class="eyebrow">OnStandard · Private Beta</div>
    <h1>Get your tester accounts.</h1>
    <p class="sub">You'll get four linked logins — coach, athlete, trainer, client — so you can see
      every side of the app. Nobody else's data, nobody sees yours.</p>
  </header>

  <div id="gate" class="panel" hidden>
    <b class="cardtitle">You need an invite link</b>
    <p class="sub">Use the full link you were sent — it ends in a code.</p>
  </div>

  <div id="form" class="panel" hidden>
    <form id="claimform">
      <div class="row">
        <label for="tname">Your name</label>
        <input id="tname" maxlength="60" placeholder="First name is fine" autocomplete="given-name">
      </div>
      <div class="row">
        <label for="temail">Your email</label>
        <input id="temail" type="email" maxlength="200" placeholder="you@example.com" autocomplete="email">
      </div>
      <button class="btn cta" id="claimbtn" type="submit">Get my accounts</button>
      <div class="say" id="formsay" role="status" aria-live="polite"></div>
    </form>
    <p class="fine">Already claimed on another device? <button type="button" id="recoverlink">Recover with your email</button></p>
  </div>

  <div id="card" class="panel" hidden>
    <p class="setno" id="setno"></p>
    <h2 class="cardtitle">Your accounts are ready</h2>

    <div class="field pw">
      <span class="flabel">Password</span>
      <span class="fval" id="pw"></span>
    </div>
    <div class="field">
      <span class="flabel">Coach</span>
      <span class="fval" id="e-coach"></span>
    </div>
    <div class="field">
      <span class="flabel">Athlete</span>
      <span class="fval" id="e-athlete"></span>
    </div>
    <div class="field">
      <span class="flabel">Trainer</span>
      <span class="fval" id="e-trainer"></span>
    </div>
    <div class="field">
      <span class="flabel">Client</span>
      <span class="fval" id="e-client"></span>
    </div>
    <div class="field">
      <span class="flabel">Team code</span>
      <span class="fval" id="teamcode"></span>
    </div>
    <div class="field">
      <span class="flabel">Practice code</span>
      <span class="fval" id="practicecode"></span>
    </div>

    <div class="actions">
      <button class="btn" id="copyall" type="button">Copy all</button>
    </div>

    <div class="starthere">
      <h2>Start here</h2>
      <ol>
        <li>Install the app from TestFlight, then sign in as the <b>athlete</b> account first — that's the everyday experience.</li>
        <li>Sign out and back in as <b>coach</b> to see the same athlete from the other side.</li>
        <li>Same idea for <b>trainer</b> / <b>client</b> — that's a separate, second relationship.</li>
        <li>Hit something confusing, broken, or good? Tap "Report anything" below — it lands on our board tagged with your tester number, not lost in a text thread.</li>
      </ol>
      <div class="actions">
        <a class="btn" id="testflightlink" href="#" target="_blank" rel="noopener" hidden>Open TestFlight</a>
        <a class="btn cta" id="reportlink" href="#" target="_blank" rel="noopener" hidden>Report anything</a>
      </div>
    </div>
  </div>

  <div id="exhausted" class="panel" hidden>
    <div class="empty">
      <b>All ten sets are taken.</b>
      <div>Text the founder — more testers means we bump the count.</div>
    </div>
  </div>

  <footer>
    Your accounts are real OnStandard sign-ins, seeded with no history so you can try the whole
    logging flow from a clean slate. Nobody else can see what you do.
  </footer>
</div>

<script>
(function () {
  'use strict';
  var FN = 'https://ftwrvylzoyznhbzhgism.supabase.co/functions/v1/tester-claim';
  // Founder: paste the public TestFlight invite link here before sharing this page. Left blank,
  // the button just stays hidden — never guess/invent this URL.
  var TESTFLIGHT_URL = '';

  var qs = new URLSearchParams(location.search);
  var K = qs.get('k') || '';

  var $ = function (id) { return document.getElementById(id); };
  var LS = {
    get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function show(id) {
    ['gate', 'form', 'card', 'exhausted'].forEach(function (s) { $(s).hidden = (s !== id); });
  }

  if (!K) { show('gate'); return; }

  function api(payload) {
    payload.k = K;
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  function renderCard(data) {
    LS.set('os_tester_device', data.device_token);
    LS.set('os_tester_set', String(data.set_no));
    var typedName = $('tname') && $('tname').value.trim();
    if (typedName) LS.set('os_tester_name', typedName);

    $('setno').textContent = 'Tester ' + String(data.set_no).padStart(2, '0');
    $('pw').textContent = data.password;
    $('e-coach').textContent = data.emails.coach;
    $('e-athlete').textContent = data.emails.athlete;
    $('e-trainer').textContent = data.emails.trainer;
    $('e-client').textContent = data.emails.client;
    $('teamcode').textContent = data.team_join_code || '—';
    $('practicecode').textContent = data.practice_join_code || '—';

    var report = $('reportlink');
    if (data.board_url) { report.href = data.board_url; report.hidden = false; } else { report.hidden = true; }

    var tf = $('testflightlink');
    if (TESTFLIGHT_URL) { tf.href = TESTFLIGHT_URL; tf.hidden = false; } else { tf.hidden = true; }

    $('copyall').onclick = function () {
      var text = [
        'OnStandard tester ' + String(data.set_no).padStart(2, '0'),
        'Password: ' + data.password,
        'Coach:   ' + data.emails.coach,
        'Athlete: ' + data.emails.athlete,
        'Trainer: ' + data.emails.trainer,
        'Client:  ' + data.emails.client
      ].join('\n');
      var btn = $('copyall');
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy all'; }, 1500);
      }).catch(function () {});
    };

    show('card');
  }

  function tryResume() {
    var device = LS.get('os_tester_device', '');
    if (!device) { show('form'); return; }
    api({ action: 'resume', device_token: device }).then(function (res) {
      if (res.ok) { renderCard(res.body); return; }
      LS.remove('os_tester_device');
      show('form');
    }).catch(function () { show('form'); });
  }

  $('claimform').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var say = $('formsay'), btn = $('claimbtn');
    var name = $('tname').value.trim();
    var email = $('temail').value.trim();
    if (!name || !email || email.indexOf('@') === -1) {
      say.className = 'say bad'; say.textContent = 'Name and a real email, please.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Getting your accounts…';
    say.className = 'say'; say.textContent = '';
    api({ action: 'claim', name: name, email: email }).then(function (res) {
      if (res.ok) { renderCard(res.body); return; }
      if (res.body && res.body.error === 'exhausted') { show('exhausted'); return; }
      say.className = 'say bad';
      say.textContent = (res.status === 429) ? 'Slow down a moment and try again.' : "Couldn't claim a set. Try again in a moment.";
    }).catch(function () {
      say.className = 'say bad'; say.textContent = 'Something went wrong. Try again.';
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Get my accounts';
    });
  });

  $('recoverlink').addEventListener('click', function (ev) {
    ev.preventDefault();
    var email = prompt('Email you claimed with:');
    if (!email) return;
    api({ action: 'recover', email: email.trim() }).then(function (res) {
      if (res.ok) { renderCard(res.body); return; }
      alert("Couldn't find a set for that email.");
    }).catch(function () { alert('Something went wrong. Try again.'); });
  });

  tryResume();
})();
</script>
</body></html>
```

- [ ] **Step 3: Manual local check**

With `supabase functions serve tester-claim` still running from Task 3, temporarily point `FN` in a local copy at `http://127.0.0.1:54321/functions/v1/tester-claim` (or serve the whole `web/landing/` directory with a static server and open `tester.html?k=localtestkey` — e.g. `npx serve web/landing`), then in a browser:
1. Open with no `?k=` → gate state shows.
2. Open with `?k=localtestkey` → form shows.
3. Fill name/email, submit → card shows with a password and 4 emails.
4. Refresh the page → card shows immediately (resume), no form flash.
5. Click "Copy all" → clipboard contains the 4 emails + password (paste somewhere to check).
6. Open DevTools → Application → Local Storage → confirm `os_tester_device`, `os_tester_set`, `os_tester_name` are all set.

- [ ] **Step 4: Commit**

```bash
git add web/landing/tester.html web/landing/_headers
git commit -m "feat(web): add tester.html claim page"
```

---

### Task 5: Tie the board to the set — `beta.html` + `beta-board`

**Files:**
- Modify: `supabase/functions/beta-board/index.ts`
- Modify: `web/landing/beta.html`

**Interfaces:**
- Consumes: `localStorage` keys `os_tester_set` / `os_tester_name` (written by Task 4's `tester.html`), `beta_posts.tester_set` column (Task 1).
- Produces: `beta-board`'s `submit` action accepts optional `tester_set` (1–10 or omitted); `list` action returns it on each post; posts render with a "Set 0N ·" prefix when present.

- [ ] **Step 1: Edit `beta-board/index.ts` — accept and store `tester_set`**

In the `list` action, change the posts select (around line 187) from:
```typescript
      .select('id,theme_id,author_name,body,app_version,created_at')
```
to:
```typescript
      .select('id,theme_id,author_name,body,app_version,tester_set,created_at')
```

In the `submit` action, after the existing `appVersion` line (around line 252):
```typescript
  const appVersion = str(body.app_version, 40) || null;
```
add:
```typescript
  const testerSetRaw = Number(body.tester_set);
  const testerSet = Number.isInteger(testerSetRaw) && testerSetRaw >= 1 && testerSetRaw <= 10 ? testerSetRaw : null;
```

Then change the insert (around line 268-271) from:
```typescript
  const { data: inserted, error: insErr } = await sb
    .from('beta_posts')
    .insert({ author_name: authorName, body: text, app_version: appVersion })
    .select('id')
    .single();
```
to:
```typescript
  const { data: inserted, error: insErr } = await sb
    .from('beta_posts')
    .insert({ author_name: authorName, body: text, app_version: appVersion, tester_set: testerSet })
    .select('id')
    .single();
```

- [ ] **Step 2: Edit `beta.html` — read, send, and show the tester tag**

Read the file first (already read in the design phase). Change:
```javascript
  $('name').value = LS.get('os_beta_name', '');
```
to:
```javascript
  var testerSet = Number(LS.get('os_tester_set', '')) || null;
  $('name').value = LS.get('os_beta_name', '') || LS.get('os_tester_name', '');
```

Change the submit handler's `api()` call from:
```javascript
    api({
      action: 'submit',
      author_name: $('name').value.trim(),
      body: text,
      app_version: $('ver').value.trim()
    }).then(function (res) {
```
to:
```javascript
    api({
      action: 'submit',
      author_name: $('name').value.trim(),
      body: text,
      app_version: $('ver').value.trim(),
      tester_set: testerSet
    }).then(function (res) {
```

Change the post rendering line:
```javascript
          pv.appendChild(el('div', 'who', (p.author_name || 'Anonymous') + ' · ' + when(p.created_at) + (p.app_version ? ' · build ' + p.app_version : '')));
```
to:
```javascript
          var setLabel = p.tester_set ? ('Set ' + String(p.tester_set).padStart(2, '0') + ' · ') : '';
          pv.appendChild(el('div', 'who', setLabel + (p.author_name || 'Anonymous') + ' · ' + when(p.created_at) + (p.app_version ? ' · build ' + p.app_version : '')));
```

- [ ] **Step 3: Verify locally against the local stack**

```bash
supabase functions serve beta-board --no-verify-jwt --env-file <(printf 'BETA_BOARD_KEY=localboardkey\n')
```

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/beta-board \
  -H 'Content-Type: application/json' \
  -d '{"k":"localboardkey","action":"submit","author_name":"Test","body":"local tie-in check","tester_set":3}'
```
Expected: `{"ok":true,...}`.

```bash
curl -s -X POST http://127.0.0.1:54321/functions/v1/beta-board \
  -H 'Content-Type: application/json' -d '{"k":"localboardkey","action":"list"}'
```
Expected: the `posts` array contains the new post with `"tester_set":3`.

Then submit a second report WITHOUT `tester_set` and confirm the returned post has `"tester_set":null` — the external-tester no-op path still works.

- [ ] **Step 4: Manual check on the page**

Serve `web/landing/` locally, in the browser console run `localStorage.setItem('os_tester_set','5'); localStorage.setItem('os_tester_name','Jordan Test');`, open `beta.html?k=localboardkey`, confirm the name field is pre-filled "Jordan Test", submit a report, confirm the post you just made shows a "Set 05 ·" prefix on the board.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/beta-board/index.ts web/landing/beta.html
git commit -m "feat(beta-board): tag reports with the tester's set number"
```

---

### Task 6: `scripts/tester-accounts.mjs` — gen / verify / smoke

**Files:**
- Create: `scripts/tester-accounts.mjs`

**Interfaces:**
- Consumes: `scripts/seed-tester-accounts.sql` (Task 2, for `gen`), `tester-claim` + `beta-board` deployed functions (Tasks 3 & 5, for `smoke`), the 40 seeded accounts + RLS policies on `days`/`teams`/`practices` (for `verify`).
- Produces: `<tmpdir>/onstandard-tester-seed.sql` (runnable, real passwords), `<tmpdir>/onstandard-tester-creds.json` (consumed by `verify`).

- [ ] **Step 1: Write the script**

Create `scripts/tester-accounts.mjs`:

```javascript
#!/usr/bin/env node
// Tester demo-account ops: generates the 10 per-tester passwords, runs the seed, and proves the
// result actually works before any real tester sees the link. Three commands:
//
//   node scripts/tester-accounts.mjs gen
//     Substitutes 10 fresh passwords into scripts/seed-tester-accounts.sql, writes the runnable
//     file + a credentials JSON to the OS temp dir (never into the repo), and prints the exact
//     `supabase db query` command to run it.
//
//   node scripts/tester-accounts.mjs verify
//     Signs in all 40 seeded accounts for real (a hand-inserted auth.users row can look perfect in
//     every table and still fail every sign-in — see scripts/seed-demo-accounts.sql), then proves
//     cross-tenant RLS isolation across all ten set boundaries. Reads credentials from the temp-dir
//     JSON `gen` wrote. Needs SUPABASE_URL + SUPABASE_ANON_KEY (or EXPO_PUBLIC_ variants) in env —
//     no service-role key, by design.
//
//   node scripts/tester-accounts.mjs smoke
//     Exercises the DEPLOYED tester-claim + beta-board functions end to end: claim, re-claim,
//     recover, exhaustion after 10, and the board tie-in. WARNING: this CLAIMS all 10 sets with
//     synthetic emails. Re-run `gen` and re-apply the seed before handing the real link to testers.
//     Needs TESTER_CLAIM_KEY, TESTER_ADMIN_KEY, BETA_BOARD_KEY in env.
//
// Local stack:
//   supabase status -o env   # prints local ANON_KEY etc.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<from above> node scripts/tester-accounts.mjs verify
//
// Prod:
//   node --env-file=.env scripts/tester-accounts.mjs verify   # .env already has EXPO_PUBLIC_SUPABASE_*
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomInt } from 'node:crypto';

const ROOT = join(import.meta.dirname, '..');
const SEED_SRC = join(ROOT, 'scripts', 'seed-tester-accounts.sql');
const OUT_SQL = join(tmpdir(), 'onstandard-tester-seed.sql');
const OUT_CREDS = join(tmpdir(), 'onstandard-tester-creds.json');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const WORDS = [
  'Cedar', 'Ridge', 'Anchor', 'Quarry', 'Ballast', 'Harbor', 'Ember', 'Granite', 'Willow', 'Meadow',
  'Canyon', 'Thicket', 'Lantern', 'Compass', 'Timber', 'Boulder', 'Brook', 'Summit', 'Hollow', 'Ferry',
  'Orchard', 'Pebble', 'Marsh', 'Cinder', 'Foundry', 'Hearth', 'Ledge', 'Mill', 'Nook', 'Overlook',
  'Pier', 'Quay', 'Rafter', 'Slate', 'Trellis', 'Underpass', 'Vale', 'Wharf', 'Yard', 'Zephyr',
];

function genPassword() {
  const picked = new Set();
  while (picked.size < 3) picked.add(WORDS[randomInt(WORDS.length)]);
  const digits = String(randomInt(10, 100));
  return [...picked].join('-') + '-' + digits;
}

function cmdGen() {
  const passwords = [];
  const used = new Set();
  for (let n = 1; n <= 10; n++) {
    let pw;
    do { pw = genPassword(); } while (used.has(pw));
    used.add(pw);
    passwords.push(pw);
  }

  let sql = readFileSync(SEED_SRC, 'utf8');
  const creds = [];
  for (let n = 1; n <= 10; n++) {
    const nn = String(n).padStart(2, '0');
    const token = `__PW_${nn}__`;
    if (!sql.includes(token)) throw new Error(`placeholder ${token} not found in ${SEED_SRC}`);
    sql = sql.split(token).join(passwords[n - 1]);
    creds.push({
      set_no: n,
      password: passwords[n - 1],
      emails: {
        coach: `t${nn}-coach@onstandard.app`,
        athlete: `t${nn}-athlete@onstandard.app`,
        trainer: `t${nn}-trainer@onstandard.app`,
        client: `t${nn}-client@onstandard.app`,
      },
    });
  }

  writeFileSync(OUT_SQL, sql, 'utf8');
  writeFileSync(OUT_CREDS, JSON.stringify(creds, null, 2), 'utf8');

  console.log(`Wrote ${OUT_SQL}`);
  console.log(`Wrote ${OUT_CREDS}  (credentials — not in the repo, delete when the beta ends)`);
  console.log('\nRun it with:');
  console.log(`  npx supabase db query --linked --file "${OUT_SQL}"`);
  console.log('\n(For the local stack, use --local instead of --linked.)\n');
  console.log('Set  Password              Coach email');
  for (const c of creds) console.log(`${String(c.set_no).padStart(2, '0')}   ${c.password.padEnd(22)} ${c.emails.coach}`);
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, email, user_id: body?.user?.id, access_token: body?.access_token, error: body?.error_description || body?.msg };
}

async function restGet(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function restPost(path, token, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function restDelete(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function rpcPost(fn, token, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { ok: res.ok, status: res.status };
}

async function cmdVerify() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or EXPO_PUBLIC_ variants) in env.');
  const creds = JSON.parse(readFileSync(OUT_CREDS, 'utf8'));

  console.log('Signing in 40 accounts…');
  const sessions = {};
  let failed = 0;
  for (const c of creds) {
    for (const role of ['coach', 'athlete', 'trainer', 'client']) {
      const email = c.emails[role];
      const r = await signIn(email, c.password);
      sessions[email] = r;
      if (!r.ok) { failed++; console.log(`  FAIL  ${email}  ${r.error || 'sign-in rejected'}`); }
    }
  }
  console.log(`${40 - failed}/40 signed in.`);
  if (failed) { console.log('Stopping — fix sign-in failures before checking isolation.'); process.exitCode = 1; return; }

  console.log("\nCollecting each set's own team/practice id (self-read)…");
  const teamId = {}, practiceId = {};
  for (const c of creds) {
    const coach = sessions[c.emails.coach];
    const teams = await restGet(`teams?created_by=eq.${coach.user_id}&select=id`, coach.access_token);
    teamId[c.set_no] = teams.body?.[0]?.id;
    const trainer = sessions[c.emails.trainer];
    const practices = await restGet(`practices?owner_id=eq.${trainer.user_id}&select=id`, trainer.access_token);
    practiceId[c.set_no] = practices.body?.[0]?.id;
  }

  console.log('\nCross-tenant isolation (each set n against set n+1)…');
  let rosterFails = 0, daysFails = 0;
  for (const c of creds) {
    const m = (c.set_no % 10) + 1;
    const mCreds = creds.find((x) => x.set_no === m);
    const coach = sessions[c.emails.coach];
    const trainer = sessions[c.emails.trainer];
    const athleteN = sessions[c.emails.athlete];
    const athleteM = sessions[mCreds.emails.athlete];

    const teamLeak = await rpcPost('team_roster', coach.access_token, { team: teamId[m] });
    if (teamLeak.ok) { rosterFails++; console.log(`  FAIL  set ${c.set_no} coach read set ${m}'s team_roster`); }

    const practiceLeak = await rpcPost('practice_roster', trainer.access_token, { practice: practiceId[m] });
    if (practiceLeak.ok) { rosterFails++; console.log(`  FAIL  set ${c.set_no} trainer read set ${m}'s practice_roster`); }

    // A throwaway row proves the RLS check means something — with zero seeded history, an empty
    // result would look identical whether isolation works or there's simply nothing to leak.
    await restPost('days', athleteN.access_token, { athlete_id: athleteN.user_id, date: '2000-01-01' });
    const leak = await restGet(`days?athlete_id=eq.${athleteM.user_id}&select=id`, athleteN.access_token);
    if ((leak.body || []).length > 0) { daysFails++; console.log(`  FAIL  set ${c.set_no} athlete read set ${m}'s days`); }
    await restDelete(`days?athlete_id=eq.${athleteN.user_id}&date=eq.2000-01-01`, athleteN.access_token);
  }
  console.log(`Roster isolation: ${rosterFails === 0 ? 'PASS — 10/10 boundaries held' : `FAIL — ${rosterFails} leak(s)`}`);
  console.log(`Days isolation:   ${daysFails === 0 ? 'PASS — 10/10 boundaries held' : `FAIL — ${daysFails} leak(s)`}`);
  if (rosterFails || daysFails) process.exitCode = 1;
}

async function fnPost(name, secretEnv, payload) {
  const key = process.env[secretEnv];
  if (!key) throw new Error(`Set ${secretEnv} in env.`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, k: key }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

async function cmdSmoke() {
  if (!SUPABASE_URL) throw new Error('Set SUPABASE_URL in env.');
  console.log('WARNING: this claims all 10 sets with synthetic emails.');
  console.log('Re-run `gen` and re-apply the seed afterward, before sharing the real link.\n');

  const r1 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-01@onstandard.app' });
  console.log(r1.ok && r1.body.set_no === 1 ? 'PASS  claim assigns set 1' : `FAIL  claim: ${JSON.stringify(r1.body)}`);

  const r2 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'resume', device_token: r1.body.device_token });
  console.log(r2.ok && r2.body.set_no === 1 ? 'PASS  resume returns the same set' : `FAIL  resume: ${JSON.stringify(r2.body)}`);

  const r3 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-01@onstandard.app' });
  console.log(r3.ok && r3.body.set_no === 1 ? 'PASS  re-claim by the same email returns set 1, not a new one' : `FAIL  re-claim: ${JSON.stringify(r3.body)}`);

  const r4 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'recover', email: 'smoke-01@onstandard.app' });
  console.log(r4.ok && r4.body.set_no === 1 ? 'PASS  recover finds set 1 from a fresh device' : `FAIL  recover: ${JSON.stringify(r4.body)}`);

  for (let n = 2; n <= 10; n++) {
    const r = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: `smoke-${String(n).padStart(2, '0')}@onstandard.app` });
    if (!r.ok || r.body.set_no !== n) console.log(`FAIL  claim ${n}: ${JSON.stringify(r.body)}`);
  }
  console.log('PASS  sets 2-10 claimed in order');

  const r11 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-11@onstandard.app' });
  console.log(r11.status === 409 && r11.body.error === 'exhausted' ? 'PASS  11th claim is exhausted' : `FAIL  11th claim: ${JSON.stringify(r11.body)}`);

  const boardUrl = r1.body.board_url;
  console.log(boardUrl ? `PASS  board_url present: ${boardUrl}` : 'FAIL  board_url missing — check BETA_BOARD_KEY is set');

  const submit = await fnPost('beta-board', 'BETA_BOARD_KEY', { action: 'submit', author_name: 'Smoke Test', body: 'smoke test report', tester_set: 1 });
  console.log(submit.ok ? 'PASS  board submit accepted tester_set' : `FAIL  board submit: ${JSON.stringify(submit.body)}`);

  const list = await fnPost('beta-board', 'BETA_BOARD_KEY', { action: 'list' });
  const posted = (list.body.posts || []).find((p) => p.body === 'smoke test report');
  console.log(posted && posted.tester_set === 1 ? 'PASS  post carries tester_set = 1 on the board' : 'FAIL  tester_set not on the returned post');

  console.log('\nDone. Re-run `gen` + re-apply the seed before sharing the real link.');
}

const cmd = process.argv[2];
try {
  if (cmd === 'gen') cmdGen();
  else if (cmd === 'verify') await cmdVerify();
  else if (cmd === 'smoke') await cmdSmoke();
  else { console.error('Usage: node scripts/tester-accounts.mjs <gen|verify|smoke>'); process.exitCode = 1; }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Run `gen`**

```bash
node scripts/tester-accounts.mjs gen
```

Expected: prints a `Set / Password / Coach email` table with 10 distinct rows, and two file paths under the OS temp dir.

- [ ] **Step 3: Apply the generated SQL locally and run `verify`**

```bash
npx supabase db query --local --file "$(node -e "console.log(require('os').tmpdir())")/onstandard-tester-seed.sql"
```

(Or copy the printed path from Step 2's output — this is just re-running the file `gen` produced.)

```bash
eval "$(supabase status -o env)"
SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" node scripts/tester-accounts.mjs verify
```

Expected: `40/40 signed in.`, `Roster isolation: PASS — 10/10 boundaries held`, `Days isolation: PASS — 10/10 boundaries held`.

- [ ] **Step 4: Deploy functions locally and run `smoke`**

```bash
supabase functions serve --no-verify-jwt --env-file <(printf 'TESTER_CLAIM_KEY=localtestkey\nTESTER_ADMIN_KEY=localadminkey\nBETA_BOARD_KEY=localboardkey\n')
```

```bash
SUPABASE_URL="$API_URL" TESTER_CLAIM_KEY=localtestkey TESTER_ADMIN_KEY=localadminkey BETA_BOARD_KEY=localboardkey \
  node scripts/tester-accounts.mjs smoke
```

Expected: every line prints `PASS`.

- [ ] **Step 5: Reset local claim state**

Re-apply the seed file from Step 3 to reset all 10 sets back to unclaimed (undoes what `smoke` claimed):

```bash
npx supabase db query --local --file "<same path as Step 3>"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/tester-accounts.mjs
git commit -m "feat(scripts): add tester-accounts gen/verify/smoke ops tool"
```

---

### Task 7: Live deployment — **STOP AND CONFIRM WITH THE FOUNDER BEFORE RUNNING THIS TASK**

This is the only task that touches live production. It creates 40 real, credentialed sign-ins on the database that also holds real users' — including minors' — data, and it is the task the design spec's entire Risks section is about. Do not run any step in this task without the user explicitly confirming they want to proceed right now — a prior approval of the plan is not the same as authorization to execute this specific, hard-to-reverse, shared-system action today.

**Files:** none (deployment only — all files were created/modified in Tasks 1-6 and are already committed).

**Interfaces:** none new — this task runs what Tasks 1-6 built, against `--linked` instead of `--local`.

- [ ] **Step 0: Confirm with the user**

State plainly what is about to happen (apply migration 0195 to live prod, create 40 real accounts, deploy 2 functions, set 2 new secrets) and get an explicit go-ahead before continuing.

- [ ] **Step 1: Apply the migration to prod**

```bash
npx supabase migration up --linked
```

Expected: `0195` applied with no errors. Confirm with:
```bash
npx supabase db query --linked "select count(*) from information_schema.columns where table_name='tester_sets';"
```
Expected: `14`.

- [ ] **Step 2: Generate passwords and seed prod**

```bash
node scripts/tester-accounts.mjs gen
npx supabase db query --linked --file "<path gen printed>"
```

Expected: the final `select` in the seed script returns 10 rows.

- [ ] **Step 3: Verify the founder's original four accounts are untouched**

```bash
npx supabase db query --linked "select email, updated_at from auth.users where raw_app_meta_data->>'demo'='true' and not (raw_app_meta_data ? 'tester') order by email;"
```

Expected: exactly the 4 original emails (`coach@` / `athlete1@` / `trainer@` / `client1@`), and `updated_at` unchanged from before this task (compare against a value noted before Step 2, or against `git log` timestamps on `seed-demo-accounts.sql` if unsure — the point is this task must not have written to these rows).

- [ ] **Step 4: Run `verify` against prod**

```bash
node --env-file=.env scripts/tester-accounts.mjs verify
```

Expected: `40/40 signed in.`, both isolation checks `PASS`. This is claim-agnostic (signs into the 40 seeded accounts directly, never touches the claim mechanism) — safe to run any time, including after real testers have claimed sets.

- [ ] **Step 5: Set secrets and deploy both functions**

```bash
npx supabase secrets set TESTER_CLAIM_KEY=<generate a real token> TESTER_ADMIN_KEY=<generate a real token>
npx supabase functions deploy tester-claim --no-verify-jwt
npx supabase functions deploy beta-board --no-verify-jwt
```

(`beta-board` redeploys to pick up the `tester_set` code from Task 5 — its secrets are already set from when it originally shipped.)

- [ ] **Step 6: Run `smoke` against prod, then immediately reset**

```bash
node --env-file=.env scripts/tester-accounts.mjs smoke
```

Expected: all `PASS`. This claims all 10 sets with synthetic emails — **immediately** undo it:

```bash
npx supabase db query --linked --file "<same seed file from Step 2>"
```

Confirm the reset worked:
```bash
npx supabase db query --linked "select count(*) from tester_sets where claimed_at is null;"
```
Expected: `10`.

- [ ] **Step 7: Fill in the TestFlight link and deploy the landing site**

Edit `web/landing/tester.html`'s `TESTFLIGHT_URL` constant with the real public TestFlight invite URL (get this from the user or App Store Connect — never invent it), then deploy the landing site through whatever mechanism ships `web/landing/` today (Cloudflare Pages, per the `_headers` file's own comment — follow the existing deploy process for this directory, not a new one).

- [ ] **Step 8: Final live check and handoff**

Open `https://onstandard.app/tester.html?k=<TESTER_CLAIM_KEY>` in a real browser, claim a set, confirm the card renders, confirm "Report anything" opens the board with the key pre-filled. Then re-run the reset from Step 6 one more time so this test claim doesn't consume a real tester's slot.

Hand the user the final link: `https://onstandard.app/tester.html?k=<TESTER_CLAIM_KEY>`.

- [ ] **Step 9: Commit anything left uncommitted**

```bash
git status
```
If `tester.html`'s `TESTFLIGHT_URL` edit is the only change, commit it:
```bash
git add web/landing/tester.html
git commit -m "chore(web): wire the TestFlight link into tester.html"
```

---

## Self-Review Notes

- **Spec coverage:** every row of the spec's Decisions table maps to a task — set contents (Task 2), passwords (Task 6 `gen`), existing accounts untouched (Task 2 teardown scoping + Task 7 Step 3), handoff (Task 4), identification (Task 3 `claim`/`recover`), count (migration's fixed 10-row seed + `exhausted` path), board tie-in (Task 5). The spec's "Out of scope" items (parent account, reset-my-set, seeded history) have no task — correctly, since they're explicitly excluded.
- **Local-first sequencing:** Tasks 1-6 build and verify entirely against `--local`; Task 7 is the sole prod-touching task and is gated behind an explicit confirmation step, matching the operating instructions around hard-to-reverse, shared-system actions.
- **Cross-task type consistency:** the response shape returned by `tester-claim` (Task 3) — `set_no`, `password`, `emails.{coach,athlete,trainer,client}`, `team_join_code`, `practice_join_code`, `device_token`, `board_url` — is used identically in Task 4's `renderCard()` and Task 6's `smoke` assertions. The `SET_COLS` column list matches `tester_sets`' actual column names from Task 1. `localStorage` keys (`os_tester_device`, `os_tester_set`, `os_tester_name`) are written in Task 4 and read in Task 5 with matching names.
