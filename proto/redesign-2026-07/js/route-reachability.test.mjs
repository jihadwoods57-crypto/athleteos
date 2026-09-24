/* EVERY SCREEN HAS A DOOR, AND EVERY DOOR OPENS ONTO A SCREEN.
 *
 * Founder audit, 2026-09-14. `screens/wakeup-morning.js` — the coach's "this morning" summary,
 * the surface Wake-Up release 1 was designed around, complete with its pulse bar, its "Needs you"
 * list and working Nudge buttons — was registered, styled, unit-tested, shipped in proto.zip, and
 * reachable from NOWHERE. No data-go, no route assignment, no notification deep-link. Its own
 * header says it is "the thing they actually open at breakfast"; a coach could not open it at all.
 *
 * It shipped that way because nothing checks the two halves against each other. Route strings are
 * plain text: a screen with no door and a door with no screen both look like working code, and in
 * a bundler-free app the second one fails at the moment a finger lands on it.
 *
 * Both directions are cheap to check, so both are checked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const JS = dirname(fileURLToPath(import.meta.url));

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
    else if (e.name.endsWith('.js') && !e.name.includes('.test.')) files.push(p);
  }
})(JS);

const INDEX = join(JS, 'screens', 'index.js');
const idxSrc = readFileSync(INDEX, 'utf8');

/** Route names in the registry. index.js's own contract is one `name: value,` line each; eager
 *  entries use object shorthand (`home,`), so both forms are read. */
const routes = new Set();
for (const m of idxSrc.matchAll(/^\s*'?([a-zA-Z0-9_-]+)'?\s*:/gm)) routes.add(m[1]);
for (const m of idxSrc.matchAll(/^\s{2}([a-zA-Z0-9_]+),\s*$/gm)) routes.add(m[1]);

/** Literal navigation targets across the shipped proto. Interpolated targets are skipped: they
 *  cannot be resolved statically, and a false failure here would get the gate deleted. */
function navTargets() {
  const hits = new Map();
  const add = (r, f) => { if (!hits.has(r)) hits.set(r, new Set()); hits.get(r).add(f); };
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const rel = relative(JS, f).replace(/\\/g, '/');
    for (const m of src.matchAll(/data-go="([^"${}]+)"/g)) add(m[1], rel);
    for (const m of src.matchAll(/data-go='([^'${}]+)'/g)) add(m[1], rel);
    for (const m of src.matchAll(/\broute:\s*'([a-zA-Z0-9_/-]+)'/g)) add(m[1], rel);
  }
  return hits;
}

test('every literal navigation target resolves to a registered screen', () => {
  const bad = [];
  for (const [target, where] of navTargets()) {
    const base = target.split('/')[0];
    if (base && !routes.has(base)) bad.push(`  ${target}  <- ${[...where].join(', ')}`);
  }
  assert.equal(bad.length, 0,
    `these taps go nowhere; nothing catches a bad route until a finger lands on it:\n${bad.join('\n')}`);
});

/* Screens with no door on purpose. Each one needs a reason, and the reason has to be in the code,
   not in this list. */
const DOORLESS_BY_DESIGN = new Set([
  // Documented legacy aliases kept for rollback (index.js): the unified meal page answers
  // #meal-confirm, and the pre-OB2 picker stays reachable as #legacy-role.
  'meal-confirm',
  'legacy-role',
  // The router's own fallbacks, reached as `screens.notfound` / `screens.notpermitted` rather
  // than by route name (router.js: `screens[route] || screens.notfound`). Nothing navigates to
  // them because the router substitutes them.
  'notfound',
  'notpermitted',
  // Retired roll call routes (roll call rebuilt, 2026-09-23). Each is kept ONLY so an old push, an
  // old bell row or a restored hash still lands: its `redirect()` hands over to the rebuilt screen
  // before the router paints (router.js). Nothing in the app may link to them any more; the test
  // at the foot of this file pins that.
  'wakeup-morning',
  'coach-wakeup-new',
  'coach-wakeup-edit',
  // Roll call v3 (2026-09-24): the week strip moved onto the one roll call screen (rollcall/<id>);
  // rollcall-week/<id> redirects there before it paints.
  'rollcall-week',
]);

test('every registered screen can actually be opened', () => {
  // A route is reachable if its name appears anywhere in the proto outside the registry itself:
  // a data-go, a route:, an interpolated hash, or a deep link built from it.
  const blob = files.filter((f) => f !== INDEX).map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
  const orphans = [];
  for (const r of routes) {
    if (DOORLESS_BY_DESIGN.has(r)) continue;
    const re = new RegExp(`['"\`#/]${r.replace(/-/g, '\\-')}['"\`/?#]`);
    if (!re.test(blob)) orphans.push(r);
  }
  assert.deepEqual(orphans, [],
    `these screens ship in proto.zip and nothing in the app navigates to them. Either give the `
    + `screen a door, or take it out of the registry — a screen a user cannot reach is not a `
    + `feature, it is weight. If it is intentional, add it to DOORLESS_BY_DESIGN with the reason.`);
});

/* Retired 2026-09-23 (roll call rebuilt): this used to pin the closed-phase Home card to
   wakeup-morning and that screen's "Open the full roll call" row. The team board replaced both: it
   is the live board while the window runs and the morning's summary once it shuts (first up, the
   Missed group with a nudge on every face). The story the old test told still holds, pinned the
   new way round: the coach Home card opens the board in EVERY phase, and wakeup-morning, which no
   longer has a door by design, hands a stale link over to that board on the misses. */
test('the coach Home roll call card opens the team board in every phase', () => {
  const commitments = stripComments(readFileSync(join(JS, 'screens', 'coach-commitments.js'), 'utf8'));
  assert.doesNotMatch(commitments, /'wakeup-morning'/, 'no phase of the Home card opens the retired summary');
  assert.match(commitments, /const target = esc\(boardRoute\(inst\.instance_id\)\)/);
  const morning = stripComments(readFileSync(join(JS, 'screens', 'wakeup-morning.js'), 'utf8'));
  assert.match(morning, /redirect\(\)[\s\S]{0,200}boardRoute\(inst\.instance_id, 'missed'\)/,
    'a stale link to the morning summary lands on the board, opened on the misses');
});

/* ONE WAY IN PER ROLE (roll call rebuilt, 2026-09-23). Before this, a coach had four ways into a
   roll call (the create menu's composer, the Commitments button, the athlete page's row, the Home
   card's board) and an athlete two (the Home card, the detail screen). Each old route is kept as a
   redirect so a deep link in an old notification still lands; none may be linked to. */
test('every old roll call entry lands on the rebuilt screens', async () => {
  for (const r of ['rollcall', 'rollcall-board', 'rollcall-new', 'rollcall-week', 'rollcall-history']) assert.ok(routes.has(r), r);
  const code = (...p) => stripComments(readFileSync(join(JS, ...p), 'utf8'));
  const create = code('screens', 'coach-create.js');
  assert.match(create, /go: 'rollcall-new'/);
  assert.doesNotMatch(create, /coach-wakeup-new/);
  // Nothing in the shipped proto links to a retired route. (The registry and router.js's
  // write-route table name them; the modules that define them do too.)
  const linkers = files.filter((f) => !/^(screens\/index|router|screens\/coach-wakeup|screens\/wakeup-morning)\.js$/
    .test(relative(JS, f).replace(/\\/g, '/')));
  for (const f of linkers) {
    const src = stripComments(readFileSync(f, 'utf8'));
    assert.doesNotMatch(src, /coach-wakeup-(new|edit)/, `${relative(JS, f)} still links to the retired composer`);
    assert.doesNotMatch(src, /['"`#]wakeup-morning['"`]/, `${relative(JS, f)} still links to the retired summary`);
  }
  // The coach doors.
  const coach = code('screens', 'coach.js');
  assert.match(coach, /data-go="rollcall\/\$\{esc\(rc\.commitment_id\)\}"/, 'Open the roll call opens the one roll call screen');
  assert.match(coach, /data-go="rollcall-new"/, 'Set a roll call opens the setup');
  const cc = code('screens', 'coach-commitments.js');
  assert.match(cc, /data-go="rollcall-new">\$\{icon\('sun', 18\)\} Roll call/, 'the manage screen Roll call button opens the setup');
  assert.match(cc, /isRollcall\(row\)\) \{ location\.hash = `#rollcall-new\/\$\{row\.id\}`/, 'Edit on a roll call opens the setup on that rule');
  assert.match(cc, /data-go="rollcall\/\$\{esc\(NEXT\.commitmentId\)\}"/, 'the next roll call card opens the roll call screen');
  // Roll call v3: nothing links to the retired week route; it only redirects.
  for (const f of linkers) {
    if (/screens[\/]rollcall-setup\.js$/.test(f)) continue;
    assert.doesNotMatch(stripComments(readFileSync(f, 'utf8')), /['"`#]rollcall-week\//, `${relative(JS, f)} still links to the retired week route`);
  }
  // The athlete doors.
  const plan = code('notify-plan.js');
  assert.match(plan, /!ROLLCALL_OFF && c\.type === 'morning_roll_call' \? `rollcall-board\/\$\{instanceId\}`/,
    'a wake-up reminder opens the board on a cold launch, and never while the roll call is off');
  const handoff = code('wakeup-handoff.js');
  assert.match(handoff, /data-go="rollcall-board\/\$\{esc\(receipt\.instanceId\)\}"/);
  const acct = code('screens', 'accountability.js');
  assert.doesNotMatch(acct, /data-go="roll-call\//, 'history rows ask athleteRollcallRoute');
  // The retired routes declare their hand-over, and the router honours it before painting.
  for (const [file, re] of [
    [['screens', 'roll-call.js'], /redirect\(\{ sub \}\)/],
    [['screens', 'coach-commitments.js'], /redirect\(\{ sub \}\)/],
    [['screens', 'wakeup-morning.js'], /redirect\(\)/],
    [['screens', 'coach-wakeup.js'], /redirect\(\) \{ return ROLLCALL_OFF \? 'coach-home' : 'rollcall-new'; \}/],
  ]) assert.match(code(...file), re, file.join('/'));
  const router = code('router.js');
  const at = router.indexOf("typeof mod.redirect === 'function'");
  assert.ok(at > 0, 'router.js asks a module for its redirect');
  assert.ok(at < router.indexOf('const body = memoTick(() => mod.render({ sub, S }))'),
    'and asks BEFORE it renders the old screen, so no frame of it is painted');
});
