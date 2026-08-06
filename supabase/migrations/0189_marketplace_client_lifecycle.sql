-- 0189 — Coach Marketplace: money coming back must end the relationship.
--
-- THE BUG (shipped in 0184-0186): `practice_clients` appears exactly ONCE in stripe-webhook — the
-- insert that CREATES a marketplace relationship. Nothing ever sets it back. revokeFundedForCharge
-- only expires trainer_funded_access + offer_claims; customer.subscription.deleted only stamps a
-- timestamp on offer_payments. So a client who refunds, charges back, or cancels stays `active` on
-- their coach's roster forever — still in the book, still in chat, still visible via every
-- practice-scoped RLS policy.
--
-- AND IT SILENTLY KILLS SUPPLY. marketplace_directory (0185) does not merely DISPLAY seats — it
-- FILTERS on `l.capacity > (count of active practice_clients)`. Every ghost permanently consumes a
-- seat, so a coach who accumulates enough refunds DISAPPEARS FROM THE DIRECTORY and can never be
-- hired again. The error is asymmetric: marketplace-checkout's capacity check is deliberately soft
-- ("overshoot accepted, it's async"), but under-release is permanent.
--
-- Also: offer_payments.status had no 'disputed' value, so a chargeback was indistinguishable from a
-- voluntary refund in the ledger — which makes dispute rate (a Phase 3 quality metric, and a number
-- Stripe judges us on) uncomputable.

-- ---------------------------------------------------------------- ledger can tell them apart
alter table public.offer_payments drop constraint if exists offer_payments_status_check;
alter table public.offer_payments add constraint offer_payments_status_check
  check (status in ('paid','refunded','disputed','failed'));

-- ---------------------------------------------------------------- agreements can close
-- The agreement row itself stays forever (it is the legal record of what was agreed, and 0184 is
-- explicit that it survives the relationship). These columns record that it ENDED, and why.
alter table public.coach_agreements add column if not exists ended_at     timestamptz;
alter table public.coach_agreements add column if not exists ended_reason text
  check (ended_reason is null or ended_reason in ('refund','dispute','cancelled','admin'));

-- ---------------------------------------------------------------- the one door
-- Service-role only (no grant to authenticated): every caller is a webhook or an admin RPC that has
-- already established authority. Idempotent — a Stripe retry, or a refund arriving after a cancel,
-- must not double-write or resurrect anything.
create or replace function public.marketplace_deactivate_client(
  p_practice uuid, p_client uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_was text;
begin
  if p_reason not in ('refund','dispute','cancelled','admin') then raise exception 'bad reason'; end if;
  if p_practice is null or p_client is null then return; end if;

  select status::text into v_was from practice_clients
   where practice_id = p_practice and client_id = p_client;
  if v_was is null then return; end if;   -- never was a client; nothing to end

  -- Releasing the seat is the whole point: 'removed' is what marketplace_directory's capacity
  -- filter counts against, so this is what puts the coach back in the directory.
  update practice_clients set status = 'removed'
   where practice_id = p_practice and client_id = p_client and status <> 'removed';

  update coach_agreements set ended_at = now(), ended_reason = p_reason
   where client_id = p_client and practice_id = p_practice and ended_at is null;

  -- Audited with a null actor: the actor is Stripe, not a person.
  if v_was <> 'removed' then
    insert into admin_audit_log (actor_id, action, target, before, after)
    values (null, 'mkt.client.deactivate', p_practice::text || ':' || p_client::text,
            jsonb_build_object('status', v_was),
            jsonb_build_object('status', 'removed', 'reason', p_reason));
  end if;
end $$;
-- from PUBLIC too, not just anon/authenticated: Postgres grants EXECUTE to PUBLIC by default
-- on every new function, so revoking the two named roles alone leaves the door open (0147).
revoke all on function public.marketplace_deactivate_client(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- resolve a charge to its hire
-- The webhook knows a charge id; it needs the (practice, client) pair that charge created. Only
-- resolves rows that actually came from a marketplace hire — an ordinary trainer offer purchase
-- must NOT deactivate anyone, because there the client existed before the payment and the payment
-- ending doesn't end the coaching relationship.
create or replace function public.marketplace_hire_for_subscription(p_subscription text)
returns table (practice_id uuid, client_id uuid)
language sql stable security definer set search_path = public as $$
  select op.practice_id, op.payer_id
  from offer_payments op
  where op.stripe_subscription_id = p_subscription
    and op.payer_id is not null
    and exists (select 1 from coach_agreements ca
                where ca.practice_id = op.practice_id and ca.client_id = op.payer_id)
  limit 1;
$$;
revoke all on function public.marketplace_hire_for_subscription(text) from public, anon, authenticated;
