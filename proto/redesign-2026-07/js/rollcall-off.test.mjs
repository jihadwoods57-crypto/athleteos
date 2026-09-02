/* THE MORNING ROLL CALL IS SWITCHED OFF (founder, 2026-09-02).
 *
 * "Remove the morning roll call completely for now from the app." Nothing was deleted — the
 * switch is `ROLLCALL_OFF` here plus the `verified_commitments` kill switch on the server — so
 * what these tests protect is that the switch is actually THROWN and actually COVERS the app.
 *
 * Two different failures are worth catching, and they need two different kinds of check:
 *
 *   1. A surface that quietly comes back. The data-driven cards empty themselves because the
 *      server returns nothing, but the static furniture (create menu, composer, manage buttons,
 *      the Progress link) is hardcoded and only this constant hides it. A future edit that drops
 *      a gate puts a live-looking composer back in front of a coach whose saves the server will
 *      refuse. These are source assertions on purpose: the screens import state.js and the DOM,
 *      so rendering them here would cost more than it proves, and the thing being protected IS
 *      the presence of the gate.
 *
 *   2. A missing import. The proto has NO BUILD STEP: a file that reads ROLLCALL_OFF without
 *      importing it throws a ReferenceError at TAP TIME, on the coach's phone, not here. The
 *      last check sweeps every user of the constant and is the reason this file earns its place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLLCALL_OFF } from './commitments.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, rel), 'utf8');

test('the switch is thrown', () => {
  assert.equal(ROLLCALL_OFF, true);
});

test('the create menu offers no way to author a roll call or a commitment', () => {
  const s = src('screens/coach-create.js');
  // Both menu rows carry key 'commitments', so one predicate removes both.
  assert.match(s, /ROLLCALL_OFF && o\.key === 'commitments'/);
  assert.match(s, /import \{ ROLLCALL_OFF \} from '\.\.\/commitments\.js';/);
});

test('the composer refuses to open: an honest screen, no form, no save', () => {
  const s = src('screens/coach-wakeup.js');
  assert.match(s, /if \(ROLLCALL_OFF\) return switchedOffScreen\(back\);/);
  // the one-frame "new" route sends a restored hash or an old deep link home, not into the form
  assert.match(s, /location\.replace\(ROLLCALL_OFF \? '#coach-home' : '#coach-wakeup-edit'\)/);
  // and nothing is wired against a screen that has no fields
  assert.match(s, /if \(ROLLCALL_OFF\) return;\s*\n\s*ensureBook\(\);/);
});

test('the manage screen drops both create buttons and says why', () => {
  const s = src('screens/coach-commitments.js');
  assert.match(s, /\$\{ROLLCALL_OFF \? `/);
  assert.match(s, /Scheduling is off right now/);
  // the buttons still exist in the OTHER branch — hidden, not deleted, so this reverses cleanly
  assert.match(s, /data-go="coach-wakeup-new"/);
  assert.match(s, /id="vc-new"/);
});

test('Progress hides the link to a record that would render empty', () => {
  const s = src('screens/progress.js');
  assert.match(s, /\$\{ROLLCALL_OFF \? '' : `/);
  assert.match(s, /data-go="accountability"/);   // kept in the else branch
});

/* THE ONE THAT MATTERS. No build step means an unimported identifier is a ReferenceError thrown
   when a coach taps, indistinguishable from the screen being broken. Every file that READS the
   constant must also IMPORT it (or be the file that exports it). */
test('every file that reads ROLLCALL_OFF imports it', () => {
  const files = [
    'commitments.js',
    'screens/coach-create.js',
    'screens/coach-wakeup.js',
    'screens/coach-commitments.js',
    'screens/progress.js',
  ];
  let readers = 0;
  for (const f of files) {
    const s = src(f);
    if (!s.includes('ROLLCALL_OFF')) continue;
    readers++;
    const exportsIt = /export const ROLLCALL_OFF/.test(s);
    // the import may be on its own line or inside a multi-line brace list
    const importsIt = /import\s*\{[^}]*\bROLLCALL_OFF\b[^}]*\}\s*from\s*'[^']*commitments\.js'/s.test(s);
    assert.ok(exportsIt || importsIt, `${f} reads ROLLCALL_OFF but neither exports nor imports it`);
  }
  // guard the guard: if the constant is ever renamed, this test must not silently pass on zero
  assert.ok(readers >= 5, `expected every gated file to be swept, saw ${readers}`);
});
