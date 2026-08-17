/* The two halves of a restate have to exist together, in the same file.
 *
 * `window.__restate()` says "the user changed the view, animate it". `data-vt-row` says "these are
 * the things that move". Either one alone is a silent no-op:
 *
 *   - marks with no restate: the rows are labelled and nothing ever transitions them. Looks
 *     finished, does nothing.
 *   - a restate with no marks: the transition fires and cross-fades the screen, but nothing glides,
 *     so the re-order the restate exists to explain is still unreadable.
 *
 * Neither failure throws, logs, or shows up in a screenshot, and both are exactly what a
 * half-finished conversion leaves behind — which matters because this conversion is deliberately
 * per-screen and will be picked up again later by someone reading this file to find out where it got
 * to. So this suite doubles as the ledger: SCREENS below is the list of what has been converted, and
 * adding a screen to the codebase without adding it here is caught by the last test.
 *
 * Positional over RAW source, and NOT comment-stripped — the lesson from capture-chain.test.mjs,
 * where a non-greedy block-comment match ate 5,259 characters of camera.js and made the assertion
 * that mattered pass on a broken file. `data-vt-row="` only appears in an attribute position here,
 * and a `window.__restate()` inside a comment would still be a true statement about the file.
 * Run: node --test proto/redesign-2026-07/js/restate-contract.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = join(HERE, 'screens');
const read = (f) => readFileSync(join(SCREENS_DIR, f), 'utf8');

/* The ledger. `rows: false` is a deliberate, explained exception — a screen where the user's change
   reshapes content that is not a list, so there is nothing to glide and the cross-fade is the whole
   effect. Anything else with a restate and no marks is an unfinished conversion. */
const SCREENS = [
  { file: 'coach-roster.js', rows: true,  what: 'sort, filter, select mode, groups panel' },
  { file: 'coach-home.js',   rows: true,  what: 'scope re-filter, scope sheet, pulse, nudge arm' },
  { file: 'coach.js',        rows: true,  what: 'athlete sections, template manage/rename, note delete, nudge arm' },
  { file: 'plan.js',         rows: true,  what: 'the goal panel opening above the day list' },
  { file: 'squad.js',        rows: false, what: 'the share-score switch — one control, no list' },
  { file: 'meal.js',         rows: false, what: 'edit mode reshaping the read, not re-ordering it' },
];

const RESTATE = 'window.__restate()';
const MARK = 'data-vt-row="';

test('every converted screen actually calls __restate', () => {
  for (const s of SCREENS) {
    const src = read(s.file);
    assert.ok(src.includes(RESTATE),
      `${s.file} is on the converted ledger (${s.what}) but calls no ${RESTATE}. Either it was reverted `
      + 'or the ledger is wrong; both are worth knowing.');
  }
});

test('a screen with row marks also has a restate to move them, and vice versa', () => {
  for (const s of SCREENS) {
    const src = read(s.file);
    const hasMarks = src.includes(MARK);
    assert.equal(hasMarks, s.rows,
      s.rows
        ? `${s.file} calls __restate but marks no rows — the transition fires and nothing glides, `
          + 'so the re-order it exists to explain is still unreadable.'
        : `${s.file} now marks rows but the ledger says it has no list. If that changed, update the `
          + 'ledger and say what moves.');
  }
});

test('no screen marks rows without a restate anywhere in the app', () => {
  /* The other direction, swept across every screen rather than only the ledger: a mark on a screen
     that never restates is dead weight that reads as a finished feature. */
  for (const f of readdirSync(SCREENS_DIR).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(SCREENS_DIR, f), 'utf8');
    if (!src.includes(MARK)) continue;
    assert.ok(src.includes(RESTATE),
      `${f} carries ${MARK} but never calls ${RESTATE}, so those rows can never glide.`);
  }
});

test('the ledger names every screen that restates', () => {
  /* Catches the reverse drift: a screen converted later and never written down here, which is how
     the next person loses track of where the pass got to. */
  const listed = new Set(SCREENS.map((s) => s.file));
  const found = readdirSync(SCREENS_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => readFileSync(join(SCREENS_DIR, f), 'utf8').includes(RESTATE));
  const missing = found.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [],
    `these screens call ${RESTATE} but are not on the ledger at the top of this file: ${missing.join(', ')}`);
});

test('__restate is only ever called, never redefined by a screen', () => {
  /* It is a router export on window. A screen assigning to it would silently replace the router's
     own implementation for every other screen too. */
  for (const f of readdirSync(SCREENS_DIR).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(SCREENS_DIR, f), 'utf8');
    assert.doesNotMatch(src, /window\.__restate\s*=/, `${f} assigns to window.__restate`);
  }
});
