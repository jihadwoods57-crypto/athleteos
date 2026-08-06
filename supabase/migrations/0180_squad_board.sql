-- 0180: Squad board — the athlete-facing team screen, opt-in by design.
--
-- Until now athlete→athlete visibility was structurally impossible (can_view_via_memberships
-- admits staff/guardian/trainer roles only) and the Privacy sheet promised exactly that:
-- "Teammates cannot see anything about your day." This migration keeps that promise the same
-- way Verified Discipline (0138) did: NOTHING is shared until the athlete flips their own
-- switch, and what is shared is the score number only — never meals, photos, check-ins,
-- weights, locations, or anything else about the day. RLS on days/meals/profiles is untouched;
-- the ONLY athlete→athlete read path is the definer RPC below, and it returns a name and a
-- score, structurally incapable of returning anything more.
--
-- The settings copy that described the old world is rewritten in the same commit
-- (settings.js Teammates row + delete-account line, share-card.js, progress.js) per the
-- standing note in settings.js: "If a board ever ships, change this row IN THE SAME commit."

-- The athlete's own switch. Off by default: a team's board shows you only after you opt in.
alter table profiles add column if not exists
  share_squad_score boolean not null default false;

-- One row per ACTIVE member of the caller's team. Caller must be an active athlete member of
-- p_team (staff have richer surfaces of their own and are refused here — this keeps the RPC's
-- disclosure surface exactly "what a teammate may see", nothing broader riding along).
--   shared     — that athlete's own switch (drives the caller's toggle state via their self row).
--   name/score — populated ONLY for the caller themselves and for teammates who opted in.
--                Non-sharers come back as anonymous stubs (shared=false, everything else null)
--                so the screen can say "3 teammates keep their number private" without leaking
--                who they are. Their day rows are never touched (the lateral join is gated).
--   day_date   — the score's date (today or yesterday, athlete-local dates written by their
--                device). The client labels staleness; the server never guesses timezones.
create or replace function squad_board(p_team uuid)
returns table (athlete_id uuid, athlete_name text, "position" text, shared boolean, day_date date, score int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (
    select 1 from team_members tm
    where tm.team_id = p_team and tm.athlete_id = auth.uid() and tm.status = 'active'
  ) then
    raise exception 'not a member of this team';
  end if;
  return query
    select m.athlete_id,
           case when vis.v then p.full_name end,
           case when vis.v then m.position end,
           p.share_squad_score,
           d.date, d.score
    from team_members m
    join profiles p on p.id = m.athlete_id
    cross join lateral (select (m.athlete_id = auth.uid() or p.share_squad_score) as v) vis
    left join lateral (
      select dd.date, dd.score from days dd
      where vis.v and dd.athlete_id = m.athlete_id and dd.date >= current_date - 1
      order by dd.date desc limit 1
    ) d on true
    where m.team_id = p_team and m.status = 'active'
    order by vis.v desc, d.score desc nulls last, coalesce(p.full_name, ''), m.joined_at;
end; $$;

-- 0035 revoked default execute; grant explicitly (and keep anon out — this is a signed-in read).
revoke execute on function squad_board(uuid) from public, anon;
grant execute on function squad_board(uuid) to authenticated;
