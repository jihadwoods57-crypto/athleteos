// Recapture the athlete camera screen (v3-camera) from the CURRENT proto —
// the old shot bakes in the pre-reversal "gallery photos never score" footnote.
// Pattern per the original v3 captures: 390x844 @2x, clock stubbed to evening
// so Dinner is the active slot, localStorage RT seed + hash navigation.
// Run: NODE_PATH=<repo>/node_modules node recapture-camera.mjs  (proto served on :8127)
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  permissions: [], // getUserMedia denied -> primed "Take a photo to analyze" state
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  // Evening clock: dinner window open, "Due by 8:00 PM" header
  const H = 18, M = 5;
  Date.prototype.getHours = function () { return H; };
  Date.prototype.getMinutes = function () { return M; };
});
await page.goto('http://localhost:8127/');
await page.waitForTimeout(3000);
// The boot gate now WIPES a localStorage RT seed when there's no real session
// (stress-test R1 hardening), so seed the LIVE module after boot instead —
// the render gate only checks in-memory RT.userId.
await page.evaluate(async () => {
  const s = await import('./js/state.js');
  s.RT.userId = 'shot-athlete';
  s.RT.authRole = 'athlete';
  s.RT.camPrimed = true; // skip the one-time "Camera, for proof." priming screen
  Object.assign(s.RT.profile || (s.RT.profile = {}), {
    firstName: 'Marcus', lastName: 'Reed', sport: 'Football', position: 'WR', goal: 'gain',
  });
});
// Retry until the camera screen actually mounts.
let ok = false;
for (let i = 0; i < 6 && !ok; i++) {
  await page.evaluate(() => { location.hash = '#camera/dinner'; });
  await page.waitForTimeout(1200);
  ok = await page.evaluate(() => /Log Dinner/i.test(document.body.innerText));
}
console.log('camera screen mounted:', ok, await page.evaluate(() => location.hash));
await page.screenshot({ path: 'a-camera-v2.png' });
console.log('footnote:', await page.evaluate(() => (document.body.innerText.match(/Gallery photos[^\n]*/) || ['(none)'])[0]));
await browser.close();
