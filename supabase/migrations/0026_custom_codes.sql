-- OnStandard — custom / regenerable join codes.
-- Coaches & trainers can set a vanity join code (e.g. 'GATORS') or regenerate a random one,
-- instead of being stuck with the auto-generated code. All SECURITY DEFINER + resolve the
-- CALLER's own team/practice (head_coach staff / practice owner) so no id is trusted from the
-- client, and uniqueness is enforced by the existing `join_code unique` constraint (a taken
-- code raises a friendly error). gen_join_code() is defined in 0004.
--
-- GUARDRAIL: authored only; the founder applies it at go-live (like 0004+).

-- ---------------------------------------------------------------- teams (coach)
create or replace function set_my_team_code(new_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  up text := upper(trim(new_code));
begin
  if up !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Code must be 4 to 12 letters or numbers';
  end if;
  select s.team_id into t from team_staff s
    where s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
    limit 1;
  if t is null then raise exception 'You do not have a team to update'; end if;
  begin
    update teams set join_code = up where id = t;
  exception when unique_violation then
    raise exception 'That code is already taken — try another';
  end;
  return up;
end; $$;

create or replace function regenerate_my_team_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  new_code text;
begin
  select s.team_id into t from team_staff s
    where s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
    limit 1;
  if t is null then raise exception 'You do not have a team to update'; end if;
  new_code := gen_join_code();
  update teams set join_code = new_code where id = t;
  return new_code;
end; $$;

-- ---------------------------------------------------------------- practices (trainer)
create or replace function set_my_practice_code(new_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  up text := upper(trim(new_code));
begin
  if up !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Code must be 4 to 12 letters or numbers';
  end if;
  select id into p from practices where owner_id = auth.uid() limit 1;
  if p is null then raise exception 'You do not have a practice to update'; end if;
  begin
    update practices set join_code = up where id = p;
  exception when unique_violation then
    raise exception 'That code is already taken — try another';
  end;
  return up;
end; $$;

create or replace function regenerate_my_practice_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  new_code text;
begin
  select id into p from practices where owner_id = auth.uid() limit 1;
  if p is null then raise exception 'You do not have a practice to update'; end if;
  new_code := gen_join_code();
  update practices set join_code = new_code where id = p;
  return new_code;
end; $$;
