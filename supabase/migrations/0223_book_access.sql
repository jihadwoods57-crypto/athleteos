-- 0223: does this operator book have access? (2026-09-08)
--
-- THE GAP. The org and pro tiers are the anchor of the business model (BUSINESS_MODEL.md §3), and
-- nothing in the product has ever required one. Stripe checkout, the webhook, the overage report
-- and the 0164 ledger all exist; has_premium_access (0163) gates ATHLETE surfaces only; and the
-- client's coach capability table is keyed on book kind with every write hardcoded to 1. A coach
-- could create a team, run a roster, assign, nudge and announce forever without a subscription.
--
-- THIS is the one predicate the product asks. Additive: no policy changes, no table changes.
--
-- WHO PAYS FOR A BOOK. The subscription row is keyed on the OPERATOR (owner_id = user.id, which
-- is what billing-checkout writes). A team's payer is teams.created_by, falling back to the org's
-- created_by; a practice's payer is practices.owner_id. Invited staff (coordinators, view-only,
-- a team nutritionist) inherit the payer's entitlement — they are on the payer's roster, not
-- their own. That is why this is SECURITY DEFINER: a staff member cannot read the payer's
-- subscription row under owner-RLS, and must not be able to; the function answers yes/no and
-- returns nothing about the row itself.
--
-- PREVIEW. A book that has never paid gets 14 days — the same length as the Stripe trial the
-- founder ratified 2026-07-30 — counted from the LATER of its creation and 2026-09-08. The floor
-- is the grandfathering default: every book that existed before enforcement gets a fresh
-- fortnight from the day enforcement landed, so nobody is locked out of a roster they built
-- during the free preview by the act of turning enforcement on.
--
-- EXPIRED IS READ-ONLY, NOT LOCKED OUT. This function only answers; the client keeps roster,
-- activity, inbox and profiles readable and gates WRITES. An athlete's data is still the coach's
-- to look at; what stops is putting new things on athletes' plates without a plan.
--
-- KNOWN BOUNDARY, stated: this is the predicate, not the wall. RLS write policies do not yet
-- consult it, so a modified client could still write. Closing that is a policy change that has
-- to go through the RLS suite (supabase/tests), which cannot run on a machine without Docker.
-- Do not add the policies without running it: a wrong deny locks real coaches out of their own
-- rosters, and that is the one failure worse than the gap.

create or replace function public.book_access(p_kind text, p_book uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_created timestamptz;
  v_paid boolean := false;
  v_preview_ends timestamptz;
  v_enforced constant timestamptz := timestamptz '2026-09-08 00:00:00+00';
  v_preview_days constant int := 14;
begin
  if p_kind = 'practice' then
    select owner_id, created_at into v_owner, v_created from practices where id = p_book;
  else
    select coalesce(t.created_by, o.created_by), t.created_at
      into v_owner, v_created
      from teams t left join orgs o on o.id = t.org_id
     where t.id = p_book;
  end if;

  if v_owner is null then
    -- No such book, or one with no traceable payer. Fail OPEN with a named reason: a bad id is
    -- a bug to fix, not a coach to lock out.
    return jsonb_build_object('entitled', true, 'reason', 'unknown');
  end if;

  -- Paid: the payer's own subscription, judged by the same rule as every other entitlement
  -- (active, or past_due inside the 7-day grace; a preview/free tier is not paid).
  select exists (
    select 1 from subscriptions
     where owner_id = v_owner
       and lower(coalesce(tier, '')) not in ('', 'preview', 'free', 'none', 'trial_expired')
       and (status = 'active'
            or (status = 'past_due'
                and coalesce(payment_failed_at, updated_at) > now() - interval '7 days'))
  ) into v_paid;
  if v_paid then
    return jsonb_build_object('entitled', true, 'reason', 'paid');
  end if;

  v_preview_ends := greatest(coalesce(v_created, v_enforced), v_enforced) + make_interval(days => v_preview_days);
  if now() < v_preview_ends then
    return jsonb_build_object('entitled', true, 'reason', 'preview', 'preview_ends_at', v_preview_ends);
  end if;
  return jsonb_build_object('entitled', false, 'reason', 'expired', 'preview_ends_at', v_preview_ends);
end; $$;

revoke execute on function public.book_access(text, uuid) from public, anon;
grant execute on function public.book_access(text, uuid) to authenticated;
