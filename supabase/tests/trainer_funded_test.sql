-- OnStandard — trainer-funded access (0166) behaviour + authorization suite.
--
-- 0166 changes two things that decide money: who is Premium (has_premium_access) and who is
-- BILLABLE (active_athlete_count). A mistake in the second one either double-bills a trainer for a
-- client they are already paying 15% on, or silently zeroes a coach's invoice. Neither is something
-- to discover in production, so both directions are pinned here against real Postgres.
--
-- Run against a migrated local/staging DB, as superuser — NEVER production:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/trainer_funded_test.sql
--
-- Same shape as rls_authz_test.sql: one transaction, rolled back, scoreboard at the end, non-zero
-- exit if any check failed.
--
-- Cast:
--   trainer_t  owns practice P1, Connect active
--   coach_b    owns practice P2 — an unrelated operator, the control for scoping bugs
--   ath_1      client of P1, funded through Pay, logs enough to be "active"
--   ath_2      client of P1, NOT funded, logs enough to be "active"
--   ath_3      client of P2 AND funded by P1 — the cross-practice case that must still bill coach_b

begin;

-- ---------------------------------------------------------------- harness
create table _tf_results (n serial, ok boolean, label text);

create or replace function _ok(cond boolean, label text) returns void
language plpgsql security definer as $$
begin
  insert into _tf_results(ok, label) values (coalesce(cond,false), label);
  if coalesce(cond,false) then raise notice 'PASS: %', label;
  else raise warning 'FAIL: %', label; end if;
end $$;
grant execute on function _ok(boolean, text) to authenticated, anon;

create or replace function _as(p_uid uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function _as(uuid) to authenticated, anon;

create or replace function _superuser() returns void
language plpgsql as $$ begin execute 'reset role'; end $$;
grant execute on function _superuser() to authenticated, anon;

create or replace function _try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'denied(' || sqlstate || '): ' || sqlerrm;
end $$;
grant execute on function _try(text) to authenticated, anon;

-- ---------------------------------------------------------------- seed
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('7ff00000-0000-0000-0000-000000000001'::uuid, 'tf-trainer@x.io'),
  ('7ff00000-0000-0000-0000-000000000002'::uuid, 'tf-coach@x.io'),
  ('7ff00000-0000-0000-0000-00000000000a'::uuid, 'tf-a1@x.io'),
  ('7ff00000-0000-0000-0000-00000000000b'::uuid, 'tf-a2@x.io'),
  ('7ff00000-0000-0000-0000-00000000000c'::uuid, 'tf-a3@x.io');

insert into profiles (id, full_name, email, primary_role) values
  ('7ff00000-0000-0000-0000-000000000001', 'Trainer T', 'tf-trainer@x.io', 'trainer'),
  ('7ff00000-0000-0000-0000-000000000002', 'Coach B',   'tf-coach@x.io',   'coach'),
  ('7ff00000-0000-0000-0000-00000000000a', 'Athlete 1', 'tf-a1@x.io',      'athlete'),
  ('7ff00000-0000-0000-0000-00000000000b', 'Athlete 2', 'tf-a2@x.io',      'athlete'),
  ('7ff00000-0000-0000-0000-00000000000c', 'Athlete 3', 'tf-a3@x.io',      'athlete')
on conflict (id) do update set full_name = excluded.full_name, primary_role = excluded.primary_role;

insert into practices (id, owner_id, name, join_code, stripe_connect_account_id, stripe_connect_status) values
  ('7ff00000-0000-0000-0000-00000000ff01'::uuid, '7ff00000-0000-0000-0000-000000000001', 'T1 Performance', 'TFTEST01', 'acct_test_t1', 'active'),
  ('7ff00000-0000-0000-0000-00000000ff02'::uuid, '7ff00000-0000-0000-0000-000000000002', 'B2 Strength',    'TFTEST02', null,           'none');

insert into offers (id, practice_id, name, price_cents, cadence) values
  ('7ff00000-0000-0000-0000-00000000ee01'::uuid, '7ff00000-0000-0000-0000-00000000ff01', 'Full Coaching', 20000, 'month');

insert into practice_clients (practice_id, client_id, status) values
  ('7ff00000-0000-0000-0000-00000000ff01', '7ff00000-0000-0000-0000-00000000000a', 'active'),
  ('7ff00000-0000-0000-0000-00000000ff01', '7ff00000-0000-0000-0000-00000000000b', 'active'),
  ('7ff00000-0000-0000-0000-00000000ff02', '7ff00000-0000-0000-0000-00000000000c', 'active');

-- Everyone logs 6 real days this month → all three are "active athletes" by 0163's definition
-- (>= 5 days with a meal / checkin / hydration). Activity is held constant so that every count
-- difference below is attributable to funding, not to logging.
insert into days (athlete_id, date, hydration_l)
select a.id, date_trunc('month', now())::date + g, 2.0
from (values ('7ff00000-0000-0000-0000-00000000000a'::uuid),
             ('7ff00000-0000-0000-0000-00000000000b'::uuid),
             ('7ff00000-0000-0000-0000-00000000000c'::uuid)) a(id),
     generate_series(0, 5) g
on conflict do nothing;

-- ================================================================ entitlement: the third arm
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000a') = false,
  '0166: an unfunded client is not premium');

insert into trainer_funded_access (athlete_id, practice_id, stripe_subscription_id, offer_id, is_owner_grant, expires_at) values
  ('7ff00000-0000-0000-0000-00000000000a', '7ff00000-0000-0000-0000-00000000ff01', 'sub_tf_1',
   '7ff00000-0000-0000-0000-00000000ee01', false, now() + interval '30 days'),
  ('7ff00000-0000-0000-0000-000000000001', '7ff00000-0000-0000-0000-00000000ff01', 'sub_tf_1',
   '7ff00000-0000-0000-0000-00000000ee01', true,  now() + interval '30 days');

select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000a') = true,
  '0166: a funded client IS premium with no subscription of their own');
select _ok(has_premium_access('7ff00000-0000-0000-0000-000000000001') = true,
  '0166: the trainer rides along on their own client''s grant');
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000b') = false,
  '0166: funding one client does not leak premium to the next client');

-- ACCESS FALLS OUT OF BILLING: nothing revokes: the grant simply ages out.
update trainer_funded_access set expires_at = now() - interval '1 minute'
  where athlete_id = '7ff00000-0000-0000-0000-00000000000a';
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000a') = false,
  '0166: a lapsed grant stops being premium with no revocation step');
update trainer_funded_access set expires_at = now() + interval '30 days'
  where athlete_id in ('7ff00000-0000-0000-0000-00000000000a', '7ff00000-0000-0000-0000-000000000001');

-- ================================================================ the seat bill
-- THE POINT OF THE MIGRATION: a funded client must leave the trainer's billable count, or the
-- trainer pays 15% AND a seat for the same person.
select _ok(active_athlete_count('7ff00000-0000-0000-0000-000000000001') = 1,
  '0166: the funded client leaves the trainer''s billable seats (2 active, 1 funded -> 1)');

update trainer_funded_access set expires_at = now() - interval '1 minute'
  where athlete_id = '7ff00000-0000-0000-0000-00000000000a';
select _ok(active_athlete_count('7ff00000-0000-0000-0000-000000000001') = 2,
  '0166: when funding lapses the client returns to the billable count');
update trainer_funded_access set expires_at = now() + interval '30 days'
  where athlete_id = '7ff00000-0000-0000-0000-00000000000a';

-- The scoping bug this guards: an athlete funded by trainer T must STILL bill coach B, who sees
-- none of T's platform fee. Excluding by athlete alone would let one operator's payment silently
-- discount an unrelated operator's invoice.
select _ok(active_athlete_count('7ff00000-0000-0000-0000-000000000002') = 1,
  '0166: coach B still bills for their own client (baseline)');
insert into trainer_funded_access (athlete_id, practice_id, stripe_subscription_id, is_owner_grant, expires_at) values
  ('7ff00000-0000-0000-0000-00000000000c', '7ff00000-0000-0000-0000-00000000ff01', 'sub_tf_3', false, now() + interval '30 days');
select _ok(active_athlete_count('7ff00000-0000-0000-0000-000000000002') = 1,
  '0166: a client funded by ANOTHER operator still counts toward coach B''s seats');

-- ================================================================ premium source labelling
select _as('7ff00000-0000-0000-0000-00000000000a');
select _ok(my_premium_source() = 'trainer',
  '0166: my_premium_source names the trainer, so the label cannot say "sponsored"');
select _as('7ff00000-0000-0000-0000-00000000000b');
select _ok(my_premium_source() = 'none',
  '0166: an unfunded athlete has no premium source');
select _superuser();

insert into subscriptions (owner_id, tier, status) values
  ('7ff00000-0000-0000-0000-00000000000a', 'consumer', 'active')
on conflict (owner_id) do update set tier = 'consumer', status = 'active';
select _as('7ff00000-0000-0000-0000-00000000000a');
select _ok(my_premium_source() = 'subscription',
  '0166: a direct payer is named as a subscriber, not as trainer-funded');
select _superuser();
delete from subscriptions where owner_id = '7ff00000-0000-0000-0000-00000000000a';

-- ================================================================ RLS: nobody mints their own premium
select _as('7ff00000-0000-0000-0000-00000000000b');
select _ok(_try($$insert into trainer_funded_access
    (athlete_id, practice_id, stripe_subscription_id, is_owner_grant, expires_at)
  values ('7ff00000-0000-0000-0000-00000000000b','7ff00000-0000-0000-0000-00000000ff01','sub_forged',false, now() + interval '10 years')$$)
  like 'denied%', '0166: an athlete cannot grant themselves trainer-funded premium');
select _ok(_try($$update trainer_funded_access set expires_at = now() + interval '10 years'$$) like 'denied%',
  '0166: an athlete cannot extend anyone''s grant');
select _ok((select count(*) from trainer_funded_access) = 0,
  '0166: an athlete cannot read another athlete''s grants');

select _as('7ff00000-0000-0000-0000-00000000000a');
select _ok((select count(*) from trainer_funded_access) = 1,
  '0166: an athlete reads exactly their own grant');

select _as('7ff00000-0000-0000-0000-000000000001');
select _ok((select count(*) from trainer_funded_access where practice_id = '7ff00000-0000-0000-0000-00000000ff01') = 3,
  '0166: the practice owner reads their own practice''s grants');

select _as('7ff00000-0000-0000-0000-000000000002');
select _ok((select count(*) from trainer_funded_access where practice_id = '7ff00000-0000-0000-0000-00000000ff01') = 0,
  '0166: an unrelated operator cannot read another practice''s grants');
select _ok(_try($$select * from my_funded_clients('7ff00000-0000-0000-0000-00000000ff01'::uuid)$$) like 'denied%',
  '0166: my_funded_clients refuses a practice you do not own');
select _superuser();

-- ================================================================ claim redemption
insert into offer_claims (code, practice_id, offer_id, stripe_subscription_id, stripe_checkout_session_id, payer_email) values
  ('TR-TEST-0001', '7ff00000-0000-0000-0000-00000000ff01', '7ff00000-0000-0000-0000-00000000ee01',
   'sub_tf_claim', 'cs_test_claim', 'newclient@x.io');

-- a2 is already a client; use a3 (a stranger to P1) to prove redemption CREATES the link.
select _as('7ff00000-0000-0000-0000-00000000000c');
select _ok((select ok from redeem_offer_code('nope-not-a-code')) = false,
  '0166: a wrong code is refused');
select _ok((select ok from redeem_offer_code('tr-test-0001')) = true,
  '0166: redemption is case- and whitespace-insensitive (a trainer reads it aloud)');
select _superuser();

select _ok(exists(select 1 from practice_clients
    where practice_id = '7ff00000-0000-0000-0000-00000000ff01'
      and client_id = '7ff00000-0000-0000-0000-00000000000c' and status = 'active'),
  '0166: redeeming creates the practice link — pay-first onboarding needs no join code');
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000c') = true,
  '0166: the redeemer is premium immediately');

-- 0168: the grant is ONE PERIOD, not the claim's 90-day window. The claim's expiry is a deadline for
-- finding the code; using it as the entitlement handed a client who cancelled after month one about
-- two free months, and broke the "access falls out of billing" property 0166 is built on. The
-- renewal webhook extends it from here.
select _ok((select expires_at from trainer_funded_access
    where athlete_id = '7ff00000-0000-0000-0000-00000000000c'
      and stripe_subscription_id = 'sub_tf_claim') < now() + interval '45 days',
  '0168: a redeemed claim grants one billing period + grace, never the claim window');
select _ok((select expires_at from trainer_funded_access
    where athlete_id = '7ff00000-0000-0000-0000-00000000000c'
      and stripe_subscription_id = 'sub_tf_claim') > now() + interval '6 days',
  '0168: and it is still long enough to be usable on the day it is redeemed');

select _as('7ff00000-0000-0000-0000-00000000000c');
select _ok((select reason from redeem_offer_code('TR-TEST-0001')) = 'already_redeemed',
  '0166: re-redeeming your own code is idempotent, not an error (double-tap on a flaky link)');
select _superuser();

select _as('7ff00000-0000-0000-0000-00000000000b');
select _ok((select reason from redeem_offer_code('TR-TEST-0001')) = 'already_used',
  '0166: a code already claimed by someone else cannot be reused');
select _superuser();

insert into offer_claims (code, practice_id, stripe_subscription_id, expires_at) values
  ('TR-TEST-DEAD', '7ff00000-0000-0000-0000-00000000ff01', 'sub_tf_dead', now() - interval '1 day');
select _as('7ff00000-0000-0000-0000-00000000000b');
select _ok((select reason from redeem_offer_code('TR-TEST-DEAD')) = 'expired',
  '0166: an expired claim is refused');
select _ok(_try($$update offer_claims set status = 'pending', claimed_by = null$$) like 'denied%',
  '0166: a client cannot reset a claim to redeem it again');
select _superuser();

-- ================================================================ 0167: chasing unredeemed buyers
-- The worst non-security failure of pay-first: someone is charged monthly for an app they never
-- opened. These pin the two queries that make it visible.
insert into offer_claims (code, practice_id, offer_id, stripe_subscription_id, payer_email, created_at) values
  ('TR-TEST-WAIT', '7ff00000-0000-0000-0000-00000000ff01', '7ff00000-0000-0000-0000-00000000ee01',
   'sub_tf_wait', 'waiting@x.io', now() - interval '5 days');

select _as('7ff00000-0000-0000-0000-000000000001');
select _ok((select count(*) from my_pending_claims('7ff00000-0000-0000-0000-00000000ff01'::uuid)) = 1,
  '0167: the trainer sees the buyer who paid and never redeemed');
select _ok((select days_waiting from my_pending_claims('7ff00000-0000-0000-0000-00000000ff01'::uuid) limit 1) = 5,
  '0167: and how long they have been waiting');
select _superuser();
select _as('7ff00000-0000-0000-0000-000000000002');
select _ok(_try($$select * from my_pending_claims('7ff00000-0000-0000-0000-00000000ff01'::uuid)$$) like 'denied%',
  '0167: another operator cannot read a practice''s buyer emails');
select _superuser();

select _ok((select count(*) from claims_needing_reminder(2, 2)) >= 1,
  '0167: a 5-day-old unredeemed claim is due a reminder');
select _ok((select count(*) from claims_needing_reminder(30, 2)) = 0,
  '0167: a claim younger than the window is not chased');
select mark_claim_reminded((select id from offer_claims where code = 'TR-TEST-WAIT'));
select mark_claim_reminded((select id from offer_claims where code = 'TR-TEST-WAIT'));
select _ok((select count(*) from claims_needing_reminder(2, 2)) = 0,
  '0167: the ladder stops after two nudges — we never mail someone weekly');

-- ================================================================ 0167: refund takes access back
-- Before this, buy -> grant -> refund -> keep premium for the whole period was a repeatable free
-- ride. The webhook calls the same UPDATE this models.
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000a') = true,
  '0167: (setup) the funded client is premium before the refund');
update trainer_funded_access set expires_at = now()
  where stripe_subscription_id = 'sub_tf_1' and expires_at > now();
select _ok(has_premium_access('7ff00000-0000-0000-0000-00000000000a') = false,
  '0167: a refunded charge takes the client''s premium back');
select _ok(active_athlete_count('7ff00000-0000-0000-0000-000000000001') = 2,
  '0167: a refunded client returns to the billable seat count');

-- The trainer is NOT cut off here, and that is the point: athlete ...000c redeemed a claim earlier,
-- so a second live grant still funds them. Revocation is scoped by SUBSCRIPTION, so refunding one
-- client can never knock a trainer with a full book off premium.
select _ok(has_premium_access('7ff00000-0000-0000-0000-000000000001') = true,
  '0167: refunding ONE client does not cut off a trainer who still has another');
update trainer_funded_access set expires_at = now() where athlete_id = '7ff00000-0000-0000-0000-000000000001';
select _ok(has_premium_access('7ff00000-0000-0000-0000-000000000001') = false,
  '0167: the trainer loses premium only when their LAST funded client is gone');

-- ================================================================ scoreboard
do $$
declare fails int; total int; bad text;
begin
  select count(*) filter (where not ok), count(*) into fails, total from _tf_results;
  raise notice '================================================';
  raise notice 'TRAINER-FUNDED SUITE: % / % checks passed', total - fails, total;
  if fails > 0 then
    raise notice 'FAILED CHECKS:';
    -- Iterate the LABELS directly. The earlier form declared a loop variable named `n` and selected
    -- a column named `n`, which Postgres reports as ambiguous — and since the branch only runs when
    -- something fails, the bug hid until the first real failure.
    for bad in select label from _tf_results where not ok order by n loop
      raise notice '  - %', bad;
    end loop;
    raise exception 'TRAINER-FUNDED SUITE FAILED: % check(s) — see the FAIL lines above', fails;
  end if;
  raise notice 'ALL GREEN.';
end $$;

rollback;
