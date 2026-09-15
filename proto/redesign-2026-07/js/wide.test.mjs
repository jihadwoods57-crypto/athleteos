/* The wide-screen layer (css/wide.css) keeps one promise above all: the phone is untouched. Every
 * rule is scoped under html[data-layout], the file sits between glass and focus, the rail is the
 * same tab bar markup, and the two masters and four details declare their pane. Regex over
 * sources, in the manner of glass.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/wide.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const WIDE = read('..', 'css', 'wide.css');
const APP = read('..', 'css', 'app.css');
const INDEX = read('..', 'index.html');
const ROUTER = read('router.js');

test('wide.css links after glass.css and before focus.css', () => {
  const wide = INDEX.indexOf('css/wide.css');
  const glass = INDEX.indexOf('css/glass.css');
  const focus = INDEX.indexOf('css/focus.css');
  assert.ok(wide > -1, 'index.html must link css/wide.css');
  assert.ok(wide > glass && wide < focus, 'wide.css must sit between glass.css and focus.css');
});

test('every rule in wide.css is scoped under html[data-layout] (the phone is untouched by construction)', () => {
  const stripped = WIDE.replace(/\/\*[\s\S]*?\*\//g, '');
  // Walk the braces. A selector is the text before a `{`; inside an at-rule body (@keyframes,
  // @supports, @media) the nested selectors are collected too, except keyframe steps.
  const selectors = [];
  const stack = [];
  let buf = '';
  for (const ch of stripped) {
    if (ch === '{') {
      const sel = buf.trim(); buf = '';
      const inKeyframes = stack.some((s) => s.startsWith('@keyframes'));
      if (!sel.startsWith('@') && !inKeyframes) selectors.push(sel);
      stack.push(sel);
    } else if (ch === '}') { stack.pop(); buf = ''; }
    else buf += ch;
  }
  assert.ok(selectors.length > 20, `expected a real stylesheet, found ${selectors.length} rules`);
  const bad = selectors.filter((s) => !s.split(',').every((part) => /^\s*html\[data-layout/.test(part)));
  assert.deepEqual(bad, [], 'unscoped selectors in wide.css');
});

test('the tab bar publishes its column count as --n instead of an inline grid', () => {
  assert.ok(!/grid-template-columns:\s*repeat\(\$\{tabs\.length\}/.test(ROUTER), 'no inline grid on the tab bar');
  assert.ok(/style="--n:\s*\$\{tabs\.length\}"/.test(ROUTER), 'tabbar() publishes --n');
  assert.ok(/\.tabbar\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--n,\s*5\),\s*1fr\)/.test(APP), 'app.css reads --n');
});

test('the rail overrides the capsule geometry and the bottom clearance', () => {
  assert.ok(/html\[data-layout\]\s*\{[^}]*--tab-clear:/.test(WIDE), '--tab-clear is re-derived for a rail');
  assert.ok(/html\[data-layout\]\s+\.tabbar\s*\{[^}]*width:\s*var\(--rail-w\)/.test(WIDE), 'the tab bar is the rail');
  assert.ok(/html\[data-layout\]\s+\.view\s*\{[^}]*max-width:\s*720px/.test(WIDE), 'the column is capped');
  assert.ok(/html\[data-layout\]\s+body\.kb-open\s+\.tabbar\s*\{[^}]*transform:\s*none/.test(WIDE), 'the rail stays for the keyboard');
  assert.ok(/html\[data-layout\]\s+\.sheet\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/.test(WIDE), 'sheets center');
});

test('the router installs the layout tier once and repaints on a change', () => {
  assert.ok(/import \{[^}]*initLayout[^}]*\} from '\.\/layout\.js'/.test(ROUTER));
  assert.ok(/initLayout\(\(\)\s*=>/.test(ROUTER));
});

test('the two masters and four details declare their pane', () => {
  const ROSTER = read('screens', 'coach-roster.js');
  const COACH = read('screens', 'coach.js');
  assert.ok(/export const coachRoster = \{\s*nav: 'operator', tab: 'roster', pane: 'master'/.test(ROSTER), 'coachRoster is a master');
  for (const [name, pane] of [['coachInbox', 'master'], ['coachAthlete', 'detail'], ['coachMeal', 'detail'], ['coachPlan', 'detail'], ['coachAssign', 'detail']]) {
    assert.ok(new RegExp(`export const ${name} = \\{\\s*nav: 'operator', tab: '[a-z]+', pane: '${pane}'`).test(COACH), `${name} must declare pane: '${pane}'`);
  }
});

test('the router renders the master beside the detail and marks the open row', () => {
  assert.ok(/class="screen\$\{paired \? ' split' : ''\}"/.test(ROUTER), 'the split screen carries .split');
  assert.ok(/pane pane-master/.test(ROUTER) && /pane pane-detail/.test(ROUTER));
  assert.ok(/id="viewport-master"/.test(ROUTER), 'the master keeps its own scroller');
  assert.ok(/setAttribute\('aria-current', 'page'\)/.test(ROUTER), 'the open row is marked');
  assert.ok(/masterFor\(\{ mod, route, tab: NAV\.tab/.test(ROUTER), 'pairing resolves off the ORIGIN tab');
});
