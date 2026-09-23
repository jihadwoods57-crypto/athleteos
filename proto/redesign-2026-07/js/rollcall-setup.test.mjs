/* The coach's roll call: setup in four answers, the place step, arrival only, the week strip and
 * history (roll call rebuilt, Task 10, 2026-09-23).
 *
 * The first three tests are the plan's, adjusted to the arrival-only ruling: an arrival-only roll
 * call is a NON-morning commitment type (practice by default) with a place and an arrive-by time,
 * and no alarm, never a morning_roll_call with the alarm switched off. The rest pin the mapping
 * back from a saved row, the validation, history's split, and the screens' shape (one primary,
 * the three-way mode segment, the switch, the plain copy when the map cannot open).
 *
 * Run: node scripts/node-test.mjs "proto/redesign-2026-07/js/rollcall-setup.test.mjs"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The screen graph touches the DOM at module eval; the same shim rollcall-board.test.mjs uses. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const JS = dirname(fileURLToPath(import.meta.url));

test('four answers make a valid roll call with the defaults behind "Change"', async () => {
  const { setupPayload, blankSetup } = await import('./screens/rollcall-setup.js');
  const d = { ...blankSetup(), starts_min: 360, repeat_days: [1, 2, 3, 4, 5], audience_kind: 'team' };
  const p = setupPayload(d, 'team-1', 'team', 'America/New_York');
  assert.equal(p.type, 'morning_roll_call');
  assert.equal(p.respond_by_min, 365);   // 5-minute grace default
  assert.equal(p.ends_min, 390);         // 30-minute close default
  assert.equal(p.location_id, null);
  assert.equal(p.escalation.alarm, true, 'the alarm is on by default');
  assert.equal(p.team_id, 'team-1');
});

test('adding a place carries arrive-by; arrival-only turns the alarm off', async () => {
  const { setupPayload, blankSetup } = await import('./screens/rollcall-setup.js');
  const p = setupPayload({ ...blankSetup(), mode: 'arrival', location_id: 'loc1', arrive_by_min: 930, repeat_days: [1, 3, 5] }, 'team-1', 'team', 'UTC');
  assert.equal(p.location_id, 'loc1');
  assert.equal(p.arrive_by_min, 930);
  assert.equal(p.escalation.alarm, false);
  assert.equal(p.starts_min, 930);
  // The ruling: arrival only is a NON-morning type, with no I'm Up to answer.
  assert.notEqual(p.type, 'morning_roll_call');
  assert.equal(p.type, 'practice', 'Practice is the default kind');
  assert.equal(p.respond_by_min, null, 'nothing to acknowledge');
  assert.equal(p.arrival_grace_min, 10);
});

test('the week strip marks moved and cancelled days', async () => {
  const { weekStrip } = await import('./screens/rollcall-setup.js');
  const html = weekStrip([{ occurs_on: '2026-09-23', starts_min: 300, moved: true }, { occurs_on: '2026-09-27', skipped: true }], '2026-09-22');
  assert.match(html, /5:00/);
  assert.match(html, /Off/);
});

test('arrival only: the coach picks what it is, and the title names the place', async () => {
  const { setupPayload, blankSetup, ARRIVAL_KINDS } = await import('./screens/rollcall-setup.js');
  assert.deepEqual(ARRIVAL_KINDS.map((k) => k.type), ['practice', 'strength', 'team_meeting', 'class']);
  assert.deepEqual(ARRIVAL_KINDS.map((k) => k.label), ['Practice', 'Lift', 'Team meeting', 'Class']);
  const p = setupPayload({ ...blankSetup(), mode: 'arrival', arrival_type: 'strength', location_id: 'loc1',
    place: { id: 'loc1', name: 'Weight room', radius_m: 150 }, arrive_by_min: 405, arrival_grace_min: 5 }, 'p-1', 'practice', 'UTC');
  assert.equal(p.type, 'strength');
  assert.equal(p.title, 'At Weight room');
  assert.equal(p.arrival_grace_min, 5);
  assert.equal(p.practice_id, 'p-1');
  assert.equal(p.team_id, null);
  assert.equal(p.opens_min, null, 'no wake-up window to open');
  // A morning type is never allowed through the arrival picker.
  const bad = setupPayload({ ...blankSetup(), mode: 'arrival', arrival_type: 'morning_roll_call', location_id: 'loc1', arrive_by_min: 900 }, 't', 'team', 'UTC');
  assert.equal(bad.type, 'practice');
});

test('both: a wake-up that also checks the place keeps the alarm and the morning type', async () => {
  const { setupPayload, blankSetup } = await import('./screens/rollcall-setup.js');
  const p = setupPayload({ ...blankSetup(), mode: 'both', starts_min: 360, location_id: 'loc1', arrive_by_min: 405 }, 'team-1', 'team', 'UTC');
  assert.equal(p.type, 'morning_roll_call');
  assert.equal(p.starts_min, 360);
  assert.equal(p.respond_by_min, 365);
  assert.equal(p.location_id, 'loc1');
  assert.equal(p.arrive_by_min, 405);
  assert.equal(p.escalation.alarm, true);
  // Back to wake-up only: the place goes with it.
  const w = setupPayload({ ...blankSetup(), mode: 'wake', location_id: 'loc1', arrive_by_min: 405 }, 'team-1', 'team', 'UTC');
  assert.equal(w.location_id, null);
  assert.equal(w.arrive_by_min, null);
});

test('validation: a day, a time, and a place when the place is the point', async () => {
  const { setupErrors, blankSetup } = await import('./screens/rollcall-setup.js');
  assert.equal(setupErrors(blankSetup()), null, 'the blank draft is already valid');
  assert.match(setupErrors({ ...blankSetup(), repeat_days: [] }), /at least one day/);
  assert.match(setupErrors({ ...blankSetup(), starts_min: null }), /time/);
  assert.match(setupErrors({ ...blankSetup(), mode: 'arrival', location_id: null, arrive_by_min: 930 }), /place/);
  assert.match(setupErrors({ ...blankSetup(), mode: 'both', location_id: null, arrive_by_min: 405 }), /place/);
  assert.match(setupErrors({ ...blankSetup(), mode: 'both', location_id: 'l', starts_min: 360, arrive_by_min: 300 }), /after the wake-up/);
  assert.match(setupErrors({ ...blankSetup(), audience_kind: 'group', audience_value: null }), /who/);
});

test('editing reads a saved row back into the right mode', async () => {
  const { draftFromRule } = await import('./screens/rollcall-setup.js');
  const wake = draftFromRule({ id: 'c1', type: 'morning_roll_call', starts_min: 330, respond_by_min: 340, ends_min: 375,
    repeat_days: [1, 2], audience_kind: 'team', escalation: { alarm: false }, message: 'Up.' });
  assert.equal(wake.mode, 'wake');
  assert.equal(wake.grace_min, 10);
  assert.equal(wake.close_after_min, 45);
  assert.equal(wake.escalation.alarm, false);
  const both = draftFromRule({ id: 'c2', type: 'morning_roll_call', starts_min: 360, respond_by_min: 365, ends_min: 390,
    location_id: 'l1', arrive_by_min: 405, arrival_grace_min: 5, repeat_days: [1] }, [{ id: 'l1', name: 'Weight room', radius_m: 150 }]);
  assert.equal(both.mode, 'both');
  assert.equal(both.place.name, 'Weight room');
  assert.equal(both.arrival_grace_min, 5);
  const arr = draftFromRule({ id: 'c3', type: 'strength', starts_min: 930, location_id: 'l1', arrive_by_min: 930, repeat_days: [2], title: 'At Weight room' });
  assert.equal(arr.mode, 'arrival');
  assert.equal(arr.arrival_type, 'strength');
  assert.equal(arr.escalation.alarm, false);
});

test('the week strip: seven days from today, today marked, the rule’s days off read Off', async () => {
  const { weekStrip, weekDays } = await import('./screens/rollcall-setup.js');
  const rows = [
    { instance_id: 'a', occurs_on: '2026-09-22', starts_min: 360, rule_starts_min: 360 },
    { instance_id: 'b', occurs_on: '2026-09-23', starts_min: 300, rule_starts_min: 360, starts_override_min: 300 },
    { instance_id: 'c', occurs_on: '2026-09-24', starts_min: 360, rule_starts_min: 360, skipped: true, instance_status: 'cancelled' },
  ];
  const days = weekDays(rows, '2026-09-22');
  assert.equal(days.length, 7);
  assert.equal(days[0].today, true);
  assert.equal(days[1].moved, true, 'an override is a moved day');
  assert.equal(days[2].skipped, true);
  assert.equal(days[3].row, null, 'a day the rule does not repeat on has no occurrence');
  const html = weekStrip(rows, '2026-09-22');
  assert.equal((html.match(/class="rw-day/g) || []).length, 7);
  assert.match(html, /rw-day[^"]*today/);
  assert.match(html, /rw-day[^"]*moved/);
  assert.match(html, /data-rw-day="b"/, 'a future day is a button');
});

test('history: needs attention first (below 80 or slipping), then reliable; the rate wears its tier', async () => {
  const { historyGroups, historyHtml } = await import('./screens/rollcall-setup.js');
  const h = { team_on_time_pct: 84, team_trend: -3, athletes: [
    { athlete_id: 'v', name: 'Tommy Vargas', mornings: 24, on_time: 14, late: 4, missed: 6, on_time_pct: 58, trend: -18, streak: 0, first_up: 0 },
    { athlete_id: 't', name: 'Tyrek Malone', mornings: 24, on_time: 21, late: 3, missed: 0, on_time_pct: 88, trend: -6, streak: 1, first_up: 0 },
    { athlete_id: 'd', name: 'DeShawn Cole', mornings: 24, on_time: 24, late: 0, missed: 0, on_time_pct: 100, trend: 0, streak: 24, first_up: 16 },
  ] };
  const g = historyGroups(h);
  assert.deepEqual(g.attention.map((a) => a.athlete_id), ['v', 't']);
  assert.deepEqual(g.reliable.map((a) => a.athlete_id), ['d']);
  const html = historyHtml(h);
  assert.ok(html.indexOf('Needs attention') < html.indexOf('Reliable'));
  assert.match(html, /rh-rate r[^"]*">58%/, 'a 58 is red on the one ladder');
  assert.match(html, /rh-rate g[^"]*">100%/);
  assert.match(html, /First up 16 times/);
  assert.match(html, /24-morning streak/);
  assert.match(html, /class="rfig/, 'the team rate is a record number (.rfig), never a boxed tile');
  assert.doesNotMatch(html, /class="stat\b/);
});

test('the setup screen: one primary at the bottom, a three-way mode segment, the alarm as a switch', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const mod = await import('./screens/rollcall-setup.js');
  mod.seedSetupForHarness({});
  const html = mod.rollcallNew.render({ sub: '' });
  assert.equal((html.match(/btn primary/g) || []).length, 1, 'exactly one primary');
  assert.match(html, /class="action-bar[^"]*"><button[^>]*class="btn primary/);
  assert.match(html, /Start roll call/);
  assert.equal((html.match(/data-rs-mode="/g) || []).length, 3);
  assert.match(html, /class="seg[^"]*"[^>]*role="radiogroup"/);
  assert.match(html, /role="switch"[^>]*aria-label="Ring as an alarm"/);
  assert.match(html, /On standard until 6:05 AM, missed at 6:30 AM\./);
  assert.match(html, /aria-expanded="false"[^>]*>Change</);
  // Arrival: no alarm switch, what-is-it chips, and the plain line when the map cannot open.
  mod.seedSetupForHarness({ mode: 'arrival' });
  const arr = mod.rollcallNew.render({ sub: '' });
  assert.doesNotMatch(arr, /Ring as an alarm/);
  assert.match(arr, /Team meeting/);
  assert.match(arr, /Update OnStandard to draw the place on a map\./);
  assert.doesNotMatch(arr, /data-rs-map/, 'no broken map control on an older binary');
  // A picked place shows its name, its size and the arrive-by time.
  mod.seedSetupForHarness({ mode: 'both', location_id: 'l1', place: { id: 'l1', name: 'Weight room', radius_m: 150 }, arrive_by_min: 405 });
  const both = mod.rollcallNew.render({ sub: '' });
  assert.match(both, /Weight room/);
  assert.match(both, /150 m/);
  assert.match(both, /value="06:45"/);
});

test('routes: rollcall-new, rollcall-week and rollcall-history are lazy, from one module', () => {
  const idx = readFileSync(join(JS, 'screens', 'index.js'), 'utf8');
  assert.match(idx, /'rollcall-new': lazy\(rollcallSetup, 'rollcallNew'\)/);
  assert.match(idx, /'rollcall-week': lazy\(rollcallSetup, 'rollcallWeek'\)/);
  assert.match(idx, /'rollcall-history': lazy\(rollcallSetup, 'rollcallHistory'\)/);
  assert.match(idx, /const rollcallSetup = \(\) => import\('\.\/rollcall-setup\.js'\)/);
  const src = readFileSync(join(JS, 'screens', 'rollcall-setup.js'), 'utf8');
  assert.doesNotMatch(src, /rollcall-(new|week|history)\/[^'"`]*\?/, 'path subs, never query strings');
  assert.match(src, /export default rollcallWeek/);
});
