// Step-9 evidence: the live hero with the video PLAYING, at 1440 and 1920 wide.
//
// Serves web/landing/ over a real HTTP origin (same dependency-free pattern as
// scripts/serve-proto.mjs), drives headless Chromium via lib/cdp.mjs, and —
// critically — emulates prefers-reduced-motion: no-preference, because headless
// Chrome defaults to `reduce` and site.js:124 skips the video entirely under it.
// Waits until #hv-video has the .on class (the 1.2s cross-fade has been
// triggered by a real `playing` event) plus a beat, then screenshots the hero.
//
// Usage:  node scripts/hero-video/shot-live.mjs
// Output: .tmp/hero-video/previews/live-hero-{1440,1920}.png
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, goto, evalJs, screenshot, sleep } from '../../web/landing-src/lib/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const ROOT = join(repo, 'web', 'landing');
const outDir = join(repo, '.tmp', 'hero-video', 'previews');
const PORT = 8931;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.ico': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const abs = normalize(join(ROOT, path));
    if (!abs.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    const s = await stat(abs).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(abs));
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(PORT);

const browser = await launch({ port: 9342, scale: 1 });
try {
  for (const width of [1440, 1920]) {
    const page = await browser.newPage({ width, height: 950, mobile: false });
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    await goto(page, `http://localhost:${PORT}/index.html`, { settleMs: 600 });
    const deadline = Date.now() + 20000;
    for (;;) {
      const on = await evalJs(page, `document.getElementById('hv-video')?.classList.contains('on') || false`);
      if (on) break;
      if (Date.now() > deadline) throw new Error(`hv-video never reached .on at ${width}px — video not playing`);
      await sleep(250);
    }
    // Let the 1.2s cross-fade fully land AND the async-decoded phone-mockup
    // images finish painting — 1.6s was long enough for the fade but the 1440
    // capture once caught the front phone screen still undecoded.
    await evalJs(page, `Promise.all([...document.querySelectorAll('.p3d-screen img')].map(i => i.decode().catch(() => {})))`);
    await sleep(3000);
    const state = await evalJs(page, `(v => ({ t: v.currentTime.toFixed(2), w: v.videoWidth, h: v.videoHeight, paused: v.paused }))(document.getElementById('hv-video'))`);
    const out = join(outDir, `live-hero-${width}.png`);
    writeFileSync(out, await screenshot(page));
    console.log(`${out}  video=${JSON.stringify(state)}`);
  }
} finally {
  await browser.close();
  server.close();
}
