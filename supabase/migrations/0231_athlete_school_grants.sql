-- 0231: HOTFIX — athlete_profiles.school was added without grants, and broke every athlete's
-- profile sync (2026-09-10, minutes after 0230 shipped)
--
-- WHAT BROKE. 0230 added the column. It did not add it to the three COLUMN-LEVEL grants that
-- fence this table, because I did not know they existed:
--   * 0103_weight_visibility revoked `select` on the whole table and granted it back column by
--     column, to keep base_weight off the client;
--   * 0210_age_server_authoritative did the same for `insert`/`update`, to make dob
--     server-authoritative.
-- A column added later is therefore granted to NOBODY by default. Table privileges sit IN FRONT
-- of RLS, so both directions failed with 42501 before any policy ran:
--   * the write — saveIdentity's athlete_profiles upsert now carries school, so the whole upsert
--     was denied and the athlete got "Saved on this phone, couldn't reach the server. It'll sync
--     when you're back online" on a phone that was online;
--   * and worse, the READ — _loadProfileIntoRt selects school alongside sport, position, level,
--     base_goal, season_goal, dob and standard, so ONE ungranted column denied the entire
--     profile hydrate and set RT.profileOffline for every athlete on the new build.
--
-- This is [[supabase-table-grants-gotcha]] one level down: that note says a new TABLE the client
-- writes directly needs its own grant. The same is true of a new COLUMN on a table whose grants
-- are column-scoped, and it is quieter, because the table already has grants and looks covered.
--
-- school is self-declared identity, exactly like sport and position, which are already inside all
-- three walls. It carries nothing the walls exist to protect (weight, age), so it joins them
-- rather than getting a door of its own.
--
-- Additive: no revoke, no policy change, no row touched. Safe to re-run.

grant select (school) on table athlete_profiles to authenticated;
grant insert (school) on table athlete_profiles to authenticated;
grant update (school) on table athlete_profiles to authenticated;

comment on column athlete_profiles.school is
  'Self-declared school or organisation. Free text, and NOT authoritative when the athlete is on '
  'a team: orgs/teams carry the verified membership, and surfaces that show one line prefer the '
  'team name (proto js/identity-line.js). This is what an athlete has before a coach. '
  'GRANTS: inside the 0103 select wall and the 0210 insert/update wall (0231) — any future column '
  'on this table must be added to those walls explicitly or the client cannot read or write it.';
