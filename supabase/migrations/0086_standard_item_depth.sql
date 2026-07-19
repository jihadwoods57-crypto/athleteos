-- OnStandard — standard item-schema depth (handoff Part B): let a coach configure more than
-- on/off. Extends the requirement-item JSON with OPTIONAL rails — grace minutes, late policy,
-- coach-review, snack flag, and a training/rest day type. All optional, so every existing set
-- validates unchanged; the scoring engine honors grace + late policy (day.js), the rest are
-- carried for the surfaces that consume them.
--
-- GUARDRAIL: authored for founder review — apply with `supabase db push`, then `npm run test:rls`.
-- validate_requirement_items is IMMUTABLE with an unchanged signature, so create-or-replace is
-- safe under the requirement_sets_items_valid check constraint (same pattern as 0074).

create or replace function validate_requirement_items(items jsonb) returns boolean
language plpgsql immutable as $$
declare
  it jsonb; meals int := 0; lifts int := 0;
begin
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) < 1 or jsonb_array_length(items) > 24 then return false; end if;
  for it in select * from jsonb_array_elements(items) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if not (it ? 'id' and it ? 'title' and it ? 'kind' and it ? 'proof') then return false; end if;
    if length(it->>'id') > 40 or length(it->>'title') > 80 then return false; end if;
    if (it->>'proof') not in ('photo','form','scale','counter','check') then return false; end if;
    if (it->>'kind') not in ('meal','lift','hydration','recovery','weigh','checkin','custom') then return false; end if;
    if (it->>'kind') = 'meal' then meals := meals + 1; end if;
    if (it->>'kind') = 'lift' then lifts := lifts + 1; end if;
    -- window rail: optional {open,due,label}; open/due minute-of-day 0..1439; due not before open.
    if it ? 'window' then
      if jsonb_typeof(it->'window') <> 'object' then return false; end if;
      if (it->'window') ? 'open' then
        if jsonb_typeof(it->'window'->'open') <> 'number' then return false; end if;
        if (it->'window'->>'open')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'due' then
        if jsonb_typeof(it->'window'->'due') <> 'number' then return false; end if;
        if (it->'window'->>'due')::numeric not between 0 and 1439 then return false; end if;
      end if;
      if (it->'window') ? 'open' and (it->'window') ? 'due' then
        if (it->'window'->>'due')::numeric < (it->'window'->>'open')::numeric then return false; end if;
      end if;
    end if;
    -- target rail: optional numeric target (hydration oz, weight goal), 1..999.
    if it ? 'target' then
      if jsonb_typeof(it->'target') <> 'number' then return false; end if;
      if (it->>'target')::numeric not between 1 and 999 then return false; end if;
    end if;
    -- Part B rails (all optional):
    -- grace: minutes past due a log still counts on time, 0..240.
    if it ? 'grace' then
      if jsonb_typeof(it->'grace') <> 'number' then return false; end if;
      if (it->>'grace')::numeric not between 0 and 240 then return false; end if;
    end if;
    -- latePolicy: how a past-grace log scores.
    if it ? 'latePolicy' then
      if (it->>'latePolicy') not in ('half','full','none') then return false; end if;
    end if;
    -- coachReview / snack: booleans.
    if it ? 'coachReview' then
      if jsonb_typeof(it->'coachReview') <> 'boolean' then return false; end if;
    end if;
    if it ? 'snack' then
      if jsonb_typeof(it->'snack') <> 'boolean' then return false; end if;
    end if;
    -- dayType: which day this item applies to (schema support; resolution is a later slice).
    if it ? 'dayType' then
      if (it->>'dayType') not in ('any','training','rest') then return false; end if;
    end if;
  end loop;
  return meals between 1 and 6 and lifts between 0 and 7;
end; $$;
