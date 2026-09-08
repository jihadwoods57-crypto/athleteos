-- 0226: a book can be on a dated pilot (2026-09-08)
--
-- THE GAP 0223 LEFT. book_access grants every unpaid book exactly 14 days, computed as
-- greatest(created_at, 2026-09-08) + 14, with no way to say "this one book runs to this date".
-- The first real pilot is a college football position room across four game weeks, and 14 days
-- is two of them: it would go read-only in the middle of the trial, silently, losing exactly the
-- writes the pilot exists to test (assign, announce, standards, nudge, notes) while the reads
-- kept working so nobody would report it.
--
-- WHY A COLUMN AND NOT THE ALTERNATIVES. Writing a fake `subscriptions` row would make the app
-- tell a person they are on a paid plan when nobody has paid, and would have to be remembered and
-- unwound by hand. Moving the 14 moves it for every book on the platform. A per-book date says
-- the true thing, is visible in the row it governs, and expires on its own.
--
-- NOT SELF-SERVE, ON PURPOSE. There is no update policy and no RPC that sets this. A coach cannot
-- extend their own preview from the client; the founder sets pilot_until with the service role.
-- It is a comp lever operated by the business, which is the only thing that makes it safe to
-- have at all.
--
-- A PILOT ONLY EVER EXTENDS. A pilot_until in the past can never cut a book's standing preview
-- short. The lever grants time; a stale date must not become a new way to lock a coach out of a
-- roster they are still legitimately inside the free window on.
--
-- Additive: one nullable column per book table, no policy change, no table rewrite, and the same
-- SECURITY DEFINER function that still fails OPEN on an unknown book. The RLS write policies
-- still do not consult book_access (0223's stated boundary); that is unchanged here, and closing
-- it still needs the suite in supabase/tests and a machine with Docker.

alter table public.teams     add column if not exists pilot_until timestamptz;
alter table public.practices add column if not exists pilot_until timestamptz;

comment on column public.teams.pilot_until is
  'Founder-set pilot end. When later than the computed 14-day preview, book_access reports reason=pilot until this moment. Service role only: there is deliberately no update policy.';
comment on column public.practices.pilot_until is
  'Founder-set pilot end for a practice. See teams.pilot_until.';

create or replace function public.book_access(p_kind text, p_book uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_created timestamptz;
  v_pilot timestamptz;
  v_paid boolean := false;
  v_preview_ends timestamptz;
  v_enforced constant timestamptz := timestamptz '2026-09-08 00:00:00+00';
  v_preview_days constant int := 14;
begin
  if p_kind = 'practice' then
    select owner_id, created_at, pilot_until
      into v_owner, v_created, v_pilot
      from practices where id = p_book;
  else
    select coalesce(t.created_by, o.created_by), t.created_at, t.pilot_until
      into v_owner, v_created, v_pilot
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

  -- The pilot window, when the founder granted one that reaches past the standard preview and
  -- has not itself run out. Reported under its own reason so the client can say "your pilot"
  -- instead of "your free preview" and can decline to push a comped room toward checkout.
  if v_pilot is not null and v_pilot > v_preview_ends and now() < v_pilot then
    return jsonb_build_object('entitled', true, 'reason', 'pilot', 'preview_ends_at', v_pilot);
  end if;

  if now() < v_preview_ends then
    return jsonb_build_object('entitled', true, 'reason', 'preview', 'preview_ends_at', v_preview_ends);
  end if;

  -- Expired reports the moment access ACTUALLY ended, which is the pilot date when a pilot
  -- carried this book past its computed preview.
  return jsonb_build_object(
    'entitled', false, 'reason', 'expired',
    'preview_ends_at', greatest(v_preview_ends, coalesce(v_pilot, v_preview_ends)));
end; $$;

revoke execute on function public.book_access(text, uuid) from public, anon;
grant execute on function public.book_access(text, uuid) to authenticated;
