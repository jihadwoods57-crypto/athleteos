/* Guards the "styled like a control ⇒ reachable like one" rule (2026-08-20).
 *
 * css/focus.css names the affordance classes and draws each one a focus ring. A ring is only
 * ever visible on an element that can HOLD focus, so every class in that list has to also be
 * promoted to a tab stop by router.js — otherwise the rule is written down, styled for, and
 * silently dead, which is exactly the state the Connected Standards editor was found in: every
 * knob on it was a click-only <span>, unreachable by keyboard, Switch Control or full keyboard
 * access, under a `.cs-seg span:focus-visible` rule that could never match.
 *
 * The failure mode this catches is drift: someone adds a class to focus.css's list (or invents a
 * new chip) and does not add it to the promotion selector, re-creating a dead ring. Two lists in
 * two files that must agree is precisely what a test is for.
 *
 * Honest about its limits: this is regex over source, not a DOM. It proves the two selector
 * lists agree; it does not prove any particular element ends up focusable at runtime. The
 * runtime half is the `cursor: pointer` check in router.js, which no static test can stand in
 * for.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const focusCss = readFileSync(join(HERE, '..', 'css', 'focus.css'), 'utf8');
const router = readFileSync(join(HERE, 'router.js'), 'utf8');

/** The class names inside focus.css's broad `:where(...):focus-visible` affordance rule.
 *
 *  Comments are stripped first and the match is anchored on the `:focus-visible` that follows
 *  the closing paren. Both matter: focus.css's own prose mentions a bare `:where()` before the
 *  rule, and the selector list contains `:not([tabindex="-1"])`, so neither "first :where(" nor
 *  "up to the first )" finds the right span. */
function focusAffordanceClasses() {
  const css = focusCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const m = css.match(/:where\(([\s\S]*?)\)\s*:focus-visible/);
  assert.ok(m, 'focus.css no longer has a :where(...):focus-visible affordance rule');
  return [...m[1].matchAll(/\.([a-z0-9-]+)/g)].map((x) => x[1]);
}

/** The class names inside router.js's keyboard-promotion querySelectorAll. */
function promotedClasses() {
  const m = router.match(/device\.querySelectorAll\(\s*\n?\s*'([^']*\.[^']*)'\s*\n?\s*\)/);
  assert.ok(m, 'router.js no longer has a class-based keyboard promotion selector');
  return [...m[1].matchAll(/\.([a-z0-9-]+)/g)].map((x) => x[1]);
}

test('every class focus.css draws a ring for is promoted to a tab stop', () => {
  const affordances = focusAffordanceClasses();
  const promoted = new Set(promotedClasses());
  // Both halves must actually have parsed something, or the comparison below passes on nothing
  // and the gate quietly stops guarding — the exact way a ratchet rots.
  assert.ok(affordances.length >= 8, `parsed only ${affordances.length} classes from focus.css`);
  assert.ok(promoted.size >= 8, `parsed only ${promoted.size} classes from router.js`);
  const missing = affordances.filter((c) => !promoted.has(c));
  assert.deepStrictEqual(
    missing, [],
    `focus.css draws a focus ring for .${missing.join(', .')} but router.js never makes `
    + 'them focusable, so that ring can never appear. Add them to the promotion selector.',
  );
});

test('the promotion keeps an author-supplied role and tabindex', () => {
  // The floor must never overwrite a screen that already did the work properly — ob2.js ships
  // role="button" + aria-pressed on its chips, and clobbering that would LOSE the pressed state.
  assert.match(router, /if \(!el\.hasAttribute\('tabindex'\)\)/);
  assert.match(router, /if \(!el\.hasAttribute\('role'\)\)/);
});

test('the promotion skips native controls, so Space cannot double-fire', () => {
  const m = router.match(/const promote = \(el\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(m, 'router.js no longer has a promote() helper');
  for (const tag of ['BUTTON', 'A', 'SUMMARY', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']) {
    assert.ok(m[0].includes(`'${tag}'`), `promote() must skip <${tag.toLowerCase()}>`);
  }
});

test('promotion wires each node once, so a re-render cannot stack keydown listeners', () => {
  // Defensive rather than a fix for a known bug: today a render replaces the subtree via
  // innerHTML, so listeners die with the old nodes. The marker means that if any screen ever
  // starts reusing nodes across renders, a knob press cannot quietly begin firing click()
  // once per render that node has survived.
  assert.match(router, /data-kb-wired/);
});
