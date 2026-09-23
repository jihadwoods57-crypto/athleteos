/* The location check-in screen, restored (final fix round, item 2, 2026-09-23).
 *
 * Restored from 8e7506bb^ and adapted: Apple's two steps in order (While Using, then Always, only
 * after and only where walk-in may run), declining Always leaves "I'm here" working, a No sends
 * the athlete to Settings, an old binary says "Update OnStandard", and the copy no longer makes
 * the two claims the product stopped being able to keep.
 *
 * Run: node --test proto/redesign-2026-07/js/location-consent.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const JS = dirname(fileURLToPath(import.meta.url));
const { consentActionHtml } = await import('./screens/location-consent.js');

const base = { capable: true, state: 'undetermined', walkIn: true, consent: true, consentAsked: true, optedOut: false, walkInStatus: null };

test('never asked: While Using first, and Always is not mentioned yet', () => {
  const h = consentActionHtml(base);
  assert.match(h, /id="lc-allow"/);
  assert.match(h, /Allow While Using App/);
  assert.doesNotMatch(h, /lc-always/);
});

test('While Using granted: Always is offered, and declining it changes nothing for I’m here', () => {
  const h = consentActionHtml({ ...base, state: 'when_in_use' });
  assert.match(h, /I’m here is on/);
  assert.match(h, /id="lc-always"/);
  assert.match(h, /Rather not\? I’m here works the same/);
});

test('walk-in switched off (WALK_IN): no Always offer at all', () => {
  assert.doesNotMatch(consentActionHtml({ ...base, state: 'when_in_use', walkIn: false }), /lc-always/);
});

test('Always on: an off switch; an arm the OS refused says so', () => {
  assert.match(consentActionHtml({ ...base, state: 'always' }), /id="lc-off"/);
  const refused = consentActionHtml({ ...base, state: 'always', walkInStatus: 'unavailable' });
  assert.match(refused, /isn’t working on this phone/);
  assert.doesNotMatch(refused, /Walk-in check-in is on/);
});

test('after a No: the Settings route, never a prompt that will not come back', () => {
  const h = consentActionHtml({ ...base, state: 'denied' });
  assert.match(h, /id="lc-settings"/);
  assert.match(h, /While Using the App/);
  assert.doesNotMatch(h, /lc-allow/);
});

test('an old binary says Update OnStandard; a minor without consent never reaches the prompt', () => {
  assert.match(consentActionHtml({ ...base, capable: false }), /Update OnStandard to check in by location/);
  const minor = consentActionHtml({ ...base, consent: false });
  assert.match(minor, /parent or guardian/);
  assert.doesNotMatch(minor, /lc-allow|lc-always/);
});

test('the copy tells the truth about what the product does now', () => {
  const src = readFileSync(join(JS, 'screens', 'location-consent.js'), 'utf8');
  assert.doesNotMatch(src, /No coordinates leave your phone/, 'one reading goes to the server since 0242');
  assert.doesNotMatch(src, /no way for other athletes/, 'teammates see Arrived / Not arrived on the board');
  assert.match(src, /Nobody sees where you are\. Only you see how far away you were\./);
  const idx = readFileSync(join(JS, 'screens', 'index.js'), 'utf8');
  assert.match(idx, /'location-consent': lazy\(\(\) => import\('\.\/location-consent\.js'\)\)/);
  assert.match(readFileSync(join(JS, 'screens', 'profile.js'), 'utf8'), /row\('location-consent'/);
});

test('after "Keep Only While Using" the screen offers Settings, never a button that asks again (m1)', () => {
  const h = consentActionHtml({ ...base, state: 'when_in_use', refused: true });
  assert.doesNotMatch(h, /id="lc-always"/);
  assert.match(h, /id="lc-settings"/);
  assert.match(h, /choose Always/);
});
