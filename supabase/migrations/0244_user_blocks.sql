-- 0244: Block, on the server (review pass 2026-09-23, G-R3, Guideline 1.2).
--
-- 1.2 asks for "the ability to block abusive users from the service". The app offered "Mute",
-- which lived only on one phone (RT.mutedUsers): lost on sign-out or reinstall, and the muted
-- person could still message and notify you. This makes it a real block:
--
--   1. user_blocks: one row per (blocker, blocked). Own-row RLS: you see, add and remove only
--      your own blocks. Nobody can see who blocked them.
--   2. Their messages disappear from your threads. A RESTRICTIVE select policy on meal_comments
--      (ANDed with every existing read policy, which stay exactly as they are) hides a blocked
--      author's rows from the blocker. AI rows are never hidden: the AI is not a person, and its
--      replies are part of the record of your own meal.
--   3. Their announcements stop reaching you: post_announcement skips an athlete who blocked the
--      author (body copied from 0078, the live definition; only the one `not exists` is new).
--      block_announcement_author lets an athlete block the coach behind an announcement they
--      were sent, without ever seeing the coach's id.
--   4. Their pushes and nudges stop: send-push, meal-chat and roll-call-coach read user_blocks
--      under the service role through blocked_recipients() and drop recipients who blocked the
--      sender (supabase/functions/_shared/blocks.mjs).
--
-- The phone keeps RT.mutedUsers as a cache, so a block hides a message the moment it is tapped.
-- Additive: one table, three functions, one restrictive policy, one function body.

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;
revoke all on table public.user_blocks from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

drop policy if exists user_blocks_own_read on public.user_blocks;
create policy user_blocks_own_read on public.user_blocks
  for select using (blocker_id = auth.uid());
drop policy if exists user_blocks_own_insert on public.user_blocks;
create policy user_blocks_own_insert on public.user_blocks
  for insert with check (blocker_id = auth.uid());
drop policy if exists user_blocks_own_delete on public.user_blocks;
create policy user_blocks_own_delete on public.user_blocks
  for delete using (blocker_id = auth.uid());

-- ---------------------------------------------------------------- 2. threads
-- SECURITY DEFINER so the policy can read user_blocks for the CURRENT reader regardless of the
-- table's own RLS (which would allow it anyway: the reader's own rows).
create or replace function public.i_blocked(p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_author is not null and exists (
    select 1 from public.user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = p_author
  );
$$;
revoke all on function public.i_blocked(uuid) from public, anon;
grant execute on function public.i_blocked(uuid) to authenticated;

drop policy if exists meal_comments_hide_blocked on public.meal_comments;
create policy meal_comments_hide_blocked on public.meal_comments
  as restrictive for select
  using (role = 'ai' or not public.i_blocked(author_id));

-- ---------------------------------------------------------------- 3. announcements
create or replace function post_announcement(
  p_team uuid, p_scope_kind text, p_scope_value text, p_title text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ann_id uuid;
  n int := 0;
  ath record;
begin
  if not is_write_staff(p_team) then
    raise exception 'not team staff';
  end if;
  insert into announcements (team_id, author_id, scope_kind, scope_value, title, body)
  values (p_team, auth.uid(), coalesce(p_scope_kind,'team'),
          case when coalesce(p_scope_kind,'team') = 'team' then null else p_scope_value end,
          trim(p_title), trim(p_body))
  returning id into ann_id;

  for ath in
    select tm.athlete_id,
           -- 0244: an athlete who blocked the author is not sent the announcement...
           exists (select 1 from user_blocks b where b.blocker_id = tm.athlete_id and b.blocked_id = auth.uid()) as blocked
    from team_members tm
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
    if not ath.blocked then
      -- The announcement's id rides the kind (review M3), so Block finds the author exactly. The
      -- bell reads the base kind before the colon, as it does for meal_flag:<id>.
      perform notify(ath.athlete_id, 'announcement:' || ann_id::text, trim(p_title), trim(p_body));
    end if;
    -- ...but still counted, so the author's "sent to N" never reveals a block (I1).
    n := n + 1;
  end loop;

  update announcements set sent_count = n where id = ann_id;
  return jsonb_build_object('id', ann_id, 'count', n);
end $$;

-- An athlete blocks whoever posted an announcement they received. The notification row carries
-- no author (post_announcement writes title/body only), so the author is found server-side: the
-- announcement with the same title and body, on a team the caller belongs to, posted in the same
-- transaction as the notification row (notify() runs inside post_announcement, so the two share
-- now()). The caller learns nothing but whether it worked.
create or replace function public.block_announcement_author(p_notification uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- Exact: the id the row carries (0244 on). Older rows (plain 'announcement') fall back to the
  -- same title and body, on a team the caller belongs to, posted in the same moment.
  select a.author_id into v_author
    from notifications n
    join announcements a on a.id::text = split_part(n.kind, ':', 2)
    join team_members tm on tm.team_id = a.team_id and tm.athlete_id = auth.uid()
   where n.id = p_notification and n.user_id = auth.uid() and n.kind like 'announcement:%'
   limit 1;
  if v_author is null then
    select a.author_id into v_author
      from notifications n
      join announcements a on a.title = n.title and a.body = n.body
        and a.created_at between n.created_at - interval '5 minutes' and n.created_at + interval '5 minutes'
      join team_members tm on tm.team_id = a.team_id and tm.athlete_id = auth.uid()
     where n.id = p_notification and n.user_id = auth.uid() and n.kind = 'announcement'
     order by abs(extract(epoch from (a.created_at - n.created_at)))
     limit 1;
  end if;
  if v_author is null or v_author = auth.uid() then return false; end if;
  insert into user_blocks (blocker_id, blocked_id) values (auth.uid(), v_author) on conflict do nothing;
  return true;
end $$;
revoke all on function public.block_announcement_author(uuid) from public, anon;
grant execute on function public.block_announcement_author(uuid) to authenticated;

-- ---------------------------------------------------------------- 2b. unread counts (review M6)
-- team_meal_comments_batch (0219) is SECURITY DEFINER, so the restrictive policy above does not
-- apply inside it, and a blocked author's rows still counted toward unread badges. Body copied
-- from 0219; only the one `i_blocked` line is new.
create or replace function team_meal_comments_batch(p_athletes uuid[], p_since timestamptz,
                                                    p_limit int default 1000)
returns table (meal_id uuid, athlete_id uuid, role text, kind text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with ids as (
    select distinct a.athlete_id from unnest(p_athletes) as a(athlete_id)
  ),
  viewable as (
    select i.athlete_id,
           (i.athlete_id = auth.uid()) as is_self
    from ids i
    where can_view(i.athlete_id) or i.athlete_id = auth.uid()
  )
  select c.meal_id, c.athlete_id, c.role, c.kind, c.created_at
  from meal_comments c
  join viewable v on v.athlete_id = c.athlete_id
  where c.created_at >= p_since
    and (coalesce(c.kind, 'message') <> 'note' or not v.is_self)
    and (c.role = 'ai' or not public.i_blocked(c.author_id))
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke execute on function team_meal_comments_batch(uuid[], timestamptz, int) from public, anon;
grant  execute on function team_meal_comments_batch(uuid[], timestamptz, int) to authenticated;

-- ---------------------------------------------------------------- 4. pushes
-- Of p_recipients, the ones who blocked p_sender. Service role only: the push senders call it
-- to drop those recipients before a single row or push is written.
create or replace function public.blocked_recipients(p_sender uuid, p_recipients uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.blocker_id from public.user_blocks b
   where b.blocked_id = p_sender and b.blocker_id = any (coalesce(p_recipients, '{}'::uuid[]));
$$;
revoke all on function public.blocked_recipients(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.blocked_recipients(uuid, uuid[]) to service_role;
