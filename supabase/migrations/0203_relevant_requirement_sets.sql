-- 0203: relevant_requirement_sets — the bounded read for the athlete's standard resolution.
--
-- WHY (scale pass 2026-08-17/18): fetchRequirementSets pulled EVERY versioned set a book has
-- ever had (0085 appends a row per standard change, per scope), and the athlete's day scoring
-- resolves from that ever-growing pile client-side. A client-side LIMIT was rejected on
-- purpose: dropping the one governing row silently changes a SCORE. This RPC bounds the read
-- with the resolution semantics instead:
--   per (scope_kind, scope_value) lane -> every row effective after (today - 7 days), PLUS the
--   single newest row at-or-before that line. resolveRequirementSet (requirements.js) then
--   picks the governing row from a set that provably still contains it for any asOf date in
--   the last week (DAY.date can trail today across a midnight rollover) and any future date.
--
-- SECURITY INVOKER on purpose: requirement_sets' own RLS stays the wall — this function
-- narrows what rides the wire, it grants nothing.

create or replace function relevant_requirement_sets(p_book uuid, p_kind text default 'team')
returns setof requirement_sets
language sql stable
as $$
  with scoped as (
    select * from requirement_sets
    where (p_kind = 'practice' and practice_id = p_book)
       or (p_kind is distinct from 'practice' and team_id = p_book)
  ),
  recent as (
    select * from scoped
    where coalesce(effective_date, '0001-01-01'::date) > (current_date - 7)
  ),
  baseline as (
    select distinct on (scope_kind, coalesce(scope_value, '')) *
    from scoped
    where coalesce(effective_date, '0001-01-01'::date) <= (current_date - 7)
    order by scope_kind, coalesce(scope_value, ''),
             coalesce(effective_date, '0001-01-01'::date) desc, updated_at desc
  )
  select * from recent
  union all
  select * from baseline;
$$;

revoke all on function relevant_requirement_sets(uuid, text) from public;
grant execute on function relevant_requirement_sets(uuid, text) to authenticated;
