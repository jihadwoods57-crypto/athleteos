/* CLAIMS THE APP MAKES ABOUT ITSELF, checked against the code that has to honour them.
 *
 * Founder audit, 2026-09-14: "find inconsistencies, redundancy and stuff that's not true". Three of
 * the four things found were a number or a promise typed by hand next to a helper that already
 * computed it correctly. Nothing failed, because nothing was comparing the two.
 *
 *   1. THE TRIAL. Consumer and Stripe trials were unified to 14 days on 2026-09-08 and the catalog
 *      says trialDays: 14. The athlete purchase screen still read "Free for 7 days" — under a plan
 *      card that said "14-day free trial", in the sentence that exists to satisfy FTC auto-renewal
 *      disclosure. One screen, two trial lengths, at the moment of purchase.
 *
 *   2. WHERE YOU CANCEL. That same fine print said "Cancel anytime in Settings". Consumer plans are
 *      store-managed IAP and settings.js says so out loud: "we never render a cancel button we
 *      can't honor". You cannot cancel in Settings; Settings deep-links you to the store.
 *
 *   3. WHAT A PLAN INCLUDES. Professional was sold as "Priority support." to a trainer and "plus
 *      team collaboration seats." to a dietitian. Neither exists: no support tier appears anywhere
 *      in this repo, and staff seats are a team feature the program carries for free. Solo and
 *      Professional differ by included seats and nothing else.
 *
 * These are cheap structural checks. They are here because a wrong number on a purchase screen is
 * not a typo, and because the comments warning about each of these were already in the files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONSUMER_PLANS } from './pricing.js';
import { stripComments } from '../tools/strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, ...p), 'utf8');

/* ob2.js reaches state.js, which touches the DOM at module eval. Same shim as
   nutrition-chat-live.test.mjs / roll-call-resolve.test.mjs; the dynamic import below is what
   lets the globals land BEFORE that eval runs. */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = globalThis.window.location;

const { PLANS } = await import('./ob2.js');

/* ---- 1. the trial length is stated once, by the catalog ------------------------------------- */

test('every consumer plan carries the same trial length', () => {
  const lengths = [...new Set(CONSUMER_PLANS.map((p) => p.trialDays))];
  assert.equal(lengths.length, 1, `consumer plans disagree on the trial length: ${lengths.join(', ')}`);
  assert.ok(lengths[0] > 0, 'a trial length of 0 would make every "free for N days" claim false');
});

test('no shipped screen hardcodes a trial length that disagrees with the catalog', () => {
  const trial = CONSUMER_PLANS[0].trialDays;
  const files = ['screens/ob2-athlete.js', 'screens/paywall.js', 'screens/ob2-coach.js',
    'screens/ob2-trainer.js', 'screens/ob2-nutrition.js', 'screens/ob2-dietitian.js',
    'screens/ob2-client.js', 'screens/settings.js', 'ob2.js', 'pricing.js'];
  for (const f of files) {
    // Comments are not copy: the files that were fixed carry a note quoting the wrong number,
    // and a lint that cannot tell those apart teaches people to delete the explanation.
    const src = stripComments(read(...f.split('/')));
    for (const m of src.matchAll(/(?:Free for|free for)\s+(\d+)\s+days|(\d+)[- ]day free trial/g)) {
      const n = Number(m[1] ?? m[2]);
      assert.equal(n, trial,
        `${f} states a ${n}-day trial; the catalog says ${trial}. State it from CONSUMER_PLANS, never by hand.`);
    }
  }
});

/* ---- 2. cancellation points at the rail that can actually honour it -------------------------- */

test('the purchase-step fine print does not promise an in-app cancel we cannot honour', () => {
  const src = stripComments(read('screens', 'ob2-athlete.js'));
  assert.doesNotMatch(src, /Cancel anytime in Settings/i,
    'consumer plans are store-managed IAP; settings.js deep-links to the store rather than '
    + 'rendering a cancel button, so promising one in Settings is a promise the app cannot keep');
  assert.match(src, /Cancel anytime in the \$\{storeName\}/,
    'the fine print should name the store that actually holds the subscription');
});

/* ---- 3. one plan, one set of promises -------------------------------------------------------- */

test('a plan sold to two audiences promises the same things to both', () => {
  // The subtitle is where audience tailoring lives, but a capability named to one audience and not
  // the other is a different plan wearing the same price.
  const CAPABILITY = /priority support|collaboration seat|staff seat|white[- ]label|\bSSO\b|\bAPI\b/i;
  const byId = new Map();
  for (const audience of ['pro', 'seat', 'org', 'individual']) {
    for (const p of PLANS[audience] || []) {
      if (!byId.has(p.id)) byId.set(p.id, []);
      byId.get(p.id).push({ audience, sub: p.sub });
    }
  }
  for (const [id, rows] of byId) {
    if (rows.length < 2) continue;
    const claims = rows.map((r) => ({ ...r, hit: (r.sub.match(CAPABILITY) || []).map((x) => x.toLowerCase()).sort().join(',') }));
    const distinct = [...new Set(claims.map((c) => c.hit))];
    assert.equal(distinct.length, 1,
      `plan "${id}" names different capabilities to different audiences:\n`
      + claims.map((c) => `   [${c.audience}] ${c.sub}`).join('\n'));
  }
});

test('no plan advertises a support tier, because the product has none', () => {
  const subs = Object.values(PLANS).flat().map((p) => p.sub || '');
  for (const sub of subs) {
    assert.doesNotMatch(sub, /priority support/i,
      'nothing in this repo implements a support tier; selling one is a promise with no owner');
  }
});
