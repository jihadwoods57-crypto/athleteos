-- 0188 — Coach Marketplace: approval must actually make you a coach.
--
-- THE BUG (shipped in 0186): admin_mkt_review_application minted a `practices` row on approve but
-- never touched `profiles.primary_role`. The proto's router bounces anyone whose authRole isn't
-- coach/trainer off every nav:'operator' screen (router.js:240), so an approved marketplace coach
-- could not reach their own dashboard, roster, or inbox — the entire coach surface was unreachable
-- for exactly the people we had just approved.
--
-- WHY 'trainer' AND NOT 'coach': only 'trainer' actually loads a practice into the client runtime
-- (state.js:2303 — 'coach' takes the team branch and would render an EMPTY book, which looks like
-- it worked and is a worse failure than the bounce). The server already agrees: flags/index.ts:59
-- derives practice-owner ⇒ "trainer". The marketplace calls them a Coach and the app shell will say
-- Trainer; that naming mismatch is a KNOWN, ACCEPTED gap (founder decision 2026-08-06) — the fix is
-- a vocabulary pass, not a different role value.
--
-- SEPARATE-ACCOUNT RULE (founder decision 2026-08-06): primary_role is global, and the router's
-- mirror guard (router.js:249) bounces a coach/trainer off every ATHLETE screen. So promoting an
-- account silently deletes that person's own Home/Plan/Camera/Progress. Rather than evict someone
-- as a side effect of getting hired, we refuse the application: marketplace coaches use a
-- coaching-only account. Enforced at submit AND at approve (defense in depth), with an explicit
-- admin override for the cases a human has actually looked at.

-- ---------------------------------------------------------------- the signal
-- What "this is somebody's athlete account" means, stated once so the copy and the guard agree.
-- Deliberately narrow: being a MEMBER somewhere, or having actually logged a day. Merely having an
-- athlete_profiles row is NOT enough — every signup gets one, so it would block everybody.
create or replace function public.mkt_athlete_activity(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on_a_team',    exists (select 1 from team_members     where athlete_id = p_user and status = 'active'),
    'is_a_client',  exists (select 1 from practice_clients where client_id  = p_user and status = 'active'),
    'logged_days',  (select count(*) from days where athlete_id = p_user)
  );
$$;
grant execute on function public.mkt_athlete_activity(uuid) to authenticated;

create or replace function public.mkt_has_athlete_activity(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (a->>'on_a_team')::boolean
      or (a->>'is_a_client')::boolean
      or (a->>'logged_days')::int > 0
  from (select public.mkt_athlete_activity(p_user) as a) s;
$$;
grant execute on function public.mkt_has_athlete_activity(uuid) to authenticated;

-- ---------------------------------------------------------------- surface it to the applicant
-- my_coach_application() gains `athlete_activity` so the apply screen can say WHY it's blocked
-- before the coach fills in a long form and gets refused at the last step.
create or replace function public.my_coach_application()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when a.id is null then null else
    to_jsonb(a) || jsonb_build_object(
      'credentials', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', c.category, 'title', c.title, 'status', c.status))
        from coach_credentials c where c.application_id = a.id), '[]'::jsonb),
      'listing', (select jsonb_build_object('slug', l.slug, 'published', l.published, 'suspended', l.suspended)
                  from coach_listings l where l.user_id = a.user_id),
      'athlete_activity', public.mkt_athlete_activity(a.user_id))
  end
  from (select 1) one
  left join coach_marketplace_applications a on a.user_id = auth.uid();
$$;
grant execute on function public.my_coach_application() to authenticated;

-- A pre-form probe, so the apply screen can warn on arrival rather than on submit.
create or replace function public.my_marketplace_eligibility()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_apply', not public.mkt_has_athlete_activity(auth.uid()),
    'activity',  public.mkt_athlete_activity(auth.uid()));
$$;
grant execute on function public.my_marketplace_eligibility() to authenticated;

-- ---------------------------------------------------------------- block at submit
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
  -- 0188: coaching accounts are separate accounts. Approving would take this person's own
  -- athlete app away from them, so refuse before they invest in the form.
  if public.mkt_has_athlete_activity(auth.uid()) then
    raise exception 'this account is in use as an athlete — apply from a separate coaching account';
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

-- ---------------------------------------------------------------- promote on approve
-- p_force lets an admin approve anyway once they've actually read the activity — the block is a
-- safety rail against a silent eviction, not a law of physics.
create or replace function public.admin_mkt_review_application(
  p_id uuid, p_action text, p_note text default '', p_force boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_app  coach_marketplace_applications;
  v_cats text[];
  v_practice uuid;
  v_slug text;
  v_role_before text;
begin
  perform assert_admin_mfa();
  if p_action not in ('under_review','info_needed','approved','rejected') then raise exception 'bad action'; end if;
  select * into v_app from coach_marketplace_applications where id = p_id;
  if v_app.id is null then raise exception 'no application'; end if;

  if coalesce(p_note,'') <> '' then
    insert into coach_application_notes (application_id, author_id, note) values (p_id, auth.uid(), p_note);
  end if;

  if p_action = 'approved' then
    if public.mkt_has_athlete_activity(v_app.user_id) and not p_force then
      raise exception 'applicant account has athlete activity — approving would remove their athlete app. Review and re-approve with force if intended.';
    end if;

    -- verified categories only, accountability always included
    select array['accountability'] || coalesce(array_agg(c.category), '{}') into v_cats
      from coach_credentials c
     where c.application_id = p_id and c.status = 'verified';

    -- reuse the applicant's earliest practice, or mint one on the spot
    select id into v_practice from practices where owner_id = v_app.user_id order by created_at limit 1;
    if v_practice is null then
      insert into practices (owner_id, name, join_code)
      values (v_app.user_id, v_app.display_name || ' Coaching', gen_join_code())
      returning id into v_practice;
    end if;

    -- slug: display name + entropy, never the legal name; retry on the astronomically unlikely clash
    loop
      v_slug := lower(regexp_replace(trim(v_app.display_name), '[^a-zA-Z0-9]+', '-', 'g'))
                || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
      exit when not exists (select 1 from coach_listings where slug = v_slug);
    end loop;

    insert into coach_listings (practice_id, user_id, slug, display_name, categories,
                                headline, bio, style_tags, languages, timezone, capacity)
    values (v_practice, v_app.user_id, v_slug, v_app.display_name, v_cats,
            '', v_app.bio,
            coalesce((select array_agg(trim(t)) from unnest(string_to_array(v_app.style, ',')) t where trim(t) <> ''), '{}'),
            v_app.languages, v_app.timezone, v_app.capacity)
    -- Re-approval (e.g. a credential verified after a first approval) refreshes the VERIFIED
    -- scope — but never touches the coach's own presentation edits or publish state.
    on conflict (practice_id) do update set categories = excluded.categories, updated_at = now();

    -- THE FIX: without this the approved coach cannot render a single operator screen.
    select primary_role::text into v_role_before from profiles where id = v_app.user_id;
    if v_role_before is distinct from 'trainer' then
      update profiles set primary_role = 'trainer', updated_at = now() where id = v_app.user_id;
      insert into admin_audit_log (actor_id, action, target, before, after)
      values (auth.uid(), 'mkt.role.promote', v_app.user_id::text,
              jsonb_build_object('role', v_role_before),
              jsonb_build_object('role', 'trainer', 'reason', 'marketplace approval', 'forced', p_force));
    end if;
  end if;

  update coach_marketplace_applications
     set status = p_action, reviewed_by = auth.uid(), updated_at = now()
   where id = p_id;

  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'mkt.application.' || p_action, 'coach_marketplace_applications:' || p_id,
          to_jsonb(v_app), (select to_jsonb(a) from coach_marketplace_applications a where a.id = p_id));
end $$;
grant execute on function public.admin_mkt_review_application(uuid, text, text, boolean) to authenticated;
-- The 3-arg signature from 0186 is now ambiguous against the 4-arg default; drop it so a stale
-- client calling the old shape gets the new behaviour (with promotion) rather than PostgREST
-- picking the un-promoting one.
drop function if exists public.admin_mkt_review_application(uuid, text, text);

-- ---------------------------------------------------------------- backfill
-- Anyone already approved before this migration is sitting locked out right now.
do $$
declare v_n int;
begin
  with promoted as (
    update profiles p set primary_role = 'trainer', updated_at = now()
    from coach_listings l
    where l.user_id = p.id and p.primary_role is distinct from 'trainer'
    returning p.id
  )
  select count(*) into v_n from promoted;
  if v_n > 0 then
    insert into admin_audit_log (actor_id, action, target, after)
    values (null, 'mkt.role.backfill', 'profiles',
            jsonb_build_object('promoted', v_n, 'migration', '0188'));
  end if;
end $$;
