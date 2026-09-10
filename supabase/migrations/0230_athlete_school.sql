-- 0230: the athlete's school gets somewhere to live (2026-09-10)
--
-- THE BUG, founder-reported: "I updated my school in the profile but it didn't update on my Home
-- Screen." It could not have, and it was worse than the symptom. The school typed on #edit-profile
-- went to RT.profile and localStorage and STOPPED there:
--
--   * act.saveIdentity sent full_name to profiles and sport/position to athlete_profiles, and
--     silently dropped school, because there was no column to send it to;
--   * so the value never reached another device, never reached the coach who reads the roster,
--     never reached the recruiting page, and died with the app's local storage;
--   * and the Save button's own failure copy said "Saved on this phone, couldn't reach the
--     server. It'll sync when you're back online", which for this one field was never true.
--
-- One nullable text column, on the table that already holds the athlete's other self-declared
-- identity (sport, position, level), so it inherits that table's policies exactly: the athlete
-- upserts their own row, staff read it through the same can_view fence every other column uses.
-- Nothing else changes. No backfill is possible or wanted — the values that exist today are on
-- individual phones, and the next save from each phone carries that phone's value up.
--
-- Additive and idempotent: no policy, index or existing row is touched.

alter table athlete_profiles add column if not exists school text;

comment on column athlete_profiles.school is
  'Self-declared school or organisation. Free text, and NOT authoritative when the athlete is on '
  'a team: orgs/teams carry the verified membership, and surfaces that show one line prefer the '
  'team name (proto js/identity-line.js). This is what an athlete has before a coach.';
