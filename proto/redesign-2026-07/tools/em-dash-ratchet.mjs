// Em-dash ratchet — makes DESIGN.md's "no em dashes in new copy" a rule instead of a wish.
//
// The problem it exists for: DESIGN.md lists the em dash under Hard bans, and an impeccable
// critique (2026-08-14) found 692 comment-stripped lines carrying one in user-facing js/,
// including strings written the same month the ban was documented. A hard ban violated 692
// times does not read as a ban; it teaches every contributor that the OTHER bans in that
// document are also suggestions. That is the real cost, and it is why this is worth a gate.
//
// Why a ratchet rather than adding the character to copy-lint's BANNED list: copy-lint is a
// hard fail, so a rule with 692 existing violations would simply break the build on day one and
// be reverted. Same shape as the type-scale and inline-style ratchets: a checked-in per-file
// baseline, failure only when a count GOES UP, new files starting at zero. The debt can only
// shrink, and a burn-down locks its new lower ceiling in with --write.
//
// WHAT IS COUNTED: the em dash character itself (U+2014) and its HTML entity, in source with
// comments stripped. Comments are exempt on purpose — half of meal.js is rationale prose and
// the ban is about COPY, not about how the code explains itself.
//
// WHAT IS NOT COUNTED: the double hyphen. DESIGN.md bans `--` as an em-dash substitute, but in
// this codebase `--` is overwhelmingly a CSS custom property (`var(--blue-bright)`), so a
// literal match would be almost entirely false positives and the gate would be ignored. The en
// dash is also left alone: it does real work in ranges ("60–79", the estimate spread).
//
// Wired as `npm run lint:dash` inside `npm run verify`.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL(import.meta.url)));
const SRC = join(ROOT, '..', 'js');
const BASELINE = join(ROOT, 'em-dash-baseline.json');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

const DASH = /\u2014|&mdash;/g;

/* Identical to copy-lint's stripper: block and line comments out, line numbering preserved,
   and a `//` inside a URL left alone. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(?<![:/])\/\/[^\n]*/g, '');
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue; // third-party bundles are not our copy
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.js$/.test(name) && !/\.test\.mjs$/.test(name)) acc.push(p);
  }
  return acc;
}

const counts = {};
const hits = [];
for (const p of walk(SRC)) {
  const stripped = stripComments(readFileSync(p, 'utf8'));
  const n = (stripped.match(DASH) || []).length;
  if (n > 0) {
    const rel = relative(join(ROOT, '..'), p).split('\\').join('/');
    counts[rel] = n;
    if (LIST) {
      stripped.split('\n').forEach((line, i) => {
        if (DASH.test(line)) hits.push(`  ${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
        DASH.lastIndex = 0;
      });
    }
  }
}

if (LIST) {
  console.log(hits.join('\n'));
  console.log(`\n${hits.length} lines across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

if (WRITE) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`em-dash-ratchet: baseline written — ${total} em dashes across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); }
catch {
  console.error('em-dash-ratchet: no baseline. Run with --write to record the current state.');
  process.exit(1);
}

const regressions = [];
for (const [file, n] of Object.entries(counts)) {
  const cap = baseline[file] ?? 0; // a NEW file starts at 0 — no em dashes in new copy, per DESIGN.md
  if (n > cap) regressions.push(`  ${file}: ${n} em dashes (ceiling ${cap})`);
}

if (regressions.length) {
  console.error('em-dash-ratchet: FAIL — em dashes in copy grew. DESIGN.md bans them:');
  console.error('use a comma, colon, semicolon, period, or parentheses. (Comments are exempt; see --list.)');
  console.error(regressions.join('\n'));
  console.error('If a burn-down legitimately LOWERED other counts, refresh the ceilings with: node proto/redesign-2026-07/tools/em-dash-ratchet.mjs --write');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`em-dash-ratchet: clean — ${total} em dashes in copy (ceiling ${base}); nothing grew.`);
