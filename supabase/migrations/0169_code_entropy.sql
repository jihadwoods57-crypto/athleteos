-- OnStandard 0169 — join codes and staff-invite codes move to a CSPRNG.
--
-- THE GAP (security audit 2026-07-30, finding #4). Both code generators built their output from
-- PostgreSQL's `random()`:
--
--     c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
--
-- `random()` is a per-backend-session PRNG (xoroshiro128**), not a CSPRNG. Its internal state is
-- recoverable from observed output, which makes SUBSEQUENT codes from the same backend session
-- predictable rather than merely improbable. That is CWE-338, and it is the weakest randomness in
-- this database guarding the STRONGEST non-admin credential we mint:
--
--   join_staff(code) -> an active team_staff row -> can_view() passes for EVERY athlete on that
--   team -> their meals, progress photos, health data, and for minors all of it.
--
-- This is drift, not a decision. The same repo already reaches for the CSPRNG in three places:
-- 0008 (guardian consent tokens), 0081 (guardian scoped access), 0130 (admin recovery codes) all
-- use extensions.gen_random_bytes(). These two generators were simply written earlier and never
-- revisited.
--
-- WHAT CHANGES
--   · new public.gen_code(n) — the one CSPRNG code generator, revoked from every client role.
--   · gen_join_code() (0004) now delegates to it. Still 6 chars; callers unchanged (create_team
--     0022, create_practice 0025, regen_my_team_code / regen_my_practice_code 0026 all call it
--     BY NAME, so replacing the body propagates everywhere with no other edit).
--   · create_staff_invite() (current definition is 0083, NOT 0061) now delegates to it, and its
--     codes widen 8 -> 10 characters. 32^10 ≈ 1.1e15, up from 32^8 ≈ 1.1e12. The column is plain
--     `text unique`, the client just displays what the RPC returns, and join_staff matches on
--     equality — so the width change needs no other migration and breaks no existing code.
--
-- Existing codes keep working. This changes how the NEXT code is minted, nothing already issued.
--
-- ROLLBACK: restore the two prior bodies from 0004 / 0083 verbatim and
--   `drop function if exists public.gen_code(int);`

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- the generator
-- Unambiguous 32-char alphabet, unchanged from 0004/0083: no 0/O and no 1/I, because these get
-- read aloud in a gym and typed by a 14-year-old.
--
-- WHY A PLAIN MOD IS SAFE HERE: gen_random_bytes gives uniform bytes over 0..255, and
-- 256 % 32 = 0, so `byte % 32` maps exactly 8 byte values onto each of the 32 characters — no
-- modulo bias, no rejection sampling needed. (If the alphabet ever changes size to something that
-- does not divide 256, this must become rejection sampling or it silently skews.)
--
-- Not SECURITY DEFINER: it needs no elevated privilege, only a reachable pgcrypto. search_path is
-- pinned and the call is schema-qualified anyway, so it resolves the same from any caller.
create or replace function public.gen_code(n int)
returns text
language plpgsql volatile
set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no 0/O/1/I
  bytes bytea;
  out_code text := '';
  i int;
begin
  if n is null or n < 4 or n > 64 then
    raise exception 'gen_code: length must be between 4 and 64';
  end if;
  bytes := extensions.gen_random_bytes(n);
  for i in 0..n - 1 loop
    out_code := out_code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
  end loop;
  return out_code;
end $$;

revoke all on function public.gen_code(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- team / practice join codes
-- Supersedes 0004:16. Same 6-char shape, same collision loop, same callers.
create or replace function gen_join_code() returns text
language plpgsql
set search_path = public as $$
declare
  code text;
begin
  loop
    code := public.gen_code(6);
    exit when not exists (select 1 from teams where join_code = code);
  end loop;
  return code;
end; $$;

-- ---------------------------------------------------------------- staff invite codes
-- Supersedes 0083:10 (which itself superseded 0078 and 0061). The role allowlist and the
-- is_head_coach_of gate are preserved EXACTLY as 0083 had them — the only changes are the code
-- source and the 8 -> 10 width.
create or replace function create_staff_invite(p_team uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text; taken bool;
begin
  if not is_head_coach_of(p_team) then
    raise exception 'Only the head coach can invite staff.';
  end if;
  if p_role not in ('assistant', 'coordinator', 'position_coach', 'nutritionist', 'readonly',
                    's_and_c', 'athletic_trainer', 'team_admin') then
    raise exception 'Invite role must be coordinator, position_coach, nutritionist, readonly, s_and_c, athletic_trainer, or team_admin.';
  end if;
  loop
    c := public.gen_code(10);
    select exists(select 1 from staff_invites where code = c) into taken;
    exit when not taken;
  end loop;
  insert into staff_invites (team_id, role, code, created_by)
  values (p_team, p_role::staff_role, c, auth.uid());
  return c;
end; $$;
revoke all on function create_staff_invite(uuid, text) from public, anon;
grant execute on function create_staff_invite(uuid, text) to authenticated;

commit;
