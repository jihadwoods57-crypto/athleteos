-- 0185 — Coach Marketplace user-facing RPCs: apply, browse, price.
-- All writes to applications are definer RPCs so status is never client-asserted; all public
-- reads are definer projections so the base tables stay own-row-only (0184).

-- ================================================================ applying
-- Upsert your own application while it's editable (draft / info_needed). Whitelisted fields only.
create or replace function public.save_coach_application(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_row coach_marketplace_applications;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into coach_marketplace_applications as a
    (user_id, legal_name, display_name, bio, experience, categories, style, languages, timezone, capacity)
  values (
    auth.uid(),
    coalesce(p->>'legal_name',''), coalesce(p->>'display_name',''),
    coalesce(p->>'bio',''), coalesce(p->>'experience',''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p->'categories') x), '{accountability}'),
    coalesce(p->>'style',''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p->'languages') x), '{}'),
    coalesce(p->>'timezone',''),
    coalesce((p->>'capacity')::int, 10)
  )
  on conflict (user_id) do update set
    legal_name   = excluded.legal_name,
    display_name = excluded.display_name,
    bio          = excluded.bio,
    experience   = excluded.experience,
    categories   = excluded.categories,
    style        = excluded.style,
    languages    = excluded.languages,
    timezone     = excluded.timezone,
    capacity     = excluded.capacity,
    updated_at   = now()
  where a.status in ('draft','info_needed')
  returning * into v_row;

  if v_row.id is null then raise exception 'application is not editable'; end if;
  return to_jsonb(v_row);
end $$;
grant execute on function public.save_coach_application(jsonb) to authenticated;

-- Submit: requires the essentials + all three acknowledgements. Stamps agreement times server-side.
create or replace function public.submit_coach_application()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_row coach_marketplace_applications;
begin
  select * into v_row from coach_marketplace_applications where user_id = auth.uid();
  if v_row.id is null then raise exception 'no application'; end if;
  if v_row.status not in ('draft','info_needed') then raise exception 'application is not editable'; end if;
  if length(trim(v_row.legal_name)) < 2 or length(trim(v_row.display_name)) < 2
     or length(trim(v_row.bio)) < 40 or length(trim(v_row.experience)) < 20 then
    raise exception 'application incomplete';
  end if;
  -- a claimed credential category without an uploaded doc can't be submitted
  if exists (select 1 from unnest(v_row.categories) c where c <> 'accountability'
             and not exists (select 1 from coach_credentials cc
                             where cc.application_id = v_row.id and cc.category = c)) then
    raise exception 'credential document required';
  end if;

  update coach_marketplace_applications set
    status = 'submitted',
    submitted_at = now(),
    agreements = jsonb_build_object('scope', now(), 'no_solicitation', now(), 'safeguarding', now()),
    updated_at = now()
  where id = v_row.id
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
grant execute on function public.submit_coach_application() to authenticated;

-- Own application + credentials, one call for the status screen. (Notes are invisible by design.)
create or replace function public.my_coach_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when a.id is null then null else
    to_jsonb(a) || jsonb_build_object(
      'credentials', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', c.category, 'title', c.title, 'status', c.status))
        from coach_credentials c where c.application_id = a.id), '[]'::jsonb),
      'listing', (select jsonb_build_object('slug', l.slug, 'published', l.published, 'suspended', l.suspended)
                  from coach_listings l where l.user_id = a.user_id))
  end
  from (select 1) one
  left join coach_marketplace_applications a on a.user_id = auth.uid();
$$;
grant execute on function public.my_coach_application() to authenticated;

-- ================================================================ browsing
-- The directory: published, not suspended, seats free. Adults only (fail-closed is_minor).
-- Deliberately NOT popularity-ranked: earliest partners first — stable, fair, and boring on purpose.
create or replace function public.marketplace_directory(
  p_category text default null, p_max_price_cents int default null,
  p_style text default null, p_tz text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_minor(auth.uid())
              or not coalesce((select value = 'true'::jsonb from app_config where key = 'marketplace_enabled'), false)
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

-- One listing + its tier plans, by slug.
create or replace function public.marketplace_listing(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_minor(auth.uid()) then null else (
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

-- ================================================================ pricing
-- The coach's three plans, bound-checked against app_config. Upserts one offer per tier.
create or replace function public.set_listing_tier_prices(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_listing coach_listings;
  v_bounds  jsonb;
  v_tier    text;
  v_cents   int;
  v_names   jsonb := '{"essential":"Essential Accountability","daily":"Daily Accountability","high_touch":"High-Touch Accountability"}'::jsonb;
begin
  select * into v_listing from coach_listings where user_id = auth.uid();
  if v_listing.practice_id is null then raise exception 'no listing'; end if;
  select value into v_bounds from app_config where key = 'marketplace_tier_bounds';

  for v_tier in select jsonb_object_keys(p) loop
    if v_tier not in ('essential','daily','high_touch') then raise exception 'bad tier %', v_tier; end if;
    v_cents := (p->>v_tier)::int;
    if v_cents < (v_bounds->v_tier->>'min_cents')::int or v_cents > (v_bounds->v_tier->>'max_cents')::int then
      raise exception 'price out of bounds for %', v_tier;
    end if;
    -- one offer per (practice, tier); update in place so existing Stripe subs are untouched —
    -- price changes apply to NEW hires only (renewals ride the subscription's own price).
    update offers set price_cents = v_cents, active = true, updated_at = now()
      where practice_id = v_listing.practice_id and tier = v_tier;
    if not found then
      insert into offers (practice_id, name, blurb, price_cents, cadence, tier, sort)
      values (v_listing.practice_id, v_names->>v_tier, '', v_cents, 'month', v_tier,
              array_position(array['essential','daily','high_touch'], v_tier));
    end if;
  end loop;
end $$;
grant execute on function public.set_listing_tier_prices(jsonb) to authenticated;
