/* No control that leads to an OS permission prompt says "Allow" (review pass 2026-09-23, G-L6).
 *
 * App Review rejected build 33 under 5.1.1(iv) for a camera primer whose button read "Allow
 * camera", and named Continue or Next as the acceptable labels. The location primers repeated the
 * pattern three times and added footers telling the athlete which answer to choose. This suite
 * holds the rule for every primer the app has: camera, location (both steps), notifications,
 * alarms, the microphone, and the AI consent sheet, which is not an OS prompt but asks the same
 * kind of question.
 *
 * Two layers: the pure renderers in every state, and a source sweep so a NEW <button> that leads
 * to a prompt cannot say Allow either.
 *
 * Run: node --test proto/redesign-2026-07/js/permission-primers.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const JS = dirname(fileURLToPath(import.meta.url));

const ALLOW = /\bAllow\b/;
/** The visible text of every <button> in an HTML string. */
const buttonTexts = (html) => [...String(html).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());

test('location primers, every state: Continue, never Allow, no "Choose" coaching', async () => {
  const { consentActionHtml } = await import('./screens/location-consent.js');
  const L = await import('./location.js');
  const base = { capable: true, walkIn: true, consent: true, consentAsked: true, optedOut: false, walkInStatus: null };
  const states = ['undetermined', 'when_in_use', 'always', 'denied'];
  const htmls = [];
  for (const state of states) {
    htmls.push(consentActionHtml({ ...base, state }));
    htmls.push(consentActionHtml({ ...base, state, refused: true }));
    for (const wiuDeclined of [false, true]) {
      htmls.push(L.locationAskHtml({ place: 'the gym', state, walkIn: true, wiuDeclined }));
    }
  }
  for (const h of htmls) {
    for (const t of buttonTexts(h)) assert.doesNotMatch(t, ALLOW, `button "${t}"`);
    assert.doesNotMatch(h, /Choose Allow|Choose Change to Always Allow|Allow While Using App/);
  }
  // The two buttons that open the OS prompt say exactly Continue.
  assert.match(consentActionHtml({ ...base, state: 'undetermined' }), /id="lc-allow"[^>]*>[\s\S]*?Continue<\/button>/);
  assert.match(L.locationAskHtml({ place: 'x', state: 'undetermined', walkIn: true }), /data-loc-allow>Continue<\/button>/);
  assert.match(L.locationAskHtml({ place: 'x', state: 'when_in_use', walkIn: true }), /data-loc-always>Continue<\/button>/);
});

test('the notifications primer: Continue, Not now, never Allow; only while never asked', async () => {
  const N = await import('./notify-permission.js');
  for (const context of ['rollcall', 'settings']) {
    const h = N.notifyPrimerHtml({ perm: 'undetermined', context, later: false });
    assert.match(h, /data-np-go>Continue<\/button>/);
    for (const t of buttonTexts(h)) assert.doesNotMatch(t, ALLOW);
    assert.equal(N.notifyPrimerHtml({ perm: 'granted', context }), '');
    assert.equal(N.notifyPrimerHtml({ perm: 'denied', context }), '');
    assert.equal(N.notifyPrimerHtml({ perm: null, context }), '');
  }
  assert.match(N.notifyPrimerHtml({ perm: 'undetermined', context: 'rollcall', later: false }), /data-np-later>Not now/);
  assert.equal(N.notifyPrimerHtml({ perm: 'undetermined', context: 'rollcall', later: true }), '', 'Not now is remembered');
});

test('the AI consent sheet: Continue and Not now', async () => {
  const { aiConsentSheetHtml } = await import('./ai-consent.js');
  for (const role of ['athlete', 'coach']) {
    const t = buttonTexts(aiConsentSheetHtml(role));
    assert.deepEqual(t, ['Continue', 'Not now']);
  }
});

test('camera, alarm and microphone controls in source never say Allow', () => {
  const cam = readFileSync(join(JS, 'screens', 'camera.js'), 'utf8');
  assert.match(cam, /data-act="primeCamera" data-then="camera">Continue<\/button>/);
  const rc = readFileSync(join(JS, 'screens', 'roll-call.js'), 'utf8');
  assert.match(rc, /id="wk-alarm-go">Continue<\/button>/, 'the alarm is asked from a Continue');
  const cmp = readFileSync(join(JS, 'components.js'), 'utf8');
  assert.match(cmp, /class="cmp-mic" aria-label="Dictate a message"/, 'the mic asks on tap, labelled for what it does');
});

test('sweep: no <button> anywhere in the shipped proto reads Allow', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'vendor') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(JS);
  const hits = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const t of buttonTexts(src)) if (ALLOW.test(t)) hits.push(`${f.slice(JS.length + 1)}: ${t}`);
    for (const m of src.matchAll(/aria-label="([^"]*)"/g)) if (ALLOW.test(m[1])) hits.push(`${f.slice(JS.length + 1)}: aria-label ${m[1]}`);
  }
  assert.deepEqual(hits, []);
});
