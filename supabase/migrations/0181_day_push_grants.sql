-- 0181: the day push could never land — the "Waiting to sync" fix.
--
-- THE BUG (found 2026-08-05; the athlete app showed "Waiting to sync" forever and prod's `days`
-- table was EMPTY): every pushDay upsert failed with 42501. Two grant gaps compounded:
--
--   1. 0112 added days.checked_tasks but never added it to 0103's column-list SELECT grant —
--      exactly the gotcha 0103's own header warns about ("add the column to the matching GRANT
--      when you add it to the table"; 0142 remembered for plan_style/signals, 0112 did not).
--      The client's loadDay SELECT (DAY_SELECT_COLS includes checked_tasks) died on it too, so
--      a reinstalled device could not even hydrate its own history.
--
--   2. Postgres requires SELECT privilege on every column referenced as `excluded.col` in an
--      ON CONFLICT DO UPDATE — so the PostgREST upsert ALSO needed SELECT on current_weight,
--      which 0103 deliberately walled off. 0103's claim that "INSERT/UPDATE grants are
--      untouched, so the athlete's own writes keep working unchanged" was wrong for the
--      upsert path. (Reproduced live 2026-08-05 with a rolled-back DO block: the shipped row
--      shape 42501s; grant checked_tasks + drop current_weight from the row and it lands.)
--
-- THE FIX, preserving the weight wall (deny-by-default stays exactly as 0103 decided):
--   * grant the forgotten checked_tasks SELECT — it was always meant to be readable; it is a
--     task-completion map, not a walled column;
--   * weight leaves the direct upsert entirely: the client stops sending current_weight in
--     pushDay and writes it through a new SELF-ONLY definer door, log_my_weight — the write
--     mirror of 0103's weight_series read door;
--   * same treatment for athlete_profiles.base_weight (onboarding's saveAthleteProfile upsert
--     referenced excluded.base_weight and failed the same way): set_my_base_weight.
--
-- DEPLOY ORDER: migration FIRST, then the client OTA. The shipped (broken) client keeps
-- failing exactly as it does today until the OTA lands — nothing regresses in the gap; the
-- fixed client requires both halves.

-- ---------------------------------------------------------------- 1. the forgotten grant
grant select (checked_tasks) on table days to authenticated;

-- ---------------------------------------------------------------- 2. the weight write doors
-- Self-only by construction: the row key is auth.uid(), never a parameter — there is no
-- athlete argument to abuse. Definer bypasses the column grant (that is the point); the
-- range/date guards keep the door from being a junk-write vector. The 0050 minor-consent
-- gate is a TRIGGER on days (trg_minor_consent_days), so it still fires inside this definer
-- insert — an unconsented minor's weight write is rejected exactly like a direct one.
-- athlete_profiles has never been consent-trigger-gated, so set_my_base_weight matches the
-- pre-0103 direct-upsert behavior exactly.
create or replace function log_my_weight(d date, w numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if w is not null and (w < 40 or w > 1000) then
    raise exception 'weight out of range';
  end if;
  if d is null or d > current_date + 1 or d < current_date - 366 then
    raise exception 'date out of range';
  end if;
  insert into days (athlete_id, date, current_weight)
  values (auth.uid(), d, w)
  on conflict (athlete_id, date) do update set current_weight = excluded.current_weight;
end $$;
revoke execute on function log_my_weight(date, numeric) from public, anon;
grant  execute on function log_my_weight(date, numeric) to authenticated;

create or replace function set_my_base_weight(w int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if w is not null and (w < 40 or w > 1000) then
    raise exception 'weight out of range';
  end if;
  insert into athlete_profiles (athlete_id, base_weight, updated_at)
  values (auth.uid(), w, now())
  on conflict (athlete_id) do update set base_weight = excluded.base_weight, updated_at = now();
end $$;
revoke execute on function set_my_base_weight(int) from public, anon;
grant  execute on function set_my_base_weight(int) to authenticated;
