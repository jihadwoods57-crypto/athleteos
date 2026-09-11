/* THE MORNING ROLL CALL IS BACK ON (founder, 2026-09-11: "I just want this new and improved
 * version live").
 *
 * It was switched off on 2026-09-02 ("remove the morning roll call completely for now from the
 * app"). Nothing was ever deleted, so turning it back on was two switches: `ROLLCALL_OFF` here
 * and the `verified_commitments` kill switch on the server, server first.
 *
 * This file used to assert the switch was THROWN. It now asserts the opposite, and keeps the one
 * check that was always the reason it earned its place: the proto has NO BUILD STEP, so a file
 * that reads ROLLCALL_OFF without importing it throws a ReferenceError at TAP TIME, on a coach's
 * phone, not here. The gates on the furniture are gone with the gate they tested — that furniture
 * is supposed to be visible again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLLCALL_OFF } from './commitments.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, rel), 'utf8');

test('the switch is released, so the roll call is live again', () => {
  assert.equal(ROLLCALL_OFF, false,
    'the client half of the 2026-09-02 shutdown. The server half is feature_flags.verified_commitments.kill_switch, which must be false too; this file cannot see it.');
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
