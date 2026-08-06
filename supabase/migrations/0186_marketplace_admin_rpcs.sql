-- 0186 — Coach Marketplace admin RPCs. Every one is gated by assert_admin_mfa() (0130: allowlist
-- AND aal2) and writes admin_audit_log. These are the ONLY write paths for application status,
-- credential verification, listing creation, suspension, and report resolution.

-- ================================================================ queues
create or replace function public.admin_mkt_list_applications(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin_mfa();
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'email', (select u.email from auth.users u where u.id = a.user_id),
      'credentials', coalesce((select jsonb_agg(to_jsonb(c)) from coach_credentials c
                               where c.application_id = a.id), '[]'::jsonb),
      'notes', coalesce((select jsonb_agg(jsonb_build_object('note', n.note, 'at', n.created_at)
                         order by n.created_at) from coach_application_notes n
                         where n.application_id = a.id), '[]'::jsonb))
      order by a.submitted_at nulls last)
    from coach_marketplace_applications a
    where p_status is null or a.status = p_status), '[]'::jsonb);
end $$;
grant execute on function public.admin_mkt_list_applications(text) to authenticated;

create or replace function public.admin_mkt_list_reports(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin_mfa();
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'coach_name', (select l.display_name from coach_listings l where l.practice_id = r.practice_id))
      order by r.created_at desc)
    from coach_reports r
    where p_status is null or r.status = p_status), '[]'::jsonb);
end $$;
grant execute on function public.admin_mkt_list_reports(text) to authenticated;

-- ================================================================ credential verification
-- The ONLY way a credential leaves 'submitted'. Never the applicant, never a policy.
create or replace function public.admin_mkt_verify_credential(p_id uuid, p_action text, p_note text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform assert_admin_mfa();
  if p_action not in ('verified','rejected') then raise exception 'bad action'; end if;
  select to_jsonb(c) into v_before from coach_credentials c where id = p_id;
  if v_before is null then raise exception 'no credential'; end if;
  update coach_credentials
     set status = p_action, verified_by = auth.uid(), verified_at = now(), review_note = coalesce(p_note,'')
   where id = p_id;
  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'mkt.credential.' || p_action, 'coach_credentials:' || p_id, v_before,
          (select to_jsonb(c) from coach_credentials c where id = p_id));
end $$;
grant execute on function public.admin_mkt_verify_credential(uuid, text, text) to authenticated;

-- ================================================================ application review
-- approve: verified categories only make it onto the listing — a claimed-but-unverified cpt/snc
-- silently drops to accountability-only, so an unverified credential can never be displayed.
create or replace function public.admin_mkt_review_application(p_id uuid, p_action text, p_note text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_app  coach_marketplace_applications;
  v_cats text[];
  v_practice uuid;
  v_slug text;
begin
  perform assert_admin_mfa();
  if p_action not in ('under_review','info_needed','approved','rejected') then raise exception 'bad action'; end if;
  select * into v_app from coach_marketplace_applications where id = p_id;
  if v_app.id is null then raise exception 'no application'; end if;

  if coalesce(p_note,'') <> '' then
    insert into coach_application_notes (application_id, author_id, note) values (p_id, auth.uid(), p_note);
  end if;

  if p_action = 'approved' then
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
  end if;

  update coach_marketplace_applications
     set status = p_action, reviewed_by = auth.uid(), updated_at = now()
   where id = p_id;

  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'mkt.application.' || p_action, 'coach_marketplace_applications:' || p_id,
          to_jsonb(v_app), (select to_jsonb(a) from coach_marketplace_applications a where a.id = p_id));
end $$;
grant execute on function public.admin_mkt_review_application(uuid, text, text) to authenticated;

-- ================================================================ suspension
create or replace function public.admin_mkt_suspend_listing(p_practice uuid, p_suspend boolean, p_reason text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform assert_admin_mfa();
  select to_jsonb(l) into v_before from coach_listings l where practice_id = p_practice;
  if v_before is null then raise exception 'no listing'; end if;
  update coach_listings
     set suspended = p_suspend, suspend_reason = case when p_suspend then coalesce(p_reason,'') else '' end,
         updated_at = now()
   where practice_id = p_practice;
  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), case when p_suspend then 'mkt.listing.suspend' else 'mkt.listing.unsuspend' end,
          'coach_listings:' || p_practice, v_before,
          (select to_jsonb(l) from coach_listings l where practice_id = p_practice));
end $$;
grant execute on function public.admin_mkt_suspend_listing(uuid, boolean, text) to authenticated;

-- ================================================================ report resolution
create or replace function public.admin_mkt_resolve_report(p_id uuid, p_status text, p_resolution text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform assert_admin_mfa();
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'bad status'; end if;
  select to_jsonb(r) into v_before from coach_reports r where id = p_id;
  if v_before is null then raise exception 'no report'; end if;
  update coach_reports
     set status = p_status, resolution = coalesce(p_resolution,''),
         resolved_by = auth.uid(),
         resolved_at = case when p_status in ('resolved','dismissed') then now() end
   where id = p_id;
  insert into admin_audit_log (actor_id, action, target, before, after)
  values (auth.uid(), 'mkt.report.' || p_status, 'coach_reports:' || p_id, v_before,
          (select to_jsonb(r) from coach_reports r where id = p_id));
end $$;
grant execute on function public.admin_mkt_resolve_report(uuid, text, text) to authenticated;
