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

// The roll call is switched off (commitments.js, 2026-09-24). This file tests the roll call itself,
// so it runs it switched ON, as it will be when it comes back; rollcall-off.test.mjs pins the off state.
import { rollcallOnForTests } from './commitments.js';
rollcallOnForTests();


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
  assert.match(arr, /Update OnStandard to add a place\./);
  assert.doesNotMatch(arr, /data-rs-map/, 'no broken map control on an older binary');
  // A picked place shows its name, its size and the arrive-by time.
  mod.seedSetupForHarness({ mode: 'both', location_id: 'l1', place: { id: 'l1', name: 'Weight room', radius_m: 150 }, arrive_by_min: 405 });
  const both = mod.rollcallNew.render({ sub: '' });
  assert.match(both, /Weight room/);
  assert.match(both, /150 m/);
  assert.match(both, /value="06:45"/);
});

/* Final review I-1: an OTA puts maps.pick in the shim of EVERY binary, so the place step asks the
   native capability line, never the shim. Old build: no "Also check they're at" door, one line. */
test('an old binary: no door to a map that cannot open, one "Update OnStandard" line', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const cd = await import('./commitment-data.js');
  const mod = await import('./screens/rollcall-setup.js');
  window.OnStandardNative = { maps: { pick: async () => null }, location: {} };   // the shim, after the OTA
  cd.setNativeCapsForHarness({ location: false, walkIn: false, maps: false, mapReason: 'update' });
  try {
    cd.seedCommitmentsForHarness([], []);
    mod.seedSetupForHarness({});
    const wake = mod.rollcallNew.render({ sub: '' });
    assert.doesNotMatch(wake, /data-rs-addplace/, 'the Also check door is gone');
    assert.match(wake, /Update OnStandard to add a place\./);
    mod.seedSetupForHarness({ mode: 'both' });
    const both = mod.rollcallNew.render({ sub: '' });
    assert.doesNotMatch(both, /data-rs-map/);
    assert.match(both, /Update OnStandard to add a place\./);
    // The same binary with the native map: the door and the map control are back.
    cd.setNativeCapsForHarness({ location: true, walkIn: true, maps: true });
    mod.seedSetupForHarness({});
    assert.match(mod.rollcallNew.render({ sub: '' }), /data-rs-addplace/);
    mod.seedSetupForHarness({ mode: 'both' });
    assert.match(mod.rollcallNew.render({ sub: '' }), /data-rs-map/);
    // A binary with the modules on an OS that cannot draw the map says so, not "update".
    cd.setNativeCapsForHarness({ location: true, walkIn: true, maps: false, mapReason: 'os' });
    mod.seedSetupForHarness({ mode: 'both' });
    assert.match(mod.rollcallNew.render({ sub: '' }), /This phone can’t show the map/);
  } finally {
    cd.setNativeCapsForHarness(null);
    delete window.OnStandardNative;
  }
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
  // Roll call v3: the week route hands over to the one roll call screen before it paints.
  assert.match(src, /redirect\(\{ sub \} = \{\}\) \{ return sub \? `rollcall\/\$\{sub\}` : null; \}/);
  assert.match(idx, /rollcall: lazy\(\(\) => import\('\.\/rollcall-hub\.js'\)\)/);
});

/* ---------------- fix round 1 ---------------- */

test('only marked arrival rows are roll calls; an edit carries what the four answers never ask', async () => {
  const { isRollcall, setupPayload, draftFromRule, ROLLCALL_MARK } = await import('./screens/rollcall-setup.js');
  const general = { id: 'g1', type: 'practice', location_id: 'l1', starts_min: 900, arrive_by_min: 915, escalation: { breakthrough: true } };
  assert.equal(isRollcall(general), false, 'a Practice with a place from the general composer is not claimed');
  assert.equal(isRollcall({ ...general, escalation: { [ROLLCALL_MARK]: true } }), true);
  assert.equal(isRollcall({ id: 'w', type: 'morning_roll_call' }), true, 'every wake-up is a roll call');
  // Everything this screen writes is marked, both kinds.
  const { blankSetup } = await import('./screens/rollcall-setup.js');
  assert.equal(setupPayload(blankSetup(), 't', 'team', 'UTC').escalation[ROLLCALL_MARK], true);
  // An edit keeps the stored reminders, dwell, link and the coach's own title.
  const row = { id: 'a1', type: 'strength', title: 'Morning lift', location_id: 'l1', starts_min: 405, arrive_by_min: 405,
    reminder_offsets_min: [30], min_dwell_min: 20, linked_commitment_id: 'c9', repeat_days: [1], escalation: { [ROLLCALL_MARK]: true } };
  const p = setupPayload(draftFromRule(row, [{ id: 'l1', name: 'Weight room', radius_m: 150 }]), 't', 'team', 'UTC');
  assert.deepEqual(p.reminder_offsets_min, [30]);
  assert.equal(p.min_dwell_min, 20);
  assert.equal(p.linked_commitment_id, 'c9');
  assert.equal(p.title, 'Morning lift', 'a coach’s own title survives');
  const auto = setupPayload(draftFromRule({ ...row, title: 'At Old gym' }, [{ id: 'l1', name: 'Weight room', radius_m: 150 }]), 't', 'team', 'UTC');
  assert.equal(auto.title, 'At Weight room', 'the automatic title follows the place');
  const wake = setupPayload(draftFromRule({ id: 'w1', type: 'morning_roll_call', starts_min: 360, respond_by_min: 365, min_dwell_min: 5, linked_commitment_id: 'c8', repeat_days: [1] }), 't', 'team', 'UTC');
  assert.equal(wake.min_dwell_min, 5);
  assert.equal(wake.linked_commitment_id, 'c8');
});

test('editing an unmarked practice refuses and points at Commitments; a bare week prefers the wake-up', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const cd = await import('./commitment-data.js');
  cd.seedCommitmentsForHarness([{ id: 'g2', type: 'practice', location_id: 'l1', starts_min: 900, escalation: {} }], []);
  const mod = await import('./screens/rollcall-setup.js');
  const html = mod.rollcallNew.render({ sub: 'g2' });
  assert.match(html, /isn’t a roll call/);
  assert.doesNotMatch(html, /id="rs-save"/);
});

test('Start in flight: any repaint draws a disabled Saving…, never a live Start', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const mod = await import('./screens/rollcall-setup.js');
  mod.seedSetupForHarness({});
  mod.markSavingForHarness(true);
  const busy = mod.rollcallNew.render({ sub: '' });
  assert.match(busy, /id="rs-save" disabled aria-busy="true">Saving…</);
  assert.doesNotMatch(busy, /Start roll call</);
  mod.markSavingForHarness(false);
  assert.match(mod.rollcallNew.render({ sub: '' }), /id="rs-save">Start roll call</);
  // Leave first, refresh after: the draft is never nulled before the navigation.
  const src = readFileSync(join(JS, 'screens', 'rollcall-setup.js'), 'utf8');
  const save = src.slice(src.indexOf('SAVING = true;'));
  assert.ok(save.indexOf('location.replace(') < save.indexOf('loadCommitments(own'), 'navigate before the refresh');
  assert.doesNotMatch(save.slice(0, save.indexOf('location.replace(')), /DRAFT = null/);
});

test('both: the header names the place and the window line says Wake-up; the Change window is one plain line', async () => {
  const { setupLine, windowLine, windowPlain, blankSetup } = await import('./screens/rollcall-setup.js');
  const d = { ...blankSetup(), mode: 'both', location_id: 'l', place: { name: 'Weight room' }, arrive_by_min: 405 };
  assert.equal(setupLine(d), 'Monday to Friday: up at 6:00 AM, at Weight room by 6:45 AM.');
  assert.match(windowLine(d), /^Wake-up: on standard until 6:05 AM, missed at 6:30 AM\.$/);
  const plain = windowPlain(blankSetup());
  assert.match(plain, /On standard until 6:05 AM<\/span> · <span class="a">late until 6:30 AM<\/span> · <span class="r">missed after/);
  assert.doesNotMatch(plain, /wk-win-c/);
});

test('the week runs on the roll call’s clock, and today cannot move to a time already gone', async () => {
  const { todayIn, nowMinIn, moveProblem } = await import('./screens/rollcall-setup.js');
  const t = Date.parse('2026-09-23T02:30:00Z');           // 10:30 PM on the 22nd in New York
  assert.equal(todayIn('America/New_York', t), '2026-09-22');
  assert.equal(todayIn('UTC', t), '2026-09-23');
  assert.equal(nowMinIn('America/New_York', t), 22 * 60 + 30);
  assert.match(moveProblem({ today: true }, 21 * 60, 'America/New_York', t), /already passed today/);
  assert.equal(moveProblem({ today: true }, 23 * 60, 'America/New_York', t), null);
  assert.equal(moveProblem({ today: false }, 60, 'America/New_York', t), null, 'another day can move anywhere');
});

/* ---------------- roll call v3 review: the day sheet reaches every morning Move can name ---------------- */

test('the day sheet opens any morning in the 14-day horizon, and Move never names one past it', async () => {
  const { weekDays, SHEET_DAYS } = await import('./screens/rollcall-setup.js');
  const { movable } = await import('./rollcall-hub-model.js');
  const now = Date.parse('2026-09-24T12:00:00Z');
  const row = { instance_id: 'far', occurs_on: '2026-10-06', starts_at: '2026-10-06T10:00:00Z', instance_status: 'scheduled', skipped: false, starts_min: 360 };
  const days = weekDays([row], '2026-09-24', now, SHEET_DAYS);
  assert.equal(days.length, 14);
  assert.equal(weekDays([row], '2026-09-24', now).length, 7, 'the strip is still a week');
  const last = days[days.length - 1].iso;
  assert.equal(movable([row], now, last).instance_id, 'far');
  assert.ok(days.some((x) => x.row && x.row.instance_id === movable([row], now, last).instance_id), 'what Move names, the sheet opens');
  assert.equal(movable([{ ...row, occurs_on: '2026-10-09', starts_at: '2026-10-09T10:00:00Z' }], now, last), null);
  const src = readFileSync(join(JS, 'screens', 'rollcall-setup.js'), 'utf8');
  assert.match(src, /weekDays\(rows, todayIn\(tz\), Date\.now\(\), SHEET_DAYS\)/, 'the sheet looks as far as Move does');
});

test('a 7-day read of the week never serves or shrinks the 14-day roll call screen', async () => {
  const cd = await import('./commitment-data.js');
  const calls = [];
  window.sb = { rpc: async (n, a) => { calls.push(a.p_days); return { data: Array.from({ length: a.p_days }, (_, i) => ({ instance_id: 'u' + i })), error: null }; } };
  assert.equal((await cd.loadUpcoming('c-days', 7)).length, 7);
  assert.equal((await cd.loadUpcoming('c-days', 14)).length, 14, 'a fresh 7-day cache does not answer a 14-day read');
  assert.equal((await cd.loadUpcoming('c-days', 7, true)).length, 14, 'a forced 7-day read keeps the 14 days');
  assert.deepEqual(calls, [7, 14, 14]);
  assert.equal((await cd.loadUpcoming('c-days', 7)).length, 14, 'and a fresh 14-day cache serves the week');
  assert.equal(calls.length, 3);
  delete window.sb;
});

test('review: only a live wake-up is told on Save; arrival-only and paused are not', () => {
  const src = readFileSync(join(JS, 'screens', 'rollcall-setup.js'), 'utf8');
  assert.match(src, /if \(payload\.type === 'morning_roll_call' && payload\.active !== false\) void tellAthletesNow\(id\);/);
});

test('review: the landing line states the real count, read off the arming list', async () => {
  const cd = await import('./commitment-data.js');
  const v3 = await import('./rollcall-v3-data.js');
  const hub = (await import('./screens/rollcall-hub.js')).default;
  const now = Date.now();
  const at = (h) => new Date(now + h * 3600000).toISOString();
  cd.seedCommitmentsForHarness([{ id: 'rc-t', type: 'morning_roll_call', title: 'Morning Roll Call', repeat_days: [1, 2, 3, 4, 5], starts_min: 360, escalation: { alarm: true }, active: true }], []);
  cd.seedUpcomingForHarness('rc-t', [{ instance_id: 'n1', occurs_on: '2099-01-01', starts_at: at(10), opens_at: at(9.8), closes_at: at(10.5), starts_min: 360, instance_status: 'scheduled', skipped: false }]);
  const A = (id, told, o = {}) => ({ athlete_id: id, name: id, status: 'pending', notified_at: told ? at(-1) : null, can_push: true, ...o });
  v3.seedArmingForHarness('n1', { alarm: true, rows: [A('Ann', true), A('Bo', true), A('Cy', false), A('Di', true, { status: 'excused' })] });
  v3.seedToldForHarness('rc-t', 'ok', 5);
  const html = hub.render({ sub: 'rc-t' });
  assert.match(html, /Told 2 athletes\./, 'the told stamps, not the devices pushed, and never the excused');
  assert.doesNotMatch(html, /just told/);
  assert.match(html, /Hasn’t been told/, 'the one not told still says so, beside an honest count');
  v3.seedToldForHarness('rc-t', 'no_instance');
  assert.doesNotMatch(hub.render({ sub: 'rc-t' }), /rhb-told/, 'a 404 says nothing');
  // Ten hours out: not opened is a fact (neutral), not a warning.
  assert.doesNotMatch(html, /rhb-list soon/);
});

test('review: every repaint of the roll call screen waits for an open day sheet', () => {
  const src = readFileSync(join(JS, 'screens', 'rollcall-hub.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((code.match(/window\.__render\(\)/g) || []).length, 2, 'only the deferred repaint and the bare-route fallback call __render');
  assert.match(code, /repaintWhenFree\(document, \(\) => \{ if \(here\(sub\) && window\.__render\) window\.__render\(\); \}, window\.MutationObserver\)/);
});
