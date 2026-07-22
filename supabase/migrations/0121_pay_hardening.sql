-- 0121 — OnStandard Pay hardening (post-build review, Opus pass).
-- Three additive fixes on top of 0119; none touch the verified happy path.
--
-- (1) CRITICAL: `stripe_connect_*` live as plain columns on the pre-existing `practices` table,
--     whose UPDATE policy is only `owner_id = auth.uid()` with NO column restriction — and
--     `authenticated` holds a table-level UPDATE grant. So a trainer could
--         update practices set stripe_connect_status='active' where id = <their practice>
--     and self-promote past Stripe onboarding, since my_trainer_offers()/pay-offer-checkout
--     trust that column as their gate. A column REVOKE can't hold under a table-level grant, so
--     guard the three columns with a BEFORE UPDATE trigger: only the server (service_role, via
--     connect-onboarding / connect-webhook) may change them; a client update silently keeps OLD.
--
-- (2) IMPORTANT: offer_payments dedupe was a check-then-insert race with no DB constraint — a
--     duplicate/concurrent Stripe delivery could double-record a charge. Add a unique index on
--     stripe_charge_id (NULLs stay distinct, so unresolved/charge-less rows are unaffected) so the
--     webhook's upsert(onConflict) is atomic.

-- ---- (1) practices Connect-column write guard ---------------------------------------------------
create or replace function public.guard_practice_connect_cols()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce((current_setting('request.jwt.claims', true))::jsonb ->> 'role', '');
begin
  -- Any end-user role (authenticated/anon) is forbidden from moving the Connect state; force the
  -- three columns back to their stored values. service_role (server) and direct admin/migration
  -- (no JWT → empty role) pass through and may set them.
  if v_role in ('authenticated', 'anon') then
    new.stripe_connect_account_id := old.stripe_connect_account_id;
    new.stripe_connect_status     := old.stripe_connect_status;
    new.stripe_connect_updated_at := old.stripe_connect_updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists practices_guard_connect on public.practices;
create trigger practices_guard_connect
  before update on public.practices
  for each row execute function public.guard_practice_connect_cols();

-- ---- (2) offer_payments idempotency constraint -------------------------------------------------
create unique index if not exists offer_payments_charge_uq
  on public.offer_payments (stripe_charge_id);
