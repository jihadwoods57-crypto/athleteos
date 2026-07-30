-- OnStandard 0164 — the overage gets a ledger, and the ledger is the idempotency.
--
-- 0163 defined the number ($10/active athlete beyond the included count); billing-overage-report
-- turns it into money. The design rule this table exists for: A CHARGE MAY ONLY HAPPEN IF ITS ROW
-- INSERTS. The function inserts (owner, month) FIRST — the primary key makes a second attempt for
-- the same month a no-op — and only then talks to Stripe, writing the invoice id back. So a
-- crashed run, a double-fired cron, or a redeployed function can never bill the same month twice:
-- the worst case is a row with no invoice id, which the founder can see and re-run explicitly.
--
-- Overage bills IN ARREARS as a standalone monthly invoice item, deliberately NOT as a quantity
-- on the subscription itself: Stripe forbids mixed intervals on one subscription, so an annual
-- subscriber could never carry a monthly overage item — this way one code path serves both
-- cadences, and the coach sees one clean line ("12 active athletes over your 50 · July") instead
-- of a mutating subscription.

begin;

create table if not exists public.billing_overage_reports (
  owner_id           uuid not null references profiles(id) on delete cascade,
  month              date not null,             -- first day of the month being billed
  active_athletes    int  not null,
  included_seats     int  not null,
  overage_seats      int  not null,
  cents_per_seat     int  not null,
  total_cents        int  not null,
  stripe_invoice_id  text,                      -- null until Stripe accepted it (or zero overage)
  created_at         timestamptz not null default now(),
  primary key (owner_id, month)
);
comment on table public.billing_overage_reports is
  'One row per (owner, month) overage decision. The PK is the double-billing guard: a charge may only happen if the insert succeeded.';

-- Service-role only, like every billing table. The owner-visible copy is the invoice itself
-- (Stripe portal); the admin view reads via RPC when the Command Center grows a panel for it.
alter table public.billing_overage_reports enable row level security;
revoke all on table public.billing_overage_reports from anon, authenticated;

-- ---------------------------------------------------------------- scheduling
-- Two jobs, one function:
--   * daily stamp   — keeps subscriptions.seats_used honest so the Plan & billing screen and
--                     admin_revenue read reality (mode: stamp).
--   * monthly bill  — on the 2nd, invoices the PREVIOUS month's overage from complete data
--                     (mode: invoice). The 2nd, not the 1st: late-arriving day rows from the
--                     final evening (client clocks, offline sync) land before the count is read.
create or replace function schedule_billing_overage(p_fn_url text, p_cron_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed — skipping schedule';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-seats-stamp';
  perform cron.schedule('billing-seats-stamp', '10 6 * * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-billing-key',%L),
      body := '{"mode":"stamp"}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));

  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-overage-invoice';
  perform cron.schedule('billing-overage-invoice', '20 6 2 * *', format(
    $cmd$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-billing-key',%L),
      body := '{"mode":"invoice"}'::jsonb
    );$cmd$, p_fn_url, p_cron_key));
end $$;
revoke all on function schedule_billing_overage(text, text) from public, anon, authenticated;
grant execute on function schedule_billing_overage(text, text) to service_role;

commit;
