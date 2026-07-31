import { launch, goto, evalJs, screenshot } from '../lib/cdp.mjs';
import { writeFile } from 'node:fs/promises';

const BASE = 'http://localhost:8130';
const browser = await launch({ port: 9336, scale: 1 });
try {
  const page = await browser.newPage({ width: 390, height: 1600, mobile: true });
  await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 500 });
  const rects = await evalJs(page, `
    (() => {
      const sec = document.getElementById('thread');
      const img = sec.querySelector('img[src*="thread-athlete"]');
      const dv = img.closest('.duo-shot') || img.parentElement;
      const next = dv.nextElementSibling;
      const rr = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height });
      return {
        img: rr(img.getBoundingClientRect()),
        dv: rr(dv.getBoundingClientRect()),
        next: next ? { tag: next.tagName, cls: next.className, rect: rr(next.getBoundingClientRect()) } : null,
      };
    })()
  `);
  console.log(JSON.stringify(rects, null, 2));
  await evalJs(page, `document.getElementById('thread').scrollIntoView()`);
  await new Promise(r => setTimeout(r, 1200));
  const buf = await screenshot(page, {});
  await writeFile('web/landing-src/qa-2026-07-30/index-390-thread-full.png', buf);
} finally {
  await browser.close();
}
