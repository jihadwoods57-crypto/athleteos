-- OnStandard — 0198: harden the practice code regeneration path before the UI exposes it.
--
-- The 2026-08-11 open-items pass gives Practice HQ the Customize / New code buttons the coach
-- has had all along (the RPCs themselves shipped in 0026/0038 and simply had no callers).
-- Exposing regenerate surfaced a latent bug: gen_join_code()'s collision loop (0169) only
-- checks TEAMS — regenerate_my_practice_code could mint a code already held by another
-- practice, and its update ran outside any exception handler, so the trainer got a raw
-- unique_violation from Postgres instead of a sentence.
--
-- Fixes, all forward-only:
--   (1) regenerate_my_practice_code loops against PRACTICES (its own namespace) and wraps the
--       update so even a race-window collision reads as a friendly retryable error.
--   (2) regenerate_my_team_code picks the same deterministic team as set_my_team_code (oldest;
--       0038 fixed the setter's non-deterministic `limit 1` and left the regenerator behind —
--       a multi-team head coach could customize one team's code and regenerate ANOTHER's).
--   (3) Both carry explicit execute grants: they predate 0035's default-privilege revoke today,
--       but an explicit grant is the house rule for every function a migration touches.

create or replace function regenerate_my_practice_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  new_code text;
begin
  select id into p from practices where owner_id = auth.uid()
    order by created_at asc
    limit 1;
  if p is null then raise exception 'You do not have a practice to update'; end if;
  -- Own-namespace collision loop: gen_join_code() only checks teams, which is correct for
  -- teams and wrong here. gen_code() is the 0169 CSPRNG.
  loop
    new_code := public.gen_code(6);
    exit when not exists (select 1 from practices where join_code = new_code);
  end loop;
  begin
    update practices set join_code = new_code where id = p;
  exception when unique_violation then
    raise exception 'Code collision — try again';
  end;
  return new_code;
end; $$;

revoke all on function regenerate_my_practice_code() from public, anon;
grant execute on function regenerate_my_practice_code() to authenticated;

create or replace function regenerate_my_team_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  new_code text;
begin
  -- Deterministic team pick (oldest), matching set_my_team_code since 0038.
  select s.team_id into t from team_staff s
    join teams tm on tm.id = s.team_id
    where s.staff_id = auth.uid() and s.role = 'head_coach' and s.status = 'active'
    order by tm.created_at asc
    limit 1;
  if t is null then raise exception 'You do not have a team to update'; end if;
  new_code := gen_join_code();
  begin
    update teams set join_code = new_code where id = t;
  exception when unique_violation then
    raise exception 'Code collision — try again';
  end;
  return new_code;
end; $$;

revoke all on function regenerate_my_team_code() from public, anon;
grant execute on function regenerate_my_team_code() to authenticated;
