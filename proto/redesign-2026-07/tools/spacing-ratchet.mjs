// Spacing ratchet — the mechanism that makes DESIGN.md's spacing scale a rule instead of an
// aspiration, exactly as type-scale-ratchet.mjs does for type.
//
// DESIGN.md names nine steps (--s1 4 · --s2 8 · --s3 12 · --s4 16 · --s5 20 · --s6 24 · --s7 32 ·
// --s8 40 · --s9 56). The 2026-09-05 audit counted the proto's raw padding/margin/gap values and
// found a shadow scale nobody minted: 6px 389 times, 10px 387, 14px 244, 18px 85, 22px 47. Type
// had a ratchet and shrank; spacing had none and grew. This lint records every file's count of
// OFF-SCALE raw px values in padding/margin/gap declarations (CSS files and JS template strings)
// and FAILS if any file's count ever goes UP. Migrated files can only stay clean; unmigrated
// files can only shrink. Run with --write after a migration lowers a count and the new lower
// number becomes the ceiling. A new file starts at a ceiling of zero.
//
// "Off-scale" means a px number that is not 0 and not one of the nine steps. 1px and 2px are
// allowed too: they are hairlines and optical nudges, not spacing. `var(--s*)`, `calc()`,
// percentages, em, and `auto` are all fine and never counted.
//
// Wired as `npm run lint:space` inside `npm run verify`.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL(import.meta.url)));
const SRC = join(ROOT, '..');
const BASELINE = join(ROOT, 'spacing-baseline.json');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

// 6, 10, 14 and 18 joined on 2026-09-06 as the --s1h..--s4h half steps (tokens.css), by the same
// rule that minted --t-micro: they were real populated tiers, not wishes.
const SCALE = new Set([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 40, 56]);

// A spacing declaration and its value, up to the terminator. Deliberately excludes
// `scroll-padding`, `padding-inline-start` etc. only by not listing them; the plain shorthands and
// the four sides are what the scale governs.
const DECL = /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;"'`}]+)/g;
const PX = /(-?[\d.]+)px/g;

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

function offScale(src) {
  const hits = [];
  for (const m of src.matchAll(DECL)) {
    for (const px of m[1].matchAll(PX)) {
      const n = Math.abs(Number(px[1]));
      if (!SCALE.has(n)) hits.push(`${n}px`);
    }
  }
  return hits;
}

const counts = {};
const detail = {};
for (const p of walk(SRC)) {
  const hits = offScale(readFileSync(p, 'utf8'));
  if (hits.length) {
    const key = relative(SRC, p).split('\\').join('/');
    counts[key] = hits.length;
    detail[key] = hits;
  }
}

if (LIST) {
  const tally = {};
  for (const hits of Object.values(detail)) for (const h of hits) tally[h] = (tally[h] || 0) + 1;
  for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${v}`);
  process.exit(0);
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`spacing-ratchet: baseline written — ${total} off-scale spacing values across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); }
catch {
  console.error('spacing-ratchet: no baseline. Run with --write to record the current state.');
  process.exit(1);
}

const regressions = [];
for (const [file, n] of Object.entries(counts)) {
  const cap = baseline[file] ?? 0;
  if (n > cap) regressions.push(`  ${file}: ${n} off-scale spacing values (ceiling ${cap})`);
}

if (regressions.length) {
  console.error('spacing-ratchet: FAIL — off-scale padding/margin/gap grew. Use the spacing tokens (var(--s1..--s9), tokens.css):');
  console.error(regressions.join('\n'));
  console.error('If a migration legitimately LOWERED other counts, refresh the ceilings with: node proto/redesign-2026-07/tools/spacing-ratchet.mjs --write');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`spacing-ratchet: clean — ${total} off-scale spacing values (ceiling ${base}); nothing grew.`);
