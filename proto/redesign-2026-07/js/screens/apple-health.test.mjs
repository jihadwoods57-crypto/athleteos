// Apple Health (Profile > Apple Health): the one front door for the integration. Source-shape
// pins, the way the other screen suites work: the route is registered lazily, Settings carries
// the row with the live state under it, the phone-side steps open the Health app through the
// native bridge (never a bare location change the WebView would swallow), every state has its
// copy, and the file carries no inline styles (a new file starts at a ratchet ceiling of zero).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const screen = read('apple-health.js');
const registry = read('index.js');
const settings = read('settings.js');
const profile = read('profile.js');
const consent = read('health-consent.js');
const css = read('../../css/screens.css');
const icons = read('../icons.js');

test('the route is registered as a lazy thunk and Profile links to it', () => {
  assert.match(registry, /'apple-health': lazy\(\(\) => import\('\.\/apple-health\.js'\)\)/);
  // The row moved from App settings to Profile's Tracking group on 2026-09-22 (IA dedupe: it had a
  // door on both screens). It carries the phone's live answer the same way Settings did, but
  // imports apple-health.js lazily because Profile is in the boot bundle.
  assert.match(profile, /data-go="apple-health"/);
  assert.match(profile, /id="pf-hk-state"/);
  assert.match(profile, /import\('\.\/apple-health\.js'\)\.then\(async \(\{ HK, probeHealth, hkLabel \}\)/);
  assert.doesNotMatch(settings, /data-go="apple-health"/, 'one door, not two');
});

test('the Health app is opened through the native bridge, with a plain fallback', () => {
  assert.match(screen, /n\.openUrl\('x-apple-health:\/\/'\)/);
  assert.match(screen, /Settings, then Health, then Data Access/);
});

test('every state has its own honest copy', () => {
  for (const s of ['Not on this phone', 'Not connected', 'Connected, nothing shared yet', 'Connect Apple Health', 'Disconnect Apple Health', 'Never written']) {
    assert.ok(screen.includes(s), `missing state copy: ${s}`);
  }
  // "Connected" is never claimed on the sheet alone: a real read earns it.
  assert.match(screen, /hasActivity\(HK\.activity\) \|\| hasRecovery\(HK\.recovery\)/);
});

test('the phone-side steps wear system tiles and the app mark, and the hand glyph exists', () => {
  assert.match(screen, /hk-tile health/);
  assert.match(screen, /hk-tile sys/);
  assert.match(screen, /hk-tile app/);
  assert.match(screen, /icon\('hand'/);
  assert.match(icons, /^\s+hand: '<path/m);
  assert.match(css, /\.hk-tile\.health \{ background: #FFFFFF; color: #FF2D55/);
});

test('no inline styles, no em dashes, and the consent screen points here', () => {
  assert.equal((screen.match(/style="/g) || []).length, 0);
  assert.ok(!screen.includes('—'));
  assert.match(consent, /data-go="apple-health"/);
});

test('Disconnect sticks: connected is the OS grant AND not-revoked consent', () => {
  // iOS keeps its grant after Disconnect revokes the server consent, so the phone alone would
  // answer "connected" forever and the next visit would flip the screen back to Connected and
  // read again — the opposite of what Disconnect just promised (1 PM audit, 2026-09-06). A
  // FAILED consent read stays null and does not un-connect the display.
  assert.match(screen, /HK\.connected = osGranted && HK\.consent !== false/);
  // And the consent fetch runs before that derivation, not after the reads.
  assert.ok(screen.indexOf("rpc('has_health_consent'") < screen.indexOf('HK.connected = osGranted'),
    'consent is fetched before connected is derived');
});

test('the old #devices screen folded in here, and both grants are offered', () => {
  // Apple asks for activity and recovery as separate scopes (bridge: HEALTH_CONNECT_SCOPED), so
  // folding #devices in without its own ask would have silently ended sleep/HRV for everyone.
  const registry = read('index.js');
  const features = read('features.js');
  const recovery = read('recovery.js');
  assert.ok(!/^\s*devices:/m.test(registry), 'the devices route is gone');
  assert.ok(!/export const devices/.test(features), 'the devices screen is gone');
  assert.match(recovery, /data-go="apple-health"/);
  assert.match(screen, /connectScoped\(\['recovery'\]\)/);
  assert.match(screen, /id="hk-rec"/);
  // A minor reaches the guardian ask first, the rule activity already followed and #devices never did.
  assert.match(screen, /HK\.isMinor === true && HK\.consent !== true.*guardian/s);
  // The numbers #devices existed to show live here now.
  assert.match(screen, /ms HRV/);
  assert.match(screen, /bpm resting/);
});

test('the Settings label follows the probe honestly', () => {
  // The module imports roles.js and through it state.js, which wants a browser at import time.
  // The label logic is three pure pieces of source, so evaluate those alone (the repo's own file,
  // not untrusted input), the way state-memo.test.mjs and server-pref-patch.test.mjs do.
  const pick = (re) => { const m = re.exec(screen); assert.ok(m, `source missing: ${re}`); return m[0].replace(/^export /, ''); };
  const src = [
    pick(/const hasActivity = [^\n]+;/),
    pick(/const hasRecovery = [^\n]+;/),
    pick(/export const HK = \{[\s\S]*?\n\};/),
    pick(/export function hkLabel\(\) \{[\s\S]*?\n\}/),
  ].join('\n');
  const { HK, hkLabel } = new Function(`${src}; return { HK, hkLabel };`)();
  HK.probed = false;
  assert.equal(hkLabel(), 'Checking…');
  HK.probed = true; HK.available = false;
  assert.equal(hkLabel(), 'iPhone only');
  HK.available = true; HK.connected = false;
  assert.equal(hkLabel(), 'Not connected');
  HK.connected = true; HK.activity = null; HK.recovery = null;
  assert.equal(hkLabel(), 'Connected, nothing shared yet');
  HK.activity = { steps: 1200 };
  assert.equal(hkLabel(), 'Connected');
  HK.probed = false; HK.available = null; HK.connected = false; HK.activity = null;
});

test('the HealthKit description renders on EVERY device, including one with no HealthKit', () => {
  // Guideline 2.5.1, App Review 2026-09-18: build 33 was reviewed on an iPad Air, HealthKit does
  // not exist on iPad, and `${ios ? readsCard() : ''}` deleted every word identifying the
  // integration on exactly that device. The identification is not allowed to depend on the answer.
  assert.match(screen, /\$\{readsCard\(\)\}/);
  assert.ok(!/\$\{ios \? readsCard\(\) : ''\}/.test(screen), 'readsCard() is gated on availability again');
  // The three things the card names are the identification itself.
  for (const s of ['What OnStandard reads', 'Activity', 'Recovery', 'Never written']) {
    assert.ok(screen.includes(s), `missing from the HealthKit description: ${s}`);
  }
});

test('an iPad is never told it is an Android', () => {
  assert.ok(!screen.includes('Nothing to set up here on Android.'),
    'the iPad/iOS-without-HealthKit case is printing the Android line again');
  assert.match(screen, /function closingLine\(\)/);
  assert.match(screen, /window\.__PLATFORM/);
  // Android keeps a true sentence of its own; every other device gets the iPhone one.
  assert.match(screen, /p === 'android'/);
  assert.ok(screen.includes('Apple Health is available on iPhone.'));
});

/* THE GUARDIAN GATE IS THE SERVER'S RULE, NOT A SECOND COPY OF IT (2026-09-22).
   Both screens used to compute it themselves from `athlete_profiles.base_age` alone, and treated
   an unknown age as a MINOR:  `age == null ? true : Number(age) < 18`.
   Migration 0050's is_provable_minor says the opposite — `coalesce(base_age, 99) < 18 or (dob is
   not null and dob > current_date - 18y)`, i.e. unknown age is an ADULT — and it also reads dob,
   which neither screen did. 30 of 31 athlete profiles on prod have base_age null, so every one of
   them was shown "Connect, with a guardian" and bounced to #guardian instead of the Health sheet.
   Ask the server; never restate the rule here. */
for (const [name, src] of [['apple-health.js', screen], ['health-consent.js', consent]]) {
  test(`${name} asks the server whether the athlete is a minor`, () => {
    assert.ok(!/age == null \? true/.test(src),
      `${name} still treats an unknown age as a minor; the server's rule says unknown = adult`);
    assert.ok(!/select\('base_age'\)/.test(src),
      `${name} still reads base_age directly — that misses dob, and RLS can make it null`);
    assert.match(src, /rpc\('is_provable_minor', \{ p: uid \}\)/,
      `${name} must call the server's own is_provable_minor`);
  });
}

test('an unreachable minor check never invents a guardian wall', () => {
  // The RPC failing leaves the flag null, and both screens compare against `=== true`, so the
  // athlete keeps the ordinary CTA. A dropped request must not read as "you are a child".
  assert.match(screen, /HK\.isMinor === true && HK\.consent !== true/);
  assert.match(consent, /IS_MINOR === true && CONSENT !== true/);
});
