/* Every Enter-to-submit handler on a text input carries the IME guard.
 *
 * Enter inside an IME composition (Japanese, Chinese, Korean keyboards) is choosing a
 * character, not sending — without `!e.isComposing` the handler submits the half-typed text.
 * The 2026-09-05 sweep fixed the five thread composers; the 09-15 audit then found nineteen
 * more Enter handlers shipped without the guard, one of them added THE DAY AFTER that sweep
 * (account.js). A fix without a gate lasts until the next new screen, hence this file.
 *
 * The rule, per line of shipped source: a keydown check for `key === 'Enter'` — or the
 * early-return spelling, `key !== 'Enter'` (its own adversarial review found two of those the
 * first draft of this gate was structurally blind to) — must either
 *   (a) also test `isComposing` in the same statement, or
 *   (b) be a role="button" activation that also handles Space (`key === ' '` / `key !== ' '`) —
 *       those fire on non-editable elements, where composition cannot occur, and adding the
 *       guard there would imply an IME risk that does not exist.
 * Regex over sources, in the manner of depill.test.mjs / keyboard-fields.test.mjs: it cannot
 * see a handler assembled at runtime, but it catches the literal pattern every screen uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function jsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor') jsFiles(p, acc); continue; }
    if (p.endsWith('.js') && !p.endsWith('.test.mjs')) acc.push(p);
  }
  return acc;
}

test("every Enter submit handler, `===` or early-return `!==`, is IME-guarded (or handles Space)", () => {
  const offenders = [];
  for (const file of jsFiles(HERE)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/key [!=]== 'Enter'/.test(line)) return;
      if (/isComposing/.test(line)) return;
      if (/key [!=]== ' '/.test(line)) return; // role="button" activation: not an editable element
      offenders.push(`${relative(HERE, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], `Enter handlers missing the !isComposing guard:\n${offenders.join('\n')}`);
});
