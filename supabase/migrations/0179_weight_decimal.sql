-- 0179: morning weight keeps its tenths.
--
-- The weigh-in UI has always stepped by 0.1 lb (and now lets the athlete TYPE the value), but
-- days.current_weight was an int and the client rounded before writing — every tenth the athlete
-- entered was silently discarded, and the trend read back integers. Widen the column and the
-- weight_series RPC door so the number the athlete logs is the number everyone reads.
--
-- Compatibility: int -> numeric(5,1) is a safe implicit widening; the currently shipped client
-- keeps writing whole numbers into numeric just fine, and numeric serializes as a JSON number
-- old clients already parse with parseFloat.

alter table days alter column current_weight type numeric(5,1);

-- Postgres cannot change a function's return type via CREATE OR REPLACE — drop + recreate,
-- then re-apply the exact 0103 grants (the door stays authenticated-only).
drop function if exists weight_series(uuid, int);

create function weight_series(athlete uuid, days_back int default 60)
returns table ("date" date, weight numeric(5,1))
language sql stable security definer set search_path = public as $$
  select d.date, d.current_weight
  from days d
  where d.athlete_id = athlete
    and d.current_weight is not null
    and d.date >= current_date - greatest(0, least(days_back, 366))
    and can_view_weight(athlete)
  order by d.date;
$$;
revoke execute on function weight_series(uuid, int) from public, anon;
grant  execute on function weight_series(uuid, int) to authenticated;
