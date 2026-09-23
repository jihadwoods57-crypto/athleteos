/* The Team Board screen and "Your day" (roll call rebuilt, Task 9, 2026-09-23).
 *
 * The screen is RENDERED here, not grepped: the real module, seeded through the harness seams
 * (seedTeamBoardForHarness, seedMineForHarness), with the DOM shim rollcall-detail.test.mjs uses.
 * The first two tests are the plan's; the breakfast assertion moved from the whole Your-day render
 * to the pure day builder (dayHtml), because S.exec reads the real clock and a suite run after
 * 9:30 AM would see breakfast as late instead of open. The rest pin the rulings: path subs (no
 * query strings), the one primary action, the arrival-only board, the doors into the board.
 *
 * Run: node scripts/node-test.mjs "proto/redesign-2026-07/js/rollcall-board.test.mjs"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* The screen graph touches the DOM at module eval; same shim as roll-call-resolve.test.mjs. */
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
const MIN = 60_000;
const iso = (m) => new Date(Date.now() + m * MIN).toISOString();

/* A 6:00 wake-up, 4 minutes in: DeShawn first, Marcus (the signed-in athlete, 'm') 4th, one late,
   Tommy ('v') not up yet. Every time is relative to now so the window is really open. */
const BOARD = {
  instance_id: 'i1', title: 'Morning Roll Call', coach_name: 'Coach Brooks', mode: 'wake',
  starts_at: iso(-4), respond_by_at: iso(1), closes_at: iso(26), asks_arrival: false,
  rows: [
    { athlete_id: 'd', name: 'DeShawn Cole', acknowledged_at: iso(-12), verdict: 'on_standard', place: 1 },
    { athlete_id: 'a', name: 'Andre Wells', acknowledged_at: iso(-7), verdict: 'on_standard', place: 2 },
    { athlete_id: 'j', name: 'Jaylen Brooks', acknowledged_at: iso(-4), verdict: 'on_standard', place: 3 },
    { athlete_id: 'm', name: 'Marcus Reed', acknowledged_at: iso(-3), verdict: 'on_standard', place: 4 },
    { athlete_id: 'v', name: 'Tommy Vargas', acknowledged_at: null, verdict: 'pending', place: null },
  ],
};

test('athlete board: my tile is marked, first up is named, breakfast shows when it closes', async () => {
  const cd = await import('./commitment-data.js');
  cd.seedTeamBoardForHarness('i1', BOARD);
  const st = await import('./state.js'); st.RT.userId = 'm'; st.RT.authRole = 'athlete';
  const mod = await import('./screens/rollcall-board.js');
  const screen = mod.default;
  const html = screen.render({ sub: 'i1' });
  assert.match(html, /First up: DeShawn/);
  assert.match(html, /class="[^"]*rb-tile[^"]*me/);
  const day = screen.render({ sub: 'i1/day' });
  assert.match(day, /Your day/);
  assert.doesNotMatch(day, /Log breakfast/);
  // The breakfast row, through the pure builder at a fixed clock: when it closes, never a button.
  const items = [{ id: 'breakfast', title: 'Breakfast', icon: 'sun', state: 'ready', color: 'gray', pill: 'Due today',
    proof: 'photo', required: true, window: { open: 300, due: 570 }, sub: 'due 9:30 AM', route: 'camera/breakfast' }];
  const d = mod.dayHtml({ items, message: 'Up and at it.', coachName: 'Coach Brooks', banked: { points: 8, late: false } });
  assert.match(d, /Breakfast/);
  assert.match(d, /Closes 9:30 AM/);
  assert.doesNotMatch(d, /Log breakfast|data-go="camera/);
  assert.match(d, /We’ll remind you before breakfast closes\./);
  assert.match(d, /\+8/);
  assert.match(d, /Up and at it\./);
});

test('coach board: faces are buttons and "Nudge everyone not up" exists while open', async () => {
  const st = await import('./state.js'); st.RT.authRole = 'coach';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'i1' });
  assert.match(html, /data-rb-athlete="v"/);
  assert.match(html, /Nudge everyone not up/);
  assert.match(html, /class="action-bar/);
  assert.doesNotMatch(html, /I’m Up/, 'a coach never gets the athlete’s button');
});

test('athlete, window open and not answered: I’m Up is the one primary action', async () => {
  const cd = await import('./commitment-data.js');
  const rows = BOARD.rows.map((r) => (r.athlete_id === 'm' ? { ...r, acknowledged_at: null, verdict: 'pending', place: null } : r));
  cd.seedTeamBoardForHarness('i2', { ...BOARD, instance_id: 'i2', rows });
  const st = await import('./state.js'); st.RT.userId = 'm'; st.RT.authRole = 'athlete';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'i2' });
  assert.match(html, /data-rb-ack/);
  assert.equal((html.match(/btn primary/g) || []).length, 1, 'exactly one primary on the athlete board');
  // Answered: the button is gone.
  assert.doesNotMatch(screen.render({ sub: 'i1' }), /data-rb-ack/);
});

test('a place asked and not arrived offers I’m here; arrival mode counts who is here', async () => {
  const cd = await import('./commitment-data.js');
  const rows = [
    { athlete_id: 'd', name: 'DeShawn Cole', acknowledged_at: null, arrived_at: iso(-6), verdict: 'pending', arrival_verdict: 'on_standard', place: null },
    { athlete_id: 'm', name: 'Marcus Reed', acknowledged_at: null, arrived_at: null, verdict: 'pending', arrival_verdict: 'pending', place: null },
  ];
  cd.seedTeamBoardForHarness('i3', { ...BOARD, instance_id: 'i3', mode: 'arrival', asks_arrival: true,
    title: 'Stadium', location_name: 'Bright House Stadium', arrive_by_at: iso(10), closes_at: null, rows });
  const st = await import('./state.js'); st.RT.userId = 'm'; st.RT.authRole = 'athlete';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'i3' });
  assert.match(html, /data-rb-here/);
  assert.doesNotMatch(html, /data-rb-ack/, 'an arrival-only roll call has no I’m Up');
  assert.match(html, /rb-n">1<\/span> of 2 here/);
  assert.match(html, /First here: DeShawn/);
});

test('loading and unknown boards use the shared state primitives', async () => {
  const st = await import('./state.js'); st.RT.userId = 'm'; st.RT.authRole = 'athlete';
  const screen = (await import('./screens/rollcall-board.js')).default;
  const html = screen.render({ sub: 'never-seen' });
  assert.match(html, /sk-card/, 'a board not loaded yet is a skeleton, never an empty team');
  assert.match(html, /back-head/);
});

test('routes are path subs: board, day and missed resolve to one instance', async () => {
  const mod = await import('./screens/rollcall-board.js');
  assert.deepEqual(mod.parseSub('abc'), { id: 'abc', view: 'board' });
  assert.deepEqual(mod.parseSub('abc/day'), { id: 'abc', view: 'day' });
  assert.deepEqual(mod.parseSub('abc/missed'), { id: 'abc', view: 'missed' });
  assert.deepEqual(mod.parseSub(''), { id: '', view: 'board' });
  const src = readFileSync(join(JS, 'screens', 'rollcall-board.js'), 'utf8');
  assert.doesNotMatch(src, /rollcall-board\/[^'"`]*\?/, 'no query strings in a route (Ruling R2)');
});

test('the route is lazy, and the old athlete doors open the board', () => {
  const idx = readFileSync(join(JS, 'screens', 'index.js'), 'utf8');
  assert.match(idx, /'rollcall-board': lazy\(\(\) => import\('\.\/rollcall-board\.js'\)\)/);
  const rc = readFileSync(join(JS, 'screens', 'roll-call.js'), 'utf8');
  assert.match(rc, /rollcall-board\/\$\{/, 'the Home card and the wake-up detail send a wake-up to the board');
  const wf = readFileSync(join(JS, 'wake-face.js'), 'utf8');
  assert.match(wf, /#rollcall-board\/\$\{/, 'the in-app alarm face lands on the board after I’m Up');
});
