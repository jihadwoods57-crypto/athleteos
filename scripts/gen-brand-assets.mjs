// OnStandard brand asset pipeline — regenerates EVERY raster brand asset from the
// masters in assets/brand/. Idempotent; run from repo root:
//   node scripts/gen-brand-assets.mjs
// Renderer: ms-playwright chrome-headless-shell (no npm deps). Transparent assets
// use --default-background-color=00000000.
// docs/brand/LOGO.md is the law; this script is its enforcement.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (f) => join(repo, 'assets', 'brand', f);
const svgUrl = (f) => 'file:///' + brand(f).replace(/\\/g, '/');
const fontUrl = (f) => 'file:///' + join(repo, 'web', 'landing', 'fonts', f).replace(/\\/g, '/');

// find the newest chrome-headless-shell in the ms-playwright cache
const pwDir = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const shellDir = readdirSync(pwDir).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
if (!shellDir) { console.error('no chrome-headless-shell in', pwDir); process.exit(1); }
const CHROME = join(pwDir, shellDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

const work = join(tmpdir(), 'onstandard-brand-gen');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

function shoot({ name, html, w, h, out, transparent = false }) {
  const page = join(work, `${name}.html`);
  writeFileSync(page, html);
  const png = join(work, `${name}.png`);
  const args = [
    '--headless', '--disable-gpu', '--allow-file-access-from-files',
    '--force-device-scale-factor=1', '--hide-scrollbars',
    `--window-size=${w},${h}`, `--screenshot=${png}`,
  ];
  if (transparent) args.splice(2, 0, '--default-background-color=00000000');
  args.push('file:///' + page.replace(/\\/g, '/'));
  execFileSync(CHROME, args, { stdio: 'pipe' });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, readFileSync(png));
  console.log('ok', out.replace(repo + '\\', ''));
}

const body = (inner, bg = 'transparent') =>
  `<!doctype html><body style="margin:0;background:${bg};overflow:hidden">${inner}</body>`;

// centered master at a given scale of a square canvas
const centered = (svg, canvas, frac, bg) => {
  const px = Math.round(canvas * frac);
  const off = Math.round((canvas - px) / 2);
  return body(`<img src="${svgUrl(svg)}" width="${px}" height="${px}" style="position:absolute;left:${off}px;top:${off}px">`, bg);
};

// dial-lit.svg has a 150-unit padded viewBox around the 100-unit art; to place the ART
// at `frac` of the canvas, the img is frac*1.5 with the same center.
const centeredLit = (canvas, frac, bg) => centered('dial-lit.svg', canvas, frac * 1.5, bg);

// favicon: mini app tile (navy rounded square + flat dial) — survives light browser chrome at 16px
const faviconHtml = (px) => body(
  `<div style="position:absolute;inset:0;background:#070B14;border-radius:${Math.round(px * 0.1875)}px"></div>
   <img src="${svgUrl('dial-flat-dark.svg')}" width="${Math.round(px * 0.72)}" height="${Math.round(px * 0.72)}"
        style="position:absolute;left:${Math.round(px * 0.14)}px;top:${Math.round(px * 0.14)}px">`);

// email mark: same mini tile at 80px (renders 30px in mail clients, retina-crisp)
const emailMarkHtml = faviconHtml(80);

// og.png 1200x630 — lit dial + two-tone lockup + tagline
const ogHtml = `<!doctype html><style>
  @font-face { font-family:'PJS'; font-weight:200 800; src:url('${fontUrl('pjs.woff2')}') format('woff2'); }
  body { margin:0; width:1200px; height:630px; overflow:hidden; font-family:'PJS',sans-serif;
         background:radial-gradient(120% 140% at 50% 20%, #0F1B33 0%, #070B14 62%); }
  .row { position:absolute; left:0; right:0; top:150px; display:flex; justify-content:center; align-items:center; gap:34px; }
  .name { font-weight:800; font-size:92px; letter-spacing:-0.04em; color:#EEF3FB; }
  .name b { font-weight:800; background:linear-gradient(90deg,#34D399,#22D3EE,#3B82F6);
            -webkit-background-clip:text; background-clip:text; color:transparent; }
  .tag { position:absolute; left:0; right:0; top:342px; text-align:center;
         font-weight:600; font-size:34px; letter-spacing:0.01em; color:#8FA3C2; }
  .bar { position:absolute; left:0; right:0; bottom:0; height:10px;
         background:linear-gradient(90deg,#34D399,#22D3EE,#3B82F6); }
</style><body>
  <div class="row"><img src="${svgUrl('dial-lit.svg')}" width="222" height="222" style="margin-top:-14px"><div class="name">On<b>Standard</b></div></div>
  <div class="tag">Prove the work. Own your standard.</div>
  <div class="bar"></div>
</body>`;

const A = join(repo, 'assets');
const L = join(repo, 'web', 'landing', 'assets');

shoot({ name: 'icon',        html: body(`<img src="${svgUrl('icon-tile.svg')}" width="1024" height="1024" style="position:absolute;left:0;top:0">`, '#070B14'), w: 1024, h: 1024, out: join(A, 'icon.png') });
shoot({ name: 'splash',      html: centeredLit(512, 0.86), w: 512, h: 512, out: join(A, 'splash-icon.png'), transparent: true });
shoot({ name: 'and-fg',      html: centeredLit(1024, 0.50), w: 1024, h: 1024, out: join(A, 'android-icon-foreground.png'), transparent: true });
shoot({ name: 'and-bg',      html: body(`<div style="position:absolute;inset:0;background:radial-gradient(120% 120% at 50% 30%, #0F1B33 0%, #070B14 65%)"></div>`), w: 1024, h: 1024, out: join(A, 'android-icon-background.png') });
shoot({ name: 'and-mono',    html: centered('dial-flat-dark.svg', 1024, 0.52).replace('</body>', `<style>img{filter:brightness(0) invert(1)}</style></body>`), w: 1024, h: 1024, out: join(A, 'android-icon-monochrome.png'), transparent: true });
shoot({ name: 'favicon-app', html: faviconHtml(64), w: 64, h: 64, out: join(A, 'favicon.png'), transparent: true });
shoot({ name: 'favicon-web', html: faviconHtml(64), w: 64, h: 64, out: join(L, 'favicon.png'), transparent: true });
shoot({ name: 'apple-touch', html: body(`<img src="${svgUrl('icon-tile.svg')}" width="180" height="180" style="position:absolute;left:0;top:0">`, '#070B14'), w: 180, h: 180, out: join(L, 'apple-touch-icon.png') });
shoot({ name: 'og',          html: ogHtml, w: 1200, h: 630, out: join(L, 'og.png') });
shoot({ name: 'email-mark',  html: emailMarkHtml, w: 80, h: 80, out: join(L, 'brand', 'email-mark.png'), transparent: true });

console.log('\nAll brand rasters regenerated from masters.');
