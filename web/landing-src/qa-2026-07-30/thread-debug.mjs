import { launch, goto, evalJs, screenshot } from '../lib/cdp.mjs';
import { writeFile } from 'node:fs/promises';

const BASE = 'http://localhost:8130';
const browser = await launch({ port: 9335, scale: 1 });
try {
  for (const w of [320, 390]) {
    const page = await browser.newPage({ width: w, height: 900, mobile: true });
    await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 500 });
    await evalJs(page, `document.getElementById('thread').scrollIntoView()`);
    await new Promise(r => setTimeout(r, 1500));
    const diag = await evalJs(page, `
      (() => {
        const sec = document.getElementById('thread');
        const imgs = Array.from(sec.querySelectorAll('img'));
        return {
          secOpacity: getComputedStyle(sec).opacity,
          imgs: imgs.map(i => ({ src: i.currentSrc || i.src, complete: i.complete, naturalW: i.naturalWidth, naturalH: i.naturalHeight })),
        };
      })()
    `);
    console.log(w, JSON.stringify(diag, null, 2));
    const buf = await screenshot(page, {});
    await writeFile(`web/landing-src/qa-2026-07-30/index-${w}-thread2.png`, buf);
    await browser.send('Target.closeTarget', { targetId: page.targetId });
  }
} finally {
  await browser.close();
}
