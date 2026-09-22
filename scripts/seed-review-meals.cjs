// npm run seed:review — log today's meals on the App Review athlete, through the app's OWN code
// paths (captureManual -> logMeal -> outbox -> meals row + days upsert), so the reviewer never lands
// on an empty Home. Run it the day you submit; it is a no-op for any slot already logged today.
//
// Serves the proto itself on :8124 (or reuses a server already there) and drives it headless with
// playwright-core borrowed from the sibling Formation IQ checkout, the same recipe as ipad-qa.mjs.
// The athlete password is REVIEW_ATHLETE_PW in .env — it also sits in App Store Connect's private
// demo-account field. Never commit it: the repo is public.
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { join, extname } = require('node:path');

const ROOT = join(__dirname, '..');
const PROTO = join(ROOT, 'proto', 'redesign-2026-07');
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const EMAIL = 'review-athlete@onstandard.app';
const PASSWORD = process.env.REVIEW_PW || env.REVIEW_ATHLETE_PW;
const MEALS = [
  ['breakfast', { protein: 34, carbs: 58, fat: 16, kcal: 520 }, ['Scrambled eggs', 'Oatmeal', 'Banana']],
  ['lunch', { protein: 46, carbs: 62, fat: 18, kcal: 600 }, ['Grilled chicken breast', 'Brown rice', 'Broccoli']],
  ['dinner', { protein: 42, carbs: 70, fat: 20, kcal: 640 }, ['Salmon', 'Sweet potato', 'Mixed greens']],
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp' };

(async () => {
  if (!PASSWORD) throw new Error('REVIEW_ATHLETE_PW is not in .env');
  const pw = createRequire('c:/Users/Administrator/Downloads/Formation IQ/app/package.json')('playwright-core');
  const server = createServer(async (req, res) => {
    try {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const body = await readFile(join(PROTO, p === '/' ? 'index.html' : p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  let ownServer = true;
  await new Promise((ok, bad) => server.listen(8124, ok).on('error', (e) => { if (e.code === 'EADDRINUSE') { ownServer = false; ok(); } else bad(e); }));

  const browser = await pw.chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 402, height: 872 }, deviceScaleFactor: 2 })).newPage();
  await page.goto('http://localhost:8124/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__act && window.sb, null, { timeout: 30000 });
  // The app's OWN sign-in. It returns {ok, role} but does not navigate; the sign-in SCREEN does that.
  const auth = await page.evaluate(async (c) => { try { return await window.__act.signIn(c.email, c.password); } catch (e) { return { error: String(e && e.message || e) }; } }, { email: EMAIL, password: PASSWORD });
  console.log('sign-in:', JSON.stringify(auth));
  if (!auth || auth.error || auth.ok === false) throw new Error('sign-in failed');
  await page.evaluate(() => { location.hash = '#home'; });
  await page.waitForTimeout(10000);
  for (const [slot, macros, foods] of MEALS) {
    const r = await page.evaluate(({ slot, macros, foods }) => {
      try { window.__act.captureManual(macros, foods, slot); window.__act.logMeal(slot); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }, { slot, macros, foods });
    console.log('logged', slot, JSON.stringify(r));
    await page.waitForTimeout(1500);
  }
  console.log(await page.evaluate(async () => { try { await window.__act.drainMealOutbox(); return 'outbox drained'; } catch (e) { return 'drain error ' + (e && e.message); } }));
  await page.waitForTimeout(8000);
  await browser.close();
  if (ownServer) server.close();
  console.log('seed-review-meals: done. `npm run check:review` will now count the meals.');
})().catch((e) => { console.error('FAILED', e && e.message || e); process.exit(1); });
