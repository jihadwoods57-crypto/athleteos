-- OnStandard 0161 — Founding 50: the promise gets a ledger.
--
-- web/landing/index.html has said this since launch:
--   "the first 50 coaches and facilities are free through the beta, then lock today's price
--    permanently — including the $10/month per active client beyond a plan's limit. A later price
--    rise never touches them."
--
-- There was no implementation of any part of that. No counter, no record of who claimed it, nothing
-- preventing customer #51 or #5000 from being told they were founding, and no way to honor a
-- "permanent" lock except a human remembering in the Stripe dashboard. This is the ledger that
-- makes each clause enforceable.
--
-- Costs nothing to add today: subscriptions is empty and Stripe has never charged anyone, so the
-- first real founder is still ahead of us.

create table if not exists public.founding_members (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  -- 1..50. UNIQUE is what makes "the first 50" a fact rather than an intention: the 51st claim
  -- cannot invent slot 51, because the check rejects it, and it cannot reuse a slot, because the
  -- unique index rejects that.
  slot_no                 int  not null unique check (slot_no between 1 and 50),
  -- The Stripe Price generation this member is pinned to, forever. '' is the launch generation,
  -- matching today's unsuffixed lookup_keys (pro_solo_monthly). See _shared/founding.ts.
  locked_generation       text not null default '',
  -- Cents per active client beyond the plan's seat limit, frozen at claim time. Called out
  -- explicitly by the landing copy and the easiest clause to lose in a manual arrangement.
  locked_extra_seat_cents int  not null default 1000 check (locked_extra_seat_cents >= 0),
  -- "free through the beta" — set when beta billing begins for them; null while still free.
  billing_starts_at       timestamptz,
  claimed_at              timestamptz not null default now(),
  note                    text
);

comment on table public.founding_members is
  'The first 50 coaches/facilities, who lock their price generation and seat overage permanently. Cap enforced by slot_no check + unique.';

alter table public.founding_members enable row level security;

-- A member may see their own row (the app can honestly say "you are founding member #12").
-- Nobody may write through the client — slots are granted server-side only.
drop policy if exists fm_self_read on public.founding_members;
create policy fm_self_read on public.founding_members
  for select using (user_id = auth.uid());

revoke all on public.founding_members from anon, authenticated;
grant select on public.founding_members to authenticated;

-- ---------------------------------------------------------------- claim
-- Atomic and race-safe. Two simultaneous claims cannot both take slot 50: the slot number is
-- computed and inserted in one statement under a unique constraint, so the loser gets a unique
-- violation and is reported as full rather than silently becoming member 51.
create or replace function claim_founding_slot(
  p_user uuid,
  p_generation text default '',
  p_extra_seat_cents int default 1000,
  p_note text default null
)
returns table (ok boolean, slot_no int, reason text)
language plpgsql security definer set search_path = public as $$
declare v_slot int;
begin
  if p_user is null then
    return query select false, null::int, 'no user'::text; return;
  end if;

  -- Idempotent: claiming twice returns the existing slot rather than consuming another.
  select fm.slot_no into v_slot from founding_members fm where fm.user_id = p_user;
  if v_slot is not null then
    return query select true, v_slot, 'already founding'::text; return;
  end if;

  begin
    insert into founding_members (user_id, slot_no, locked_generation, locked_extra_seat_cents, note)
    select p_user,
           coalesce((select max(fm2.slot_no) from founding_members fm2), 0) + 1,
           coalesce(p_generation, ''),
           greatest(coalesce(p_extra_seat_cents, 1000), 0),
           p_note
    returning founding_members.slot_no into v_slot;
  exception
    -- Either the slot_no check (>50) or the unique index (a concurrent claim took it) fired.
    when check_violation or unique_violation then
      return query select false, null::int, 'founding 50 is full'::text; return;
  end;

  return query select true, v_slot, 'claimed'::text;
end $$;

-- Granting a slot is a business decision, never a self-service action: a client that could call
-- this could award itself a permanent discount.
revoke all on function claim_founding_slot(uuid, text, int, text) from public, anon, authenticated;
grant execute on function claim_founding_slot(uuid, text, int, text) to service_role;

-- ---------------------------------------------------------------- read
-- What billing needs to know about a buyer. Definer so the billing functions can ask about the
-- caller without exposing the whole table.
create or replace function founding_lock(p_user uuid)
returns table (locked_generation text, locked_extra_seat_cents int, slot_no int)
language sql stable security definer set search_path = public as $$
  select fm.locked_generation, fm.locked_extra_seat_cents, fm.slot_no
    from founding_members fm where fm.user_id = p_user;
$$;

revoke all on function founding_lock(uuid) from public, anon;
grant execute on function founding_lock(uuid) to authenticated, service_role;

-- How many of the fifty are gone. Safe to expose: the landing page wants to say it out loud, and
-- it reveals no identities.
create or replace function founding_slots_taken()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(count(*), 0)::int from founding_members;
$$;

revoke all on function founding_slots_taken() from public;
grant execute on function founding_slots_taken() to anon, authenticated, service_role;
