// Render the Instagram set from ig-cards.html — same per-card temp-page trick as
// render-cards.mjs, with per-card canvas sizes (feed 1080×1350, story 1080×1920).
//   node web/marketing-src/render-ig.mjs
import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'marketing', 'ig');
mkdirSync(outDir, { recursive: true });

const CARDS = [
  ['c01', 'carousel-1-hook', 1350], ['c02', 'carousel-2-rollcall', 1350],
  ['c03', 'carousel-3-snap', 1350], ['c04', 'carousel-4-ai-read', 1350],
  ['c05', 'carousel-5-thread', 1350], ['c06', 'carousel-6-lock', 1350],
  ['c07', 'carousel-7-cta', 1350],
  ['c08', 'post-proof-not-promises', 1350], ['c09', 'post-coach-roster', 1350],
  ['c10', 'post-streak-rules', 1350],
  ['c11', 'story-number', 1920], ['c12', 'story-rollcall', 1920],
];

const pwDir = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const shellDir = readdirSync(pwDir).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
const CHROME = join(pwDir, shellDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

const src = readFileSync(join(here, 'ig-cards.html'), 'utf8');

for (const [id, name, height] of CARDS) {
  const patched = src.replace('</head>', `<style>
    html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#070B14}
    section.card{display:none!important}
    #${id}{display:block!important;position:fixed!important;top:0!important;left:0!important;margin:0!important}
  </style></head>`);
  const tmp = join(here, `.tmp-ig-${id}.html`);
  writeFileSync(tmp, patched);
  const out = join(outDir, `${name}.png`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=1080,${height}`,
    '--virtual-time-budget=6000', `--screenshot=${out}`,
    'file:///' + tmp.replace(/\\/g, '/'),
  ], { stdio: 'pipe' });
  unlinkSync(tmp);
  console.log('ok', name);
}
console.log(`${CARDS.length} IG graphics -> ${outDir}`);
