import { launch, goto, evalJs, screenshot } from '../lib/cdp.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'web/landing-src/qa-2026-07-30';
const BASE = 'http://localhost:8130';
const pages = ['index', 'athletes', 'coaches', 'trainers', 'dietitians', 'parents'];
const widths = [320, 390, 768, 1200];

const results = { overflow: {}, thread: {}, modal: null, counterBlocked: null, counterNormal: null };

const browser = await launch({ port: 9333, scale: 1 });

try {
  for (const p of pages) {
    for (const w of widths) {
      const page = await browser.newPage({ width: w, height: 900, mobile: w < 768 });
      await goto(page, `${BASE}/${p}.html`, { waitFor: '!document.getElementById("pre")', settleMs: 500 });
      const overflow = await evalJs(page, 'document.documentElement.scrollWidth - document.documentElement.clientWidth');
      results.overflow[`${p}@${w}`] = overflow;
      if (overflow > 1) {
        const offenders = await evalJs(page, `
          (() => {
            const cw = document.documentElement.clientWidth;
            const els = Array.from(document.querySelectorAll('*'));
            const bad = [];
            for (const el of els) {
              const r = el.getBoundingClientRect();
              if (r.right > cw + 1) {
                bad.push({ tag: el.tagName, id: el.id, cls: (el.className||'').toString().slice(0,80), right: Math.round(r.right), cw });
              }
              if (bad.length > 8) break;
            }
            return bad;
          })()
        `);
        results.overflow[`${p}@${w}_offenders`] = offenders;
      }
      const buf = await screenshot(page, {});
      await writeFile(join(OUT, `${p}-${w}.png`), buf);

      if (p === 'index' && w === 320 || p === 'index' && w === 390) {
        await evalJs(page, `document.getElementById('thread').scrollIntoView()`);
        await new Promise(r => setTimeout(r, 300));
        const buf2 = await screenshot(page, {});
        await writeFile(join(OUT, `index-${w}-thread.png`), buf2);

        await evalJs(page, `document.getElementById('pricing') ? document.getElementById('pricing').scrollIntoView() : document.querySelector('[id*=pricing]')?.scrollIntoView()`);
        await new Promise(r => setTimeout(r, 300));
        const buf3 = await screenshot(page, {});
        await writeFile(join(OUT, `index-${w}-pricing.png`), buf3);
      }

      await browser.send('Target.closeTarget', { targetId: page.targetId });
    }
  }

  // Modal check at 390
  {
    const page = await browser.newPage({ width: 390, height: 900, mobile: true });
    await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 500 });
    await evalJs(page, `document.querySelector('.js-wl').click()`);
    await new Promise(r => setTimeout(r, 400));
    const dlgOpen = await evalJs(page, `!!document.querySelector('dialog[open], .wl-modal[open], dialog.wl')`);
    const headingText = await evalJs(page, `(document.querySelector('dialog')||{}).outerHTML ? (document.querySelector('dialog h2, dialog h3, .wl-panel h2, .wl-panel h3')||{}).textContent || null : null`);
    results.modal = { dlgOpen, headingText };
    const buf = await screenshot(page, {});
    await writeFile(join(OUT, 'index-390-modal.png'), buf);
    await browser.send('Target.closeTarget', { targetId: page.targetId });
  }

  // Counter blocked path
  {
    const page = await browser.newPage({ width: 390, height: 900, mobile: true });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (function() {
          const orig = window.fetch;
          window.fetch = function(url, ...args) {
            if (typeof url === 'string' && url.includes('supabase.co')) {
              return Promise.reject(new Error('blocked for QA'));
            }
            return orig.call(this, url, ...args);
          };
        })();
      `,
    }, page.sessionId);
    await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 1500 });
    const state = await evalJs(page, `
      (() => {
        const els = Array.from(document.querySelectorAll('[data-f50]'));
        return els.map(el => ({ hidden: el.hidden, text: (el.querySelector('[data-f50-n]')||{}).textContent || '' }));
      })()
    `);
    results.counterBlocked = state;
    await browser.send('Target.closeTarget', { targetId: page.targetId });
  }

  // Counter normal path
  {
    const page = await browser.newPage({ width: 390, height: 900, mobile: true });
    await goto(page, `${BASE}/index.html`, { waitFor: '!document.getElementById("pre")', settleMs: 2000 });
    const state = await evalJs(page, `
      (() => {
        const els = Array.from(document.querySelectorAll('[data-f50]'));
        return els.map(el => ({ hidden: el.hidden, text: (el.querySelector('[data-f50-n]')||{}).textContent || '' }));
      })()
    `);
    results.counterNormal = state;
    await browser.send('Target.closeTarget', { targetId: page.targetId });
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
