-- OnStandard — make grant_trust_pass read the per-team Trust Pass policy (0097 consumer).
--
-- 0097 shipped trust_pass_policy (per-team length_days + eligibility_days) but nothing read it:
-- grant_trust_pass (0033/0039) still took a client-supplied p_length and a hardcoded default
-- eligibility of 7. This closes that loop. The grant now resolves the policy for the team through
-- which THIS coach is linked to the athlete and uses its numbers as the authority; an explicit
-- caller-supplied value still wins (back-compat), and a team with no policy row falls back to the
-- shipped 10-day / 7-day defaults — so behavior is unchanged until a coach configures a policy.
--
-- Only the eligibility/length SOURCE changes. The coach-link wall (is_team_coach_of), the
-- forgery-resistant photo-day eligibility signal (0039), the one-active-pass index, and the RPC
-- surface/signature are all intact. Same arg types (uuid,int,int) so create-or-replace replaces in
-- place and the existing grant to authenticated stands.
--
-- GUARDRAIL: authored + statically reviewed; NOT applied to live here (founder applies via
-- `supabase db push` + `npm run test:rls` at the next go-live batch). Forward-only, idempotent.

create or replace function grant_trust_pass(
  p_athlete uuid,
  p_length int default null,
  p_min_on_standard int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team       uuid;
  v_len        int;
  v_elig       int;
  v_photo_days int;
  v_id         uuid;
begin
  if not is_team_coach_of(p_athlete) then
    raise exception 'not authorized to grant a trust pass to this athlete';
  end if;

  -- The team through which THIS coach is linked to the athlete decides which policy applies
  -- (same join is_team_coach_of uses). limit 1: a coach linked via multiple teams takes any one.
  select m.team_id into v_team
    from team_members m
    join team_staff s on s.team_id = m.team_id
    where m.athlete_id = p_athlete and m.status = 'active'
      and s.staff_id = auth.uid() and s.status = 'active'
    limit 1;

  -- Effective policy: caller override, else the team's configured defaults, else shipped defaults.
  -- A missing policy row leaves v_len/v_elig NULL, which coalesce fills.
  select tpp.length_days, tpp.eligibility_days into v_len, v_elig
    from trust_pass_policy tpp
    where tpp.team_id = v_team;
  v_len  := coalesce(p_length, v_len, 10);
  v_elig := coalesce(p_min_on_standard, v_elig, 7);

  if v_len < 1 or v_len > 60 then
    raise exception 'invalid pass length';
  end if;
  if v_elig < 1 then v_elig := 1; end if;  -- defensive; the table already bounds 1..30

  -- Forgery-resistant eligibility (0039): distinct days the athlete photo-logged a meal.
  select count(distinct m.day_date) into v_photo_days
    from meals m
    where m.athlete_id = p_athlete and m.photo_path is not null;
  if v_photo_days < v_elig then
    raise exception 'athlete not eligible: % of % photo-logged days', v_photo_days, v_elig;
  end if;

  update trust_passes set ended_at = now() where athlete_id = p_athlete and ended_at is null;
  insert into trust_passes (athlete_id, granted_by, length_days)
    values (p_athlete, auth.uid(), v_len)
    returning id into v_id;
  return v_id;
end;
$$;

grant execute on function grant_trust_pass(uuid, int, int) to authenticated;
