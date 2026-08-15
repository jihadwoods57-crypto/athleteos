// Type-scale ratchet — the mechanism that makes DESIGN.md's nine-step scale a rule instead of
// an aspiration.
//
// The problem it exists for: the scale was documented while the proto carried ~800 raw
// `font-size: Npx` declarations and ZERO uses of the tokens. A document that states a law the
// code ignores teaches every reader that the docs are optional. A big-bang migration was
// rejected (each screen's change should be reviewable in the QC contact sheet), so the rule is
// a RATCHET: every file's raw-font-size count is recorded in a checked-in baseline, and this
// lint FAILS if any file's count ever goes UP. Migrated files can only stay clean; unmigrated
// files can only shrink. Run with --write after a migration lowers a count, and the new lower
// number becomes the ceiling.
//
// "Raw" means a numeric font-size (`font-size: 13px`, `font-size:14.5px`) in CSS or in a JS
// template string. `var(--t-*)`, `calc(...)` over tokens, em/%/inherit are all fine.
//
// Wired as `npm run lint:type` inside `npm run verify`, next to lint:copy and lint:xss — the
// same gate that keeps banned vocabulary and unescaped interpolations out keeps the type
// continuum from growing back.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL(import.meta.url)));
const SRC = join(ROOT, '..');
const BASELINE = join(ROOT, 'type-scale-baseline.json');
const WRITE = process.argv.includes('--write');

// Standalone session-less pages outside the proto, brought onto the type scale by the 2026-08-14
// impeccable fix pass and now held to it: their raw counts are 0 (all var(--t-*) now), so adding
// them here locks that in rather than leaving the gate blind to them. NOT all of web/ — only the
// two pages that pass actually touched.
const EXTRA_FILES = [
  join(ROOT, '..', '..', '..', 'web/landing/beta.html'),
  join(ROOT, '..', '..', '..', 'web/landing/tester.html'),
];

// A numeric px font-size. Deliberately narrow: it must not match `font-size: var(--t-sm)`
// or `font-size: calc(var(--t-score) * var(--score-fit))`.
const RAW = /font-size:\s*[\d.]+px/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'tools' || name === 'assets' || name === 'fonts') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(css|js)$/.test(name) && !/\.test\.mjs$/.test(name)) acc.push(p);
  }
  return acc;
}

const counts = {};
for (const p of [...walk(SRC), ...EXTRA_FILES]) {
  const n = (readFileSync(p, 'utf8').match(RAW) || []).length;
  if (n > 0) counts[relative(SRC, p).split('\\').join('/')] = n;
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`type-scale-ratchet: baseline written — ${total} raw font-sizes across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); }
catch {
  console.error('type-scale-ratchet: no baseline. Run with --write to record the current state.');
  process.exit(1);
}

const regressions = [];
for (const [file, n] of Object.entries(counts)) {
  const cap = baseline[file] ?? 0; // a NEW file starts at 0 raw font-sizes — tokens only
  if (n > cap) regressions.push(`  ${file}: ${n} raw font-sizes (ceiling ${cap})`);
}

if (regressions.length) {
  console.error('type-scale-ratchet: FAIL — raw `font-size: Npx` grew. Use the type tokens (var(--t-*), tokens.css):');
  console.error(regressions.join('\n'));
  console.error('If a migration legitimately LOWERED other counts, refresh the ceilings with: node proto/redesign-2026-07/tools/type-scale-ratchet.mjs --write');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`type-scale-ratchet: clean — ${total} raw font-sizes (ceiling ${base}); nothing grew.`);
