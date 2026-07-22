-- 0132 — sponsor-funded access: a sponsor buys premium seats; athletes redeem a code to unlock premium.
create table if not exists public.sponsorships (
  id             uuid primary key default gen_random_uuid(),
  sponsor_id     uuid not null references profiles(id) on delete cascade,
  sponsor_label  text not null default '',
  code           text not null unique,
  seats          int  not null check (seats > 0),
  seats_claimed  int  not null default 0 check (seats_claimed >= 0),
  months         int  not null default 12 check (months > 0),
  status         text not null default 'active' check (status in ('active','closed')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  amount_cents   int,
  created_at     timestamptz not null default now()
);
create index if not exists sponsorships_sponsor_idx on public.sponsorships (sponsor_id);
create unique index if not exists sponsorships_session_uq on public.sponsorships (stripe_checkout_session_id);

create table if not exists public.sponsored_access (
  athlete_id     uuid not null references profiles(id) on delete cascade,
  sponsorship_id uuid not null references sponsorships(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  primary key (athlete_id, sponsorship_id)
);
create index if not exists sponsored_access_active_idx on public.sponsored_access (athlete_id, expires_at);

alter table public.sponsorships enable row level security;
alter table public.sponsored_access enable row level security;
drop policy if exists sponsorships_read_own on public.sponsorships;
create policy sponsorships_read_own on public.sponsorships for select using (sponsor_id = auth.uid());
drop policy if exists sponsored_access_read_own on public.sponsored_access;
create policy sponsored_access_read_own on public.sponsored_access for select using (athlete_id = auth.uid());
-- No client INSERT/UPDATE policy on either: webhook (sponsorships) + redeem RPC (sponsored_access) write.

-- Combined premium entitlement: a paid subscription OR an active sponsored grant.
create or replace function public.has_premium_access(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from subscriptions
    where owner_id = p_user and status in ('active','past_due')
      and coalesce(tier,'') not in ('','preview','free','none','trial_expired')
  ) or exists(
    select 1 from sponsored_access where athlete_id = p_user and expires_at > now()
  );
$$;
grant execute on function public.has_premium_access(uuid) to authenticated, service_role;

-- Atomic redemption: claims exactly one seat (no oversell under concurrency), idempotent per athlete.
create or replace function public.redeem_sponsor_code(p_code text)
returns table (ok boolean, reason text, label text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_sp record;
  v_uid uuid := auth.uid();
  v_exp timestamptz;
begin
  if v_uid is null then return query select false, 'sign_in', ''::text, null::timestamptz; return; end if;
  select * into v_sp from public.sponsorships where upper(code) = upper(btrim(p_code)) and status = 'active';
  if not found then return query select false, 'invalid_code', ''::text, null::timestamptz; return; end if;
  select sa.expires_at into v_exp from public.sponsored_access sa where sa.athlete_id = v_uid and sa.sponsorship_id = v_sp.id;
  if found then return query select true, 'already_redeemed', v_sp.sponsor_label, v_exp; return; end if;
  -- Guarded UPDATE: Postgres re-checks the predicate under the row lock, so concurrent redeems of the
  -- last seat let exactly one win.
  update public.sponsorships set seats_claimed = seats_claimed + 1 where id = v_sp.id and seats_claimed < seats;
  if not found then return query select false, 'full', v_sp.sponsor_label, null::timestamptz; return; end if;
  v_exp := now() + make_interval(months => v_sp.months);
  insert into public.sponsored_access (athlete_id, sponsorship_id, expires_at) values (v_uid, v_sp.id, v_exp);
  return query select true, 'redeemed', v_sp.sponsor_label, v_exp;
end $$;
grant execute on function public.redeem_sponsor_code(text) to authenticated;
