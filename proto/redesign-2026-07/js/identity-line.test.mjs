/* The athlete's own line: "Wednesday · Lincoln Varsity Football".
 *
 * The bug this suite exists for (founder, 2026-09-10: "I updated my school in the profile but it
 * didn't update on my Home Screen"). Two independent defects met on that one sentence:
 *
 *   1. Home's line was built from RT.myCoach.teamName ONLY, so an athlete with no coach saw a
 *      bare weekday and their school appeared nowhere on Home, however many times they edited it.
 *   2. The school itself never left the phone. act.saveProfile wrote RT.profile + localStorage,
 *      act.saveIdentity sent full_name / sport / position to the server and silently dropped
 *      school, and athlete_profiles had no column to put it in — while the save screen's own
 *      failure copy promised "it'll sync when you're back online".
 *
 * The first half is behaviour and is tested here. The second half is a shape that must exist in
 * three specific places, and those are pinned below the same way the screen suites pin theirs:
 * state.js and profile.js import the DOM and the whole app, so rendering them would cost more
 * than it proves, and the thing being protected IS the presence of these writes.
 * Run: node --test proto/redesign-2026-07/js/identity-line.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { identityLine } from './identity-line.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

test('a team wins: it is the coach-verified fact, and it is more specific than a school', () => {
  assert.equal(identityLine('Wednesday', 'Lincoln Varsity Football', 'Lincoln High'), 'Wednesday · Lincoln Varsity Football');
});

test('no team falls back to the school the athlete typed, which is why they typed it', () => {
  assert.equal(identityLine('Wednesday', null, 'Lincoln High'), 'Wednesday · Lincoln High');
  assert.equal(identityLine('Wednesday', '', 'Lincoln High'), 'Wednesday · Lincoln High');
});

test('neither one leaves the weekday alone rather than inventing a separator', () => {
  assert.equal(identityLine('Wednesday', null, ''), 'Wednesday');
  assert.equal(identityLine('Wednesday', null, null), 'Wednesday');
  assert.equal(identityLine('Wednesday', undefined, undefined), 'Wednesday');
});

test('whitespace is not an organisation', () => {
  assert.equal(identityLine('Wednesday', '   ', '  '), 'Wednesday');
  assert.equal(identityLine('Wednesday', null, '  Lincoln High  '), 'Wednesday · Lincoln High');
});

/* ---- the three places the school has to be written, read and sent ---- */

test('saveIdentity sends the school to the server, not just the name and sport', () => {
  const state = read('state.js');
  const fn = state.slice(state.indexOf('async saveIdentity('), state.indexOf('async saveIdentity(') + 1200);
  assert.match(fn, /async saveIdentity\(\{[^}]*school[^}]*\}\)/, 'school is a parameter');
  assert.match(fn, /ap\.school\s*=\s*school/, 'and it is put on the athlete_profiles payload');
});

test('the hydrate ASKS for school, or the server copy could never come back', () => {
  const state = read('state.js');
  // The select is assembled from CORE_COLS + EXTRA_COLS now (see the resilience test below), so
  // what matters is that school is in the asked-for set and lands on RT.profile.
  assert.match(state, /EXTRA_COLS = 'school'/, 'school is in the asked-for set');
  assert.match(state, /select\(`\$\{CORE_COLS\},\$\{EXTRA_COLS\}`\)/, 'and both halves are requested together first');
  assert.match(state, /patch\.school\s*=\s*ap\.school/, 'and it is applied to RT.profile');
});

test('the edit screen hands the school to the server write as well as the local one', () => {
  const profile = read('screens/profile.js');
  assert.match(profile, /saveIdentity\(\{[^}]*school[^}]*\}\)/,
    'the Save button sends school to saveIdentity, not only to saveProfile');
});

test('Home builds its line from the shared helper rather than a second copy of the rule', () => {
  const home = read('screens/home.js');
  assert.match(home, /import\s*\{\s*identityLine\s*\}\s*from\s*'\.\.\/identity-line\.js'/);
  assert.match(home, /identityLine\(/);
  assert.ok(!/const team = RT\.myCoach && RT\.myCoach\.teamName;\s*\n\s*return team \?/.test(home),
    'the old team-only line is gone, not merely bypassed');
});

/* 2026-09-10, the hour after: athlete_profiles is fenced by COLUMN-level grants (0103 select,
   0210 insert/update), so 0230's new column was granted to nobody. Table privileges sit in front
   of RLS, so the whole select failed with 42501 and took the entire profile hydrate down —
   targets, standard, plan style — for every athlete on the build. These two pin both halves of
   the answer: the grant exists, and the client can survive the next one that doesn't. */

test('the school column is inside all three grant walls, or the client can neither read nor write it', () => {
  const sql = read('../../../supabase/migrations/0231_athlete_school_grants.sql');
  assert.match(sql, /grant select \(school\) on table athlete_profiles to authenticated/i);
  assert.match(sql, /grant insert \(school\) on table athlete_profiles to authenticated/i);
  assert.match(sql, /grant update \(school\) on table athlete_profiles to authenticated/i);
});

test('one ungranted column can no longer cost the athlete their whole profile', () => {
  const state = read('state.js');
  assert.match(state, /const CORE_COLS = 'sport,position,level,base_goal,season_goal,dob,standard'/,
    'the columns that must never be lost are named apart from the newer ones');
  assert.match(state, /const EXTRA_COLS = 'school'/);
  assert.match(state, /if \(apErr\) \{[\s\S]{0,400}?select\(CORE_COLS\)/,
    'a failed read retries with the core alone');
  assert.match(state, /if \(!retry\.error\) \{/,
    'and only adopts the narrower read when it actually succeeded, so an outage still reads as one');
  const analytics = read('analytics.js');
  assert.match(analytics, /SYNC_DEGRADED: 'sync_degraded'/, 'the drop is reported, not swallowed');
});

test('the migration that gives the school somewhere to live exists', () => {
  const sql = read('../../../supabase/migrations/0230_athlete_school.sql');
  assert.match(sql, /alter table athlete_profiles/i);
  assert.match(sql, /add column if not exists school text/i);
});
