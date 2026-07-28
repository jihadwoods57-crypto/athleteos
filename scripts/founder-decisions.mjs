#!/usr/bin/env node
// Founder-decisions scanner — collects every open "waiting on the founder" item scattered across
// the repo docs, the memory folder, and code comments into one raw candidate list. It does NOT
// decide what's truly open; it gathers candidates and filters the obvious closed ones (RATIFIED
// lines, checked boxes) so a human (or Claude, via the founder-decisions skill) can synthesize.
//
// Usage: node scripts/founder-decisions.mjs [--json]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MEMORY = 'C:/Users/Administrator/.claude/projects/c--Users-Administrator-Downloads-athleteos/memory';

// Doc files that are the canonical human backlog (newest-first, decision-of-record, go-live gates).
const DOC_FILES = [
  'docs/FOUNDER-DECISIONS.md',
  'docs/FOUNDER-GO-LIVE-CHECKLIST.md',
  'docs/LAUNCH-CHECKLIST.md',
  'docs/RUNBOOK-go-live.md',
  'docs/NEXT-SPRINT-PRIORITIES.md',
];

// Directories to grep for inline decision/hold markers in source.
const CODE_DIRS = ['src', 'web'];

// A line is a candidate if it matches one of these (case-insensitive)...
const OPEN = /founder decision|needs founder|awaiting founder|awaiting your call|awaiting you\b|gated on founder|go-live-gated|GO-LIVE is a founder|test\s*→\s*live|test->live|OPEN founder|\bHELD\b|three-holds|hold list|deferred pending|deferred to|blocked on|still open|awaiting your|\bWS[2-6]\b gate/i;
// ...unless it's clearly already closed.
const CLOSED = /RATIFIED|✅|\bDONE\b|resolved|superseded|no longer/i;
// Inline code-comment markers (tighter, to avoid noise).
const CODE_MARK = /\b(TODO|FIXME|DECISION|FOUNDER|HELD|DEFERRED)\b.*(founder|decision|go-live|held|defer)/i;

const isCheckedBox = (l) => /^\s*[-*]\s*\[x\]/i.test(l);
const isOpenBox = (l) => /^\s*[-*]\s*\[ \]/i.test(l);

function scanFile(abs, { code = false } = {}) {
  let text;
  try { text = readFileSync(abs, 'utf8'); } catch { return []; }
  const rel = relative(ROOT, abs).replace(/\\/g, '/');
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    if (isCheckedBox(l)) return;                       // closed checklist item
    const hit = code ? CODE_MARK.test(l) : (OPEN.test(l) || isOpenBox(l));
    if (!hit) return;
    if (CLOSED.test(l) && !isOpenBox(l)) return;       // ratified/done — skip
    out.push({ file: rel, line: i + 1, text: l.slice(0, 240) });
  });
  return out;
}

function walk(dir, exts, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

const results = { docs: [], memory: [], code: [] };

for (const f of DOC_FILES) {
  const abs = join(ROOT, f);
  if (existsSync(abs)) results.docs.push(...scanFile(abs));
}

if (existsSync(MEMORY)) {
  for (const f of readdirSync(MEMORY)) {
    if (f.endsWith('.md')) results.memory.push(...scanFile(join(MEMORY, f)));
  }
}

for (const d of CODE_DIRS) {
  for (const f of walk(join(ROOT, d), ['.ts', '.tsx', '.js', '.mjs'])) {
    results.code.push(...scanFile(f, { code: true }));
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const section = (title, rows) => {
    console.log(`\n## ${title}  (${rows.length})`);
    for (const r of rows) console.log(`  ${r.file}:${r.line}  ${r.text}`);
  };
  const total = results.docs.length + results.memory.length + results.code.length;
  console.log(`FOUNDER DECISIONS — ${total} candidate line(s). Filter and group before trusting.`);
  section('Docs (canonical backlog)', results.docs);
  section('Memory (prose holds/deferrals)', results.memory);
  section('Code comments', results.code);
  console.log('\nNote: candidates only. RATIFIED/checked items are already dropped, but re-read each');
  console.log('before treating it as open — prose markers over-match.');
}
