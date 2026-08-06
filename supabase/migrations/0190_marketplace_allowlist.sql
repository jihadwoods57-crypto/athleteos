-- 0190 — Coach Marketplace: a way to launch to five people instead of everyone.
--
-- THE GAP: `marketplace_enabled` (0183) is a single global boolean in app_config. feature_flags
-- (0109) is the table that supports enabled_user_ids / enabled_org_ids — the marketplace switch
-- isn't in it. So the only way to exercise this on production was to turn it on for every adult
-- user at once, which means the first real hire, the first real payment, and the first real coach
-- relationship all happen in public with no rehearsal.
--
-- This adds an allowlist WITHOUT moving the switch: `marketplace_allowlist` holds user ids that
-- see the marketplace while `marketplace_enabled` is still false. The precedence is deliberately
-- boring and stated once here:
--     enabled = true               → everyone (adults) sees it
--     enabled = false + on list    → only those users see it
--     enabled = false + not listed → nobody sees it        (today's state)
-- There is no kill-switch inversion subtlety like feature_flags has (see the 2026-07-29 note in
-- MEMORY: kill_switch is evaluated FIRST and inverts default_on) — enabled=true always wins.
--
-- Every server RPC keeps re-checking; the allowlist changes WHO passes, never WHETHER we check.

insert into public.app_config (key, value, value_type, description) values
  ('marketplace_allowlist', '[]'::jsonb, 'json',
   'User ids that see the Coach Marketplace while marketplace_enabled is false. Staged-rollout list; enabled=true overrides it and opens to everyone.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- one predicate, used everywhere
create or replace function public.marketplace_visible()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_config where key = 'marketplace_enabled'), false)
      or coalesce((select value @> to_jsonb(auth.uid()::text) from app_config where key = 'marketplace_allowlist'), false);
$$;
grant execute on function public.marketplace_visible() to authenticated;

-- ---------------------------------------------------------------- flags now report the real answer
create or replace function public.marketplace_flags()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled',           public.marketplace_visible(),
    'tier_bounds',       coalesce((select value from app_config where key = 'marketplace_tier_bounds'), '{}'::jsonb),
    'agreement_version', coalesce((select value #>> '{}' from app_config where key = 'marketplace_agreement_version'), 'v1'),
    'can_hire',          auth.uid() is not null and not is_minor(auth.uid()),
    -- so a tester can tell "I'm on the list" from "we launched"
    'preview',           public.marketplace_visible()
                         and not coalesce((select value = 'true'::jsonb from app_config where key = 'marketplace_enabled'), false)
  );
$$;
grant execute on function public.marketplace_flags() to authenticated;

-- ---------------------------------------------------------------- directory honours it too
-- (0185 read the app_config boolean inline; it must now ask the same question everything else does,
-- or an allowlisted tester would see a "Get a Coach" entry leading to an empty directory.)
create or replace function public.marketplace_directory(
  p_category text default null, p_max_price_cents int default null,
  p_style text default null, p_tz text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_minor(auth.uid()) or not public.marketplace_visible()
    then '[]'::jsonb
    else coalesce((select jsonb_agg(r order by r->>'created_at') from (
      select jsonb_build_object(
        'slug', l.slug, 'display_name', l.display_name, 'categories', l.categories,
        'headline', l.headline, 'style_tags', l.style_tags, 'languages', l.languages,
        'timezone', l.timezone, 'created_at', l.created_at,
        'seats_left', greatest(0, l.capacity - (select count(*) from practice_clients pc
                        where pc.practice_id = l.practice_id and pc.status = 'active')),
        'from_cents', (select min(o.price_cents) from offers o
                        where o.practice_id = l.practice_id and o.tier is not null and o.active)
      ) as r
      from coach_listings l
      where l.published and not l.suspended
        and l.capacity > (select count(*) from practice_clients pc
                          where pc.practice_id = l.practice_id and pc.status = 'active')
        and (p_category is null or l.categories @> array[p_category])
        and (p_style is null or l.style_tags @> array[p_style])
        and (p_tz is null or l.timezone = p_tz)
        and (p_max_price_cents is null or exists (select 1 from offers o
              where o.practice_id = l.practice_id and o.tier is not null and o.active
                and o.price_cents <= p_max_price_cents))
    ) rows), '[]'::jsonb)
  end;
$$;
grant execute on function public.marketplace_directory(text, int, text, text) to authenticated;

-- marketplace_listing gated the minor check but never the switch at all — an allowlist-era slug
-- guess would have returned a full listing to anyone. Close that while we're here.
create or replace function public.marketplace_listing(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_minor(auth.uid()) or not public.marketplace_visible() then null else (
    select jsonb_build_object(
      'slug', l.slug, 'practice_id', l.practice_id, 'display_name', l.display_name,
      'categories', l.categories, 'headline', l.headline, 'bio', l.bio,
      'style_tags', l.style_tags, 'languages', l.languages, 'timezone', l.timezone,
      'seats_left', greatest(0, l.capacity - (select count(*) from practice_clients pc
                      where pc.practice_id = l.practice_id and pc.status = 'active')),
      'already_client', exists (select 1 from practice_clients pc
                      where pc.practice_id = l.practice_id and pc.client_id = auth.uid()
                        and pc.status = 'active'),
      'tiers', coalesce((select jsonb_agg(jsonb_build_object(
                 'offer_id', o.id, 'tier', o.tier, 'name', o.name, 'blurb', o.blurb,
                 'price_cents', o.price_cents, 'features', o.features)
                 order by array_position(array['essential','daily','high_touch'], o.tier))
               from offers o where o.practice_id = l.practice_id and o.tier is not null and o.active),
               '[]'::jsonb))
    from coach_listings l
    where l.slug = p_slug and l.published and not l.suspended)
  end;
$$;
grant execute on function public.marketplace_listing(text) to authenticated;

-- ---------------------------------------------------------------- admin: manage the list
create or replace function public.admin_mkt_set_allowlist(p_user uuid, p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb;
begin
  perform assert_admin_mfa();
  select value into v_before from app_config where key = 'marketplace_allowlist';
  v_before := coalesce(v_before, '[]'::jsonb);
  if p_on then
    v_after := case when v_before @> to_jsonb(p_user::text) then v_before
                    else v_before || to_jsonb(p_user::text) end;
  else
    v_after := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_before) e
                         where e <> to_jsonb(p_user::text)), '[]'::jsonb);
  end if;
  update app_config set value = v_after, version = version + 1,
         updated_by = auth.uid(), updated_at = now()
   where key = 'marketplace_allowlist';
  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), case when p_on then 'mkt.allowlist.add' else 'mkt.allowlist.remove' end,
          p_user::text, v_before, v_after);
  return v_after;
end $$;
grant execute on function public.admin_mkt_set_allowlist(uuid, boolean) to authenticated;
