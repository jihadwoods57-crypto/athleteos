/* The row IS the switch — pins the pattern that closed crew backlog #2 (2026-09-07).
 *
 * Every on/off switch in the app is a ROW carrying role="switch", tabindex and aria-checked,
 * with the 50x30 .std-switch pill inside as aria-hidden paint. The coach standards editor
 * established the pattern (coach.css .std-switch-row[role="switch"]); settings, the squad
 * share row and the signup consent rows were converted to it on 2026-09-07. Before that, the
 * pill itself was the control: a 30px-tall target propped up to 44px by a ::before hit-area
 * band-aid, and a row whose text LOOKED like part of the control but did nothing when tapped.
 *
 * Why static source scan and not a DOM test: the regression that matters is a NEW screen
 * pasting the old idiom (role="switch" on the bare pill), and that is visible in the template
 * strings themselves. In the manner of depill.test.mjs and focus-hitarea.test.mjs: regex over
 * source, honest about its limits — it reads tags, not a render tree.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js') && !name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const FILES = walk(join(ROOT, 'js')).map((f) => ({
  path: relative(ROOT, f),
  src: readFileSync(f, 'utf8'),
}));

/* Every HTML start tag in the templates. Good enough: the builders write plain
   `<div ... >` tags with double-quoted attributes throughout. Arrow functions inside
   attribute interpolations (`${xs.every(p => ...)}`) would end the match at their `=>`
   and truncate the tag, so neutralize them first. */
const tags = (src) => (src.replace(/=>/g, '  ').match(/<[a-z][^<>]*>/g) || []);

/* A tag whose class list carries the bare pill class (std-switch, not std-switch-row),
   at any position in the attribute. */
const isPill = (t) => /class="[^"]*\bstd-switch(?!-row)\b/.test(t);

test('no bare .std-switch pill is the control (role/tabindex/aria-checked live on the row)', () => {
  const bad = [];
  for (const { path, src } of FILES) {
    for (const t of tags(src)) {
      if (!isPill(t)) continue;
      if (/role=|tabindex=|aria-checked=/.test(t)) bad.push(`${path}: ${t.slice(0, 100)}`);
    }
  }
  assert.deepStrictEqual(bad, [], `the pill is paint, never the control; put role="switch" on the row:\n${bad.join('\n')}`);
});

test('every .std-switch pill is aria-hidden paint', () => {
  const bad = [];
  for (const { path, src } of FILES) {
    for (const t of tags(src)) {
      if (!isPill(t)) continue;
      if (!/aria-hidden="true"/.test(t)) bad.push(`${path}: ${t.slice(0, 100)}`);
    }
  }
  assert.deepStrictEqual(bad, [], `a pill inside a switch row must be aria-hidden (the row carries the semantics):\n${bad.join('\n')}`);
});

test('every role="switch" is a row-level control with keyboard reach and a state', () => {
  const bad = [];
  let count = 0;
  for (const { path, src } of FILES) {
    for (const t of tags(src)) {
      if (!/role="switch"/.test(t)) continue;
      count++;
      const problems = [];
      if (!/class="[^"]*(lrow|std-switch-row)/.test(t)) problems.push('not a .lrow/.std-switch-row');
      if (!/tabindex="0"/.test(t)) problems.push('no tabindex="0"');
      if (!/aria-checked=/.test(t)) problems.push('no aria-checked');
      // No aria-label check: a switch ROW may take its name from its visible content (the
      // coach-connected sw() rows do, deliberately), and that name moves with the copy.
      // The display-only rows opt OUT of interactivity with cursor:default; a switch row that
      // keeps it advertises "not clickable" on a control that is.
      if (/cursor:\s*default/.test(t)) problems.push('cursor:default on a control');
      if (problems.length) bad.push(`${path} [${problems.join(', ')}]: ${t.slice(0, 120)}`);
    }
  }
  assert.ok(count >= 15, `expected the app's switch rows to be found by this scan, got ${count} — has the markup idiom changed? Update this test.`);
  assert.deepStrictEqual(bad, [], `switch rows carry the full contract:\n${bad.join('\n')}`);
});

test('a labeled switch row also voices its subtitle (aria-label needs aria-describedby)', () => {
  // role="switch" makes the row's children presentational and aria-label replaces name-from-
  // content, so a row that names itself with aria-label silences its own subtitle unless it
  // points at it with aria-describedby (the settings rows' shape). Rows that take their name
  // from content (coach-connected's sw()) are exempt: their subtitle is read as part of the name.
  const bad = [];
  for (const { path, src } of FILES) {
    for (const t of tags(src)) {
      if (!/role="switch"/.test(t)) continue;
      if (!/aria-label=/.test(t)) continue;
      if (!/aria-describedby=/.test(t)) bad.push(`${path}: ${t.slice(0, 120)}`);
    }
  }
  assert.deepStrictEqual(bad, [], `an aria-label'd switch row must aria-describedby its subtitle:\n${bad.join('\n')}`);
});

test('coach.css guarantees the 44px floor on .lrow switch rows', () => {
  const css = readFileSync(join(ROOT, 'css', 'coach.css'), 'utf8');
  const m = css.match(/\.lrow\[role="switch"\]\s*\{([^}]*)\}/);
  assert.ok(m, 'coach.css lost the .lrow[role="switch"] rule — the settings/consent switch rows have no 44px floor');
  assert.match(m[1], /min-height:\s*44px/, 'the .lrow[role="switch"] rule stopped guaranteeing 44px');
  assert.match(m[1], /cursor:\s*pointer/, 'switch rows must read as clickable (cursor: pointer)');
});

test('the retired ::before hit-area band-aid on bare pills stays retired', () => {
  const css = readFileSync(join(ROOT, 'css', 'coach.css'), 'utf8');
  assert.ok(!/\.std-switch\[role="switch"\]/.test(css),
    'a .std-switch[role="switch"] rule is back in coach.css — that selector only matches the bare-pill idiom this test bans');
});
