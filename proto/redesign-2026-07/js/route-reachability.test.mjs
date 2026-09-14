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
  // A hash-only reference gallery of verification-state specimens (0208). It exists so the amber
  // near-collision between "left early" and "unverified" has a canonical rendering; it is opened
  // by typing the hash, and it deliberately has no entry point in the product.
  'states',
  // Documented legacy aliases kept for rollback (index.js): the unified meal page answers
  // #meal-confirm, and the pre-OB2 picker stays reachable as #legacy-role.
  'meal-confirm',
  'legacy-role',
  // The router's own fallbacks, reached as `screens.notfound` / `screens.notpermitted` rather
  // than by route name (router.js: `screens[route] || screens.notfound`). Nothing navigates to
  // them because the router substitutes them.
  'notfound',
  'notpermitted',
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

test('the wake-up morning summary is reachable, and keeps the full board one tap away', () => {
  // The specific regression this file exists for, pinned by name so a future refactor that drops
  // the link fails with the story rather than with a generic orphan list.
  const commitments = stripComments(readFileSync(join(JS, 'screens', 'coach-commitments.js'), 'utf8'));
  assert.match(commitments, /phase === 'closed' \? 'wakeup-morning'/,
    "once the window shuts, the operator-Home card should open the morning summary that was built "
    + 'for exactly that moment, not the live board it opened in every phase');
  const morning = stripComments(readFileSync(join(JS, 'screens', 'wakeup-morning.js'), 'utf8'));
  assert.match(morning, /data-go="coach-commitments\/\$\{esc\(inst\.instance_id\)\}"/,
    'overrides, excuses and recent mornings live on the board; swapping where the card goes must '
    + 'not put them further away');
});
