/* Liquid Glass chrome (css/glass.css) keeps the promises DESIGN.md makes about blur: chrome only,
 * a documented no-support fallback, and a way out for people who asked the OS for less
 * transparency or less motion. Regex over sources, in the manner of depill.test.mjs. Run:
 *   node --test proto/redesign-2026-07/js/glass.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');
const GLASS = read('..', 'css', 'glass.css');
const INDEX = read('..', 'index.html');
const ROUTER = read('router.js');
const DESIGN = read('..', '..', '..', 'DESIGN.md');

test('the glass layer is linked after the app styles and before the focus layer', () => {
  const glass = INDEX.indexOf('css/glass.css');
  const app = INDEX.indexOf('css/app.css');
  const focus = INDEX.indexOf('css/focus.css');
  assert.ok(glass > -1, 'index.html must link css/glass.css');
  assert.ok(glass > app && glass < focus, 'glass.css must sit between app.css and focus.css');
});

test('blur is gated on support, with the opaque ramp as the fallback', () => {
  assert.ok(/@supports\s*\(backdrop-filter/.test(GLASS), 'backdrop-filter must sit inside @supports');
});

test('reduced transparency and reduced motion are both honoured', () => {
  assert.ok(/prefers-reduced-transparency:\s*reduce/.test(GLASS));
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(GLASS));
});

test('the tab bar floats as a capsule and carries a lens the router positions', () => {
  assert.ok(/tab-lens/.test(ROUTER), 'router.js tabbar() must render .tab-lens');
  assert.ok(/tab-lens at-\$\{/.test(ROUTER), 'the lens column must be published as an at-N class');
  assert.ok(/\.tab-lens\.at-4\s*\{\s*--i:\s*4/.test(GLASS), 'glass.css maps at-N to --i for all five columns');
  assert.ok(/\.tab-lens\s*\{/.test(GLASS));
});

test('the design doc records the Liquid Glass amendment, chrome only', () => {
  assert.ok(/Liquid Glass/.test(DESIGN), 'DESIGN.md must document the Liquid Glass chrome amendment');
});

test('glass never paints ::after (focus.css owns it as the 44px touch target)', () => {
  const rules = GLASS.replace(/\/\*[\s\S]*?\*\//g, '');   // comments may name it; rules may not
  assert.ok(!/::after/.test(rules), 'use ::before for the specular rim; focus.css owns ::after');
});
