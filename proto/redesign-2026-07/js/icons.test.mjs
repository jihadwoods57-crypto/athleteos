// Every icon name the proto asks for must have a glyph.
//
// icon(name) falls back to an empty path list, so a name with no glyph renders a correctly-sized,
// completely INVISIBLE <svg>. On screen that reads as a spacing bug, not a missing asset, which is
// why it keeps surviving review: 'sun' shipped blank across three screens, and on 2026-08-10 an
// audit found 'alert' and 'info' had done it again — 'alert' being the icon on a coach's AI
// meal-flag row, their single most urgent notification.
//
// icons.js warns to the console once per bad name. That has now failed to catch this twice, because
// nobody is watching a WebView console. A warning is not a gate; this is.
import test from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.(js|mjs)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(p);
  }
  return acc;
}

// The glyph table is a plain object literal of `name: '<svg fragment>'`, read as text rather than
// imported so this test does not need a DOM.
const iconsSrc = readFileSync(join(JS, 'icons.js'), 'utf8');
const table = iconsSrc.slice(iconsSrc.indexOf('const P = {'), iconsSrc.indexOf('\n};'));
const defined = new Set([...table.matchAll(/^\s{2}([A-Za-z][\w-]*)\s*:/gm)].map((m) => m[1]));

test('the glyph table parsed at all', () => {
  // Guards the regex above: if icons.js is ever reformatted so this stops matching, `defined` goes
  // empty and every assertion below would pass vacuously — the same "green by running nothing"
  // failure scripts/node-test.mjs exists to prevent.
  assert.ok(defined.size > 30, `expected the glyph table to parse, got ${defined.size} names`);
  assert.ok(defined.has('bell'), 'expected a known glyph (bell) in the parsed table');
});

test('every icon() name used in the proto has a glyph', () => {
  const used = new Map(); // name -> Set(file)
  for (const f of sourceFiles(JS)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*['"]([\w-]+)['"]/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(f.slice(JS.length + 1).split('\\').join('/'));
    }
  }
  assert.ok(used.size > 20, `expected to find icon() calls, found ${used.size}`);

  const missing = [...used.entries()].filter(([n]) => !defined.has(n));
  const report = missing.map(([n, fs_]) => `  ${n}  <- ${[...fs_].join(', ')}`).join('\n');
  assert.strictEqual(
    missing.length, 0,
    `icon name(s) with no glyph — these render as invisible blank SVGs:\n${report}`,
  );
});

test('alert and info specifically, since both shipped blank', () => {
  for (const n of ['alert', 'info']) assert.ok(defined.has(n), `no glyph for '${n}'`);
});
