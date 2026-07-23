// Dependency-free Chrome DevTools Protocol driver.
//
// The repo has no Playwright package, but the Playwright-managed Chromium binaries are on disk and
// Node 24 ships a global WebSocket — so we drive Chromium directly over CDP rather than adding a
// dependency for screenshot tooling. Same reason scripts/serve-proto.mjs is http-only.
//
// Used by shoot-proto.mjs (proto app screens) and shoot-site.mjs (responsive checks of the built
// landing pages). Nothing here is shipped to the site; it lives in web/landing-src/ with the other
// generation scripts.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

/** Newest Playwright-managed Chromium on this machine, or null. Prefers the full browser over the
 *  headless shell: the shell can't rasterize some CSS the proto uses (backdrop-filter). */
export function findChrome() {
  const roots = [
    join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
    join(process.env.HOME || '', '.cache', 'ms-playwright'),
  ].filter((r) => r && existsSync(r));
  const candidates = [];
  for (const root of roots) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium-')) continue;
      const build = Number(dir.split('-')[1]) || 0;
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const exe = join(root, dir, rel);
        if (existsSync(exe)) candidates.push({ build, exe });
      }
    }
  }
  candidates.sort((a, b) => b.build - a.build);
  return candidates.length ? candidates[0].exe : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the DevTools HTTP endpoint until the browser is actually accepting connections. */
async function waitForWs(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(120);
  }
  throw new Error(`Chrome DevTools did not come up on port ${port}`);
}

/**
 * Launch headless Chromium and return a small client.
 *
 * `send(method, params, sessionId)` resolves with the CDP result, or rejects with the CDP error —
 * silent failures here would produce blank screenshots that look like real empty states, which is
 * exactly the failure mode this whole exercise exists to avoid.
 */
export async function launch({ port = 9333, scale = 3 } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('No Chromium found. Expected a Playwright-managed build under ms-playwright.');
  const profile = await mkdtemp(join(tmpdir(), 'onstd-shot-'));

  const proc = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', '--disable-gpu',
    // Deterministic rendering across runs: no font smoothing drift, no lazy-image races.
    '--force-device-scale-factor=' + scale,
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--allow-file-access-from-files',
    'about:blank',
  ], { stdio: 'ignore' });

  const wsUrl = await waitForWs(port);
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket failed')); });

  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? ` — ${msg.error.data}` : ''}`));
      else resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  };

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return {
    send,
    on: (fn) => listeners.push(fn),
    async newPage({ width, height, mobile = true }) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId);
      await s('Page.enable');
      await s('Runtime.enable');
      await s('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: scale, mobile,
        screenWidth: width, screenHeight: height,
      });
      return { sessionId, targetId, send: s };
    },
    async close() {
      try { ws.close(); } catch { /* already gone */ }
      proc.kill();
      await sleep(200);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** Navigate, then wait for the app to be genuinely settled — not just `load`. */
export async function goto(page, url, { settleMs = 900, waitFor = null } = {}) {
  await page.send('Page.navigate', { url });
  await page.send('Runtime.evaluate', {
    expression: 'new Promise(r => (document.readyState === "complete" ? r(1) : addEventListener("load", () => r(1))))',
    awaitPromise: true, returnByValue: true,
  });
  if (waitFor) {
    const deadline = Date.now() + 15000;
    for (;;) {
      const { result } = await page.send('Runtime.evaluate', { expression: `!!(${waitFor})`, returnByValue: true });
      if (result.value) break;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${waitFor}`);
      await sleep(150);
    }
  }
  // Let fonts + any entry transition finish so text isn't captured mid-swap.
  await page.send('Runtime.evaluate', {
    expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1', awaitPromise: true, returnByValue: true,
  });
  await sleep(settleMs);
}

/** Evaluate in the page and return the value, throwing on a page-side exception. */
export async function evalJs(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || 'page error');
  }
  return result.value;
}

/** Run script before any page script on the next navigation (for seeding localStorage). */
export async function seedOnNewDocument(page, source) {
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
}

export async function screenshot(page, { clip = null, format = 'png' } = {}) {
  const { data } = await page.send('Page.captureScreenshot', {
    format, ...(format === 'jpeg' ? { quality: 92 } : {}), ...(clip ? { clip } : {}),
    captureBeyondViewport: !!clip,
  });
  return Buffer.from(data, 'base64');
}

export { sleep };
