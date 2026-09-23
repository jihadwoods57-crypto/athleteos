/* The age gate, end to end on the client (review pass 2026-09-23: G-R5, A-B5, A-B6, A Polish 4,
 * C Polish 7, A-M7).
 *
 *   - one age rule (ageBand), mirroring the server: under 13 refused, 13-17 a minor, unknown never
 *     a minor;
 *   - a new Apple/Google identity from Sign-in never lands on Home: it is signed back out and sent
 *     to pick a role, where the DOB step comes first;
 *   - a signed-in athlete the server holds no age for is routed to #age-check, and only on a
 *     confirmed "no age";
 *   - 13 to 17 hear "You'll need a parent's OK" right after the DOB step;
 *   - the blocked screens have no way back to retype the year;
 *   - the social block shows only with Sign in with Apple, and Google only beside it (4.8).
 *
 * Run: node --test proto/redesign-2026-07/js/age-gate.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const JS = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(JS, p), 'utf8');
const { ageBand, AGE_FLOOR, ADULT_AGE } = await import('./ob-helpers.js');
const { ageGuardRoute } = await import('./router.js');
const { socialButtons, isNewIdentity, isFreshUser, accountStepDecision } = await import('./social-auth.js');

test('ageBand: the one rule, the server’s numbers', () => {
  assert.equal(AGE_FLOOR, 13);
  assert.equal(ADULT_AGE, 18);
  const today = '2026-09-23';
  assert.equal(ageBand('2014-09-24', today), 'under13', 'a day short of 12');
  assert.equal(ageBand('2013-09-24', today), 'under13', 'a day short of 13');
  assert.equal(ageBand('2013-09-23', today), 'minor', '13 today');
  assert.equal(ageBand('2008-09-24', today), 'minor', 'a day short of 18');
  assert.equal(ageBand('2008-09-23', today), 'adult', '18 today');
  assert.equal(ageBand(null, today), null, 'unknown is never a minor');
  assert.equal(ageBand('2030-01-01', today), null, 'a future date is not an age');
});

test('no second copy of the age rule in the DOB screens', () => {
  for (const p of ['screens/ob2-athlete.js', 'ob2.js', 'screens/age-check.js']) {
    const s = src(p);
    assert.match(s, /ageBand\(/, `${p} asks ageBand`);
    assert.doesNotMatch(s, /ageOn\([^)]*\)\s*<\s*1[38]/, `${p} compares an age itself`);
  }
});

test('the age guard routes only a CONFIRMED missing age, only for athletes', () => {
  const athlete = { userId: 'u', authRole: 'athlete', ageKnown: false };
  assert.equal(ageGuardRoute('home', athlete), 'age-check');
  assert.equal(ageGuardRoute('camera', athlete), 'age-check');
  assert.equal(ageGuardRoute('home', { ...athlete, ageKnown: null }), false, 'unknown never routes');
  assert.equal(ageGuardRoute('home', { ...athlete, ageKnown: true }), false);
  assert.equal(ageGuardRoute('home', { ...athlete, authRole: 'coach' }), false);
  assert.equal(ageGuardRoute('home', { ...athlete, userId: null }), false);
  for (const open of ['age-check', 'guardian', 'terms', 'privacy', 'oba', 'signin', 'welcome', 'delete-account']) {
    assert.equal(ageGuardRoute(open, athlete), false, `${open} stays reachable`);
  }
  assert.match(src('router.js'), /if \(ageGuardRoute\(route\)\) \{ location\.hash = '#age-check'; return; \}/);
  assert.match(src('screens/index.js'), /'age-check': lazy\(\(\) => import\('\.\/age-check\.js'\)\)/);
});

/* I2: primary_role is NOT NULL DEFAULT 'athlete', so it can never mark a new account. The real
   signal is "never onboarded (no terms accepted) and created just now". */
test('isNewIdentity: the real signal, not primary_role', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');
  const fresh = { created_at: '2026-09-23T11:59:50Z' };
  const old = { created_at: '2026-01-02T10:00:00Z' };
  // A brand-new Apple account reads back primary_role 'athlete' from handle_new_user: still new.
  assert.equal(isNewIdentity(fresh, { primary_role: 'athlete', tos_accepted_at: null }, now), true);
  assert.equal(isNewIdentity(fresh, { primary_role: 'athlete', tos_accepted_at: '2026-09-23T11:59:55Z' }, now), false);
  assert.equal(isNewIdentity(old, { primary_role: 'athlete', tos_accepted_at: null }, now), false);
  assert.equal(isNewIdentity({}, null, now), false);
  assert.equal(isFreshUser(fresh, now), true);
});

test('account step: a new identity keeps the chosen role and saves; nobody is ever re-roled', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');
  const fresh = { created_at: '2026-09-23T11:59:50Z' };
  const old = { created_at: '2026-01-02T10:00:00Z' };
  // Path 1: brand new, coach flow. handle_new_user said 'athlete'; the flow's role wins.
  assert.equal(accountStepDecision({ user: fresh, prof: { primary_role: 'athlete', tos_accepted_at: null }, role: 'coach', nowMs: now }), 'adopt');
  // Path 2: an existing, onboarded coach tapping Apple in the ATHLETE flow goes home as a coach.
  assert.equal(accountStepDecision({ user: old, prof: { primary_role: 'coach', tos_accepted_at: 'x' }, role: 'athlete', nowMs: now }), 'route');
  // A never-onboarded old coach account is not converted to an athlete either.
  assert.equal(accountStepDecision({ user: old, prof: { primary_role: 'coach', tos_accepted_at: null }, role: 'athlete', nowMs: now }), 'route');
  // A never-onboarded old account of this flow's role finishes onboarding.
  assert.equal(accountStepDecision({ user: old, prof: { primary_role: 'athlete', tos_accepted_at: null }, role: 'athlete', nowMs: now }), 'adopt');
  const oa = src('screens/ob-account.js');
  assert.match(oa, /accountStepDecision\(\{ user: r\.user, prof: id\.prof, role \}\) === 'route'/);
  assert.match(oa, /primary_role: role/);
  assert.match(oa, /if \(proceed\) await onSession\(true\)/, 'the onboarding answers are saved');
});

test('Sign-in: a new social identity is signed out and sent to pick a role, never Home', () => {
  const s = src('screens/signin.js');
  const i = s.indexOf('if (isNew)');
  assert.ok(i > 0, 'the new-identity branch exists');
  const branch = s.slice(i, s.indexOf('}', s.indexOf("go('role')", i)) + 1);
  assert.match(branch, /auth\.signOut\(\)/);
  assert.match(branch, /go\('role'\)/);
  assert.match(s, /isNewIdentity\(r\.user, id\.prof\)/);
  assert.doesNotMatch(s, /if \(known && !role\)/, 'the null-role test is gone: primary_role is never null');
  assert.match(s, /await act\.checkAgeKnown\(\)/, 'the age guard decides before Home paints');
  assert.match(src('screens/ob2-role.js'), /You’re new to OnStandard\./);
});

test('Guideline 4.8: Google only beside Apple, on both screens', () => {
  assert.deepEqual(socialButtons({ apple: false, google: true }), { apple: false, google: false });
  assert.deepEqual(socialButtons({ apple: true, google: true }), { apple: true, google: true });
  assert.deepEqual(socialButtons({ apple: true, google: false }), { apple: true, google: false });
  for (const p of ['screens/signin.js', 'screens/ob-account.js']) {
    assert.match(src(p), /socialAvailability\(\)/, `${p} uses the one rule`);
    assert.match(src(p), /if \(!wrap \|\| !(social \|\| !)?avail\.apple\) return;|!avail\.apple\) return;/);
  }
  assert.match(src('social-auth.js'), /class="btn sso-apple"[^>]*><span class="sso-ic">\$\{APPLE_GLYPH\}/, 'Apple’s glyph on Apple’s button (G-P4)');
});

test('13 to 17 are told right after the DOB step (A-B6), with the invite, and it is sent after sign-up', () => {
  const s = src('screens/ob2-athlete.js');
  assert.match(s, /next: \(o\) => \(o\.dobBlocked \? 'blocked' : o\.dobMinor \? 'minor' : 'sport'\)/);
  assert.match(s, /id: 'minor'[\s\S]*?You’ll need a parent’s OK/);
  assert.match(s, /guardianWhyHtml\(\)/, 'the same words as #guardian');
  assert.match(s, /id="ob-guardian"/);
  assert.match(src('state.js'), /this\.requestGuardianConsent\(ob\.guardianEmail\)/);
  assert.match(src('screens/guardian.js'), /export function guardianWhyHtml\(\)/);
});

test('no way back from a blocked age screen (A Polish 4, C Polish 7), and the copy says only what is true (A-M7)', () => {
  const a = src('screens/ob2-athlete.js');
  const blocked = a.slice(a.indexOf("id: 'blocked'"), a.indexOf("id: 'blocked'") + 200);
  assert.match(blocked, /noBack: true/);
  assert.doesNotMatch(blocked, /back: `\$\{R\}\/dob`/);
  assert.match(a, /RT\.ob && RT\.ob\.ageLocked/);
  const e = src('ob2.js');
  const adult = e.slice(e.indexOf("id: 'blocked'"), e.indexOf("id: 'blocked'") + 400);
  assert.match(adult, /noBack: true/);
  assert.match(e, /RT\.ob && RT\.ob\.adultAgeLocked/);
  assert.match(e, /\$\{s\.noBack \? '' : /, 'the engine drops the back arrow');
  assert.doesNotMatch(a, /It verifies you are old enough/);
  assert.match(a, /Asked once\. OnStandard is for ages 13 and up\./);
});
