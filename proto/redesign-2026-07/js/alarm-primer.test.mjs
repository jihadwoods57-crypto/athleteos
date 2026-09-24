/* The once-per-account alarm primer. Run: node --test proto/redesign-2026-07/js/alarm-primer.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldOfferAlarmPrimer, alarmPrimerHtml, AP_TITLE, AP_BODY } from './alarm-primer.js';

const st = { supported: true, authorization: 'notDetermined' };

test('offered once per account, only where a phone can ring and was never asked', () => {
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: st, onTeam: true }), true);
  assert.equal(shouldOfferAlarmPrimer({ answered: true, state: st, onTeam: true }), false, 'Not now is remembered');
  assert.equal(shouldOfferAlarmPrimer({ answered: true, state: st, onTeam: true, force: true }), true, 'the card may ask again');
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: { ...st, authorization: 'authorized' }, onTeam: true }), false);
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: { ...st, authorization: 'denied' }, onTeam: true }), false);
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: { ...st, supported: false }, onTeam: true }), false);
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: st, onTeam: false }), false);
  assert.equal(shouldOfferAlarmPrimer({ answered: false, state: null, onTeam: true }), false);
});

test('an unknown answer (the read failed) never asks: a Not now must not come back offline', () => {
  assert.equal(shouldOfferAlarmPrimer({ answered: null, state: st, onTeam: true }), false);
  assert.equal(shouldOfferAlarmPrimer({ answered: null, state: st, onTeam: true, force: true }), true);
});

test('Continue and Not now, never Allow, and it says what happens', () => {
  const h = alarmPrimerHtml();
  assert.equal(AP_TITLE, 'Let your coach set your wake-up alarm');
  assert.match(h, />Continue</);
  assert.match(h, />Not now</);
  assert.doesNotMatch(h, /allow/i);
  assert.match(h, /real alarm/);
  assert.match(h, /silent mode/);
  assert.match(h, /one tap checks you in/);
  assert.doesNotMatch(h, /—/);
});

/* The device spike failed (2026-09-24): the APP sets the alarm when it opens, nothing sets it the
   moment the coach assigns it. The primer must not promise otherwise. */
test('the copy is true on the fallback: the app sets it, not the coach the moment they assign', () => {
  assert.match(AP_BODY, /OnStandard sets/);
  assert.doesNotMatch(AP_BODY, /automatic|the moment|instantly|right away/i);
  assert.doesNotMatch(AP_BODY, /tap Continue|choose|select|pick/i, 'never says which answer to pick (5.1.1(iv))');
});

test('one primer at a time on Home: the alarm question first, the notification one only if it did not show', () => {
  const src = readFileSync(new URL('./alarm-primer.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!shown\) await mountRollcallPrimer\(slot, rows\)/);
  const home = readFileSync(new URL('./screens/home.js', import.meta.url), 'utf8');
  assert.match(home, /AP\.mountPrimers\(slot, VC\.mine, S\.coach\.kind === 'coach'\)/);
  const connect = readFileSync(new URL('./screens/connect.js', import.meta.url), 'utf8');
  assert.match(connect, /AP\.mountAlarmPrimer\(apSlot, \{ onTeam: true \}\)/);
});
