// Does the SHIPPED proto still work? The test suites all run against the working tree, so once
// build-proto-zip.mjs started minifying on the way in (2026-09-07), nothing checked the artifact
// that actually reaches a phone. A minifier that mangled one file would have shipped green.
//
// This unpacks assets/proto.zip and checks the bytes that ship:
//   1. every .js parses as an ES module,
//   2. every .css parses,
//   3. every relative import resolves to a file that is actually IN the zip,
//   4. the entry graph from index.html is intact and nothing it needs is missing.
//
// It is deliberately a check of the ARTIFACT, not of the source: source is already covered by
// test:proto and the lint ratchets. Run: node scripts/verify-proto-zip.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZIP = join(ROOT, 'assets/proto.zip');

const files = unzipSync(new Uint8Array(readFileSync(ZIP)));
const names = new Set(Object.keys(files));
const failures = [];

const isJs = (n) => /\.m?js$/i.test(n);
const isCss = (n) => /\.css$/i.test(n);

// 1 + 2: every shipped source file still parses.
let parsed = 0;
for (const name of names) {
  if (!isJs(name) && !isCss(name)) continue;
  const src = strFromU8(files[name]);
  try {
    transformSync(src, { loader: isCss(name) ? 'css' : 'js', format: isJs(name) ? 'esm' : undefined });
    parsed++;
  } catch (e) {
    failures.push(`${name}: does not parse after packaging — ${String(e.message).split('\n')[0]}`);
  }
}

// 3: every relative import resolves to a file that actually shipped.
//
// Read from SOURCE, checked against the ZIP. Regexing the minified bytes was the obvious approach
// and it was wrong: whitespace minification emits `}from"./x.js"` with no space before `from`, so
// an import-shaped pattern found 149 edges where the source has 786 — a check that reported green
// because it was looking at a fifth of the graph. Minification cannot change an import specifier
// (they are string literals), so the graph is honest in the source and the only question worth
// asking of the artifact is whether each TARGET made it into the zip. That is what catches the
// real risk here: a DEV_ONLY exclusion or a rename orphaning a module, which in a proto with no
// bundler throws at click time rather than build time.
const SRC_DIR = join(ROOT, 'proto/redesign-2026-07');
const IMPORT = /\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g;
let edges = 0;

function walkSrc(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSrc(full, acc);
    else acc.push(full);
  }
  return acc;
}

for (const full of walkSrc(SRC_DIR)) {
  const rel = relative(SRC_DIR, full).split('\\').join('/');
  if (!isJs(rel) || /\.test\.mjs$/.test(rel) || rel.startsWith('tools/')) continue;
  if (!names.has(rel)) { failures.push(`${rel}: in the source tree but MISSING from the zip`); continue; }
  // Comments are stripped first: the registry documents its own shape with `() => import('./x.js')`
  // in a header comment, and a naive scan reported that example as a missing module. esbuild
  // removes comments and leaves string literals untouched, so the specifiers survive exactly.
  let scan;
  try {
    scan = transformSync(readFileSync(full, 'utf8'), { loader: 'js', minifyWhitespace: true }).code;
  } catch { scan = readFileSync(full, 'utf8'); }
  for (const m of scan.matchAll(IMPORT)) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    edges++;
    const target = posix.normalize(posix.join(posix.dirname(rel), spec));
    if (!names.has(target)) failures.push(`${rel}: imports '${spec}' which is not in the zip (${target})`);
  }
}

// 4: the entry points index.html names must exist.
const html = names.has('index.html') ? strFromU8(files['index.html']) : '';
if (!html) failures.push('index.html is not in the zip');
for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
  const ref = m[1];
  if (/^https?:/.test(ref)) continue;
  if (!names.has(ref)) failures.push(`index.html references './${ref}' which is not in the zip`);
}

if (failures.length) {
  console.error(`\n✗ proto.zip is NOT shippable — ${failures.length} problem(s):`);
  for (const f of failures.slice(0, 25)) console.error(`   ${f}`);
  if (failures.length > 25) console.error(`   ...and ${failures.length - 25} more`);
  process.exit(1);
}

console.log(`proto.zip verified: ${parsed} source files parse, ${edges} imports all resolve inside the zip.`);
