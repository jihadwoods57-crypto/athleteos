-- OnStandard — Trust Pass rebuilt as a grantable reward (spec 2026-08-09).
--
-- THE TWO GAPS THIS CLOSES. The pass has existed since 0033 and holds ZERO rows in prod, because
--   1. a TRAINER could never grant one. 0099's grant checks is_team_coach_of and nothing else,
--      which is why coach-data.js marked the capability permanently unavailable to a practice;
--   2. it did nothing. The "credit your trailing median" reward lives in src/core/trustPass.ts,
--      the legacy RN engine. The shipped proto scorer never consulted a pass, so an athlete who
--      believed the copy and skipped logging scored zero nutrition.
--
-- WHY A DROP AND RECREATE: trust_passes and trust_pass_policy both hold zero rows in prod
-- (verified against live 2026-08-09), so there is no data to migrate and no back-compat to
-- honor. Six stacked ALTERs would leave a file nobody can read. This is the one moment the clean
-- shape is free.
--
-- NUMBERING: this is 0196, not 0195. 0195_tester_sets.sql was already claimed by the in-flight
-- tester-demo-accounts branch. A gap is harmless; a collision is not.
--
-- Forward-only. NOT applied to live here — the founder applies via `supabase db push` at the next
-- go-live batch, and it MUST land before the client OTA (see the ceiling note in the ship task).
begin;

drop table if exists public.pass_spends;
drop table if exists public.trust_passes cascade;
drop table if exists public.trust_pass_policy cascade;

-- ---------------------------------------------------------------- the grant
create table public.trust_passes (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references public.profiles(id) on delete cascade,
  granted_by   uuid not null references public.profiles(id) on delete cascade,
  team_id      uuid references public.teams(id)     on delete cascade,
  practice_id  uuid references public.practices(id) on delete cascade,

  -- THE SHAPE IS THE NULLABILITY. There is deliberately no `kind` enum: an enum would make
  -- "3 credits, this weekend only" illegal, and that combination falls out of these columns for
  -- free. Reading rule:
  --   credits_total null -> a WINDOW (unlimited inside the range, nothing to tap)
  --   covers_from   null -> CREDITS (spend them on any day until expires_on)
  --   both set           -> credits fenced to a window
  credits_total int,
  covers_from   date,
  covers_until  date,
  expires_on    date not null,

  note         text,
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),

  constraint tp_one_owner   check (num_nonnulls(team_id, practice_id) = 1),
  constraint tp_credits_rng check (credits_total is null or credits_total between 1 and 14),
  constraint tp_window_pair check (num_nonnulls(covers_from, covers_until) in (0, 2)),
  -- 60 camera-free days was never a reward, it was an off switch. 14 is the ceiling now.
  constraint tp_window_cap  check (covers_until is null or covers_until - covers_from between 0 and 13),
  constraint tp_has_shape   check (credits_total is not null or covers_from is not null),
  constraint tp_expiry      check (covers_until is null or expires_on >= covers_until),
  constraint tp_note_len    check (note is null or length(note) <= 140)
);

-- At most one live pass per athlete, unchanged from 0033.
create unique index trust_passes_one_active on public.trust_passes (athlete_id) where ended_at is null;
create index trust_passes_athlete  on public.trust_passes (athlete_id, created_at desc);
create index trust_passes_practice on public.trust_passes (practice_id, created_at desc);
create index trust_passes_team     on public.trust_passes (team_id, created_at desc);

-- ---------------------------------------------------------------- the ledger
create table public.pass_spends (
  id         uuid primary key default gen_random_uuid(),
  pass_id    uuid not null references public.trust_passes(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  day_date   date not null,
  -- Free text, NOT an enum. A coach standard (0055 requirement_sets) can reshape a day into six
  -- slots with keys like 'meal-5'; an enum would erase those rooms exactly the way a hardcoded
  -- key list would have erased them from 0193's nutrition gate.
  slot       text not null,
  created_at timestamptz not null default now()
);
-- One credit per slot, ever. This is what stops three credits burning on one dinner.
create unique index pass_spends_one_per_slot on public.pass_spends (athlete_id, day_date, slot);
create index pass_spends_pass on public.pass_spends (pass_id);

-- ---------------------------------------------------------------- policy (dual-owner)
create table public.trust_pass_policy (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid references public.teams(id)     on delete cascade,
  practice_id         uuid references public.practices(id) on delete cascade,
  default_credits     int not null default 3  check (default_credits between 1 and 14),
  default_window_days int not null default 2  check (default_window_days between 1 and 14),
  eligibility_days    int not null default 7  check (eligibility_days between 1 and 30),
  max_credits         int not null default 5  check (max_credits between 1 and 14),
  updated_by          uuid references public.profiles(id) on delete set null,
  updated_at          timestamptz not null default now(),
  constraint tpp_one_owner check (num_nonnulls(team_id, practice_id) = 1)
);
-- THE 0136 TRAP: with team_id nullable you cannot key this on team_id. SQL treats NULLs as
-- DISTINCT, so every practice row (team_id null) would slip past a team_id key and the table
-- would enforce nothing at all across practices. Key on the coalesce.
create unique index trust_pass_policy_owner on public.trust_pass_policy (coalesce(team_id, practice_id));

-- ---------------------------------------------------------------- RLS + grants
alter table public.trust_passes      enable row level security;
alter table public.pass_spends       enable row level security;
alter table public.trust_pass_policy enable row level security;

-- Explicit grants. RLS alone leaves a new table unreadable — the 0036/0098 lesson, which this
-- repo has now paid for twice.
revoke all on table public.trust_passes, public.pass_spends, public.trust_pass_policy from anon, authenticated;
grant select on table public.trust_passes to authenticated;
grant select on table public.pass_spends  to authenticated;
grant select, insert, update on table public.trust_pass_policy to authenticated;

-- There is deliberately NO insert/update/delete policy on trust_passes or pass_spends. The
-- security definer RPCs are the only writers, which is what makes self-granting impossible
-- rather than merely discouraged.
create policy tp_read on public.trust_passes
  for select using (athlete_id = auth.uid() or is_team_coach_of(athlete_id) or is_trainer_of(athlete_id));

create policy ps_read on public.pass_spends
  for select using (athlete_id = auth.uid() or is_team_coach_of(athlete_id) or is_trainer_of(athlete_id));

-- The `is not null and` guards are redundant today (is_team_staff(null) yields false, not null,
-- because `s.team_id = null` matches no rows) but they are the shape 0136 established and they
-- make the dual-owner intent legible at the call site.
create policy tpp_read on public.trust_pass_policy
  for select using ((team_id is not null and is_team_staff(team_id))
                 or (practice_id is not null and is_practice_staff(practice_id)));
create policy tpp_insert on public.trust_pass_policy
  for insert with check ((team_id is not null and is_team_staff(team_id))
                      or (practice_id is not null and is_practice_staff(practice_id)));
create policy tpp_update on public.trust_pass_policy
  for update using ((team_id is not null and is_team_staff(team_id))
                 or (practice_id is not null and is_practice_staff(practice_id)))
       with check ((team_id is not null and is_team_staff(team_id))
                or (practice_id is not null and is_practice_staff(practice_id)));

comment on table public.trust_passes is
  'Trust Pass grants (0196). Two shapes via nullability: credits_total null = a date window, '
  'covers_from null = spendable credits, both set = credits fenced to a window. Written only by '
  'grant_pass / end_pass.';
comment on table public.pass_spends is
  'One row per credit spent on one slot. Unique on (athlete_id, day_date, slot). Deleted by the '
  'refund trigger when the athlete logs that meal after all.';

-- ---------------------------------------------------------------- the flag, in SQL
-- 0109 shipped feature_flags but the only EVALUATOR is TypeScript
-- (supabase/functions/_shared/feature-flags.ts), which a SQL RPC cannot call. Without this
-- mirror, gating grant_pass would mean either no kill switch at all or a second hand-maintained
-- copy of the precedence rule inside the RPC.
--
-- Precedence mirrors evaluateFlag(): kill_switch -> user -> role -> default_on. A MISSING flag
-- row is false, and any failure to read is false, because a flag exists precisely because we are
-- not yet certain.
--
-- DELIBERATE DIVERGENCE: the org arm is omitted. A SQL caller has no unambiguous "current org"
-- the way an edge function's request context does, and inventing one would be a silent
-- disagreement between the two evaluators. The omission makes this STRICTER than the TS version
-- (a flag switched on only by org allowlist reads as off here), which is the safe direction.
create or replace function public.flag_on(p_name text, p_user uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.feature_flags%rowtype;
  v_role text;
begin
  select * into f from public.feature_flags where name = p_name;
  if not found then return false; end if;
  if f.kill_switch then return false; end if;
  if p_user is not null and p_user = any (f.enabled_user_ids) then return true; end if;
  if array_length(f.enabled_roles, 1) is not null and p_user is not null then
    select primary_role into v_role from public.profiles where id = p_user;
    if v_role is not null and v_role = any (f.enabled_roles) then return true; end if;
  end if;
  return f.default_on;
exception when others then
  return false;
end;
$$;
revoke all on function public.flag_on(text, uuid) from public, anon;
grant execute on function public.flag_on(text, uuid) to authenticated;

-- ---------------------------------------------------------------- grant
-- Authorized for a TEAM COACH **or** a TRAINER. The trainer arm is the entire point of 0196:
-- 0099 checked is_team_coach_of only, which is why coach-data.js recorded the capability as
-- permanently unavailable to a practice. is_trainer_of (0002) resolves through
-- practice_clients -> practices.owner_id, the same wall every other trainer surface uses.
create or replace function public.grant_pass(
  p_athlete      uuid,
  p_credits      int  default null,
  p_covers_from  date default null,
  p_covers_until date default null,
  p_expires_on   date default null,
  p_note         text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team       uuid;
  v_practice   uuid;
  v_credits    int;
  v_def_cred   int;
  v_elig       int;
  v_max        int;
  v_photo_days int;
  v_expires    date;
  v_id         uuid;
begin
  if not (is_team_coach_of(p_athlete) or is_trainer_of(p_athlete)) then
    raise exception 'not authorized to grant a pass to this athlete';
  end if;

  -- The kill switch gates NEW GRANTS ONLY. It must never gate spend or read: flipping it off has
  -- to stop new grants without stranding a client already holding credits. Same reasoning as the
  -- 0166 claim-code lookup, which is deliberately ungated for exactly this reason.
  if not flag_on('trust_pass', auth.uid()) then
    raise exception 'passes are temporarily unavailable';
  end if;

  -- Which book is granting decides which policy applies. Team first, then practice.
  select m.team_id into v_team
    from team_members m
    join team_staff s on s.team_id = m.team_id
    where m.athlete_id = p_athlete and m.status = 'active'
      and s.staff_id = auth.uid() and s.status = 'active'
    limit 1;

  if v_team is null then
    select p.id into v_practice
      from practice_clients pc
      join practices p on p.id = pc.practice_id
      where pc.client_id = p_athlete and pc.status = 'active' and p.owner_id = auth.uid()
      limit 1;
  end if;

  if v_team is null and v_practice is null then
    raise exception 'no team or practice links you to this athlete';
  end if;

  select tpp.default_credits, tpp.eligibility_days, tpp.max_credits
    into v_def_cred, v_elig, v_max
    from trust_pass_policy tpp
    where tpp.team_id is not distinct from v_team
      and tpp.practice_id is not distinct from v_practice;

  v_elig := coalesce(v_elig, 7);
  v_max  := coalesce(v_max, 5);

  -- Forgery-resistant eligibility, unchanged from 0039: distinct days the athlete PHOTOGRAPHED a
  -- meal, which is a real storage upload, not the client-written days.score.
  --
  -- Deliberately a LIFETIME count with no date bound. This is a GATE, and re-locking somebody who
  -- already earned it reads as punishment. The consequence is that a long-dormant athlete stays
  -- eligible, which is exactly why pass.js refuses to credit a thin history and excuses the slot
  -- instead. Two independent defenses, because this one is intentionally generous.
  select count(distinct m.day_date) into v_photo_days
    from meals m
    where m.athlete_id = p_athlete and m.photo_path is not null;
  if v_photo_days < v_elig then
    raise exception 'athlete not eligible: % of % photo-logged days', v_photo_days, v_elig;
  end if;

  -- Resolve the shape. A caller supplying neither credits nor a window gets the book's default
  -- credit grant, which is what the one-tap milestone prompt sends.
  if p_credits is null and p_covers_from is null then
    v_credits := coalesce(v_def_cred, 3);
  else
    v_credits := p_credits;
  end if;

  if v_credits is not null and v_credits > v_max then
    raise exception 'pass exceeds this book''s maximum of % credits', v_max;
  end if;

  v_expires := coalesce(p_expires_on, p_covers_until, current_date + 14);

  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;

  insert into trust_passes (athlete_id, granted_by, team_id, practice_id,
                            credits_total, covers_from, covers_until, expires_on, note)
    values (p_athlete, auth.uid(), v_team, v_practice,
            v_credits, p_covers_from, p_covers_until, v_expires,
            nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.grant_pass(uuid, int, date, date, date, text) from public, anon;
grant execute on function public.grant_pass(uuid, int, date, date, date, text) to authenticated;

-- ---------------------------------------------------------------- end
-- Same wall as the grant. Note the athlete is NOT authorized: ending a pass is a record of what
-- an operator gave and took back, and letting the recipient erase it would make the ledger a
-- suggestion.
create or replace function public.end_pass(p_athlete uuid) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_hit boolean;
begin
  if not (is_team_coach_of(p_athlete) or is_trainer_of(p_athlete)) then
    raise exception 'not authorized to end a pass for this athlete';
  end if;
  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$$;
revoke all on function public.end_pass(uuid) from public, anon;
grant execute on function public.end_pass(uuid) to authenticated;

-- 0109 seeded trust_pass with default_on = false and NOTHING shipped ever read it (only the
-- legacy src/store/flagsStore.ts). Now grant_pass reads it for real, so leaving it false would
-- ship the whole feature silently off — the 0125 mistake, repeated.
update public.feature_flags set default_on = true, kill_switch = false where name = 'trust_pass';

commit;
