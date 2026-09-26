-- OnStandard: dining hall menus (0255) authorization suite.
--
-- Halls: standards editors (head coach, nutritionist, ...) write; view-only staff, a position
-- coach, an athlete and another team's coach cannot; the team's staff and athletes read; another
-- team's athlete, a guardian and an outsider see nothing; at most 8 per team; a hall never moves.
-- Uploads: editors file a pending upload whose files sit in its own folder; nobody but the service
-- role moves its status; athletes and view-only staff never read one.
-- Menus: editors write DRAFTS only; athletes never see a draft; a published menu changes only
-- through publish_dining_day / unpublish_dining_day, which only editors may call; publishing makes
-- it visible to the team's athletes and nobody else; a new draft replaces the published period,
-- an empty draft takes it off; unpublish hides it again. Items are bounded by the database.
-- Storage: the 'dining-menus' bucket is editor-only, folder-scoped to the team.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/dining_hall_test.sql
-- One transaction, rolled back, scoreboard at the end, non-zero exit if any check failed.

begin;

-- ---------------------------------------------------------------- harness
create table _dh_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _dh_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label;
  else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon;

create or replace function _as(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function _as(uuid) to authenticated, anon;

create or replace function _superuser() returns void
language plpgsql as $$ begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '', false);
end $$;
grant execute on function _superuser() to authenticated, anon;

create or replace function _try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'denied(' || sqlstate || '): ' || sqlerrm;
end $$;
grant execute on function _try(text) to authenticated, anon;

/* Rows a statement touched (0 when RLS filtered it out silently). */
create or replace function _n(p_sql text) returns int
language plpgsql as $$
declare c int;
begin
  execute p_sql;
  get diagnostics c = row_count;
  return c;
exception when others then
  return -1;
end $$;
grant execute on function _n(text) to authenticated, anon;

-- ---------------------------------------------------------------- seed
-- 01 head coach T1 · 02 view-only T1 · 03 position coach T1 · 04 nutritionist T1 · 05 head coach T2
-- 0a athlete A (T1) · 0b athlete B (T2) · 0c outsider · 0d guardian of A
select _superuser();
insert into auth.users (id, email) values
  ('7fc00000-0000-0000-0000-000000000001'::uuid, 'dh-coach@x.io'),
  ('7fc00000-0000-0000-0000-000000000002'::uuid, 'dh-ro@x.io'),
  ('7fc00000-0000-0000-0000-000000000003'::uuid, 'dh-pos@x.io'),
  ('7fc00000-0000-0000-0000-000000000004'::uuid, 'dh-rd@x.io'),
  ('7fc00000-0000-0000-0000-000000000005'::uuid, 'dh-coach2@x.io'),
  ('7fc00000-0000-0000-0000-00000000000a'::uuid, 'dh-a@x.io'),
  ('7fc00000-0000-0000-0000-00000000000b'::uuid, 'dh-b@x.io'),
  ('7fc00000-0000-0000-0000-00000000000c'::uuid, 'dh-out@x.io'),
  ('7fc00000-0000-0000-0000-00000000000d'::uuid, 'dh-parent@x.io');
insert into profiles (id, full_name, email, primary_role) values
  ('7fc00000-0000-0000-0000-000000000001', 'Coach DH', 'dh-coach@x.io', 'coach'),
  ('7fc00000-0000-0000-0000-000000000002', 'Viewer DH', 'dh-ro@x.io', 'coach'),
  ('7fc00000-0000-0000-0000-000000000003', 'Position DH', 'dh-pos@x.io', 'coach'),
  ('7fc00000-0000-0000-0000-000000000004', 'Dietitian DH', 'dh-rd@x.io', 'coach'),
  ('7fc00000-0000-0000-0000-000000000005', 'Coach Two', 'dh-coach2@x.io', 'coach'),
  ('7fc00000-0000-0000-0000-00000000000a', 'Athlete A', 'dh-a@x.io', 'athlete'),
  ('7fc00000-0000-0000-0000-00000000000b', 'Athlete B', 'dh-b@x.io', 'athlete'),
  ('7fc00000-0000-0000-0000-00000000000c', 'Outsider', 'dh-out@x.io', 'athlete'),
  ('7fc00000-0000-0000-0000-00000000000d', 'Parent A', 'dh-parent@x.io', 'parent')
on conflict (id) do nothing;
insert into teams (id, name, join_code, created_by) values
  ('7fc00000-0000-0000-0000-0000000000d1'::uuid, 'DH One', 'DHTEAM01', '7fc00000-0000-0000-0000-000000000001'),
  ('7fc00000-0000-0000-0000-0000000000d2'::uuid, 'DH Two', 'DHTEAM02', '7fc00000-0000-0000-0000-000000000005');
insert into team_staff (team_id, staff_id, role, status) values
  ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-000000000001', 'head_coach', 'active'),
  ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-000000000002', 'readonly', 'active'),
  ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-000000000003', 'position_coach', 'active'),
  ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-000000000004', 'nutritionist', 'active'),
  ('7fc00000-0000-0000-0000-0000000000d2', '7fc00000-0000-0000-0000-000000000005', 'head_coach', 'active');
insert into team_members (team_id, athlete_id, status) values
  ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-00000000000a', 'active'),
  ('7fc00000-0000-0000-0000-0000000000d2', '7fc00000-0000-0000-0000-00000000000b', 'active');
insert into guardianships (athlete_id, guardian_id, relationship, status) values
  ('7fc00000-0000-0000-0000-00000000000a', '7fc00000-0000-0000-0000-00000000000d', 'parent', 'active');

-- ================================================================ halls
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_halls (id, team_id, name, hours) values ('7fc00000-0000-0000-0000-0000000000a1', '7fc00000-0000-0000-0000-0000000000d1', 'Knights Plaza', '[{"period":"lunch","days":[0,1,2,3,4,5,6],"from":"11:00","to":"14:00"}]')$q$) = 'ok',
  'halls: the nutritionist adds a hall');
select _as('7fc00000-0000-0000-0000-000000000001');
select _ok(_try($q$insert into dining_halls (id, team_id, name) values ('7fc00000-0000-0000-0000-0000000000a2', '7fc00000-0000-0000-0000-0000000000d1', '  Commons  ')$q$) = 'ok',
  'halls: the head coach adds a hall');
select _superuser();
select _ok((select name = 'Commons' and created_by = '7fc00000-0000-0000-0000-000000000001' from dining_halls where id = '7fc00000-0000-0000-0000-0000000000a2'),
  'halls: the name is trimmed and created_by is the caller');

select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', 'Sneaky')$q$) <> 'ok',
  'halls: view-only staff cannot add one');
select _as('7fc00000-0000-0000-0000-000000000003');
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', 'Sneaky')$q$) <> 'ok',
  'halls: a position coach cannot add one');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', 'Sneaky')$q$) <> 'ok',
  'halls: an athlete cannot add one');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', 'Sneaky')$q$) <> 'ok',
  'halls: another team''s head coach cannot add one to this team');
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', '<script>')$q$) <> 'ok',
  'halls: a markup-shaped name is refused');

-- reads
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from dining_halls) = 2, 'halls: the team''s athlete reads both halls');
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok((select count(*) from dining_halls) = 2, 'halls: view-only staff read them');
select _as('7fc00000-0000-0000-0000-00000000000b');
select _ok((select count(*) from dining_halls) = 0, 'halls: another team''s athlete sees none');
select _as('7fc00000-0000-0000-0000-00000000000d');
select _ok((select count(*) from dining_halls) = 0, 'halls: a guardian sees none');
select _as('7fc00000-0000-0000-0000-00000000000c');
select _ok((select count(*) from dining_halls) = 0, 'halls: an outsider sees none');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok((select count(*) from dining_halls) = 0, 'halls: another team''s coach sees none');

-- writes by the wrong people are silently filtered; a hall never moves team
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_n($q$update dining_halls set name = 'Renamed' where id = '7fc00000-0000-0000-0000-0000000000a1'$q$) <= 0,
  'halls: view-only staff cannot rename one');
select _ok(_n($q$delete from dining_halls where id = '7fc00000-0000-0000-0000-0000000000a1'$q$) <= 0,
  'halls: view-only staff cannot delete one');
select _as('7fc00000-0000-0000-0000-000000000004');
select _n($q$update dining_halls set team_id = '7fc00000-0000-0000-0000-0000000000d2', name = 'Knights Plaza North' where id = '7fc00000-0000-0000-0000-0000000000a1'$q$);
select _superuser();
select _ok((select team_id = '7fc00000-0000-0000-0000-0000000000d1' and name = 'Knights Plaza North' from dining_halls where id = '7fc00000-0000-0000-0000-0000000000a1'),
  'halls: an editor renames one, and it stays on its team');

-- at most 8
select _as('7fc00000-0000-0000-0000-000000000001');
select _try($q$insert into dining_halls (team_id, name) select '7fc00000-0000-0000-0000-0000000000d1', 'Hall ' || g from generate_series(3, 8) g$q$);
select _ok(_try($q$insert into dining_halls (team_id, name) values ('7fc00000-0000-0000-0000-0000000000d1', 'Ninth')$q$) like 'denied(23514)%',
  'halls: a ninth hall is refused');
select _superuser();
delete from dining_halls where name like 'Hall %';

-- ================================================================ uploads
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_menu_uploads (id, team_id, hall_id, kind, paths, starts_on, status, claimed_at)
  values ('7fc00000-0000-0000-0000-0000000000b1', '7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-0000000000a1', 'photo',
          array['7fc00000-0000-0000-0000-0000000000d1/7fc00000-0000-0000-0000-0000000000b1/0.jpg'], current_date, 'parsed', now())$q$) = 'ok',
  'uploads: an editor files one');
select _superuser();
select _ok((select status = 'pending' and created_by = '7fc00000-0000-0000-0000-000000000004' from dining_menu_uploads where id = '7fc00000-0000-0000-0000-0000000000b1'),
  'uploads: a signed-in caller only ever files a pending upload');
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_menu_uploads (team_id, hall_id, kind, paths, starts_on)
  values ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-0000000000a1', 'photo',
          array['7fc00000-0000-0000-0000-0000000000d2/elsewhere/0.jpg'], current_date)$q$) <> 'ok',
  'uploads: a file outside the upload''s own folder is refused');
select _ok(_try($q$insert into dining_menu_uploads (team_id, hall_id, kind, text_body, starts_on)
  values ('7fc00000-0000-0000-0000-0000000000d2', '7fc00000-0000-0000-0000-0000000000a1', 'text', 'Lunch: chicken', current_date)$q$) <> 'ok',
  'uploads: a hall filed under another team is refused');
select _ok(_try($q$insert into dining_menu_uploads (team_id, hall_id, kind, text_body, starts_on)
  values ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-0000000000a1', 'text', 'Lunch: chicken', current_date + 90)$q$) <> 'ok',
  'uploads: a start date months away is refused');
select _ok(_n($q$update dining_menu_uploads set status = 'parsed' where id = '7fc00000-0000-0000-0000-0000000000b1'$q$) <= 0,
  'uploads: an editor cannot move the status (the function owns it)');
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$insert into dining_menu_uploads (team_id, hall_id, kind, text_body, starts_on)
  values ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-0000000000a1', 'text', 'Lunch: chicken', current_date)$q$) <> 'ok',
  'uploads: view-only staff cannot file one');
select _ok((select count(*) from dining_menu_uploads) = 0, 'uploads: view-only staff read none');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into dining_menu_uploads (team_id, hall_id, kind, text_body, starts_on)
  values ('7fc00000-0000-0000-0000-0000000000d1', '7fc00000-0000-0000-0000-0000000000a1', 'text', 'Lunch: chicken', current_date)$q$) <> 'ok',
  'uploads: an athlete cannot file one');
select _ok((select count(*) from dining_menu_uploads) = 0, 'uploads: an athlete reads none');
select _superuser();
select _ok((select claimed_at is null from dining_menu_uploads where id = '7fc00000-0000-0000-0000-0000000000b1'),
  'uploads: a signed-in caller cannot pre-stamp the claim time');
select _ok(_n($q$update dining_menu_uploads set status = 'parsing' where id = '7fc00000-0000-0000-0000-0000000000b1' and status = 'pending'$q$) = 1
       and _n($q$update dining_menu_uploads set status = 'parsing' where id = '7fc00000-0000-0000-0000-0000000000b1' and status = 'pending'$q$) = 0,
  'uploads: the claim is one-shot (the second pending -> parsing touches nothing)');

-- ================================================================ menus: drafts
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_menus (hall_id, team_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', '7fc00000-0000-0000-0000-0000000000d2', current_date, 'lunch',
          '[{"name":"Grilled chicken","station":"Grill","kind":"protein","per_serving":{"protein":35,"kcal":280},"tags":[]},{"name":"Brown rice","kind":"carb","per_serving":{"protein":5,"kcal":220}}]')$q$) = 'ok',
  'menus: an editor writes a draft');
select _superuser();
select _ok((select team_id = '7fc00000-0000-0000-0000-0000000000d1' and status = 'draft' from dining_menus where hall_id = '7fc00000-0000-0000-0000-0000000000a1' and period = 'lunch'),
  'menus: the team comes from the hall, never the client');
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, status, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', 'published', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: an editor cannot write a PUBLISHED row directly');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"<img src=x>"}]')$q$) <> 'ok',
  'menus: a markup-shaped item name is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak","per_serving":{"protein":9000}}]')$q$) <> 'ok',
  'menus: an absurd figure is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak","per_serving":{"protein":"lots"}}]')$q$) <> 'ok',
  'menus: a figure that is not a number is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'brunch', '[{"name":"Waffles"}]')$q$) <> 'ok',
  'menus: an unknown period is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 100, 'dinner', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: a date months away is refused');
-- the item shape (review round): known keys only, tags from the ONE vocabulary (dining-menu.js MENU_TAGS)
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 2, 'dinner', '[{"name":"Alfredo","tags":["contains dairy","contains wheat","gluten free"]}]')$q$) = 'ok',
  'items: vocabulary tags are accepted');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 3, 'dinner', '[{"name":"Alfredo","tags":["spicy"]}]')$q$) <> 'ok',
  'items: a tag outside the vocabulary is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 3, 'dinner', '[{"name":"Alfredo","tags":[7]}]')$q$) <> 'ok',
  'items: a tag that is not a string is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 3, 'dinner', '[{"name":"Alfredo","tags":["vegan","vegan","vegan","vegan","vegan","vegan","vegan","vegan","vegan"]}]')$q$) <> 'ok',
  'items: more than 8 tags is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 3, 'dinner', '[{"name":"Alfredo","note":"<script>"}]')$q$) <> 'ok',
  'items: an unknown key is refused');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date + 3, 'dinner', '[{"name":"Alfredo","per_serving":{"protein":20,"sugar":9}}]')$q$) <> 'ok',
  'items: an unknown figure is refused');
select _superuser();
delete from dining_menus where menu_date = current_date + 2;
select _as('7fc00000-0000-0000-0000-000000000004');

select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: view-only staff cannot write a draft');
select _ok((select count(*) from dining_menus) = 1, 'menus: view-only staff read the draft');
select _as('7fc00000-0000-0000-0000-000000000003');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: a position coach cannot write a draft');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: another team''s coach cannot write into this team''s hall');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Steak"}]')$q$) <> 'ok',
  'menus: an athlete cannot write a draft');
select _ok((select count(*) from dining_menus) = 0, 'menus: the team''s athlete never sees a draft');

-- editing a draft
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_n($q$update dining_menus set items = items || '[{"name":"Roasted broccoli","kind":"veg","per_serving":{"protein":3,"kcal":60}}]'::jsonb where period = 'lunch' and status = 'draft'$q$) = 1,
  'menus: an editor edits a draft');
select _ok(_try($q$update dining_menus set status = 'published' where period = 'lunch'$q$) <> 'ok',
  'menus: an editor cannot publish by updating the status');
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_n($q$update dining_menus set items = '[]' where period = 'lunch'$q$) <= 0,
  'menus: view-only staff cannot edit a draft');

-- ================================================================ menus: publish
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date)$q$) <> 'ok',
  'publish: view-only staff cannot publish');
select _as('7fc00000-0000-0000-0000-000000000003');
select _ok(_try($q$select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date)$q$) <> 'ok',
  'publish: a position coach cannot publish');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok(_try($q$select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date)$q$) <> 'ok',
  'publish: an athlete cannot publish');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok(_try($q$select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date)$q$) <> 'ok',
  'publish: another team''s coach cannot publish this team''s hall');
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date) = 1,
  'publish: the nutritionist publishes the day (one period)');

select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from dining_menus where status = 'published') = 1
       and (select jsonb_array_length(items) from dining_menus where period = 'lunch') = 3,
  'publish: the team''s athlete now reads the published lunch, all three items');
select _as('7fc00000-0000-0000-0000-00000000000b');
select _ok((select count(*) from dining_menus) = 0, 'publish: another team''s athlete sees nothing');
select _as('7fc00000-0000-0000-0000-00000000000d');
select _ok((select count(*) from dining_menus) = 0, 'publish: a guardian sees nothing');
select _as('7fc00000-0000-0000-0000-00000000000c');
select _ok((select count(*) from dining_menus) = 0, 'publish: an outsider sees nothing');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok((select count(*) from dining_menus) = 0, 'publish: another team''s coach sees nothing');

-- a published row is never edited in place
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_n($q$update dining_menus set items = '[{"name":"Swapped"}]' where status = 'published'$q$) <= 0,
  'publish: an editor cannot edit a published menu in place');
select _ok(_n($q$delete from dining_menus where status = 'published'$q$) <= 0,
  'publish: an editor cannot delete a published menu directly');

-- replace: a new draft for the same period, then publish
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'lunch', '[{"name":"Turkey burger","kind":"protein","per_serving":{"protein":30,"kcal":450}}]')$q$) = 'ok',
  'replace: an editor drafts a replacement for a published period');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select items -> 0 ->> 'name' from dining_menus where period = 'lunch') = 'Grilled chicken',
  'replace: the athlete still sees the published menu while the replacement is a draft');
select _as('7fc00000-0000-0000-0000-000000000004');
select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date);
select _superuser();
select _ok((select count(*) from dining_menus where period = 'lunch') = 1
       and (select items -> 0 ->> 'name' from dining_menus where period = 'lunch' and status = 'published') = 'Turkey burger',
  'replace: publishing swaps in the replacement and leaves one row');

-- an empty draft takes the period off
select _as('7fc00000-0000-0000-0000-000000000004');
select _try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'lunch', '[]')$q$);
select _ok(publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date) = 0,
  'empty: publishing an emptied draft publishes nothing new');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from dining_menus) = 0, 'empty: and the athlete no longer sees that period');

-- unpublish
select _as('7fc00000-0000-0000-0000-000000000004');
select _try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a1', current_date, 'dinner', '[{"name":"Salmon","kind":"protein"}]')$q$);
select publish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date);
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from dining_menus) = 1, 'unpublish: (the athlete sees dinner first)');
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$select unpublish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date)$q$) <> 'ok',
  'unpublish: view-only staff cannot unpublish');
select _as('7fc00000-0000-0000-0000-000000000001');
select _ok(unpublish_dining_day('7fc00000-0000-0000-0000-0000000000a1', current_date) = 1,
  'unpublish: the head coach unpublishes the day');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from dining_menus) = 0, 'unpublish: the athlete sees nothing again');
select _as('7fc00000-0000-0000-0000-000000000001');
select _ok((select status from dining_menus where period = 'dinner') = 'draft',
  'unpublish: the menu is back to an editable draft');

-- ================================================================ storage
select _as('7fc00000-0000-0000-0000-000000000004');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('dining-menus', '7fc00000-0000-0000-0000-0000000000d1/7fc00000-0000-0000-0000-0000000000b1/0.jpg')$q$) = 'ok',
  'storage: an editor uploads into the team''s folder');
select _ok((select count(*) from storage.objects where bucket_id = 'dining-menus') = 1, 'storage: and reads it');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('dining-menus', '7fc00000-0000-0000-0000-0000000000d2/x/0.jpg')$q$) <> 'ok',
  'storage: an editor cannot upload into another team''s folder');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('dining-menus', 'not-a-team/x/0.jpg')$q$) <> 'ok',
  'storage: a malformed folder is refused (and does not throw a cast error through the policy)');
select _as('7fc00000-0000-0000-0000-000000000002');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('dining-menus', '7fc00000-0000-0000-0000-0000000000d1/y/0.jpg')$q$) <> 'ok',
  'storage: view-only staff cannot upload');
select _ok((select count(*) from storage.objects where bucket_id = 'dining-menus') = 0, 'storage: view-only staff read none');
select _as('7fc00000-0000-0000-0000-00000000000a');
select _ok(_try($q$insert into storage.objects (bucket_id, name) values ('dining-menus', '7fc00000-0000-0000-0000-0000000000d1/z/0.jpg')$q$) <> 'ok',
  'storage: an athlete cannot upload');
select _ok((select count(*) from storage.objects where bucket_id = 'dining-menus') = 0, 'storage: an athlete reads none');
select _as('7fc00000-0000-0000-0000-000000000005');
select _ok((select count(*) from storage.objects where bucket_id = 'dining-menus') = 0, 'storage: another team''s coach reads none');
select _superuser();
select _ok((select public = false and 'application/pdf' = any(allowed_mime_types) and file_size_limit = 10485760 from storage.buckets where id = 'dining-menus'),
  'storage: the bucket is private, takes PDFs, and is capped at 10 MB');

-- ================================================================ the service role (the function)
select _superuser();
set local role service_role;
select _ok(_try($q$insert into dining_menus (hall_id, menu_date, period, items)
  values ('7fc00000-0000-0000-0000-0000000000a2', current_date + 1, 'breakfast', '[{"name":"Oatmeal","kind":"carb"}]')$q$) = 'ok',
  'service role: the function writes a draft');
reset role;

-- ================================================================ scoreboard
select _superuser();
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _dh_results;
  raise notice '================================================';
  raise notice 'DINING HALL SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    for bad in select label from _dh_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'DINING HALL SUITE FAILED: % check(s), see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
