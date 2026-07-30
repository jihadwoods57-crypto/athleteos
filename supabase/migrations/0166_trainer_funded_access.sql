-- OnStandard 0166 — trainer-funded access: the trainer's 15% buys the seats.
--
-- The independent trainer was billed three times by the model as it stood: a team-tier seat
-- subscription for their roster (0163), 15% of every dollar their client pays them (0119), and
-- their client paid a THIRD bill to unlock Premium. Three bills, one household. A trainer with 20
-- clients at $200/mo handed over ~$600/mo and got back seats worth ~$100 — so the rational move was
-- to take payment on Venmo, which is what they did.
--
-- The flip: a client billed through OnStandard Pay gets Premium INCLUDED, funded by the platform
-- fee we already take, and that client drops out of the trainer's seat bill. One bill per household.
-- The economics favour the platform too — 15% of a $200/mo package is $30/mo from one client, where
-- a seat is a few dollars — so this trades a small line item for a larger one and gains a retained
-- user per client.
--
-- Nothing here invents a mechanism. `has_premium_access` (0163) is already one predicate with two
-- arms (own subscription OR sponsored_access, 0132); trainer-funded is a THIRD arm of identical
-- shape, so every screen that already respects Premium respects this for free. The claim code
-- reuses redeem_sponsor_code's guarded-update shape.
--
-- The property worth stating plainly: ACCESS FALLS OUT OF BILLING. expires_at is pushed forward by
-- stripe-webhook on each successful invoice. A failed card runs dunning, expires_at passes, access
-- lapses. There is no revocation code path because there does not need to be one — and that
-- automatic lapse is precisely the enforcement a trainer cannot build for themselves, which is what
-- justifies 15% against Stripe's 2.9%.

begin;

-- ---------------------------------------------------------------- the grant
-- Mirrors sponsored_access (0132): a row is a live grant while expires_at is in the future. Keyed
-- by (athlete, subscription) rather than (athlete, practice) so a client who buys a second offer
-- from the same trainer gets a second independent grant — cancelling one must not orphan the other.
--
-- is_owner_grant marks the trainer's own row. When a client is funded, the practice OWNER is
-- granted alongside them: a trainer with at least one live funded client is Premium. That keeps the
-- predicate at three arms instead of four, and it is the right answer anyway — a trainer running
-- money through us should never be looking at a paywall.
create table if not exists public.trainer_funded_access (
  athlete_id             uuid not null references profiles(id) on delete cascade,
  practice_id            uuid not null references practices(id) on delete cascade,
  stripe_subscription_id text not null,
  offer_id               uuid references offers(id) on delete set null,
  is_owner_grant         boolean not null default false,
  granted_at             timestamptz not null default now(),
  expires_at             timestamptz not null,
  primary key (athlete_id, stripe_subscription_id)
);
create index if not exists trainer_funded_active_idx
  on public.trainer_funded_access (athlete_id, expires_at);
-- Drives active_athlete_count's exclusion and the trainer's funded-roster readout.
create index if not exists trainer_funded_practice_idx
  on public.trainer_funded_access (practice_id, expires_at);

alter table public.trainer_funded_access enable row level security;
-- 0013 revoked default grants; be explicit. SELECT only — every write is service-role (webhook) or
-- the redeem definer below. A client that could write this table could mint itself Premium.
revoke all on table public.trainer_funded_access from anon, authenticated;
grant select on public.trainer_funded_access to authenticated;

drop policy if exists tfa_read_own on public.trainer_funded_access;
create policy tfa_read_own on public.trainer_funded_access
  for select using (athlete_id = auth.uid());
drop policy if exists tfa_read_owner on public.trainer_funded_access;
create policy tfa_read_owner on public.trainer_funded_access
  for select using (owns_practice(practice_id));

-- ---------------------------------------------------------------- pre-account purchases
-- A prospect buying from the PUBLIC trainer page has no account yet — that is the entire point of
-- the pay-first funnel — so there is no athlete_id to grant. The webhook mints a claim instead and
-- the code is redeemed in-app after signup, which creates the practice link and the grant together.
--
-- The code is not a secret on its own: it is single-use, expiring, and bound to one Stripe
-- subscription. The sponsor alphabet (no 0/O/1/I) is reused so it can be read aloud without
-- ambiguity, since a trainer will do exactly that.
create table if not exists public.offer_claims (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  practice_id            uuid not null references practices(id) on delete cascade,
  offer_id               uuid references offers(id) on delete set null,
  stripe_subscription_id text not null,
  stripe_checkout_session_id text unique,
  payer_email            text,
  status                 text not null default 'pending' check (status in ('pending','claimed')),
  claimed_by             uuid references profiles(id) on delete set null,
  claimed_at             timestamptz,
  expires_at             timestamptz not null default now() + interval '90 days',
  created_at             timestamptz not null default now()
);
create index if not exists offer_claims_practice_idx on public.offer_claims (practice_id, created_at desc);

alter table public.offer_claims enable row level security;
revoke all on table public.offer_claims from anon, authenticated;
grant select on public.offer_claims to authenticated;
-- The trainer may see their own claims (who bought, who has not redeemed yet). The BUYER cannot
-- query claims at all before redeeming — they have no account — so there is no read policy for
-- them; the redeem RPC below is a definer and does not need one.
drop policy if exists offer_claims_owner_read on public.offer_claims;
create policy offer_claims_owner_read on public.offer_claims
  for select using (owns_practice(practice_id));

-- ---------------------------------------------------------------- the predicate gains a third arm
-- Byte-for-byte 0163's subscription arm (including the 7-day bounded grace and its no-timestamp
-- fallback) and 0132's sponsored arm, plus trainer-funded. GRACE IS PINNED at 7 days across SQL,
-- isPro (src/core/subscription.ts) and isPaid (proto settings.js) by entitlementParity.test.ts —
-- if you change the interval here, that suite fails until all three agree, which is it working.
create or replace function public.has_premium_access(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subscriptions
    where owner_id = p_user
      and lower(coalesce(tier, '')) not in ('', 'preview', 'free', 'none', 'trial_expired')
      and (
        status = 'active'
        or (status = 'past_due'
            and coalesce(payment_failed_at, updated_at) > now() - interval '7 days')
      )
  )
  or exists (
    select 1 from sponsored_access
    where athlete_id = p_user and expires_at > now()
  )
  or exists (
    select 1 from trainer_funded_access
    where athlete_id = p_user and expires_at > now()
  );
$$;
grant execute on function public.has_premium_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- which source is paying
-- The billing screen already had this problem for sponsorship: isPaid(sub) said "Free" while the
-- server said premium, because the extra source lives in its own table. settings.js solved it by
-- calling has_premium_access and labelling the result "Premium · sponsored" — which is now a lie
-- for a trainer-funded athlete. Return the SOURCE so the label can be honest.
--
-- Precedence is subscription > trainer > sponsor: if someone is paying us directly, that is the
-- relationship to name, and a trainer grant is more specific to the athlete's actual situation
-- than a sponsorship they may have redeemed months ago.
create or replace function public.my_premium_source()
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from subscriptions
      where owner_id = auth.uid()
        and lower(coalesce(tier, '')) not in ('', 'preview', 'free', 'none', 'trial_expired')
        and (status = 'active'
             or (status = 'past_due'
                 and coalesce(payment_failed_at, updated_at) > now() - interval '7 days'))
    ) then 'subscription'
    when exists (
      select 1 from trainer_funded_access where athlete_id = auth.uid() and expires_at > now()
    ) then 'trainer'
    when exists (
      select 1 from sponsored_access where athlete_id = auth.uid() and expires_at > now()
    ) then 'sponsor'
    else 'none'
  end;
$$;
revoke all on function public.my_premium_source() from public, anon;
grant execute on function public.my_premium_source() to authenticated;

-- ---------------------------------------------------------------- funded athletes leave the seat bill
-- THE POINT OF THE WHOLE MIGRATION. 0163 counted every active client toward the owner's billable
-- seats. Left alone, a trainer would pay 15% AND a seat for the same person — the exact double-dip
-- being deleted here, and the change would be worse than useless.
--
-- The exclusion is scoped to THIS OWNER'S OWN practices: an athlete funded by trainer A must still
-- count toward coach B's seats, because B is getting none of A's platform fee. Scoping it by
-- athlete alone would let one trainer's payment silently discount an unrelated coach's bill.
--
-- Otherwise identical to 0163: same activity definition (a day counts only when something was
-- really logged — meals/checkin/hydration, which is what drives our AI cost), same 5-day floor,
-- same "changing the threshold is a PRICING decision, not a tuning knob".
create or replace function public.active_athlete_count(
  p_owner uuid,
  p_month date default date_trunc('month', now())::date,
  p_threshold int default 5
) returns int
language sql stable security definer set search_path = public as $$
  with owned_athletes as (
    select tm.athlete_id from team_members tm
      join teams t on t.id = tm.team_id
      where t.created_by = p_owner and tm.status = 'active'
    union
    select pc.client_id from practice_clients pc
      join practices p on p.id = pc.practice_id
      where p.owner_id = p_owner and pc.status = 'active'
  ),
  billable as (
    select oa.athlete_id from owned_athletes oa
    where not exists (
      select 1 from trainer_funded_access tfa
        join practices fp on fp.id = tfa.practice_id
      where tfa.athlete_id = oa.athlete_id
        and fp.owner_id = p_owner
        and tfa.expires_at > now()
    )
  ),
  activity as (
    select d.athlete_id, count(*) as logged_days
    from days d
    join billable b on b.athlete_id = d.athlete_id
    where d.date >= date_trunc('month', p_month)::date
      and d.date < (date_trunc('month', p_month) + interval '1 month')::date
      and (d.meals <> '{}'::jsonb or d.checkin <> '{}'::jsonb or d.hydration_l > 0)
    group by d.athlete_id
  )
  select count(*)::int from activity where logged_days >= greatest(p_threshold, 1);
$$;
-- Unchanged from 0163: service-role/billing plumbing only. The raw function takes an arbitrary
-- owner id, which must never be a way for one coach to read another's roster engagement.
revoke all on function public.active_athlete_count(uuid, date, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- redeem a claim code
-- Shaped after redeem_sponsor_code (0132): a guarded UPDATE that Postgres re-checks under the row
-- lock, so two devices racing the same code produce exactly one winner. Idempotent for the athlete
-- who already redeemed it (returns ok/already_redeemed rather than an error, so a double-tap on a
-- flaky connection is not a scary failure).
--
-- Redemption does three things in one transaction: link the client to the practice, grant the
-- client, grant the trainer. The grant runs to the claim's expiry and is then maintained by the
-- renewal webhook like any other — a redeemed claim is indistinguishable from an in-app purchase
-- from that moment on.
create or replace function public.redeem_offer_code(p_code text)
returns table (ok boolean, reason text, trainer_name text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim record;
  v_practice record;
  v_name text;
  v_exp timestamptz;
begin
  if v_uid is null then
    return query select false, 'sign_in', ''::text, null::timestamptz; return;
  end if;

  select * into v_claim from public.offer_claims
    where upper(code) = upper(btrim(coalesce(p_code, '')));
  if not found then
    return query select false, 'invalid_code', ''::text, null::timestamptz; return;
  end if;

  select pr.*, p.full_name into v_practice
    from practices pr join profiles p on p.id = pr.owner_id where pr.id = v_claim.practice_id;
  v_name := coalesce(v_practice.full_name, 'your trainer');

  -- Already redeemed BY THIS ATHLETE: report the live grant instead of failing.
  if v_claim.status = 'claimed' and v_claim.claimed_by = v_uid then
    select tfa.expires_at into v_exp from public.trainer_funded_access tfa
      where tfa.athlete_id = v_uid and tfa.stripe_subscription_id = v_claim.stripe_subscription_id;
    return query select true, 'already_redeemed', v_name, v_exp; return;
  end if;
  if v_claim.status = 'claimed' then
    return query select false, 'already_used', v_name, null::timestamptz; return;
  end if;
  if v_claim.expires_at <= now() then
    return query select false, 'expired', v_name, null::timestamptz; return;
  end if;

  -- Guarded: only the caller who flips pending -> claimed proceeds to grant.
  update public.offer_claims
     set status = 'claimed', claimed_by = v_uid, claimed_at = now()
   where id = v_claim.id and status = 'pending';
  if not found then
    return query select false, 'already_used', v_name, null::timestamptz; return;
  end if;

  v_exp := v_claim.expires_at;

  -- Link the client to the practice. An existing row is reactivated rather than duplicated (the
  -- table is keyed on (practice_id, client_id)) — a lapsed client who re-buys comes straight back.
  insert into public.practice_clients (practice_id, client_id, status)
    values (v_claim.practice_id, v_uid, 'active')
    on conflict (practice_id, client_id) do update set status = 'active';

  -- Grant the client, and the trainer alongside them.
  insert into public.trainer_funded_access
    (athlete_id, practice_id, stripe_subscription_id, offer_id, is_owner_grant, expires_at)
    values (v_uid, v_claim.practice_id, v_claim.stripe_subscription_id, v_claim.offer_id, false, v_exp)
    on conflict (athlete_id, stripe_subscription_id)
      do update set expires_at = greatest(trainer_funded_access.expires_at, excluded.expires_at);

  insert into public.trainer_funded_access
    (athlete_id, practice_id, stripe_subscription_id, offer_id, is_owner_grant, expires_at)
    values (v_practice.owner_id, v_claim.practice_id, v_claim.stripe_subscription_id, v_claim.offer_id, true, v_exp)
    on conflict (athlete_id, stripe_subscription_id)
      do update set expires_at = greatest(trainer_funded_access.expires_at, excluded.expires_at);

  return query select true, 'redeemed', v_name, v_exp;
end $$;
grant execute on function public.redeem_offer_code(text) to authenticated;

-- ---------------------------------------------------------------- the trainer's funded roster
-- What the "Bring your clients" screen reads: who is funded, when they renew, and who has lapsed.
-- Lapsed rows are deliberately included (expires_at in the past) — a trainer needs to see the
-- client whose card failed far more than they need to see the ones who are fine.
create or replace function public.my_funded_clients(p_practice uuid)
returns table (athlete_id uuid, full_name text, expires_at timestamptz, is_active boolean, offer_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query
    select tfa.athlete_id, p.full_name, tfa.expires_at, (tfa.expires_at > now()) as is_active, o.name
    from trainer_funded_access tfa
    join profiles p on p.id = tfa.athlete_id
    left join offers o on o.id = tfa.offer_id
    where tfa.practice_id = p_practice and not tfa.is_owner_grant
    order by (tfa.expires_at > now()) desc, tfa.expires_at desc;
end $$;
grant execute on function public.my_funded_clients(uuid) to authenticated;

-- ---------------------------------------------------------------- flag (kill-switch discipline)
-- default_on = true, kill_switch NOT set. kill_switch is evaluated FIRST and inverts default_on, so
-- seeding it true here would ship the whole feature silently off (the 0125 lesson).
insert into public.feature_flags (name, description, default_on) values
  ('trainer_funded_v1', 'Trainer-funded access: Pay clients get Premium included and leave the seat bill', true)
on conflict (name) do nothing;

commit;
