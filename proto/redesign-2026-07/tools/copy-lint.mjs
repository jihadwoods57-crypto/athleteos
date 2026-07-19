#!/usr/bin/env node
/*
 * copy-lint — GS-5 customer-facing copy guard (T-28).
 *
 * Scans the shipped coach/athlete proto (js/**) for internal engineering
 * language that must never reach a coach- or athlete-facing string. Fails
 * (exit 1) if any banned phrase is found, so a regression can't ship.
 *
 * Comments and JSDoc are stripped before scanning, so a phrase that only
 * documents internal logic (e.g. the `minting` render-state enum, or a note
 * that a weigh-in is "trend only, never scored") is NOT flagged — only the
 * strings a user can actually read. Run: `node tools/copy-lint.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.resolve(HERE, '..', 'js');

/* Each rule maps an internal phrase → the GS-5 replacement it should have been.
   Rules are matched against source with comments removed (see stripComments). */
const BANNED = [
  { re: /score denominator/i, fix: 'say "the meals that count toward the daily score"' },
  { re: /rails enforced/i, fix: 'remove — server limits are silent, not coach-facing' },
  { re: /prospective by default/i, fix: 'say "applies going forward — starts on the date you choose"' },
  { re: /Planned on this phone/i, fix: 'describe what the controls do in plain language' },
  { re: /Hourly summary/i, fix: 'rename to "Overdue digest"' },
  { re: /never scored/i, fix: 'say "tracked, not scored"' },
  { re: /\bteam default\b/i, fix: 'use the noun "Standard" (e.g. "the team standard")' },
  // User-facing "minting" copy only — the internal render-state enum ('minting')
  // and code comments are intentionally not matched.
  { re: /code is minting|is minting|minting\s*(?:…|\.\.\.|a few)/i, fix: 'say "Creating your athlete code…"' },
];

/* Remove block + line comments so documentation of internal terms isn't flagged.
   String URLs (https://…) are preserved: the line-comment strip ignores a `//`
   that is preceded by ':' or '/'. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // keep line numbers
    .replace(/(?<![:/])\/\/[^\n]*/g, '');
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(JS_DIR)) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const rule of BANNED) {
      const m = line.match(rule.re);
      if (m) violations.push({ file, line: i + 1, phrase: m[0].trim(), fix: rule.fix });
    }
  });
}

if (violations.length) {
  console.error(`\ncopy-lint: ${violations.length} banned phrase${violations.length === 1 ? '' : 's'} in coach/athlete copy (GS-5):\n`);
  for (const v of violations) {
    console.error(`  ${path.relative(path.resolve(HERE, '..'), v.file)}:${v.line}  "${v.phrase}"\n      → ${v.fix}`);
  }
  console.error('');
  process.exit(1);
}
console.log('copy-lint: clean — no internal terminology in coach/athlete copy.');
