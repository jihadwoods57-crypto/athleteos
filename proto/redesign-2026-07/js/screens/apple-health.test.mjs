// Apple Health (Settings > Apple Health): the one front door for the integration. Source-shape
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
const consent = read('health-consent.js');
const css = read('../../css/screens.css');
const icons = read('../icons.js');

test('the route is registered as a lazy thunk and Settings links to it', () => {
  assert.match(registry, /'apple-health': lazy\(\(\) => import\('\.\/apple-health\.js'\)\)/);
  assert.match(settings, /data-go="apple-health"/);
  assert.match(settings, /id="set-hk-state"/);
  assert.match(settings, /import \{ HK, probeHealth, hkLabel \} from '\.\/apple-health\.js'/);
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
