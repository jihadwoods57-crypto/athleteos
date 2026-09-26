-- OnStandard 0251: no photo, no meal, on the server too (founder rule, decided 2026-09-26).
--
-- "An athlete can never log a meal without a photo." The current client already holds the line
-- (act.logMeal refuses a commit with no photo; search, label, barcode and chat picks PLAN a meal).
-- But meals_write (0002) is is_self() only, so an older build or a direct API call can still insert
-- a meal with no photo. This closes that door. The founder accepted the cost: a no-photo meal an
-- OLD build queued offline is refused when it finally syncs.
--
-- THE INVARIANT: photo_path names an object in the athlete's OWN meal-photos folder, i.e. it
-- starts with '<athlete_id>/' and has something after it. Why photo_path and not photo_hash or
-- source:
--   * Every shipped proto writer (day.js insertMeal, since the first one on 2026-07-08) builds the
--     path from the athlete id, the day and the slot BEFORE the upload, and inserts the row WITH it
--     set. No client, in any version, inserts first and fills photo_path later: no code path has
--     ever updated photo_path. The upload runs beside the insert (the outbox job does not wait for
--     it), so the storage object may not exist yet when the row lands. That is why this checks the
--     path and not storage.objects.
--   * photo_hash is NOT always present on a photo meal: insertMeal's pre-0062 fallback shape drops
--     it and source together, and prod has such a row (2026-09-17, path set, hash and source null).
--   * The '<athlete_id>/' prefix is the same rule the meal-photos storage policy (0003/0050)
--     applies to uploads, so it means "a path this athlete could actually have uploaded". Every one
--     of prod's 126 photo rows matches '<athlete_id>/<yyyy-mm-dd>/<slot>.jpg'.
--
-- WHO IS HELD TO IT: every request that arrives through the API, by the role it runs as:
-- authenticated (athletes; staff cannot insert meals at all), anon, and service_role. No server
-- writer needs an exemption today:
--   * No edge function inserts or updates meals (analyze-meal, meal-chat, athlete-summary,
--     ai-followup and verified-profile only read them).
--   * The one SQL writer, pro_correct_meal (0199), is a security definer UPDATE of the numbers,
--     foods and note. It never touches photo_path, and as a definer it runs as the table owner.
--   * The Trust Pass (0196) never creates a meal: spend_pass writes pass_spends, and the client
--     scores a covered slot from the athlete's trailing median on a clone of the day (pass.js).
--     The refund trigger (meals_refund_pass_spend) still fires after every real photo insert.
-- Direct database sessions (migrations, the SQL editor, `supabase db query`, the SQL test
-- fixtures) run as postgres and are not held: that is where a deliberate operator repair belongs.
-- A future security definer function that writes meals runs as its owner and is NOT held by this
-- trigger, so it must apply the rule itself.
--
-- UPDATES: a photo meal can never lose its photo. Once photo_path is set, an API caller cannot
-- change or clear it (no legitimate flow does; moves, corrections and reads patch other columns).
-- A legacy no-photo row may gain a path only if the path is a valid one.
--
-- PAST ROWS are untouched and stay valid and readable: this is a trigger, not a constraint, and it
-- looks only at the row being written. Prod's 12 no-photo rows (of 138, checked 2026-09-26) all
-- belong to demo and App Review accounts (rd-demo seeds 2026-08-16/18, the review athlete
-- 2026-09-22). No real athlete has ever stored a meal without a photo.
--
-- THE ERROR is stable for clients to match: SQLSTATE 23514 (check_violation, HTTP 400 through
-- PostgREST) with message exactly 'photo_required'. The current client drops the write and marks
-- the slot instead of retrying (day.js insertMeal, state.js).
--
-- Additive and idempotent: create-or-replace function, drop-if-exists trigger. No table, column,
-- policy or data change.

create or replace function public.enforce_meal_photo() returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: current_user must be the role the request runs as.
set search_path = public
as $$
declare
  v_held boolean := current_user in ('authenticated', 'anon', 'service_role');
  v_prefix text;
begin
  if not v_held then
    return new;
  end if;
  v_prefix := new.athlete_id::text || '/';

  if tg_op = 'INSERT' then
    if new.photo_path is null
       or left(new.photo_path, length(v_prefix)) <> v_prefix
       or length(new.photo_path) <= length(v_prefix) then
      raise exception using
        errcode = '23514',
        message = 'photo_required',
        detail  = 'A meal is logged only with its photo: photo_path must name the athlete''s own meal-photos object.',
        hint    = 'Take the photo, then log the meal.';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.photo_path is distinct from old.photo_path then
    if old.photo_path is not null
       or left(new.photo_path, length(v_prefix)) <> v_prefix
       or length(new.photo_path) <= length(v_prefix) then
      raise exception using
        errcode = '23514',
        message = 'photo_required',
        detail  = 'A logged meal keeps its photo: photo_path cannot be cleared or changed.',
        hint    = 'Delete the meal and log it again with a photo.';
    end if;
  end if;
  return new;
end;
$$;

-- A trigger function, never an RPC.
revoke all on function public.enforce_meal_photo() from public, anon, authenticated;

drop trigger if exists meals_photo_required on public.meals;
create trigger meals_photo_required
  before insert or update on public.meals
  for each row execute function public.enforce_meal_photo();
