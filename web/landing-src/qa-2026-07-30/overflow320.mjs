import { launch, goto, evalJs, screenshot } from '../lib/cdp.mjs';
import { writeFile } from 'node:fs/promises';

const BASE = 'http://localhost:8130';
const browser = await launch({ port: 9334, scale: 1 });
try {
  const page = await browser.newPage({ width: 320, height: 900, mobile: true });
  await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 500 });
  const info = await evalJs(page, `
    (() => {
      const cw = document.documentElement.clientWidth;
      const els = Array.from(document.querySelectorAll('*'));
      const bad = [];
      for (const el of els) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (r.right > cw + 1 && r.width > 0 && r.height > 0) {
          bad.push({ tag: el.tagName, id: el.id, cls: (el.className||'').toString().slice(0,60), right: Math.round(r.right), width: Math.round(r.width), pos: cs.position });
        }
      }
      return { cw, bad: bad.slice(0, 20) };
    })()
  `);
  console.log(JSON.stringify(info, null, 2));
  const buf = await screenshot(page, {});
  await writeFile('web/landing-src/qa-2026-07-30/index-320-nav-debug.png', buf);
} finally {
  await browser.close();
}
