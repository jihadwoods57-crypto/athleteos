-- OnStandard — 0199: the professional lane the Nutrition Pro onboarding promised (2026-08-11).
--
-- (1) coach_interventions gains kind 'flag' — the operator's "needs a human follow-up" mark
--     (ob2-nutrition's flame). Convention: reason_key 'flag:meal:<uuid>'; clearing a flag
--     appends kind 'handled' with the SAME reason_key (the table is append-only by design —
--     no update/delete policies — so state is "latest row wins per reason_key").
--
-- (2) pro_correct_meal — the first staff-side write path to a meals row. meals_update is
--     is_self-only (0002) and no definer function has ever written meals; the professional
--     correction flow needs one. The CLIENT computes the corrected numbers with the same
--     deterministic machinery the athlete uses (meal-intel.js applyMealCorrection /
--     applyFoodEdit — kitchen math is NOT duplicated here); this function only authorizes,
--     clamps, and persists. The athlete's own device reconciles its in-day copy through the
--     thread payload (meta t:'pro_correction'), so the day score still moves through the one
--     scoring engine, on the athlete's device, like every other score in the product.
--
-- Authorization: the caller must be WRITE staff for the meal's athlete — their trainer
-- (practice owner) or write-capable team staff. Deliberately NOT can_view: guardians and
-- read-only staff can see a meal but must never rewrite its record.

alter table coach_interventions drop constraint if exists coach_interventions_kind_check;
alter table coach_interventions add constraint coach_interventions_kind_check
  check (kind in ('nudge', 'message', 'assign', 'handled', 'flag'));

create or replace function pro_correct_meal(p_meal uuid, p_fields jsonb, p_summary text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m record;
  authorized boolean;
  marker text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select id, athlete_id, note into m from meals where id = p_meal;
  if m.id is null then raise exception 'meal not found'; end if;
  if m.athlete_id = auth.uid() then
    raise exception 'own meals are corrected through the meal screen, not this path';
  end if;
  select is_trainer_of(m.athlete_id)
      or exists (
        select 1 from team_members tm
        where tm.athlete_id = m.athlete_id and tm.status = 'active'
          and is_write_staff(tm.team_id))
    into authorized;
  if not authorized then raise exception 'not authorized to correct this meal'; end if;
  if p_fields is null or p_summary is null or btrim(p_summary) = '' then
    raise exception 'a correction needs fields and a summary';
  end if;
  -- The detected list rides as jsonb; cap its size so a hostile client cannot balloon the row.
  if p_fields ? 'detected' and pg_column_size(p_fields->'detected') > 16384 then
    raise exception 'detected list too large';
  end if;
  -- Same marker convention the athlete's own mirror uses ('[Athlete correction] …'), so every
  -- reader that already understands one understands both.
  marker := '[Pro correction] ' || left(btrim(p_summary), 160);
  update meals set
    protein = greatest(0, least(500,  coalesce((p_fields->>'protein')::int,  protein))),
    carbs   = greatest(0, least(500,  coalesce((p_fields->>'carbs')::int,    carbs))),
    fat     = greatest(0, least(500,  coalesce((p_fields->>'fat')::int,      fat))),
    kcal    = greatest(0, least(5000, coalesce((p_fields->>'kcal')::int,     kcal))),
    fiber   = greatest(0, least(60,   coalesce((p_fields->>'fiber')::int,    fiber))),
    quality = case when p_fields ? 'quality' and p_fields->>'quality' is not null
                   then greatest(0, least(100, (p_fields->>'quality')::int)) else quality end,
    detected = case when p_fields ? 'detected' then p_fields->'detected' else detected end,
    note = left(coalesce(nullif(note, ''), '') ||
                case when coalesce(note, '') = '' then '' else ' · ' end || marker, 500)
  where id = p_meal;
end; $$;

revoke all on function pro_correct_meal(uuid, jsonb, text) from public, anon;
grant execute on function pro_correct_meal(uuid, jsonb, text) to authenticated;
