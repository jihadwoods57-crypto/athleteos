-- OnStandard 0163 — the billing metric becomes ACTIVE athletes, and non-payment stops being free.
--
-- Three structural problems in the subscription model, fixed at the data layer:
--
--   1. `seats_used` was never written by anything. The billing screen said "0 of 25 seats in use"
--      for a full roster, and admin_revenue()'s MRR estimate multiplied a permanent zero. Worse,
--      there was NO seat accounting at all: join_team/join_practice insert with no count, so every
--      advertised limit ("up to 50 active clients") was copy. This migration gives seats a real
--      definition and a writer.
--
--   2. The definition itself was wrong-shaped. Charging on ROSTER SIZE bills a coach for the kid
--      who quit in week two, while our real cost (AI meal reads) accrues only for athletes who
--      log. "Active athlete" — logged at least ACTIVE_DAYS_THRESHOLD days this calendar month —
--      points the billing metric and the cost metric in the same direction, and turns the
--      biggest sales objection to seat pricing into the pitch: idle seats are free.
--
--   3. `has_premium_access` treated past_due as unlocked FOREVER. Grace on a failed payment is
--      right (Stripe smart-retries run ~3 weeks; cutting access on day one loses saveable
--      customers), but unbounded grace means a card that never recovers keeps full access for
--      life — and stripe-webhook folds Stripe's terminal `unpaid` into past_due, making that the
--      default outcome of non-payment. The timestamp needed to bound it (payment_failed_at,
--      0042) has existed all along; the check just ignored it.
--
-- Billing itself (the $10/active-athlete overage) is reported to Stripe by the
-- billing-overage-report function, which calls stamp_seats_used() below. Nothing in this
-- migration charges anyone; it defines and records the number every charge depends on.

begin;

-- ---------------------------------------------------------------- active athletes
-- A day COUNTS toward activity when the athlete actually logged something: any meal, or a
-- submitted check-in, or hydration. A bare row (created by a reminder tap that logged nothing)
-- does not. Mirrors what drives AI cost: meals are the paid reads.
--
-- 5 days/month is the floor for "this athlete is genuinely using it": more than one stray week
-- of a single log, comfortably below any engaged athlete (who logs 20+). Callers can pass a
-- different threshold; the default is the billing definition and changing it is a PRICING
-- decision, not a tuning knob.
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
  activity as (
    select d.athlete_id, count(*) as logged_days
    from days d
    join owned_athletes oa on oa.athlete_id = d.athlete_id
    where d.date >= date_trunc('month', p_month)::date
      and d.date < (date_trunc('month', p_month) + interval '1 month')::date
      and (d.meals <> '{}'::jsonb or d.checkin <> '{}'::jsonb or d.hydration_l > 0)
    group by d.athlete_id
  )
  select count(*)::int from activity where logged_days >= greatest(p_threshold, 1);
$$;
-- Service-role/billing plumbing only: the raw function takes an arbitrary owner id, which must
-- never be a way for one coach to read another's roster engagement.
revoke all on function public.active_athlete_count(uuid, date, int) from public, anon, authenticated;

-- The owner's own number, for the Plan & billing screen ("34 of 50 active this month").
create or replace function public.my_active_athlete_count()
returns int language sql stable security definer set search_path = public as $$
  select public.active_athlete_count(auth.uid());
$$;
revoke all on function public.my_active_athlete_count() from public, anon;
grant execute on function public.my_active_athlete_count() to authenticated;

-- ---------------------------------------------------------------- seats_used gets a writer
-- Stamps every Stripe-rail subscription's seats_used from this month's active count. Called by
-- billing-overage-report (cron) and safe to call any time — it records reality, it never charges.
-- Returns the rows it stamped so the caller can report overage quantities without re-querying.
create or replace function public.stamp_seats_used()
returns table (owner_id uuid, seats int, seats_used int, plan_id text, stripe_subscription_id text)
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with stamped as (
    update subscriptions s
      set seats_used = public.active_athlete_count(s.owner_id),
          updated_at = now()
      where s.tier = 'team' and s.status in ('active', 'past_due')
      returning s.owner_id, s.seats, s.seats_used, s.plan_id, s.stripe_subscription_id
  )
  select st.owner_id, st.seats, st.seats_used, st.plan_id, st.stripe_subscription_id from stamped st;
end $$;
revoke all on function public.stamp_seats_used() from public, anon, authenticated;

-- ---------------------------------------------------------------- bounded grace
-- Same predicate as 0132, plus the one condition it was missing: past_due unlocks only within
-- GRACE (21 days — Stripe's smart-retry window plus margin) of the recorded failure. A row that
-- somehow reaches past_due with no timestamp gets the grace measured from updated_at rather than
-- a free pass. `unpaid` still maps to past_due in the webhook; with the bound, that now means
-- "three more weeks of access while dunning runs", not "free forever".
create or replace function public.has_premium_access(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from subscriptions
    where owner_id = p_user
      and lower(coalesce(tier, '')) not in ('', 'preview', 'free', 'none', 'trial_expired')
      and (
        status = 'active'
        or (status = 'past_due'
            and coalesce(payment_failed_at, updated_at) > now() - interval '21 days')
      )
  )
  or exists (
    select 1 from sponsored_access
    where athlete_id = p_user and expires_at > now()
  );
$$;
grant execute on function public.has_premium_access(uuid) to authenticated;

-- ---------------------------------------------------------------- founding slots, readable
-- The paywall says "Founding 50" and until now could not say how many are left — the count lived
-- in a service-role-only table. Exposes ONLY the remaining count: never who claimed, never when,
-- so allowlist membership stays unleakable (the 0109 rule).
create or replace function public.founding_slots_left()
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, 50 - (select count(*)::int from founding_members));
$$;
revoke all on function public.founding_slots_left() from public;
grant execute on function public.founding_slots_left() to anon, authenticated;

commit;
