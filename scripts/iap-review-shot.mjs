// App Review screenshot for the four consumer subscription products (six until the 2026-09-22
// repricing retired Individual Plus).
//
// App Store Connect will not let a subscription be SUBMITTED without a review screenshot, and
// "the In-App Purchase products have not been submitted for review" was half of the 2.1(b)
// rejection of 1.0 (33) on 2026-09-18. One screenshot covers all four: they are one purchase wall.
//
// Rendered from the REAL paywall, not a mockup. The only thing faked is the store bridge — a
// headless browser has no App Store, so OnStandardNative.iap.available() is stubbed true, which is
// exactly the answer a device with the RevenueCat key gives. Everything else (the two plans,
// the prices, the trial line, Terms and Privacy) comes from the shipped catalog in js/pricing.js,
// so if the catalog moves the screenshot moves with it and cannot quietly go stale.
//
// THE PIXEL SIZE IS NOT FREE. App Store Connect accepts a review screenshot only at a real
// device screenshot size, and rejects anything else asynchronously with IMAGE_INCORRECT_DIMENSIONS
// in assetDeliveryState — the upload itself returns 200, so nothing fails until you read the
// asset back and the subscription silently stays MISSING_METADATA. 804 x 1744 (a 402pt viewport
// at dsf 2) was rejected for exactly that. 414 x 736 at dsf 3 renders 1242 x 2208, the 5.5"
// iPhone size, which ASC takes. Always re-read assetDeliveryState after uploading.
//
// Run: npm run shots:iap     Output: .tmp/iap-review/
// playwright-core is borrowed from the sibling Formation IQ checkout (same recipe as ipad-shots).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTO = join(ROOT, 'proto', 'redesign-2026-07');
const OUT = join(ROOT, '.tmp', 'iap-review');
const SIBLING = 'c:/Users/Administrator/Downloads/Formation IQ/app/package.json';

let chromium;
try {
  const req = createRequire(existsSync(SIBLING) ? SIBLING : join(ROOT, 'package.json'));
  ({ chromium } = req('playwright-core'));
} catch (e) {
  console.error(`iap-review-shot: playwright-core is not available (${e.message}).`);
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(PROTO, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

// An athlete, and a store that can transact. __PLATFORM='ios' is what the native shell injects;
// without it store-policy.js treats this as the web build and the screen reads differently.
const SEED = `(async () => {
  const st = await import('./js/state.js');
  st.RT.userId = '11111111-2222-3333-4444-555555555555';
  st.RT.authRole = 'athlete';
  st.RT.profile = Object.assign({}, st.RT.profile || {}, { name: 'Marcus Hill', role: 'athlete', position: 'LB' });
  const sb = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : (k === 'auth' ? { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } : sb)), apply: () => sb });
  window.sb = sb;
  window.__PLATFORM = 'ios';
  window.OnStandardNative = Object.assign(window.OnStandardNative || {}, {
    iap: {
      available: async () => true,
      purchase: async () => ({ ok: true }),
      restore: async () => ({ ok: false, reason: 'cancelled' }),
    },
    haptic: () => {},
  });
})()`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 414, height: 736 }, deviceScaleFactor: 3, hasTouch: true });
const page = await ctx.newPage();

await page.goto(`${base}#welcome`);
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(`${base}#welcome`);
await page.waitForSelector('#view');
await page.evaluate(SEED);
await page.evaluate(() => { location.hash = '#paywall'; });
// The screen holds a deliberate "Checking the store…" beat while it probes the bridge, then
// repaints with the plans. Screenshotting during the beat is a screenshot of a spinner.
await page.waitForSelector('[data-pw-plan]', { timeout: 15000 });
await page.waitForTimeout(900);
await page.evaluate(() => { try { document.fonts.ready; } catch {} });

const seen = await page.evaluate(() => {
  const text = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
  return {
    plans: document.querySelectorAll('[data-pw-plan]').length,
    buy: (document.querySelector('#pw-buy') || {}).textContent || null,
    prices: [...document.querySelectorAll('.pw-plan-price')].map((n) => n.textContent.trim()),
    terms: !!document.querySelector('[data-go="terms"]'),
    privacy: !!document.querySelector('[data-go="privacy"]'),
    renews: /auto-renew/i.test(text),
  };
});

const file = join(OUT, 'paywall-review-screenshot.png');
await page.screenshot({ path: file });
const box = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

await ctx.close();
await browser.close();
server.close();

console.log('iap-review-shot:', file);
console.log('  rendered      :', box.w * 3, 'x', box.h * 3, '(must be a real device size; ASC takes 1242 x 2208)');
console.log('  plan cards    :', seen.plans);
console.log('  prices        :', seen.prices.join('  '));
console.log('  purchase CTA  :', JSON.stringify(seen.buy));
console.log('  terms/privacy :', seen.terms && seen.privacy);
console.log('  auto-renew    :', seen.renews);
if (seen.plans !== 2 || !seen.buy) {
  console.error('iap-review-shot: the purchase wall did not render its plans — not a usable review screenshot.');
  process.exit(1);
}
