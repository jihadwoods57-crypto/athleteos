// Boot-closure ratchet — keeps the eager boot graph from silently regrowing, exactly as
// type-scale-ratchet.mjs and spacing-ratchet.mjs do for type and spacing.
//
// WHY (measured 2026-09-21)
// The 2026-09-07 boot-perf pass cut the eager closure to 67 modules / 1545 KB and shipped. Two
// weeks later, unguarded, it was 76 modules / 1688 KB — ten new modules (the wake-up cluster,
// inbox, avatar-upload, coach-replies, receipts) plus growth inside state.js. Nothing failed,
// because nothing was watching. Type had a ratchet and shrank; spacing had none and grew; the
// boot graph had none and grew. Same lesson, third time.
//
// WHAT IT COUNTS
// The EAGER closure: walk STATIC imports only, starting at js/router.js (index.html's entry).
// A dynamic `import()` is the lazy-registry boundary and is deliberately NOT followed — that
// boundary is the whole point of js/screens/index.js, and following it would measure the app
// rather than the boot.
//
// Two ceilings, because they fail differently:
//   modules — a NEW module joining the boot graph, usually an import added to a file that was
//             already eager. This is the one that creeps.
//   bytes   — existing modules growing. Allowed some slack (see SLACK) so ordinary feature work
//             inside an already-eager module does not fail the build on every commit.
//
// Bytes are UNMINIFIED source. The shipped zip minifies (whitespace-only, ~-54% on the closure),
// so this number is a proxy for parse cost, not the parse cost itself. It only has to be
// consistent to be a useful ratchet.
//
// Run with --write after a real reduction to lock the lower ceiling in. --list prints the whole
// closure, heaviest first, which is where you look when it fails.
//
// Wired as `npm run lint:boot` inside `npm run verify`.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL(import.meta.url)));
const SRC = join(ROOT, '..');
const BASELINE = join(ROOT, 'boot-closure-baseline.json');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

// Byte slack before the size ceiling fails. Module COUNT has none: a new module in the boot graph
// is a decision someone should have to make on purpose, and it is one line to lazy-load instead.
const SLACK = 0.04;

// Static `import ... from '...'` and `export ... from '...'`. A re-export pulls the whole module
// in just as hard as an import, and missing that would undercount the graph.
const STATIC = /^\s*(?:import\s+(?:[^'"]*?from\s*)?|export\s+(?:\*|\{[^}]*\})\s*from\s*)['"]([^'"]+)['"]/gm;

const seen = new Set();
const rows = [];
let bytes = 0;

function walk(file) {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const n = Buffer.byteLength(src);
  bytes += n;
  rows.push([relative(SRC, file).split(sep).join('/'), n]);
  const re = new RegExp(STATIC.source, 'gm');
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;        // bare specifiers are not ours
    walk(resolve(dirname(file), spec));
  }
}

walk(join(SRC, 'js', 'router.js'));
rows.sort((a, b) => b[1] - a[1]);

const modules = seen.size;
const kb = Math.round(bytes / 1024);

if (LIST) {
  for (const [f, n] of rows) console.log(`${String(Math.round(n / 1024)).padStart(5)} KB  ${f}`);
  console.log(`\n${modules} modules, ${kb} KB (unminified source)`);
  process.exit(0);
}

if (WRITE) {
  writeFileSync(BASELINE, `${JSON.stringify({ modules, kb }, null, 2)}\n`);
  console.log(`boot-closure-ratchet: baseline written — ${modules} modules, ${kb} KB.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('boot-closure-ratchet: no baseline. Run with --write once to create it.');
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const kbCeiling = Math.round(base.kb * (1 + SLACK));
const fail = [];

if (modules > base.modules) {
  fail.push(`modules ${base.modules} -> ${modules} (+${modules - base.modules})`);
}
if (kb > kbCeiling) {
  fail.push(`size ${base.kb} KB -> ${kb} KB (ceiling ${kbCeiling} KB with ${Math.round(SLACK * 100)}% slack)`);
}

if (fail.length) {
  console.error('boot-closure-ratchet: FAIL — the eager boot graph grew.');
  for (const f of fail) console.error(`  ${f}`);
  console.error('\nEvery module here is parsed before the first frame, on every launch.');
  console.error('Usually the fix is a dynamic import() rather than a static one, or moving the');
  console.error('route into the lazy half of js/screens/index.js.');
  console.error('\n  node proto/redesign-2026-07/tools/boot-closure-ratchet.mjs --list   # what is in it');
  console.error('  node proto/redesign-2026-07/tools/boot-closure-ratchet.mjs --write  # after a REAL reduction');
  process.exit(1);
}

const headroom = kbCeiling - kb;
console.log(`boot-closure-ratchet: OK — ${modules}/${base.modules} modules, ${kb} KB (${headroom} KB under ceiling).`);
