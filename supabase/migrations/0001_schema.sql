-- OnStandard — Phase 2 multi-tenant schema
-- See docs/specs/phase2-multitenant-backend.md. Run order: 0001 -> 0002 -> 0003.
-- Principle: one athlete = one source of truth; coaches/parents/trainers are linked
-- viewers. The athlete is the ONLY writer of their own day/meals/checkins.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
create type user_role     as enum ('athlete', 'parent', 'coach', 'trainer');
create type org_type      as enum ('school', 'club', 'independent');
create type comp_mode      as enum ('position', 'team', 'off');
create type link_status    as enum ('active', 'invited', 'removed');
create type staff_role     as enum ('head_coach', 'assistant');

-- ---------------------------------------------------------------- shared updated_at
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------------------------------------------------------------- profiles (1:1 auth.users)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  primary_role  user_role not null default 'athlete',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- auto-create a profile when an auth user signs up
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ---------------------------------------------------------------- orgs / teams / practices
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        org_type not null default 'school',
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table teams (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references orgs(id) on delete cascade,
  name              text not null,
  sport             text,
  join_code         text not null unique,
  competition_mode  comp_mode not null default 'position',
  -- {tracked:{nutrition,recovery,hydration,weight,tasks},
  --  checkin_questions:{energy,recovery,sleep,confidence,soreness,motivation}}
  settings          jsonb not null default '{}'::jsonb,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger teams_updated before update on teams
  for each row execute function set_updated_at();

create table practices (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade, -- the trainer
  name        text not null,
  join_code   text not null unique,
  plan        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- link tables (RLS spine)
create table team_members (
  team_id     uuid not null references teams(id) on delete cascade,
  athlete_id  uuid not null references profiles(id) on delete cascade,
  position    text,
  status      link_status not null default 'active',
  joined_at   timestamptz not null default now(),
  primary key (team_id, athlete_id)
);
create index team_members_athlete on team_members(athlete_id) where status = 'active';

create table team_staff (
  team_id   uuid not null references teams(id) on delete cascade,
  staff_id  uuid not null references profiles(id) on delete cascade,
  role      staff_role not null default 'head_coach',
  status    link_status not null default 'active',
  primary key (team_id, staff_id)
);
create index team_staff_staff on team_staff(staff_id) where status = 'active';

create table practice_clients (
  practice_id     uuid not null references practices(id) on delete cascade,
  client_id       uuid not null references profiles(id) on delete cascade,
  org_label       text,
  status          link_status not null default 'active',
  last_active_at  timestamptz,
  primary key (practice_id, client_id)
);
create index practice_clients_client on practice_clients(client_id) where status = 'active';

create table guardianships (
  athlete_id    uuid not null references profiles(id) on delete cascade,
  guardian_id   uuid not null references profiles(id) on delete cascade,
  relationship  text,
  status        link_status not null default 'active',
  primary key (athlete_id, guardian_id)
);
create index guardianships_guardian on guardianships(guardian_id) where status = 'active';

-- ---------------------------------------------------------------- athlete data (athlete-owned)
create table athlete_profiles (
  athlete_id    uuid primary key references profiles(id) on delete cascade,
  level         text,
  sport         text,
  position      text,
  base_height   int,
  base_weight   int,
  base_age      int,
  base_goal     text,
  targets       jsonb not null default '{}'::jsonb,   -- {protein, calories, weight} (coach-editable)
  season_goal   jsonb not null default '{}'::jsonb,   -- {start, target, deadline}
  team_code     text,
  updated_at    timestamptz not null default now()
);
create trigger athlete_profiles_updated before update on athlete_profiles
  for each row execute function set_updated_at();

create table days (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,
  date          date not null,
  meals         jsonb not null default '{}'::jsonb,
  hydration_l   numeric(4,1) not null default 0,
  tasks         jsonb not null default '[]'::jsonb,
  quick_added   jsonb not null default '[]'::jsonb,
  current_weight int,
  checkin       jsonb not null default '{}'::jsonb,
  score         int,    -- computed client-side by src/core; see 0002 note on optional server recompute
  grade         text,
  computed_at   timestamptz,
  updated_at    timestamptz not null default now(),
  unique (athlete_id, date)
);
create index days_athlete_date on days(athlete_id, date desc);
create trigger days_updated before update on days
  for each row execute function set_updated_at();

create table meals (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references profiles(id) on delete cascade,
  day_date    date not null,
  type        text,                  -- Breakfast | Lunch | Snack | Dinner
  photo_path  text,                  -- storage: meal-photos/{athlete_id}/{date}/{meal_id}.jpg
  name        text,
  protein     int,
  kcal        int,
  carbs       int,
  fat         int,
  quality     int,
  detected    jsonb not null default '[]'::jsonb,
  note        text,
  logged_at   timestamptz not null default now()
);
create index meals_athlete_day on meals(athlete_id, day_date desc);

create table checkins (
  id            uuid primary key default gen_random_uuid(),
  athlete_id    uuid not null references profiles(id) on delete cascade,
  week          text not null,
  weight        int,
  energy        int, recovery int, sleep int, confidence int, soreness int, motivation int,
  notes         text,
  ai_summary    text,
  submitted_at  timestamptz not null default now(),
  unique (athlete_id, week)
);

-- ---------------------------------------------------------------- messaging
create table threads (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references profiles(id) on delete cascade,
  counterpart_id  uuid not null references profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (athlete_id, counterpart_id)
);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references threads(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  text        text not null,
  sent_at     timestamptz not null default now()
);
create index messages_thread on messages(thread_id, sent_at);
