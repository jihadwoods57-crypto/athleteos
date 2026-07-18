-- OnStandard — parent (guardian) scoped access + invite flow (founder security spec 2026-07-18)
--
-- THE GAP (audit 2026-07-18): the parent role is an honest stub. guardianships + is_guardian_of()
-- exist, but (a) is_guardian_of feeds can_view(), so a guardian would see the athlete's ENTIRE
-- record — meal photos, weight, everything — exactly like a coach; and (b) there is no way to
-- CREATE a guardianship (client insert revoked in 0053). The promise "parents see scores and
-- streaks, never photos or weight" was UI copy only.
--
-- THE FIX (fail-closed): a guardian gets NO direct table access. is_guardian_of is REMOVED from
-- can_view(), so every can_view-gated surface (days, meals, checkins, athlete_profiles,
-- performance_profiles, the meal-photos storage bucket) excludes guardians. A guardian reads
-- ONLY a safe summary — date + score + grade — through two SECURITY DEFINER RPCs whose SELECT
-- lists never touch weight/photos/meals (score and weight share the days row, so column-safety
-- is enforced in the RPC, not by row RLS). If an RPC is ever wrong it returns LESS, never more.
-- Guardianships are created only by redeeming a single-use, expiring invite the athlete mints;
-- the accept RPC is the sole insert path. The minor-consent gate is preserved throughout.
--
-- SAFE TODAY: no guardian rows exist (insert revoked in 0053, never wired), so removing guardian
-- from can_view() changes nothing live.
--
-- GUARDRAIL: authored only; NOT applied to live by the crew. Because this gates MINORS' data,
--   the founder reviews it, runs `npm run test:rls` (guardian probes are updated in this pass),
--   ideally against a throwaway project first, then applies at go-live per the runbook.

-- ---------------------------------------------------------------- 1. guardian loses direct access
-- Supersedes can_view (0078:70-78): identical body MINUS the is_guardian_of branch.
create or replace function can_view(athlete uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_self(athlete)
      or ( ( ( can_view_via_memberships(athlete)
               and not staff_scope_blocks(athlete) )
             or is_trainer_of(athlete) )
           and (not is_provable_minor(athlete) or has_verified_guardian_consent(athlete)) );
$$;

-- ---------------------------------------------------------------- 2. single-use, expiring invites
create table if not exists guardian_invites (
  token        text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  athlete_id   uuid not null references profiles(id) on delete cascade,
  relationship text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_by  uuid references profiles(id) on delete set null,
  accepted_at  timestamptz
);
create index if not exists guardian_invites_athlete on guardian_invites(athlete_id);
alter table guardian_invites enable row level security;
-- Athlete sees their own invites; all writes go through the RPCs (no direct client write).
drop policy if exists gi_read on guardian_invites;
create policy gi_read on guardian_invites for select using (athlete_id = auth.uid());
revoke insert, update, delete on guardian_invites from authenticated;

-- Athlete mints an invite for THEMSELVES (athlete_id is always the caller — you can't invite a
-- guardian onto someone else's account). Returns the token to share out-of-band.
create or replace function create_guardian_invite(relationship text default null) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  insert into guardian_invites (athlete_id, relationship)
  values (auth.uid(), relationship)
  returning token into tok;
  return tok;
end; $$;

-- The parent (signed into their OWN account) redeems the token → the ONLY path that inserts a
-- guardianship. Single-use, unexpired, no self-guardianship; idempotent on re-link.
create or replace function accept_guardian_invite(invite_token text, rel text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv guardian_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;
  select * into inv from guardian_invites where token = invite_token for update;
  if inv.token is null then raise exception 'invalid invite'; end if;
  if inv.accepted_at is not null then raise exception 'this invite has already been used'; end if;
  if inv.expires_at < now() then raise exception 'this invite has expired — ask for a new one'; end if;
  if inv.athlete_id = auth.uid() then raise exception 'you cannot be your own guardian'; end if;
  insert into guardianships (athlete_id, guardian_id, relationship, status)
  values (inv.athlete_id, auth.uid(), coalesce(rel, inv.relationship), 'active')
  on conflict (athlete_id, guardian_id) do update set status = 'active';
  update guardian_invites set accepted_by = auth.uid(), accepted_at = now() where token = invite_token;
  return inv.athlete_id;
end; $$;

-- ---------------------------------------------------------------- 3. safe-column read RPCs
-- The ONLY way a guardian reads athlete data. The explicit SELECT list is the security boundary:
-- date + score + grade + name — never weight, photos, meals, or check-ins. Minor-consent gated.
create or replace function guardian_children() returns table (
  athlete_id uuid, name text, latest_score int, latest_grade text, latest_day date
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, d.score, d.grade, d.date
  from guardianships g
  join profiles p on p.id = g.athlete_id
  left join lateral (
    select dd.score, dd.grade, dd.date from days dd
    where dd.athlete_id = g.athlete_id order by dd.date desc limit 1
  ) d on true
  where g.guardian_id = auth.uid() and g.status = 'active'
    and (not is_provable_minor(g.athlete_id) or has_verified_guardian_consent(g.athlete_id));
$$;

create or replace function guardian_child_days(child uuid, days_back int default 30) returns table (
  day date, score int, grade text
)
language sql stable security definer set search_path = public as $$
  select d.date, d.score, d.grade
  from days d
  where d.athlete_id = child
    and exists (select 1 from guardianships g
                where g.athlete_id = child and g.guardian_id = auth.uid() and g.status = 'active')
    and (not is_provable_minor(child) or has_verified_guardian_consent(child))
    and d.date >= (current_date - greatest(1, least(coalesce(days_back, 30), 120)))
  order by d.date desc;
$$;

grant execute on function create_guardian_invite(text) to authenticated;
grant execute on function accept_guardian_invite(text, text) to authenticated;
grant execute on function guardian_children() to authenticated;
grant execute on function guardian_child_days(uuid, int) to authenticated;
