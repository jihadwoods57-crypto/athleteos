/* THE ROLL CALL IS SWITCHED OFF AGAIN (founder, 2026-09-24): "Take roll call off the app but don't
 * permanently delete it. It's not working right now but i want to revisit it in the future."
 *
 * Nothing is deleted. Two switches, server first when it comes back (docs/go-live/WAKEUP-ROLLCALL.md,
 * "SWITCHED OFF 2026-09-24"): feature_flags.verified_commitments.kill_switch, and ROLLCALL_OFF in
 * commitments.js. This file pins the CLIENT half. The roll call's own tests still run it switched
 * ON (rollcallOnForTests), so the feature stays verified for the day it returns.
 *
 * The phone half (alarms cancelled, geofences disarmed, cards ended, once per launch) is pinned in
 * rollcall-off-phone.test.mjs, which needs state.js and its own globals.
 *
 * Run: node --test proto/redesign-2026-07/js/rollcall-off.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = { sb: null };
const { ROLLCALL_OFF, ROLLCALL_ROUTES } = await import('./commitments.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, rel), 'utf8');
/** Source without comments, so a gate named only in a comment never passes for a real one. */
const code = (rel) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('the switch is thrown: the roll call is off', () => {
  assert.equal(ROLLCALL_OFF, true,
    'the client half of the 2026-09-24 shutdown. The server half is feature_flags.verified_commitments.kill_switch = true; this file cannot see it.');
});

/* THE ONE THAT MATTERS (kept from 2026-09-02). No build step means an unimported identifier is a
   ReferenceError thrown when somebody taps, indistinguishable from the screen being broken. Every
   file that READS the constant must IMPORT it (or be the file that exports it). Swept, not listed:
   a new reader is covered the day it is written. */
test('every file that reads ROLLCALL_OFF imports it', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'vendor' ? [] : walk(p);
    return p.endsWith('.js') ? [p] : [];
  });
  const readers = [];
  for (const p of walk(HERE)) {
    const s = readFileSync(p, 'utf8');
    // Read in code, not in a comment (a comment naming the switch is not a reader).
    const bare = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (!/\bROLLCALL_OFF\b/.test(bare)) continue;
    const rel = relative(HERE, p).split(sep).join('/');
    readers.push(rel);
    const exportsIt = /export let ROLLCALL_OFF/.test(s);
    const importsIt = /import\s*\{[^}]*\bROLLCALL_OFF\b[^}]*\}\s*from\s*'[^']*commitments\.js'/s.test(s);
    assert.ok(exportsIt || importsIt, `${rel} reads ROLLCALL_OFF but neither exports nor imports it`);
  }
  // guard the guard: a rename must not let this pass on zero
  assert.ok(readers.length >= 15, `expected the gated files to be swept, saw ${readers.length}: ${readers.join(', ')}`);
});

/* ---------------------------------------------------------------- no dead ends */

test('every roll call screen is a route the router sends Home while off', () => {
  const idx = src('screens/index.js');
  // alias consts: const rollcallSetup = () => import('./rollcall-setup.js');
  const alias = new Map([...idx.matchAll(/const (\w+) = \(\) => import\('\.\/([\w-]+)\.js'\)/g)].map((m) => [m[1], m[2]]));
  const RC_FILES = new Set(['roll-call', 'rollcall-board', 'rollcall-assigned', 'rollcall-hub', 'rollcall-setup',
    'wakeup-morning', 'wakeup-squad', 'location-consent', 'accountability', 'coach-commitments', 'coach-wakeup']);
  const routes = [];
  for (const m of idx.matchAll(/^\s*'?([\w-]+)'?: lazy\((?:\(\) => import\('\.\/([\w-]+)\.js'\)|(\w+))/gm)) {
    const file = m[2] || alias.get(m[3]);
    if (RC_FILES.has(file)) routes.push([m[1], file]);
  }
  assert.ok(routes.length >= 16, `expected every roll call route, found ${routes.length}`);
  for (const [route, file] of routes) {
    // The retired composer and summary redirect themselves to the operator's Home.
    if (file === 'coach-wakeup' || file === 'wakeup-morning') continue;
    assert.ok(ROLLCALL_ROUTES.has(route), `#${route} (${file}.js) would still open while the roll call is off`);
  }
  assert.match(code('screens/coach-wakeup.js'), /redirect\(\) \{ return ROLLCALL_OFF \? 'coach-home' : 'rollcall-new'; \}/);
  assert.match(code('screens/wakeup-morning.js'), /if \(ROLLCALL_OFF\) return RT\.authRole === 'trainer' \? 'trainer' : 'coach-home';/);
});

test('the router sends a roll call route Home BEFORE it fetches or paints the screen', () => {
  const r = code('router.js');
  const gate = r.indexOf("if (ROLLCALL_OFF && ROLLCALL_ROUTES.has(route)) { location.replace('#' + routeForRole(RT.authRole || 'athlete')); return; }");
  assert.ok(gate > 0, 'the router gate is missing');
  assert.ok(gate < r.indexOf('if (isLazy(resolved))'), 'the gate must run before the lazy screen is fetched');
  assert.match(r, /import \{ ROLLCALL_OFF, ROLLCALL_ROUTES \} from '\.\/commitments\.js';/);
});

test('a push, a bell row or an old link to the roll call has somewhere to land', () => {
  // Every route those doors produce is one the router intercepts.
  for (const r of ['rollcall-board/i1', 'rollcall-board/i1/missed', 'roll-call/i1', 'rollcall-assigned/c1', 'rollcall/c1', 'rollcall-new', 'accountability', 'location-consent']) {
    assert.ok(ROLLCALL_ROUTES.has(r.split('/')[0]), r);
  }
});

/* ---------------------------------------------------------------- no roll call data */

test('the athlete reads no roll call: no Home card, next card, alarm face, reminder or wake-up score', async () => {
  let rpcs = 0;
  window.sb = { rpc: async () => { rpcs++; return { data: [{ type: 'morning_roll_call', instance_id: 'x' }], error: null }; } };
  const CD = await import('./commitment-data.js');
  CD.seedMineForHarness([{ type: 'morning_roll_call', instance_id: 'i1', occurs_on: CD.todayISO(), status: 'pending' }]);
  assert.deepEqual(CD.VC.mine, [], 'a cached row must not paint while off');
  assert.deepEqual(CD.VC.today(), []);
  assert.deepEqual(await CD.loadMine(true), []);
  assert.deepEqual(await CD.loadMineAhead(true), []);
  assert.equal(rpcs, 0, 'off means no roll call read at all, not a read that comes back empty');
  window.sb = null;
});

test('any alarm sync while off cancels every alarm on the phone and mints no code', async () => {
  const { syncWakeAlarms } = await import('./wake-alarms.js');
  const got = [];
  let invoked = 0;
  window.sb = { functions: { invoke: async () => { invoked++; return { data: null, error: null }; } } };
  window.OnStandardNative = { wakeAlarms: { sync: async (a, o) => { got.push([a, o]); return 0; } } };
  const ahead = new Date(Date.now() + 18 * 3600000).toISOString();
  await syncWakeAlarms([{ type: 'morning_roll_call', instance_id: 'i1', starts_at: ahead, status: 'pending' }], Date.now(), { complete: false });
  assert.deepEqual(got, [[[], { complete: true }]]);
  assert.equal(invoked, 0);
  delete window.OnStandardNative; window.sb = null;
});

test('the alarm primer never asks and the next-roll-call card never draws', async () => {
  window.OnStandardNative = { wakeAlarms: { state: async () => ({ supported: true, authorization: 'notDetermined' }) } };
  const AP = await import('./alarm-primer.js');
  const host = { querySelector: () => null, isConnected: true, appendChild() { throw new Error('drew a primer'); } };
  assert.equal(await AP.mountAlarmPrimer(host, { onTeam: true }), false);
  assert.equal(await AP.mountAlarmPrimer(host, { onTeam: true, force: true }), false);
  await AP.mountPrimers(host, [], true);
  const RN = await import('./rollcall-next.js');
  const ahead = new Date(Date.now() + 18 * 3600000).toISOString();
  await RN.mountNextCard({ querySelector: () => null, appendChild() { throw new Error('drew a card'); } },
    { rows: [{ type: 'morning_roll_call', instance_id: 'i1', starts_at: ahead, status: 'pending' }] });
  delete window.OnStandardNative;
});

/* ---------------------------------------------------------------- the furniture */

test('the coach create menu offers no roll call and no commitment', () => {
  const s = code('screens/coach-create.js');
  assert.match(s, /!\(ROLLCALL_OFF && o\.key === 'commitments'\)/);
  for (const go of ['rollcall-new', 'coach-commit-manage']) {
    const line = s.split('\n').find((l) => l.includes(`go: '${go}'`));
    assert.ok(line && line.includes("key: 'commitments'"), `${go} must share the filtered key`);
  }
});

test('coach Home paints no roll call card and reads no board', () => {
  const s = code('screens/coach-commitments.js');
  const body = s.slice(s.indexOf('export function paintBoard('));
  assert.match(body.slice(0, 400), /if \(ROLLCALL_OFF\) \{ slot\.innerHTML = ''; return; \}/);
  assert.ok(body.indexOf('if (ROLLCALL_OFF)') < body.indexOf('loadBoard('), 'the gate comes before the read');
});

test('the athlete page has no roll call section', () => {
  assert.match(code('screens/coach.js'), /\$\{ROLLCALL_OFF \? '' : `<h2 class="eyebrow">Roll call<\/h2>/);
});

test('Progress has no roll call record, Profile no location check-in', () => {
  assert.match(code('screens/progress.js'), /ROLLCALL_OFF \|\| !S\.coach\.hasCoach \? '' : row\('accountability'/);
  assert.match(code('screens/profile.js'), /ROLLCALL_OFF \? '' : row\('location-consent'/);
});

test('Settings does not tell anyone their roll call answers are shown', () => {
  const s = code('screens/settings.js');
  assert.match(s, /if \(!ROLLCALL_OFF\) \{\s*rows\.push\(\{\s*ic: 'clock', t: 'Roll call board'/);
  assert.match(s, /s: ROLLCALL_OFF \? 'Scores only by opt-in'/);
  assert.match(s, /s: ROLLCALL_OFF \? 'Your score only if you opt in'/);
});

test('Home never arms or paints from the roll call on its own', () => {
  const h = code('screens/home.js');
  // Every roll call surface on Home reads VC / loadMine / loadMineAhead / the lazy modules gated above.
  assert.doesNotMatch(h, /rpc\('my_commitments'/);
  assert.match(code('commitment-data.js'), /export async function loadMine\(force = false, dayISO = null\) \{\s*if \(ROLLCALL_OFF\) return \[\];/);
  assert.match(code('commitment-data.js'), /export async function loadMineAhead\(force = false\) \{\s*if \(ROLLCALL_OFF\) return \[\];/);
});
