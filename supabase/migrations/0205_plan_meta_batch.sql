-- 0205: batch plan meta for the fueling board.
--
-- The nutrition board (coach-home's fueling table) needs every roster athlete's coach-set
-- targets to rank by risk (coverage x avg-vs-target). athlete_plan_meta (0103) answers one
-- athlete per round trip; calling it 85 times per paint is exactly the N+1 shape the scale
-- passes have been closing. One array-in call, same wall, same redaction, row for row.
--
-- Semantics mirror athlete_plan_meta exactly: rows are gated by is_self / can_view, and the
-- weight parts are conditionally redacted per athlete (base_weight -> null, targets minus
-- its 'weight' key) via can_view_weight. An id the caller cannot view simply returns no row,
-- indistinguishable from an athlete with no profile row -- that is the same posture as the
-- single-athlete RPC returning empty.
--
-- GUARDRAIL: authored only; NOT applied to live. The client degrades honestly without it
-- (RPC error -> null -> the board ranks by coverage alone and shows no targets), so ordering
-- against the OTA is safe either way; apply it to light targets up.

create or replace function athlete_plan_meta_batch(p_athletes uuid[])
returns table (athlete_id uuid, base_weight int, targets jsonb)
language sql stable security definer set search_path = public as $$
  select ap.athlete_id,
         case when can_view_weight(ap.athlete_id) then ap.base_weight else null end,
         case when can_view_weight(ap.athlete_id) then ap.targets else ap.targets - 'weight' end
  from athlete_profiles ap
  where ap.athlete_id = any(p_athletes)
    and (is_self(ap.athlete_id) or can_view(ap.athlete_id));
$$;
revoke execute on function athlete_plan_meta_batch(uuid[]) from public, anon;
grant  execute on function athlete_plan_meta_batch(uuid[]) to authenticated;
