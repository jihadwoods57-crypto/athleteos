/* STORE COPY: what the app says about money, pinned per platform (App Review pass 2026-09-23).
 *
 * The pass found the same three shapes on every plan surface:
 *   - iOS pointing at another way to buy ("set up from your account on the web"), which 3.1.1
 *     forbids and 3.1.3(c) does not excuse (G-R6, C-R2);
 *   - a price, a trial tag or a renewal sentence next to a button that opens no store: the athlete
 *     and client onboarding "Pick your plan" and the Nutrition Professional seat picker (A-R1, C-R1);
 *   - coming-soon copy ("Billing turns on at launch", "once memberships are live") (2.1).
 * And on the paywall itself, US-dollar prices in every storefront and a trial line shown to
 * Apple IDs that already used theirs (G-R7).
 *
 * The flows are RENDERED here under window.__PLATFORM = 'ios' and on the web, so a new step or a
 * reworded sub is checked as the reviewer would read it, not as the source happens to spell it.
 * Surfaces whose state is private to their module are checked on their source, comments stripped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from '../tools/strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (...p) => stripComments(readFileSync(join(HERE, ...p), 'utf8'));

/* state.js touches the DOM at module eval: the same shim claims-truth.test.mjs uses, installed
   before the dynamic imports below. */
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

const { RT } = await import('./state.js');
const { obAthlete } = await import('./screens/ob2-athlete.js');
const { obClient } = await import('./screens/ob2-client.js');
const { obCoach } = await import('./screens/ob2-coach.js');
const { obTrainer } = await import('./screens/ob2-trainer.js');
const { obDietitian } = await import('./screens/ob2-dietitian.js');
const { obNutrition } = await import('./screens/ob2-nutrition.js');
const { planUpgrade } = await import('./screens/plan-upgrade.js');
const paywallMod = await import('./screens/paywall.js');
const pricing = await import('./pricing.js');

const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const withPlatform = (p, fn) => {
  const was = window.__PLATFORM;
  window.__PLATFORM = p;
  try { return fn(); } finally { window.__PLATFORM = was; }
};

const POINTER = /on the web|your account on|set up from|managed from|onstandard\.app\/(?!terms|privacy)/i;
const LAUNCH = /at launch|once memberships|coming soon|being built/i;
const PRICE = /[$€£]\s?\d|\d+[.,]\d\d\s?\/(?:mo|yr)/;
const TRIAL = /free trial|free for \d|trial/i;
const RENEW = /renew/i;

const OPERATOR_PLANS = [['obk', obCoach], ['obt', obTrainer], ['obd', obDietitian], ['obn', obNutrition]];
const CONSUMER_PLANS = [['oba', obAthlete], ['obf', obClient]];

test('iOS: every operator plans step names no price, no trial, no place to buy, no launch date', () => {
  RT.ob = {};
  for (const [route, flow] of OPERATOR_PLANS) {
    const t = withPlatform('ios', () => text(flow.render({ sub: 'plans' })));
    assert.doesNotMatch(t, POINTER, `${route}/plans points iOS somewhere else to buy: ${t}`);
    assert.doesNotMatch(t, LAUNCH, `${route}/plans carries coming-soon copy: ${t}`);
    assert.doesNotMatch(t, PRICE, `${route}/plans prints a price on iOS with no store behind it: ${t}`);
    assert.doesNotMatch(t, TRIAL, `${route}/plans promises a trial on iOS: ${t}`);
    assert.doesNotMatch(t, /no card/i, `${route}/plans talks about a card on iOS, where none is ever asked for: ${t}`);
    assert.match(t, /Team plans aren’t sold in the app\./, `${route}/plans should state the one iOS sentence: ${t}`);
  }
});

test('web: operator plans keep their ladder, and none says billing turns on at launch', () => {
  RT.ob = {};
  for (const [route, flow] of OPERATOR_PLANS) {
    const t = withPlatform(undefined, () => text(flow.render({ sub: 'plans' })));
    assert.match(t, PRICE, `${route}/plans on the web should still show its plans`);
    assert.doesNotMatch(t, LAUNCH, `${route}/plans carries coming-soon copy: ${t}`);
  }
});

test('athlete and client onboarding end on a start step that sells nothing, on every platform', () => {
  RT.ob = {};
  for (const platform of ['ios', 'android', undefined]) {
    for (const [route, flow] of CONSUMER_PLANS) {
      const t = withPlatform(platform, () => text(flow.render({ sub: 'plans' })));
      const where = `${route}/plans on ${platform || 'web'}`;
      assert.doesNotMatch(t, PRICE, `${where} prints a price next to a button that opens no store: ${t}`);
      assert.doesNotMatch(t, TRIAL, `${where} promises a trial nothing starts: ${t}`);
      assert.doesNotMatch(t, RENEW, `${where} carries a renewal sentence with no subscription behind it: ${t}`);
      assert.doesNotMatch(t, /save \d+%|no card/i, `${where} still reads like a checkout: ${t}`);
      assert.match(t, /Start free/, `${where} should offer the free start`);
      assert.ok(t.includes(pricing.MEMBERSHIP_ADDS), `${where} should say what membership adds, in the one sentence`);
    }
  }
});

test('no operator flow carries the placeholder testimonial step', () => {
  for (const f of ['ob2-coach.js', 'ob2-trainer.js', 'ob2-dietitian.js', 'ob2-nutrition.js']) {
    const src = code('screens', f);
    assert.doesNotMatch(src, /id: 'proof'/, `${f} still has a proof step`);
    assert.doesNotMatch(src, /testimonial\(|Illustrative, not actual customers/, `${f} still renders invented testimonials`);
  }
});

test('the Nutrition Professional door has the 18+ date-of-birth gate the other three have', () => {
  RT.ob = {};
  const t = obNutrition.render({ sub: 'dob' });
  assert.match(t, /id="ob-dob-y"/, 'obn/dob should render the birth-date fields');
  assert.match(text(t), /Nutrition professional accounts are for adults/);
  const blocked = text(obNutrition.render({ sub: 'blocked' }));
  assert.doesNotMatch(blocked, /Birth year/, 'obn/blocked should be the blocked screen, not a fallback');
});

test('a failed team creation offers Try again and the dashboard, never "Pick a plan"', () => {
  for (const [route, flow] of [['obk', obCoach], ['obd', obDietitian]]) {
    RT.ob = { coach: { teamName: 'Varsity' } };
    for (const platform of ['ios', undefined]) {
      const html = withPlatform(platform, () => flow.render({ sub: 'code' }));
      const t = text(html);
      assert.doesNotMatch(t, /Pick a plan/i, `${route}/code sends the coach to a plan: ${t}`);
      assert.match(html, new RegExp(`id="${route}-team-retry"`), `${route}/code should offer Try again`);
      assert.match(html, /data-go="coach-home"/, `${route}/code should open the dashboard`);
    }
  }
  // The dashboard really has the button the copy names.
  assert.match(code('screens', 'coach-home.js'), /id="coach-team-create"[^>]*>\$\{icon\('users', 16\)\} Create team/);
});

test('iOS plan screen: no place to buy, no price', () => {
  RT.ob = {}; RT.authRole = 'coach'; RT.planWall = 'Assigning';
  const t = withPlatform('ios', () => text(planUpgrade.render()));
  assert.doesNotMatch(t, POINTER, t);
  assert.doesNotMatch(t, PRICE, t);
  assert.match(t, /Team plans aren’t sold in the app\./);
  assert.match(t, /If your program has a plan, it shows here\./);
});

test('no plan or billing surface points iOS elsewhere or promises a launch', () => {
  const files = ['store-policy.js', 'ob2.js', 'pricing.js', 'screens/plan-upgrade.js', 'screens/paywall.js',
    'screens/monthly-report.js', 'screens/coach-home.js', 'screens/settings.js',
    ...readdirSync(join(HERE, 'screens')).filter((f) => /^ob2-.*\.js$/.test(f) && !f.includes('test')).map((f) => `screens/${f}`)];
  for (const f of files) {
    const src = code(...f.split('/'));
    assert.doesNotMatch(src, /your account on the web|set up from your account|Managed from your account/i, `${f} points to the web`);
    assert.doesNotMatch(src, /turns on at launch|once memberships are live/i, `${f} carries coming-soon copy`);
  }
});

/* ---- the paywall prints the store's own numbers ------------------------------------------- */

const EUR = {
  onstandard_individual_annual: { priceString: '219,99 €', price: 219.99, currencyCode: 'EUR', pricePerMonthString: '18,33 €', trial: { count: 2, unit: 'WEEK' }, trialEligible: true },
  onstandard_individual_monthly: { priceString: '21,99 €', price: 21.99, currencyCode: 'EUR', pricePerMonthString: '21,99 €', trial: { count: 2, unit: 'WEEK' }, trialEligible: true },
  onstandard_family_annual: { priceString: '269,99 €', price: 269.99, currencyCode: 'EUR', pricePerMonthString: '22,50 €', trial: null, trialEligible: null },
  onstandard_family_monthly: { priceString: '26,99 €', price: 26.99, currencyCode: 'EUR', pricePerMonthString: '26,99 €', trial: null, trialEligible: null },
};

test('quote(): the store string when the store answered, the catalog when it did not', () => {
  const ind = pricing.planById('individual');
  const store = pricing.quote(ind, 'annual', EUR);
  assert.equal(store.amount, '219,99 €');
  assert.equal(store.perMonth, '18,33 €');
  assert.equal(store.trial, '2 weeks');
  assert.equal(store.fromStore, true);
  const cat = pricing.quote(ind, 'annual', null);          // no store at all: the catalog describes the plan
  assert.equal(cat.amount, '$199.99');
  assert.equal(cat.trial, '14 days');
  assert.equal(cat.fromStore, false);
  assert.equal(store.saving, null, 'the store saving is not formatted in the WebView locale (review Minor 3)');
  assert.equal(pricing.savePercent(ind, EUR), Math.round(((21.99 * 12 - 219.99) / (21.99 * 12)) * 100));
  assert.equal(pricing.savePercent(ind, null), 17);
});

test('quote(): no trial line unless the store says THIS account is eligible', () => {
  const ind = pricing.planById('individual');
  for (const trialEligible of [false, null, undefined]) {
    const offers = { onstandard_individual_annual: { ...EUR.onstandard_individual_annual, trialEligible } };
    assert.equal(pricing.quote(ind, 'annual', offers).trial, '', `eligibility ${trialEligible} must print no trial`);
    assert.doesNotMatch(pricing.disclosure(ind, 'annual', offers), /free/i);
  }
});

test('quote(): a live store with no price for this product claims no trial (review I1)', () => {
  const ind = pricing.planById('individual');
  for (const offers of [null, {}, { onstandard_family_annual: EUR.onstandard_family_annual }]) {
    const qt = pricing.quote(ind, 'annual', offers, { storeLive: true });
    assert.equal(qt.trial, '', 'nothing says this buyer is eligible, so no trial is claimed');
    const d = pricing.disclosure(ind, 'annual', offers, { storeLive: true });
    assert.doesNotMatch(d, /free/i);
    assert.match(d, /Shown in US dollars; your price in .* shows before you confirm\./);
  }
});

test('paywall on iOS with a live store: localized prices, the trial only when eligible', () => {
  const UI = paywallMod.paywallState;
  const render = () => withPlatform('ios', () => paywallMod.default.render());
  Object.assign(UI, { iapReady: true, offers: EUR, offersFor: RT.userId || null, cadence: 'annual', planId: 'individual', status: null, busy: false });
  let html = render();
  assert.match(html, /219,99 €/);
  assert.doesNotMatch(html, /\$199\.99|\$19\.99/, 'a store answer must replace every catalog dollar');
  assert.match(text(html), /Try it free for 2 weeks/);
  assert.match(text(html), /No charge today\./);
  assert.match(text(html), /Terms of Service/);
  assert.match(html, /id="pw-restore"/);

  UI.planId = 'family';                         // no trial on this product
  html = render();
  assert.doesNotMatch(text(html), /Try it free|No charge today/, 'a product with no trial must not promise one');
  assert.match(text(html), /Subscribe to Family/);

  UI.planId = 'individual';
  UI.offers = { ...EUR, onstandard_individual_annual: { ...EUR.onstandard_individual_annual, trialEligible: false } };
  html = render();
  assert.doesNotMatch(text(html), /Try it free|No charge today/, 'an Apple ID that used its trial is charged on confirm');

  // Store up, but the price read failed or timed out (review I1): the catalog amount stands, with
  // a line saying it is US dollars, and NO trial and no "No charge today".
  UI.offers = null;
  html = render();
  assert.match(html, /\$199\.99/);
  assert.doesNotMatch(text(html), /Try it free|No charge today|Free for/, 'no store answer means no trial claim');
  assert.match(text(html), /Subscribe to Individual/);
  assert.match(text(html), /Shown in US dollars/);

  // Store up, and one product missing from the offerings: the missing plan gets no trial either.
  UI.offers = { onstandard_family_annual: EUR.onstandard_family_annual, onstandard_family_monthly: EUR.onstandard_family_monthly };
  html = render();
  assert.doesNotMatch(text(html), /Try it free|No charge today|Free for/, 'a product the store left out claims no trial');
  assert.match(text(html), /Subscribe to Individual/);

  UI.iapReady = false;                          // old binary: update, never a dead paywall
  html = render();
  assert.match(text(html), /Update OnStandard to join/);
  assert.doesNotMatch(html, PRICE);
  Object.assign(UI, { iapReady: null, offers: null });
});

test('store answers do not survive a change of account (review Minor 10)', () => {
  const UI = paywallMod.paywallState;
  const was = RT.userId;
  Object.assign(UI, { iapReady: true, offers: EUR, offersFor: 'someone-else', planId: 'individual', cadence: 'annual' });
  RT.userId = 'me';
  const html = withPlatform('ios', () => paywallMod.default.render());
  assert.equal(UI.offers, null);
  assert.equal(UI.iapReady, null, 'the probe runs again for the new account');
  assert.doesNotMatch(text(html), /Try it free|219,99/);
  RT.userId = was;
  Object.assign(UI, { iapReady: null, offers: null, offersFor: null });
});

test('the plan-gated verified-profile copy only renders behind its own flag (review Minor 9)', () => {
  /* FREE_KEEPS says the recruiting card is free, which is true while
     VERIFIED_PROFILE_REQUIRES_PLAN is unset. The one screen that says otherwise must stay behind
     that flag; if it is ever flipped, pricing.js's sentences change in the same change. */
  const src = code('screens', 'verified-profile.js');
  const i = src.indexOf('rides with the Individual plan');
  assert.ok(i > 0);
  assert.match(src.slice(Math.max(0, i - 200), i), /if \(st\.requiresPlan && !st\.paid\)/);
  assert.match(pricing.FREE_KEEPS, /recruiting card/);
});

/* ---- one sentence for what membership buys, one name for the Terms --------------------------- */

test('what membership adds is stated once and used, and no screen sells a free feature', () => {
  for (const f of ['screens/paywall.js', 'screens/settings.js', 'screens/monthly-report.js', 'ob2.js']) {
    const src = code(...f.split('/'));
    assert.match(src, /ENTITLEMENT_LINE|MEMBERSHIP_ADDS/, `${f} should render the entitlement sentence from pricing.js`);
    assert.doesNotMatch(src, /written coaching|opens everything/i, `${f} describes membership in its own words`);
  }
  assert.doesNotMatch(code('screens', 'paywall.js'), /Deep Dive/, 'Deep Dive is not gated, so a member is not sold it');
});

test('the Terms document has one name, the page title at onstandard.app/terms', () => {
  const title = readFileSync(join(HERE, '..', '..', '..', 'web', 'landing', 'terms.html'), 'utf8').match(/<h1>([^<]+)<\/h1>/)[1];
  assert.equal(title, 'Terms of Service');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.js') && !d.name.includes('.test.') ? [join(dir, d.name)] : []));
  for (const f of walk(HERE)) {
    const raw = readFileSync(f, 'utf8');
    if (!/Terms of Use|Terms and conditions/i.test(raw)) continue;   // cheap pass before the strip
    const src = stripComments(raw);
    assert.doesNotMatch(src, /Terms of Use|Terms and conditions/i, `${f} names the Terms something other than "${title}"`);
  }
});

test('the store is named by the one helper, never guessed from the user agent', () => {
  for (const f of ['screens/settings.js', 'screens/ob2-athlete.js', 'screens/paywall.js']) {
    assert.doesNotMatch(code(...f.split('/')), /navigator\.userAgent/, `${f} guesses the store from the user agent`);
  }
  withPlatform('ios', () => assert.equal(pricing.storeName(), 'the App Store'));
  withPlatform('android', () => assert.equal(pricing.storeSubscriptionsUrl(), 'https://play.google.com/store/account/subscriptions'));
  withPlatform('ios', () => assert.equal(pricing.restoreUnavailableLine(), 'Update OnStandard to restore purchases.'));
});
