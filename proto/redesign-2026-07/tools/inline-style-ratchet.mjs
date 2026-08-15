// Inline-style ratchet — the same mechanism as the type-scale ratchet, pointed at the drift
// that was quietly dismantling the component vocabulary.
//
// The problem it exists for: an impeccable critique (2026-08-14) found ~270 inline `style="`
// attributes across the four flagship screens alone, and the fragmentation they were carrying.
// Ghost buttons had been hand-sized to SIX different heights (34px×36, 30px×21, 36px×13,
// 32px×10, 40px×4, 28px×2) because there was no size modifier to reach for, so every screen
// invented its own. components.js states the doctrine in its own header — "improve the
// primitive so polish propagates; avoid per-screen one-offs" — and the screens were voting
// against it one `style=` at a time. That is the inconsistent-component-vocabulary ban in slow
// motion, and DESIGN.md's bans only mean anything if something enforces them.
//
// A big-bang migration was rejected for the same reason it was rejected for the type scale:
// each screen's change should be reviewable on its own. So this is a RATCHET. Every file's
// inline-style count is recorded in a checked-in baseline, and this lint FAILS if any file's
// count ever goes UP. New files start at a ceiling of zero. Migrated screens can only stay
// clean; unmigrated ones can only shrink. After a migration lowers a count, run with --write to
// lock the new lower ceiling in.
//
// The point is NOT that inline styles are forbidden. A genuine one-off (a computed width, a
// background-image built from a runtime URL) is legitimate and always will be. The point is
// that the total can only fall, so the next person who needs a 36px button finds `.btn.xs`
// instead of typing `height:36px` for the eighty-seventh time.
//
// Wired as `npm run lint:inline` inside `npm run verify`, next to lint:type, lint:copy and
// lint:xss.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL(import.meta.url)));
const SRC = join(ROOT, '..');
const BASELINE = join(ROOT, 'inline-style-baseline.json');
const WRITE = process.argv.includes('--write');

// An inline style attribute in markup or in a JS template string. Matches `style="..."` and
// `style='...'`. Deliberately does NOT match `.style.foo =` assignments in JS: setting a
// computed value from script is a different act from hardcoding a look into a template, and
// the outbox/photo-store paths legitimately do it.
const RAW = /style\s*=\s*["']/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'tools' || name === 'assets' || name === 'fonts') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(html|js)$/.test(name) && !/\.test\.mjs$/.test(name)) acc.push(p);
  }
  return acc;
}

const counts = {};
for (const p of walk(SRC)) {
  const n = (readFileSync(p, 'utf8').match(RAW) || []).length;
  if (n > 0) counts[relative(SRC, p).split('\\').join('/')] = n;
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`inline-style-ratchet: baseline written — ${total} inline styles across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); }
catch {
  console.error('inline-style-ratchet: no baseline. Run with --write to record the current state.');
  process.exit(1);
}

const regressions = [];
for (const [file, n] of Object.entries(counts)) {
  const cap = baseline[file] ?? 0; // a NEW file starts at 0 — classes only
  if (n > cap) regressions.push(`  ${file}: ${n} inline styles (ceiling ${cap})`);
}

if (regressions.length) {
  console.error('inline-style-ratchet: FAIL — inline `style="` grew. Reach for a class instead');
  console.error('(button sizes: .btn.sm/.xs/.micro in app.css; see components.js for the primitives):');
  console.error(regressions.join('\n'));
  console.error('If a migration legitimately LOWERED other counts, refresh the ceilings with: node proto/redesign-2026-07/tools/inline-style-ratchet.mjs --write');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`inline-style-ratchet: clean — ${total} inline styles (ceiling ${base}); nothing grew.`);
