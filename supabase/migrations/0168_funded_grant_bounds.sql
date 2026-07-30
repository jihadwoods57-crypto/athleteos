-- OnStandard 0168 — two defects in the trainer-funded grant (0166), found reviewing 0166/0167.
--
-- 1. A REDEEMED CLAIM GRANTED UP TO 90 DAYS FOR ONE MONTH'S MONEY.
--    redeem_offer_code set the grant's expires_at to the CLAIM's expires_at, and a claim is minted
--    with `now() + interval '90 days'` — that window exists so a buyer who closes the tab has three
--    months to find their code, and it says nothing about what they paid for. So a client who bought
--    a $200/mo package, redeemed, and then cancelled kept Premium for the rest of the 90 days: about
--    two free months, per client, silently.
--
--    It also contradicts the property 0166 states as its whole design ("ACCESS FALLS OUT OF BILLING.
--    expires_at is pushed forward by stripe-webhook on each successful invoice. A failed card runs
--    dunning, expires_at passes, access lapses. There is no revocation code path because there does
--    not need to be one"). That is only true if a grant is never longer than the period that bought
--    it — otherwise the lapse the design relies on simply does not arrive.
--
--    Fix: the redemption grant covers ONE billing period plus the standard 7-day grace, and never
--    more than the claim's own window. The renewal webhook extends it from there exactly as it does
--    for an in-app purchase, which is the "indistinguishable from that moment on" this intended.
--    A week is the floor, so a nearly-expired claim still redeems into something usable.
--
--    The cadence comes from the offer the claim was sold against — a weekly package funds a week,
--    not a month. An offer that has since been deleted (offer_id is nullable, ON DELETE SET NULL)
--    falls back to a month, which is the only recurring cadence public-offer-checkout ships besides
--    week and is the safer of the two to guess.
--
-- 2. THE WEBHOOK'S HOTTEST QUERY HAD NO INDEX.
--    trainer_funded_access is keyed (athlete_id, stripe_subscription_id) and indexed on
--    (athlete_id, expires_at) and (practice_id, expires_at). But every renewal — the most frequent
--    write in the whole feature — updates BY SUBSCRIPTION ALONE, and a refund does the same. A
--    leading-column mismatch means both sequential-scan the table on every invoice.paid. Same for
--    offer_claims, which the refund path filters by subscription id.
--
-- Safe to apply whether or not 0166's function has already run: this only replaces a function body
-- and adds indexes. No grants change (create or replace preserves them).

begin;

create index if not exists trainer_funded_sub_idx
  on public.trainer_funded_access (stripe_subscription_id);
create index if not exists offer_claims_sub_idx
  on public.offer_claims (stripe_subscription_id);

create or replace function public.redeem_offer_code(p_code text)
returns table (ok boolean, reason text, trainer_name text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_claim record;
  v_practice record;
  v_name text;
  v_exp timestamptz;
  v_cadence text;
  v_period interval;
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
  if not found then
    -- The practice went away under the claim. Nothing to link to and nobody to grant.
    return query select false, 'invalid_code', ''::text, null::timestamptz; return;
  end if;
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

  -- ONE PERIOD + the 7-day grace, capped by the claim's own window, floored at a week. See the
  -- header: the claim's 90 days is a deadline for finding the code, never an entitlement.
  select o.cadence into v_cadence from offers o where o.id = v_claim.offer_id;
  v_period := case when v_cadence = 'week' then interval '7 days' else interval '1 month' end;
  v_exp := greatest(
    now() + interval '7 days',
    least(now() + v_period + interval '7 days', v_claim.expires_at)
  );

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

  -- Never a self-grant row: a trainer who bought their own offer would collide on the primary key
  -- with the client row just written (0166 guards the same case in the webhook, not here).
  if v_practice.owner_id <> v_uid then
    insert into public.trainer_funded_access
      (athlete_id, practice_id, stripe_subscription_id, offer_id, is_owner_grant, expires_at)
      values (v_practice.owner_id, v_claim.practice_id, v_claim.stripe_subscription_id, v_claim.offer_id, true, v_exp)
      on conflict (athlete_id, stripe_subscription_id)
        do update set expires_at = greatest(trainer_funded_access.expires_at, excluded.expires_at);
  end if;

  return query select true, 'redeemed', v_name, v_exp;
end $$;
grant execute on function public.redeem_offer_code(text) to authenticated;

commit;
