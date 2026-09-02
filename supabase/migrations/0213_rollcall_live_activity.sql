-- OnStandard — Wake-Up Roll Call, third pass (2026-09-02): the iOS Live Activity.
--
-- WHY. The founder's review of the second pass: the lock screen "feels like generic system
-- notifications". It was one. A remote notification is drawn by iOS from four strings, so no
-- amount of copy work could make it read as an alarm-grade accountability moment. A Live Activity
-- is the one lock-screen surface an app draws itself, and the only one that can hold a countdown
-- the phone ticks without a push.
--
-- WHAT THIS MIGRATION ADDS: only the token bookkeeping. Two kinds of token, which are NOT
-- interchangeable and are the reason this is a table and not a column:
--
--   PUSH-TO-START (per device, long-lived). iOS 17.2+ hands the app a token that authorises
--   STARTING a new Live Activity remotely. It belongs to the device, not to any roll call, and it
--   is what lets a 6:00 activity appear on a phone whose owner has not opened OnStandard in days.
--
--   UPDATE (per activity, short-lived). Once an activity exists, iOS hands the app a SECOND token
--   that authorises updating and ending that one activity. Apple warns it can rotate mid-activity,
--   so the row is upserted, never inserted once.
--
-- The device reports both through register_live_activity_token(). Everything the crons need is
-- read through one service-role function, claim_rollcall_live_targets().
--
-- NOTHING HERE IS REQUIRED FOR THE ROLL CALL TO WORK. Every call site treats an empty result as
-- "this athlete has no Live Activity", which is exactly the state of every Android phone and every
-- iPhone below 17.2. The notification path is untouched and remains the one that records the tap.

-- ================================================================ 1. the tokens
create table if not exists rollcall_live_tokens (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references profiles(id) on delete cascade,
  -- Null for a push-to-start row (it is not tied to one roll call); set for an update row.
  instance_id     uuid references commitment_instances(id) on delete cascade,
  kind            text not null check (kind in ('start', 'update')),
  -- Lowercase hex, as ActivityKit hands it to Swift. Length is not constrained: Apple has never
  -- promised one, and a check that guessed wrong would silently drop every token on the day it
  -- changed.
  token           text not null,
  -- 'ios' today. Present so an Android Live Update token has somewhere to go later without a
  -- second table.
  platform        text not null default 'ios',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Set when APNs tells us the token is dead (410 / BadDeviceToken / Unregistered). Kept rather
  -- than deleted so a device that re-registers reuses its row, and so a debugging session can see
  -- that a phone WAS registered and went away.
  revoked_at      timestamptz
);

-- One live push-to-start token per athlete per device token, and one update token per activity.
-- The partial indexes carry the distinction that the nullable instance_id cannot express in a
-- single unique constraint (null never equals null).
create unique index if not exists rlt_start_uq
  on rollcall_live_tokens (athlete_id, token) where kind = 'start';
create unique index if not exists rlt_update_uq
  on rollcall_live_tokens (athlete_id, instance_id) where kind = 'update';
create index if not exists rlt_instance_ix
  on rollcall_live_tokens (instance_id) where kind = 'update' and revoked_at is null;
create index if not exists rlt_athlete_live_ix
  on rollcall_live_tokens (athlete_id) where revoked_at is null;

alter table rollcall_live_tokens enable row level security;

-- An athlete may see their own device registrations (the Profile screen tells them whether
-- lock-screen check-in is actually wired up on this phone). Nobody writes here directly: the only
-- write path is the security-definer RPC below, so there is deliberately no insert/update policy
-- and no write grant. (0028's device_tokens learned this the hard way and 0150 had to repair it;
-- the difference is that this table has never had a direct write path to lose.)
drop policy if exists rlt_read_own on rollcall_live_tokens;
create policy rlt_read_own on rollcall_live_tokens for select
  using (athlete_id = auth.uid());

grant select on rollcall_live_tokens to authenticated;

-- ================================================================ 2. the device reports a token
-- Called by the app itself, as the athlete. p_instance is null for a push-to-start token.
--
-- SECURITY: the athlete is taken from auth.uid(), never from an argument, so one athlete can never
-- register a token against another. That matters more here than for an ordinary push token: a
-- Live Activity token is a capability to draw on someone's lock screen.
create or replace function register_live_activity_token(
  p_token text, p_kind text, p_instance uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_athlete uuid := auth.uid();
begin
  if v_athlete is null then raise exception 'not authenticated'; end if;
  if p_kind not in ('start', 'update') then raise exception 'bad kind'; end if;
  if p_token is null or char_length(p_token) = 0 then raise exception 'empty token'; end if;
  -- An update token names the activity it can update; a start token must not pretend to.
  if p_kind = 'update' and p_instance is null then raise exception 'update token needs an instance'; end if;
  if p_kind = 'start' and p_instance is not null then raise exception 'start token is not per instance'; end if;

  if p_kind = 'start' then
    insert into rollcall_live_tokens (athlete_id, kind, token)
    values (v_athlete, 'start', p_token)
    on conflict (athlete_id, token) where kind = 'start'
    do update set updated_at = now(), revoked_at = null;
  else
    -- Apple: "The push token for a Live Activity may change throughout its duration... invalidate
    -- the previous, now-outdated token on your server." So the newest token for an activity wins.
    insert into rollcall_live_tokens (athlete_id, instance_id, kind, token)
    values (v_athlete, p_instance, 'update', p_token)
    on conflict (athlete_id, instance_id) where kind = 'update'
    do update set token = excluded.token, updated_at = now(), revoked_at = null;
  end if;
end $$;

revoke all on function register_live_activity_token(text, text, uuid) from public, anon;
grant execute on function register_live_activity_token(text, text, uuid) to authenticated;

-- ================================================================ 3. the server forgets a dead one
-- Service role only: called when APNs answers 410 / BadDeviceToken / Unregistered. Marking rather
-- than deleting keeps the history and lets a re-register revive the same row.
create or replace function revoke_live_activity_token(p_token text)
returns void
language sql security definer set search_path = public as $$
  update rollcall_live_tokens set revoked_at = now(), updated_at = now()
  where token = p_token and revoked_at is null;
$$;

revoke all on function revoke_live_activity_token(text) from public, anon, authenticated;

-- ================================================================ 4. what the crons need
-- One row per athlete the caller is about to act on, carrying whichever token applies.
--
-- `start_token` is the device's push-to-start token, used when no activity exists yet.
-- `update_token` is that activity's own token, used once one does.
-- A row with BOTH null means this athlete has no iPhone capable of a Live Activity: the caller
-- skips them and their notification is unaffected.
create or replace function rollcall_live_targets(p_instance uuid, p_athletes uuid[])
returns table (
  athlete_id uuid,
  start_token text,
  update_token text
)
language sql security definer set search_path = public as $$
  select
    a.id as athlete_id,
    (select t.token from rollcall_live_tokens t
      where t.athlete_id = a.id and t.kind = 'start' and t.revoked_at is null
      order by t.updated_at desc limit 1) as start_token,
    (select t.token from rollcall_live_tokens t
      where t.athlete_id = a.id and t.kind = 'update'
        and t.instance_id = p_instance and t.revoked_at is null
      limit 1) as update_token
  from unnest(p_athletes) as a(id);
$$;

revoke all on function rollcall_live_targets(uuid, uuid[]) from public, anon, authenticated;

-- ================================================================ 5. tidy up after a roll call
-- An update token is worthless once its activity has ended, and leaving it would let a later bug
-- push at a dead activity forever. Called by the escalation cron after it ends the activities for
-- a closed instance.
create or replace function clear_live_activity_tokens(p_instance uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  delete from rollcall_live_tokens
  where instance_id = p_instance and kind = 'update';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function clear_live_activity_tokens(uuid) from public, anon, authenticated;

-- ================================================================ 6. the escalation claim needs
--                                                                    the roll call's own clock
-- claim_missed_commitments already returns respond_by_at and closes_at (0211). The Live Activity
-- also needs the coach's name and the message to render its card, and the athlete list to address
-- the push. Rather than change that function's return type again (it has been dropped and
-- recreated twice already, and every change is a deploy-ordering hazard), the escalation function
-- reads what it needs for the card through this small, read-only companion.
create or replace function rollcall_live_card(p_instance uuid)
returns table (
  instance_id uuid,
  title text,
  coach_name text,
  message text,
  starts_at timestamptz,
  respond_by_at timestamptz,
  closes_at timestamptz,
  timezone text
)
language sql security definer set search_path = public as $$
  select
    ci.id,
    coalesce(c.title, 'Wake-Up Roll Call'),
    coalesce(p.full_name, ''),
    -- Today's override wins over the standing message, exactly as my_commitments reads it.
    coalesce(ci.message_override, c.message, ''),
    ci.starts_at,
    ci.respond_by_at,
    -- CLOSE goes through 0212's function, never ci.ends_at directly: a wake-up with no explicit
    -- ends_at closes 30 minutes after it starts, and reading the raw column would hand the card a
    -- null and make its countdown run forever.
    rollcall_closes_at(c.type, ci.respond_by_at, ci.starts_at, ci.ends_at),
    coalesce(c.timezone, 'UTC')
  from commitment_instances ci
  join commitments c on c.id = ci.commitment_id
  -- The coach is commitments.created_by. There is no owner_id on this table.
  left join profiles p on p.id = c.created_by
  where ci.id = p_instance;
$$;

revoke all on function rollcall_live_card(uuid) from public, anon, authenticated;
