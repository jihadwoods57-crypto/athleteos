-- OnStandard 0255: dining hall menus (goals and eating plan, phase C, 2026-09-26).
--
-- Founder, 2026-09-26: "Maybe the nutritionist can upload the dining halls meal schedules to that
-- app so it could know and make it useful." A team's staff upload a hall's menu (photos, a PDF or
-- pasted text); ONE model call per upload turns it into a DRAFT (edge function dining-menu); staff
-- review and edit the draft and press Publish; only then do the team's athletes see it, as
-- dining-hall plates among their meal ideas on Plan > Today (built deterministically on the
-- device, no per-athlete model call) and as a compact list in Nia's chat context.
--
-- WHO. Staff who edit the team's standard: the same role set as 0252 can_set_team_phase (head
-- coach, coordinator and its legacy 'assistant', nutritionist, S&C, team admin; the proto
-- staff-access.js TARGET_ROLES list). Teams only: a trainer's practice and a solo athlete have no
-- halls. Every active staffer of the team may READ halls and menus (drafts included), so view-only
-- staff see what their athletes will see; only the editors write.
--
-- 1. dining_halls: name + serving hours, per team (at most 8). hours is a list of rules
--    { period, days: [0..6] (Sunday = 0), from: 'HH:MM', to: 'HH:MM' }; a later rule for the same
--    period and weekday wins. Sanitized on every read by js/dining-menu.js cleanHours (mirrored to
--    _shared/dining-menu.mjs); the database bounds the size only.
-- 2. dining_menu_uploads: one row per upload. The files live in the private 'dining-menus' bucket
--    at <team_id>/<upload_id>/<n>.<ext>; pasted text lives on the row. status pending -> parsing ->
--    parsed | failed is moved ONLY by the function (service role), and the pending -> parsing claim
--    is a single conditional update, which is what makes it one parse per upload.
-- 3. dining_menus: one row per hall, date, period and status ('draft' | 'published'), items as a
--    bounded jsonb list. The function writes drafts; staff edit drafts directly (RLS: drafts
--    only); publish_dining_day / unpublish_dining_day are the ONLY ways a row changes status, so a
--    published menu is never edited in place: unpublish, edit, publish, or upload a replacement.
--    Athletes of the team read PUBLISHED rows only. Guardians, other teams and outsiders see
--    nothing (a guardian is not a team member, and can_view is not consulted: a menu is not
--    anyone's personal data).
-- 4. the 'dining-menus' storage bucket, private, images and PDF, 10 MB, folder-scoped to the team
--    by its first path segment, editors only.
--
-- Additive and idempotent. The client and the function treat every object here as optional.

-- ---------------------------------------------------------------- helpers
/* An ACTIVE athlete of the team. Menus are team data, so this is membership, not can_view. */
create or replace function is_team_athlete(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members m
    where m.team_id = t and m.athlete_id = auth.uid() and m.status = 'active'
  );
$$;
revoke all on function is_team_athlete(uuid) from public, anon;
grant execute on function is_team_athlete(uuid) to authenticated;

/* A serving's figures: absent or null, or a number inside a sane per-serving bound. */
create or replace function dining_serving_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  k text;
  lim constant jsonb := '{"protein":200,"kcal":3000,"carbs":400,"fat":200}';
begin
  if p is null or p = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if not lim ? k then return false; end if;
    if p -> k = 'null'::jsonb then continue; end if;
    if jsonb_typeof(p -> k) <> 'number' then return false; end if;
    if (p ->> k)::numeric < 0 or (p ->> k)::numeric > (lim ->> k)::numeric then return false; end if;
  end loop;
  return true;
end $$;

/* The items list the client and the function both write through dining-menu.js cleanMenuItem.
   This is the database's own bound on shape and size, so a hand-rolled request cannot store a
   blob, a script-shaped name or an absurd figure. */
create or replace function dining_items_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  e jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) > 60 or pg_column_size(p) > 65536 then return false; end if;
  for e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if jsonb_typeof(e -> 'name') is distinct from 'string' then return false; end if;
    if char_length(e ->> 'name') not between 1 and 80 or (e ->> 'name') ~ '[<>{}]' then return false; end if;
    if e ? 'station' and e -> 'station' <> 'null'::jsonb
       and (jsonb_typeof(e -> 'station') <> 'string' or char_length(e ->> 'station') > 40 or (e ->> 'station') ~ '[<>{}]') then
      return false;
    end if;
    if e ? 'kind' and e -> 'kind' <> 'null'::jsonb
       and (e ->> 'kind') not in ('protein', 'carb', 'veg', 'fruit', 'other') then
      return false;
    end if;
    if e ? 'per_serving' and not dining_serving_ok(e -> 'per_serving') then return false; end if;
    if e ? 'tags' and e -> 'tags' <> 'null'::jsonb
       and (jsonb_typeof(e -> 'tags') <> 'array' or jsonb_array_length(e -> 'tags') > 8) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------- 1. halls
create table if not exists public.dining_halls (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60 and name !~ '[<>{}]'),
  hours       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(hours) = 'array' and jsonb_array_length(hours) <= 16 and pg_column_size(hours) <= 4096),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists dining_halls_team on public.dining_halls (team_id);

comment on table public.dining_halls is
  'A team''s dining halls (phase C): name and serving hours per period and weekday. Standards editors (can_set_team_phase) write; the team''s staff and athletes read. 0255.';

create or replace function dining_halls_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('dining_halls:' || new.team_id::text, 0));
    if (select count(*) from dining_halls h where h.team_id = new.team_id) >= 8 then
      raise exception 'a team has at most 8 dining halls' using errcode = '23514';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.team_id := old.team_id;          -- a hall never moves to another team
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
revoke all on function dining_halls_guard() from public, anon, authenticated;

drop trigger if exists trg_dining_halls_guard on public.dining_halls;
create trigger trg_dining_halls_guard
  before insert or update on public.dining_halls
  for each row execute function dining_halls_guard();

alter table public.dining_halls enable row level security;

drop policy if exists dining_halls_read on public.dining_halls;
create policy dining_halls_read on public.dining_halls
  for select using (is_staff_of_team(team_id) or is_team_athlete(team_id));

drop policy if exists dining_halls_insert on public.dining_halls;
create policy dining_halls_insert on public.dining_halls
  for insert with check (can_set_team_phase(team_id));

drop policy if exists dining_halls_update on public.dining_halls;
create policy dining_halls_update on public.dining_halls
  for update using (can_set_team_phase(team_id)) with check (can_set_team_phase(team_id));

drop policy if exists dining_halls_delete on public.dining_halls;
create policy dining_halls_delete on public.dining_halls
  for delete using (can_set_team_phase(team_id));

revoke all on table public.dining_halls from public, anon, authenticated;
grant select, insert, update, delete on public.dining_halls to authenticated;
grant select, insert, update, delete on public.dining_halls to service_role;

-- ---------------------------------------------------------------- 2. uploads
create table if not exists public.dining_menu_uploads (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  hall_id     uuid not null references public.dining_halls(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('photo', 'pdf', 'text')),
  paths       text[] not null default '{}' check (cardinality(paths) <= 6),
  text_body   text check (text_body is null or char_length(text_body) between 1 and 20000),
  starts_on   date not null,
  status      text not null default 'pending' check (status in ('pending', 'parsing', 'parsed', 'failed')),
  error       text check (error is null or char_length(error) <= 60),
  entries     int check (entries is null or entries between 0 and 100),
  parsed_at   timestamptz,
  check ((kind = 'text') = (text_body is not null)),
  check (kind = 'text' or cardinality(paths) between 1 and 6),
  check (kind <> 'pdf' or cardinality(paths) = 1)
);
create index if not exists dining_menu_uploads_hall on public.dining_menu_uploads (hall_id, created_at desc);

comment on table public.dining_menu_uploads is
  'One menu upload (photos, a PDF or pasted text) for a dining hall. The dining-menu function claims it once (pending -> parsing) and writes DRAFT menus from it. 0255.';

create or replace function dining_uploads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  p text;
begin
  select h.team_id into v_team from dining_halls h where h.id = new.hall_id;
  if v_team is null or v_team <> new.team_id then
    raise exception 'that hall is not on this team' using errcode = '23514';
  end if;
  -- Files only inside this upload's own folder of this team's bucket space.
  foreach p in array coalesce(new.paths, '{}') loop
    if p is null or p !~ ('^' || new.team_id::text || '/' || new.id::text || '/[0-9]{1,2}\.(jpg|png|webp|pdf)$') then
      raise exception 'an upload file must sit in its own folder' using errcode = '23514';
    end if;
  end loop;
  if new.starts_on < current_date - 7 or new.starts_on > current_date + 30 then
    raise exception 'a menu starts within a week back or a month ahead' using errcode = '23514';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  -- A signed-in user only ever files a pending upload; the service role moves the status.
  if auth.uid() is not null then
    new.status := 'pending'; new.error := null; new.entries := null; new.parsed_at := null;
  end if;
  return new;
end $$;
revoke all on function dining_uploads_guard() from public, anon, authenticated;

drop trigger if exists trg_dining_uploads_guard on public.dining_menu_uploads;
create trigger trg_dining_uploads_guard
  before insert on public.dining_menu_uploads
  for each row execute function dining_uploads_guard();

alter table public.dining_menu_uploads enable row level security;

drop policy if exists dining_uploads_read on public.dining_menu_uploads;
create policy dining_uploads_read on public.dining_menu_uploads
  for select using (can_set_team_phase(team_id));

drop policy if exists dining_uploads_insert on public.dining_menu_uploads;
create policy dining_uploads_insert on public.dining_menu_uploads
  for insert with check (can_set_team_phase(team_id) and status = 'pending');

-- No update or delete policy: the function (service role) owns the status.
revoke all on table public.dining_menu_uploads from public, anon, authenticated;
grant select, insert on public.dining_menu_uploads to authenticated;
grant select, insert, update, delete on public.dining_menu_uploads to service_role;

-- ---------------------------------------------------------------- 3. menus
create table if not exists public.dining_menus (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  hall_id       uuid not null references public.dining_halls(id) on delete cascade,
  menu_date     date not null,
  period        text not null check (period in ('breakfast', 'lunch', 'dinner', 'late')),
  status        text not null default 'draft' check (status in ('draft', 'published')),
  items         jsonb not null default '[]'::jsonb check (dining_items_ok(items)),
  upload_id     uuid references public.dining_menu_uploads(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  published_at  timestamptz,
  published_by  uuid references public.profiles(id) on delete set null,
  unique (hall_id, menu_date, period, status)
);
create index if not exists dining_menus_team_day on public.dining_menus (team_id, menu_date) where status = 'published';

comment on table public.dining_menus is
  'A dining hall''s menu for one date and period. Draft (staff only, editable) or published (the team''s athletes read it). Status moves only through publish_dining_day / unpublish_dining_day. Macros are per-serving estimates. 0255.';

create or replace function dining_menus_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select h.team_id into v_team from dining_halls h where h.id = new.hall_id;
  if v_team is null then raise exception 'no such hall' using errcode = '23514'; end if;
  new.team_id := v_team;                 -- never the client's say-so
  if tg_op = 'INSERT' then
    if new.menu_date < current_date - 7 or new.menu_date > current_date + 45 then
      raise exception 'a menu date must be within a week back or 45 days ahead' using errcode = '23514';
    end if;
  else
    new.hall_id := old.hall_id;
    new.menu_date := old.menu_date;
    new.period := old.period;
    new.team_id := old.team_id;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function dining_menus_guard() from public, anon, authenticated;

drop trigger if exists trg_dining_menus_guard on public.dining_menus;
create trigger trg_dining_menus_guard
  before insert or update on public.dining_menus
  for each row execute function dining_menus_guard();

alter table public.dining_menus enable row level security;

drop policy if exists dining_menus_staff_read on public.dining_menus;
create policy dining_menus_staff_read on public.dining_menus
  for select using (is_staff_of_team(team_id));

drop policy if exists dining_menus_athlete_read on public.dining_menus;
create policy dining_menus_athlete_read on public.dining_menus
  for select using (status = 'published' and is_team_athlete(team_id));

-- Editors write DRAFTS only. A published row is changed by the two RPCs below and nothing else.
-- The team is checked on the HALL itself, so the check never leans on the client's team_id (the
-- guard trigger also overwrites it from the hall).
drop policy if exists dining_menus_insert on public.dining_menus;
create policy dining_menus_insert on public.dining_menus
  for insert with check (
    status = 'draft'
    and exists (select 1 from dining_halls h where h.id = dining_menus.hall_id and can_set_team_phase(h.team_id))
  );

drop policy if exists dining_menus_update on public.dining_menus;
create policy dining_menus_update on public.dining_menus
  for update using (status = 'draft' and can_set_team_phase(team_id))
  with check (status = 'draft' and can_set_team_phase(team_id));

drop policy if exists dining_menus_delete on public.dining_menus;
create policy dining_menus_delete on public.dining_menus
  for delete using (status = 'draft' and can_set_team_phase(team_id));

revoke all on table public.dining_menus from public, anon, authenticated;
grant select, insert, update, delete on public.dining_menus to authenticated;
grant select, insert, update, delete on public.dining_menus to service_role;

/* Publish a hall's day: every draft period replaces that period's published menu. An EMPTY draft
   (staff deleted every item) takes that period off the published menu instead. Periods with no
   draft keep what is published. Returns how many periods are now published from a draft. */
create or replace function publish_dining_day(p_hall uuid, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  r record;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select h.team_id into v_team from dining_halls h where h.id = p_hall;
  if v_team is null or not can_set_team_phase(v_team) then
    raise exception 'only staff who edit the team standard can publish menus' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dining_day:' || p_hall::text || ':' || p_date::text, 0));
  for r in select m.id, m.period, jsonb_array_length(m.items) as n_items
             from dining_menus m
            where m.hall_id = p_hall and m.menu_date = p_date and m.status = 'draft'
            order by m.period loop
    delete from dining_menus
     where hall_id = p_hall and menu_date = p_date and period = r.period and status = 'published';
    if r.n_items = 0 then
      delete from dining_menus where id = r.id;
    else
      update dining_menus set status = 'published', published_at = now(), published_by = auth.uid() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function publish_dining_day(uuid, date) from public, anon;
grant execute on function publish_dining_day(uuid, date) to authenticated;

/* Take a hall's day off the athletes' screens. Each published period goes back to a draft, unless
   a newer draft for it already exists (that draft is kept, the published copy is dropped).
   Returns how many periods were unpublished. */
create or replace function unpublish_dining_day(p_hall uuid, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  r record;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select h.team_id into v_team from dining_halls h where h.id = p_hall;
  if v_team is null or not can_set_team_phase(v_team) then
    raise exception 'only staff who edit the team standard can unpublish menus' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dining_day:' || p_hall::text || ':' || p_date::text, 0));
  for r in select m.id, m.period from dining_menus m
            where m.hall_id = p_hall and m.menu_date = p_date and m.status = 'published' loop
    if exists (select 1 from dining_menus d where d.hall_id = p_hall and d.menu_date = p_date
                 and d.period = r.period and d.status = 'draft') then
      delete from dining_menus where id = r.id;
    else
      update dining_menus set status = 'draft', published_at = null, published_by = null where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function unpublish_dining_day(uuid, date) from public, anon;
grant execute on function unpublish_dining_day(uuid, date) to authenticated;

-- ---------------------------------------------------------------- 4. the bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dining-menus', 'dining-menus', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* The team a bucket path belongs to (its first segment), or null for anything that is not a uuid.
   A cast inside a policy would throw on a malformed name; this answers null instead. */
create or replace function dining_path_team(p_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

drop policy if exists dining_menus_obj_read on storage.objects;
create policy dining_menus_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'dining-menus' and can_set_team_phase(dining_path_team(name)));

drop policy if exists dining_menus_obj_insert on storage.objects;
create policy dining_menus_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dining-menus' and can_set_team_phase(dining_path_team(name)));

drop policy if exists dining_menus_obj_delete on storage.objects;
create policy dining_menus_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dining-menus' and can_set_team_phase(dining_path_team(name)));
