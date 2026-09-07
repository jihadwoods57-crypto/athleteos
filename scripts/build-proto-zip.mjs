// Package the :8124 proto into a single bundled asset (assets/proto.zip) that the app
// extracts to documentDirectory on launch and loads in the WebView. Also writes a content
// hash to src/proto/protoVersion.ts so the app re-extracts only when the proto changes
// (and so `eas update` shipping a new zip triggers a fresh extract). Run before build/ship.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'proto/redesign-2026-07');
const OUT_ZIP = join(ROOT, 'assets/proto.zip');
const OUT_VER = join(ROOT, 'src/proto/protoVersion.ts');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Files that exist for developers and can never be reached by the WebView. Nothing in the proto
// imports a *.test.mjs, and tools/ holds the lint scripts package.json runs from the repo — the
// app has no path to either.
//
// Two costs, and the second is the one that matters. They were 307 KB of the 4.1 MB payload, which
// every device downloads on every OTA. And because PROTO_VERSION is the content hash of this zip,
// EDITING A TEST CHANGED THE HASH — so tightening an assertion in chat-view.test.mjs shipped a new
// version stamp and made every phone re-extract the whole proto on next launch, for a change no
// user could observe.
//
// fonts/NOTICE.md and the other .md files stay: they are a few KB and a font license notice is
// meant to travel with the font.
const DEV_ONLY = /(\.test\.mjs$)|(^tools[/\\])/;
const files = walk(SRC).filter((p) => {
  const rel = relative(SRC, p).split('\\').join('/');
  return !/\.DS_Store$/.test(p) && !DEV_ONLY.test(rel);
});
// Text entries are normalised to LF before zipping, for the same reason the mtime below is
// pinned: the zip must be byte-identical no matter who builds it. Git checks these files out
// with CRLF on a Windows clone (core.autocrlf), so a bundle built on the founder's PC and one
// built in a Linux cloud session were different files carrying identical code — a new
// PROTO_VERSION, a pointless full re-extract on every phone, and two hashes that could never be
// compared to each other. It has bitten at least twice (2026-08-31, 2026-09-01), each time
// caught only by eye in a diff.
//
// Byte-safe by construction: the CR strip runs ONLY on the source extensions the proto is
// written in. Fonts, images and every other binary are passed through untouched, and a lone CR
// inside a JS string literal survives because the pattern requires the LF.
const TEXT = /\.(?:js|mjs|css|html|json|svg|md|txt)$/i;
const stripCR = (buf) => {
  let w = 0;
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue; // CR immediately before LF
    out[w++] = buf[i];
  }
  return w === buf.length ? out : out.subarray(0, w);
};
/* MINIFIED ON THE WAY IN, NEVER IN THE WORKING TREE.
 *
 * The proto has no build step by design, and that stays true: you edit plain ES modules and what
 * you read on disk is what runs at :8124. This touches only the SHIPPED artifact.
 *
 * Why it is worth it, measured 2026-09-07: the WebView parses 4,129 KB of raw JS+CSS, of which
 * 1,577 KB across 67 modules is the eager closure that must be parsed before first paint. The zip
 * being 1,815 KB is DEFLATE, which helps the download and does nothing for parse time.
 *
 * WHITESPACE ONLY, deliberately. Measured on that eager closure:
 *     whitespace only        1577 KB -> 724 KB  (-54%)
 *     whitespace + syntax    1577 KB -> 700 KB  (-56%)
 *     full (renames locals)  1577 KB -> 614 KB  (-61%)
 * Full minification buys another 7 points and renames every local, so a stack trace off a real
 * device stops naming anything you could search for. This codebase gets debugged in the field and
 * that trade is not worth 7%. Function and variable NAMES survive here. Be aware that LINE numbers
 * do not: statements collapse onto shared lines, so a trace pins the function, not the line.
 *
 * DETERMINISM: this zip must be byte-identical across machines (see the CRLF note above, which has
 * bitten twice). esbuild's output is deterministic for a given input AND VERSION, so esbuild is
 * pinned to an exact version in devDependencies. Bumping it changes PROTO_VERSION and re-extracts
 * on every phone; that is expected, but this is why.
 *
 * Failure is NEVER fatal: a file esbuild cannot parse ships as its original bytes. A performance
 * pass must not be able to break a ship.
 */
const MINIFY = /\.(?:js|css)$/i;
const dec = new TextDecoder();
const enc = new TextEncoder();
let minifiedFrom = 0, minifiedTo = 0, minifySkipped = 0;

function minify(rel, bytes) {
  if (!MINIFY.test(rel)) return bytes;
  try {
    const out = transformSync(dec.decode(bytes), {
      loader: rel.endsWith('.css') ? 'css' : 'js',
      minifyWhitespace: true,
      // Syntax and identifier minification stay OFF on purpose — see the note above.
      minifySyntax: false,
      minifyIdentifiers: false,
    });
    const buf = enc.encode(out.code);
    minifiedFrom += bytes.length;
    minifiedTo += buf.length;
    return buf;
  } catch {
    minifySkipped++;
    return bytes;
  }
}

const entries = {};
for (const p of files) {
  const rel = relative(SRC, p).split('\\').join('/'); // zip uses forward slashes
  const raw = new Uint8Array(readFileSync(p));
  entries[rel] = TEXT.test(rel) ? minify(rel, stripCR(raw)) : raw;
}

// Pin a fixed mtime so the zip is byte-deterministic across runs (otherwise fflate stamps
// "now" into every entry, changing the content hash every build and dirtying the tree forever).
const zipped = zipSync(entries, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
mkdirSync(dirname(OUT_ZIP), { recursive: true });
writeFileSync(OUT_ZIP, zipped);

const hash = createHash('sha256').update(zipped).digest('hex').slice(0, 16);
mkdirSync(dirname(OUT_VER), { recursive: true });
writeFileSync(
  OUT_VER,
  `// AUTO-GENERATED by scripts/build-proto-zip.mjs — do not edit by hand.\n` +
    `// Content hash of assets/proto.zip; bumps whenever the proto changes so the app re-extracts.\n` +
    `export const PROTO_VERSION = '${hash}';\n`
);

const saved = minifiedFrom ? (100 - (minifiedTo / minifiedFrom) * 100).toFixed(0) : '0';
console.log(
  `proto.zip: ${files.length} files, ${(zipped.length / 1024).toFixed(0)} KB, version ${hash}` +
  ` | minified ${(minifiedFrom / 1024).toFixed(0)}->${(minifiedTo / 1024).toFixed(0)} KB (-${saved}%)` +
  (minifySkipped ? ` | ${minifySkipped} passed through unminified` : '')
);
