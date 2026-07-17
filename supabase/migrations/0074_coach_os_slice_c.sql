-- OnStandard — Coach OS Slice C: announcements + requirement templates + item-window rails
-- (spec: docs/superpowers/specs/2026-07-16-coach-os-design.md, Slice C).
-- One slice, one migration (0055 idiom). Forward-only, idempotent.
--
-- announcements: a coach broadcast to a scoped audience. The row is the durable coach-side
--   record; athlete delivery is notify() feed rows (fan-out in post_announcement) + Expo
--   push via the send-push edge function (announcement mode — push only, never feed rows,
--   so nothing is double-delivered). Athletes never read this table.
-- requirement_templates: named, reusable requirement-set item lists (game week, travel…).
--   Direct-table RLS rw for staff (coach_groups idiom) — templates are drafts, not the
--   governing standard; publishing still goes through set_team_requirements' rails.
-- validate_requirement_items: now also rails the optional window {open,due,label} and
--   numeric target riding on items (windows drive due-soon/overdue + nudge timing).

create table if not exists announcements (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  author_id   uuid not null default auth.uid() references profiles(id),
  scope_kind  text not null default 'team' check (scope_kind in ('team','position','group','athlete')),
  scope_value text,
  title       text not null check (char_length(trim(title)) between 2 and 80),
  body        text not null check (char_length(trim(body)) between 1 and 500),
  sent_count  int not null default 0,
  created_at  timestamptz not null default now(),
  constraint ann_scope_shape check (
    (scope_kind = 'team' and scope_value is null) or
    (scope_kind <> 'team' and scope_value is not null)
  )
);
create index if not exists ann_team_created on announcements (team_id, created_at desc);
alter table announcements enable row level security;
drop policy if exists ann_staff_read on announcements;
create policy ann_staff_read on announcements
  for select using (is_team_staff(team_id));
drop policy if exists ann_author_delete on announcements;
create policy ann_author_delete on announcements
  for delete using (is_team_staff(team_id) and author_id = auth.uid());
-- No insert policy: writes go through post_announcement (SECURITY DEFINER) so the
-- audience fan-out can never be skipped or forged. Table privileges: SELECT (read by
-- staff via ann_staff_read) is granted by the schema default; the DELETE grant makes the
-- ann_author_delete policy actually usable (a policy without the table privilege is dead).
grant select, delete on announcements to authenticated;

create or replace function post_announcement(
  p_team uuid, p_scope_kind text, p_scope_value text, p_title text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ann_id uuid;
  n int := 0;
  ath record;
begin
  if not is_team_staff(p_team) then
    raise exception 'not team staff';
  end if;
  insert into announcements (team_id, author_id, scope_kind, scope_value, title, body)
  values (p_team, auth.uid(), coalesce(p_scope_kind,'team'),
          case when coalesce(p_scope_kind,'team') = 'team' then null else p_scope_value end,
          trim(p_title), trim(p_body))
  returning id into ann_id;

  for ath in
    select tm.athlete_id from team_members tm
    where tm.team_id = p_team and tm.status = 'active'
      and (
        coalesce(p_scope_kind,'team') = 'team'
        or (p_scope_kind = 'position' and upper(coalesce(tm.position,'')) = upper(p_scope_value))
        or (p_scope_kind = 'athlete' and tm.athlete_id::text = p_scope_value)
        or (p_scope_kind = 'group' and tm.athlete_id = any (
              select unnest(g.athlete_ids) from coach_groups g
              where g.id::text = p_scope_value and g.team_id = p_team))
      )
  loop
    perform notify(ath.athlete_id, 'announcement', trim(p_title), trim(p_body));
    n := n + 1;
  end loop;

  update announcements set sent_count = n where id = ann_id;
  return jsonb_build_object('id', ann_id, 'count', n);
end $$;
revoke all on function post_announcement(uuid, text, text, text, text) from public;
grant execute on function post_announcement(uuid, text, text, text, text) to authenticated;

create table if not exists requirement_templates (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  kind        text not null default 'custom' check (kind in
                ('game_week','off_season','travel','recovery','weight_gain','weight_loss','injured','custom')),
  items       jsonb not null check (validate_requirement_items(items)),
  created_by  uuid not null default auth.uid() references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists rt_team_name on requirement_templates (team_id, lower(name));
alter table requirement_templates enable row level security;
drop policy if exists rt_staff_rw on requirement_templates;
create policy rt_staff_rw on requirement_templates
  for all using (is_team_staff(team_id))
  with check (is_team_staff(team_id));
-- Table privileges: the rt_staff_rw policy governs which ROWS staff may touch, but a
-- policy is inert without the underlying table privilege. Grant full DML so staff can
-- actually insert/update/delete their team's templates (row scope stays enforced by RLS).
grant select, insert, update, delete on requirement_templates to authenticated;

-- Extend the items validator: optional window/target rails. Recreated in full — 0055's body
-- (verbatim, 0055_requirements_engine.sql:53-70) plus the window/target block inside the
-- per-item loop. Everything else (array 1..24, id/title/kind/proof required, kind/proof
-- enums, meals 1-6 / lifts 0-7 rails) stays byte-identical to the live definition.
create or replace function validate_requirement_items(items jsonb) returns boolean
language plpgsql immutable as $$
declare
  it jsonb; meals int := 0; lifts int := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 24 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if not (it ? 'id' and it ? 'title' and it ? 'kind' and it ? 'proof') then return false; end if;
    if length(it->>'id') > 40 or length(it->>'title') > 80 then return false; end if;
    if (it->>'proof') not in ('photo','form','scale','counter','check') then return false; end if;
    if (it->>'kind') not in ('meal','lift','hydration','recovery','weigh','checkin','custom') then return false; end if;
    if (it->>'kind') = 'meal' then meals := meals + 1; end if;
    if (it->>'kind') = 'lift' then lifts := lifts + 1; end if;
    -- window rail: optional {open,due,label}; open/due when present must be minute-of-day
    -- numbers (0..1439); when both present, due must not precede open.
    if it ? 'window' then
      if jsonb_typeof(it->'window') <> 'object' then return false; end if;
      if (it->'window') ? 'open' then
        if jsonb_typeof(it->'window'->'open') <> 'number' then return false; end if;
        if (it->'window'->>'open')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'due' then
        if jsonb_typeof(it->'window'->'due') <> 'number' then return false; end if;
        if (it->'window'->>'due')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'open' and (it->'window') ? 'due' then
        if (it->'window'->>'due')::numeric < (it->'window'->>'open')::numeric then return false; end if;
      end if;
    end if;
    -- target rail: optional numeric target (e.g. hydration oz, weight goal), 1..999.
    if it ? 'target' then
      if jsonb_typeof(it->'target') <> 'number' then return false; end if;
      if (it->>'target')::numeric not between 1 and 999 then return false; end if;
    end if;
  end loop;
  return meals between 1 and 6 and lifts between 0 and 7;
end; $$;

comment on table announcements is
  'Coach broadcasts. Durable coach-side record; athlete delivery = notifications rows (post_announcement) + Expo push (send-push announcement mode). Athletes never read this table.';
comment on table requirement_templates is
  'Named reusable requirement-set drafts (7 standard kinds + custom). Staff-only. Publishing still flows through set_team_requirements.';
