/* The book-arrival contract: read the operator book → you must also be able to LOAD it.
 *
 * The failure class this locks shut has now bitten twice. A screen renders from the shared
 * operator cache (coach-data.js: CD.roster / CD.extras / bookId() / entriesFor()) but its mount
 * never kicks loadBook. Reached by a tap from another operator screen, the cache is warm and
 * everything looks finished. Reached DIRECTLY — a relaunch restoring the hash — the cache is
 * null, nothing ever loads it, and the screen sits on its loading skeleton forever or, worse,
 * states a confirmed-sounding emptiness over real data ("No activity standards yet",
 * "Nothing scheduled yet"). Nothing throws, nothing logs, and a tap-through QA pass can't see
 * it because tapping through is exactly the path that warms the cache.
 *   - coach-standards / coach-standards-manage / coach-rooms: found hung 2026-08-23.
 *   - coach-commitments (board, manage, composer), pass-grant, coach-meal: found 2026-08-26.
 *
 * Rule: a screen file that reads the book anywhere must contain a load kick somewhere in the
 * same file. File-scope on raw source, same trade restate-contract.test.mjs makes and for the
 * same reason: comment-stripping has eaten real code here before (capture-chain.test.mjs), and
 * a kick mentioned in a comment but absent from code would be caught the first time the screen
 * is actually opened cold by qc-capture — this gate exists to catch the class at commit time,
 * not to prove per-mount placement.
 *
 * The second half of the fix is delivery: loadBook used to repaint by hash whitelist (the
 * actual footgun — every new screen had to remember to join it). It now dispatches
 * 'onstd:book-arrival' and the router repaints whichever operator screen is current. The two
 * tests below pin both sides of that seam so neither half can be refactored away alone.
 *
 * Run: node --test proto/redesign-2026-07/js/book-arrival.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = join(HERE, 'screens');

const READS = ['bookId()', 'CD.roster', 'entriesFor(', 'CD.extras'];
const KICKS = ['loadBook(', 'loadCoachRoster(', 'loadTrainerBook(', 'ensureBook'];

test('every screen that reads the operator book can also load it', () => {
  const orphans = [];
  for (const f of readdirSync(SCREENS_DIR).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(SCREENS_DIR, f), 'utf8');
    if (!READS.some((r) => src.includes(r))) continue;
    if (!KICKS.some((k) => src.includes(k))) orphans.push(f);
  }
  assert.deepEqual(orphans, [],
    `these screens render from the operator book but never load it — on direct entry `
    + `(a relaunch restoring their hash) they hang or fabricate emptiness:\n  ${orphans.join('\n  ')}\n`
    + `Fix: kick loadBook(false, bookKindFor(RT.authRole)) in mount when bookId()/CD.roster is null.`);
});

test('loadBook announces arrival instead of keeping a hash whitelist', () => {
  const src = readFileSync(join(HERE, 'coach-data.js'), 'utf8');
  assert.ok(src.includes("dispatchEvent(new Event('onstd:book-arrival'))"),
    'coach-data.js must dispatch onstd:book-arrival when the book load settles (success AND failure)');
  assert.ok(!src.includes("h.startsWith('#coach-standards')"),
    'the per-screen hash whitelist is the footgun this contract retired — do not bring it back');
});

test('the router repaints the current operator screen on arrival', () => {
  const src = readFileSync(join(HERE, 'router.js'), 'utf8');
  assert.ok(src.includes("addEventListener('onstd:book-arrival'"),
    'router.js must listen for onstd:book-arrival — without the listener the dispatch repaints nothing');
});

/* 2026-09-23 review (Important 1): a book arrival while the coach's Nudge/Override sheet is open
 * used to just drop the repaint — no crash, no replay, so `CD.kind` labels, the `rosterLoaded`
 * dead-link guard and the More template's rows stayed stale until some UNRELATED repaint. The fix
 * has two halves and both must survive a refactor together: (1) the listener must not call
 * window.__render() while a `.sheet-scrim` sits in the document — it must defer instead, and
 * (2) something must replay that deferred arrival once the sheet is gone, or (1) alone just
 * turns "closes itself" into "never catches up". Source-level, same reasoning as the tests
 * above: importing router.js pulls in the whole screens/index.js tree for a module that has
 * real side effects at import time (initLayout/initGestures/initKeyboard), which is exactly why
 * this file has stayed source-scanning since 2026-08-23. */
test('a book arrival while the sheet is open is deferred, not dropped, and replays once it closes', () => {
  const src = readFileSync(join(HERE, 'router.js'), 'utf8');
  const start = src.indexOf("addEventListener('onstd:book-arrival'");
  assert.ok(start >= 0, 'the onstd:book-arrival listener must exist');
  const body = src.slice(start, start + 1200);

  // Half 1: no repaint while the sheet is open. The sheet-scrim check must come BEFORE the
  // unconditional window.__render() call inside this listener, and must return without calling
  // it — otherwise the guard from Important 1's failure scenario is gone again.
  const guardAt = body.indexOf("querySelector('.sheet-scrim')");
  const renderAt = body.indexOf('window.__render();');
  assert.ok(guardAt >= 0, 'the listener must check for an open .sheet-scrim before repainting');
  assert.ok(renderAt >= 0 && guardAt < renderAt,
    'the .sheet-scrim check must gate the unconditional window.__render() call, not follow it');
  const guardLine = body.slice(guardAt - 40, guardAt + 120);
  assert.ok(!/window\.__render\(\)/.test(body.slice(guardAt, guardAt + 60)),
    'the branch that finds an open sheet must not itself call window.__render() synchronously');
  assert.match(guardLine, /pendingBookArrival\s*=\s*true/,
    'finding an open sheet must remember the deferred arrival (pendingBookArrival), or half 2 has nothing to replay');

  // Half 2: one repaint after the sheet closes. Something must watch for the sheet leaving the
  // document and then call window.__render() — gated on the same pending flag, so an arrival
  // that was never deferred does not cause an extra repaint on some later, unrelated sheet close.
  assert.ok(/new MutationObserver/.test(src),
    'nothing observes the sheet closing, so a deferred arrival can never replay');
  const replaySrc = src.slice(src.indexOf('function replayBookArrivalWhenSheetCloses'));
  assert.match(replaySrc.slice(0, 600), /if\s*\(pendingBookArrival\)\s*\{\s*pendingBookArrival\s*=\s*false;\s*window\.__render\(\);/,
    'the replay must clear pendingBookArrival and call window.__render() exactly once when the sheet is gone');
});
