/* Recent Results on a morning with nothing logged yet (founder report 2026-09-17).
 *
 * "When I first start in the morning, when I have no score, and I scroll down to the bottom, the
 * recent results don't show my previous logged meals."
 *
 * Three separate things made that true, and this file pins all three:
 *
 *  1. The "Recent Results" heading and its "View all" door rode `rows.length` — what was logged
 *     TODAY. Before the first log of the day both vanished, and yesterday's rail sat at the
 *     bottom of Home under a bare "Yesterday" eyebrow with nothing naming the section.
 *  2. The fetch window was two calendar days. One unlogged day emptied the rails and two emptied
 *     the section entirely, so an athlete with a month of history could scroll to nothing.
 *  3. Past cards printed the stored row's raw `type` — "dinner", "meal-5" — beside today's
 *     "Dinner" and a coach standard's own slot titles.
 *
 * Source regexes, in the manner of null-macro.test.mjs: recentResults/pastResults are module-
 * private to home.js and the screen cannot be booted here.
 *
 * Run: node --test proto/redesign-2026-07/js/recent-results-empty-day.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = readFileSync(join(HERE, 'screens', 'home.js'), 'utf8');

test('THE BUG, pinned: the heading is not gated on what was logged today', () => {
  const fn = HOME.slice(HOME.indexOf('const recentResults = ()'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  const head = body.indexOf('<h2 class="eyebrow">Recent Results');
  assert.ok(head > -1, 'the section still has its heading');
  // The heading must not sit inside a `rows.length ? ... : ''` arm. The only ternary that may
  // wrap anything here is the one around today's OWN rail, which comes after the heading.
  const beforeHead = body.slice(0, head);
  assert.doesNotMatch(beforeHead, /rows\.length \?/, 'the heading is outside the today-only gate');
  assert.match(body, /\$\{rows\.length \? `<div class="res-rail">/, "today's rail keeps its own gate");
  // And "View all" travels with the heading, so the door is there on an empty morning too.
  assert.match(body, /Recent Results <span class="link" data-go="history">View all<\/span>/);
});

test('the section still disappears entirely when there is genuinely nothing', () => {
  const fn = HOME.slice(HOME.indexOf('const recentResults = ()'));
  assert.match(fn.slice(0, 400), /if \(!rows\.length && !past\) return '';/,
    'no heading over an athlete who has never logged');
});

test('the window is seven days, and two LOGGED days render', () => {
  assert.match(HOME, /const PAST_DAYS = 7;/);
  assert.match(HOME, /const PAST_RAILS = 2;/);
  assert.match(HOME, /fetchRecentMeals\(uid, daysAgoISO\(PAST_DAYS\)\)/,
    'the fetch reads the constant, not a literal 2');
  assert.match(HOME, /\.sort\(\)\.reverse\(\)\.slice\(0, PAST_RAILS\)/,
    'the two most recent days that HAVE logs, not the last two calendar days');
  // Seven is the span pastDayLabel can name without ambiguity: past a week, two Tuesdays.
  assert.ok(Number(HOME.match(/const PAST_DAYS = (\d+);/)[1]) <= 7,
    'a longer window would print a weekday name that names two different days');
});

test('a past card wears the slot title, the same call today\'s cards make', () => {
  assert.match(HOME, /type: slotTitle\(r\.type\) \|\| 'Meal',/);
  assert.match(HOME, /import \{ S, RT, act, slotHasPhoto, liveWeightPct, slotTitle \} from '\.\.\/state\.js';/);
  // Named slots wear their own glyph here too, exactly as S.activity does for today.
  assert.match(HOME, /icon: \['breakfast', 'lunch', 'dinner', 'snack'\]\.includes\(r\.type\) \? r\.type : 'utensils',/);
});

test('the empty-morning state is a registered capture, so it cannot go unreviewed again', () => {
  const seeds = readFileSync(join(HERE, '..', '..', '..', 'web/landing-src/lib/seeds.mjs'), 'utf8');
  const qc = readFileSync(join(HERE, '..', '..', '..', 'scripts/qc-capture.mjs'), 'utf8');
  assert.match(seeds, /export const dayOpen = /, 'a seed with a real history and nothing logged today');
  assert.match(seeds, /dayOpen, dayMorning,/, 'and it is in the SEEDS registry');
  assert.match(qc, /name: 'home-open', seed: 'dayOpen', route: 'home'/, 'and it is shot');
  // The stub had no past-day meals at all, which is why these rails were never in a contact sheet.
  const stub = readFileSync(join(HERE, '..', '..', '..', 'web/landing-src/lib/sb-stub.mjs'), 'utf8');
  assert.match(stub, /for \(const back of \[1, 2\]\) \{/, "the signed-in athlete has yesterday's plates");
  // safeImg rejects a leading slash, so every stub meal photo fell back to the icon glyph.
  assert.match(stub, /return 'assets\/meal-' \+ known \+ '\.jpg';/,
    'the fixture path passes components.js safeImg, so a photographed card can be reviewed');
});
