-- OnStandard — in-app notification feed.
-- A real per-user notification store (replaces the hardcoded bell list) plus triggers that
-- create notifications automatically on the linking events athletes/coaches care about:
-- a join request arrives (notify staff/owner) and a request is approved (notify the athlete/
-- client). Rows are user-owned + RLS-scoped; only SECURITY DEFINER helpers/triggers insert
-- them (so one user can create a notification for another, e.g. a request for the coach).
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user on notifications (user_id, created_at desc);

alter table notifications enable row level security;
-- Recipients read / mark-read / delete their own; NO direct insert (server-side only).
create policy notif_read   on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on notifications for delete using (user_id = auth.uid());

-- SECURITY DEFINER insert helper: lets a trigger/RPC create a notification for ANY user
-- (the recipient is often not the caller), bypassing the self-only insert restriction.
create or replace function notify(target uuid, n_kind text, n_title text, n_body text)
returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body) values (target, n_kind, n_title, n_body);
$$;

-- ---------------------------------------------------------------- team_members triggers
create or replace function tg_team_member_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  team_name text;
  st record;
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    select full_name into who from profiles where id = NEW.athlete_id;
    select name into team_name from teams where id = NEW.team_id;
    for st in select staff_id from team_staff where team_id = NEW.team_id and status = 'active' loop
      perform notify(st.staff_id, 'join_request',
        coalesce(who, 'An athlete') || ' asked to join',
        'Approve them on your dashboard to add them to ' || coalesce(team_name, 'your team') || '.');
    end loop;
  elsif TG_OP = 'UPDATE' and NEW.status = 'active' and OLD.status is distinct from 'active' then
    select name into team_name from teams where id = NEW.team_id;
    perform notify(NEW.athlete_id, 'join_approved', 'You''re on the roster',
      'Your coach approved you for ' || coalesce(team_name, 'the team') || '.');
  end if;
  return NEW;
end; $$;

drop trigger if exists team_member_notify on team_members;
create trigger team_member_notify after insert or update on team_members
  for each row execute function tg_team_member_notify();

-- ---------------------------------------------------------------- practice_clients triggers
create or replace function tg_practice_client_notify()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  practice_name text;
  owner uuid;
begin
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    select full_name into who from profiles where id = NEW.client_id;
    select name, owner_id into practice_name, owner from practices where id = NEW.practice_id;
    perform notify(owner, 'join_request',
      coalesce(who, 'A client') || ' asked to join',
      'Approve them to add them to ' || coalesce(practice_name, 'your practice') || '.');
  elsif TG_OP = 'UPDATE' and NEW.status = 'active' and OLD.status is distinct from 'active' then
    select name into practice_name from practices where id = NEW.practice_id;
    perform notify(NEW.client_id, 'join_approved', 'You''re connected',
      'Your trainer approved you for ' || coalesce(practice_name, 'the practice') || '.');
  end if;
  return NEW;
end; $$;

drop trigger if exists practice_client_notify on practice_clients;
create trigger practice_client_notify after insert or update on practice_clients
  for each row execute function tg_practice_client_notify();
