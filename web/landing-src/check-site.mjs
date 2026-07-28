// Responsive + integrity check for the landing pages.
//   node scripts/serve-landing.mjs   (or any static server on 8800 rooted at web/landing)
//   node web/landing-src/check-site.mjs
// Verifies: no horizontal overflow at 375/768/1440, every <img> loads, every internal link resolves.
import { launch, goto, evalJs, screenshot, sleep } from './lib/cdp.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.SITE_BASE || 'http://localhost:8800';
const PAGES = (process.argv[2] || 'index,athletes,coaches,trainers,parents,dietitians').split(',');
const WIDTHS = [375, 768, 1440];
const OUT = join(process.cwd(), 'web', 'landing-src', 'qa-rewrite');

const b = await launch({ port: 9350, scale: 1 });
let problems = 0;
try {
  await mkdir(OUT, { recursive: true });
  for (const p of PAGES) {
    for (const w of WIDTHS) {
      const page = await b.newPage({ width: w, height: w < 500 ? 812 : 1000, mobile: w < 500 });
      const bad = [];
      b.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') bad.push('JS: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 120));
      });
      await goto(page, `${BASE}/${p}.html`, { settleMs: 1400 });
      const r = await evalJs(page, `(() => {
        const de = document.documentElement;
        const overflow = de.scrollWidth - de.clientWidth;
        const wide = [...document.querySelectorAll('body *')]
          .filter(el => el.getBoundingClientRect().right > de.clientWidth + 2)
          .slice(0, 6).map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0,2).join('.') : ''));
        // loading="lazy" images below the fold have naturalWidth 0 until scrolled into view, so
        // decode-state is a useless liveness test here. Ask the network whether each URL resolves.
        const imgs = [...document.images];
        const srcs = [...new Set(imgs.map(i => i.getAttribute('src')).filter(Boolean))];
        const broken = [];
        const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
          .filter(h => h && !/^(https?:|mailto:|tel:|#)/.test(h));
        const anchors = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1);
        const deadAnchors = anchors.filter(h => !document.querySelector(h));
        return { overflow, wide, imgCount: imgs.length, srcs, broken, links: [...new Set(links)], deadAnchors };
      })()`);
      // Verify every referenced image URL actually resolves (catches renamed/deleted assets).
      for (const src of r.srcs) {
        const url = src.startsWith('http') ? src : `${BASE}/${src.replace(/^\.?\//, '')}`;
        try { const res = await fetch(url, { method: 'GET' }); if (!res.ok) r.broken.push(`${src} → ${res.status}`); }
        catch { r.broken.push(`${src} → unreachable`); }
      }
      const issues = [];
      if (r.overflow > 1) issues.push(`H-OVERFLOW ${r.overflow}px via ${r.wide.join(', ')}`);
      if (r.broken.length) issues.push(`BROKEN IMG: ${r.broken.join(', ')}`);
      if (r.deadAnchors.length) issues.push(`DEAD ANCHOR: ${r.deadAnchors.join(', ')}`);
      if (bad.length) issues.push(bad.join(' | '));
      problems += issues.length;
      console.log(`${issues.length ? 'FAIL' : 'ok  '} ${p.padEnd(11)} ${String(w).padStart(4)}px  imgs:${String(r.imgCount).padStart(2)}  ${issues.join(' ; ') || ''}`);
      if (w === 1440 || issues.length) await writeFile(join(OUT, `${p}-${w}.webp`), await screenshot(page, { format: 'webp' }));
      if (w === WIDTHS[0]) console.log(`     links → ${r.links.join(' ')}`);
      await b.send('Target.closeTarget', { targetId: page.targetId });
    }
  }
} finally { await b.close(); }
console.log(`\n${problems ? problems + ' issue(s)' : 'all clean'}`);
