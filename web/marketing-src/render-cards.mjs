// Re-render the 12 marketing card PNGs from cards.html without Playwright:
// per-card temp page (all other cards hidden, target pinned at 0,0) shot by the
// ms-playwright chrome-headless-shell at exactly 1080x1350. Run from repo root:
//   node web/marketing-src/render-cards.mjs
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'marketing');
const OUT_NAMES = ['01-prove-the-work', '02-how-it-works', '03-meal-logging', '04-ai-knows-its-lane',
  '05-honest-score', '06-nutrition-science', '07-why-now-nil-era', '08-for-athletes',
  '09-for-coaches', '10-for-trainers', '11-for-clients', '12-for-parents'];

const pwDir = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const shellDir = readdirSync(pwDir).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const CHROME = join(pwDir, shellDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

const src = readFileSync(join(here, 'cards.html'), 'utf8');

for (let i = 0; i < 12; i++) {
  const id = `c${String(i + 1).padStart(2, '0')}`;
  const patched = src.replace('</head>', `<style>
    html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#070B14}
    section.card{display:none!important}
    #${id}{display:block!important;position:fixed!important;top:0!important;left:0!important;margin:0!important}
  </style></head>`);
  const tmp = join(here, `.tmp-${id}.html`);
  writeFileSync(tmp, patched);
  const out = join(outDir, `${OUT_NAMES[i]}.png`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=1080,1350',
    '--virtual-time-budget=6000', `--screenshot=${out}`,
    'file:///' + tmp.replace(/\\/g, '/'),
  ], { stdio: 'pipe' });
  unlinkSync(tmp);
  console.log('ok', OUT_NAMES[i]);
}
console.log('12 cards re-rendered.');
