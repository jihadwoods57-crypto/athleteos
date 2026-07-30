-- OnStandard 0167 — chase the buyer who paid and never redeemed.
--
-- The pay-first funnel (0166) has one genuinely bad failure mode, and it is not a security hole —
-- it is a customer one. A prospect buys a $200/mo package from a trainer's public page, closes the
-- tab before writing down the claim code, ignores the email, and is then billed EVERY MONTH for a
-- product they cannot open. The claim expires after 90 days; the Stripe subscription does not. That
-- ends in a chargeback and a furious trainer, and nothing in 0166 surfaced it to anyone.
--
-- The strongest lever is not another email from us — it is the TRAINER, who has the relationship and
-- is already looking at their Grow tab. So: make unredeemed claims visible to them by name, and let
-- a reminder job (billing-claim-reminders) find stale ones.

begin;

-- Track reminders so a nightly job never re-mails the same buyer daily. Nullable because every
-- existing row predates the column and has had none.
alter table public.offer_claims add column if not exists reminded_at timestamptz;
alter table public.offer_claims add column if not exists reminder_count int not null default 0;

-- ---------------------------------------------------------------- trainer-facing
-- Deliberately NOT filtered to "recent": a trainer needs to see every person who paid them and
-- never got in, however long ago. Returns the code itself so the trainer can simply read it to the
-- client — they are the practice owner, it is their sale, and they could refund it outright.
create or replace function public.my_pending_claims(p_practice uuid)
returns table (code text, payer_email text, created_at timestamptz, offer_name text, days_waiting int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not owns_practice(p_practice) then raise exception 'not authorized'; end if;
  return query
    select c.code, c.payer_email, c.created_at, o.name,
           greatest(0, extract(day from (now() - c.created_at))::int)
    from offer_claims c
    left join offers o on o.id = c.offer_id
    where c.practice_id = p_practice
      and c.status = 'pending'
      and c.expires_at > now()
    order by c.created_at asc;   -- the longest-waiting buyer is the most urgent
end $$;
grant execute on function public.my_pending_claims(uuid) to authenticated;

-- ---------------------------------------------------------------- reminder job feed
-- Service-role only: it returns buyer email addresses across every practice, which no signed-in
-- user may ever enumerate. Ladder is deliberately short — two nudges, then we stop and leave it to
-- the trainer. Mailing someone weekly about a code they ignored is how you earn a spam complaint.
--
-- p_after_days: only claims at least this old (a buyer who redeems in the first hour needs nothing).
create or replace function public.claims_needing_reminder(p_after_days int default 2, p_max_reminders int default 2)
returns table (id uuid, code text, payer_email text, practice_name text, reminder_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select c.id, c.code, c.payer_email, pr.name, c.reminder_count
    from offer_claims c
    join practices pr on pr.id = c.practice_id
    where c.status = 'pending'
      and c.expires_at > now()
      and c.payer_email is not null
      and c.reminder_count < greatest(p_max_reminders, 0)
      and c.created_at < now() - make_interval(days => greatest(p_after_days, 0))
      -- Space the nudges: never twice within p_after_days of each other.
      and (c.reminded_at is null or c.reminded_at < now() - make_interval(days => greatest(p_after_days, 0)))
    order by c.created_at asc
    limit 200;
end $$;
revoke all on function public.claims_needing_reminder(int, int) from public, anon, authenticated;

create or replace function public.mark_claim_reminded(p_id uuid)
returns void language sql volatile security definer set search_path = public as $$
  update offer_claims set reminded_at = now(), reminder_count = reminder_count + 1 where id = p_id;
$$;
revoke all on function public.mark_claim_reminded(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- schedule
-- Same shape as schedule_billing_overage (0164): service-role only, idempotent (unschedule then
-- schedule), key passed in rather than stored. Daily at 07:05 — after the billing jobs, and at a
-- civil hour for whoever receives the mail.
create or replace function public.schedule_claim_reminders(p_fn_url text, p_cron_key text)
returns void language plpgsql volatile security definer set search_path = public, cron as $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed — skipping claim reminder schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'claim-reminders';
  perform cron.schedule('claim-reminders', '5 7 * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-billing-key',%L),
      body := '{}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;
revoke all on function public.schedule_claim_reminders(text, text) from public, anon, authenticated;
grant execute on function public.schedule_claim_reminders(text, text) to service_role;

commit;
