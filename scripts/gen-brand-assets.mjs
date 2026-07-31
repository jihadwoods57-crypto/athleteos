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

// ---- social media set (profile picture + platform header banners) ----
const S = join(repo, 'assets', 'brand', 'social');

// profile picture: same as the app icon (1024, opaque tile) — square works everywhere
// (X, Instagram, LinkedIn, YouTube, Discord all crop to a circle from a square source).
shoot({ name: 'soc-profile', html: body(`<img src="${svgUrl('icon-tile.svg')}" width="1024" height="1024" style="position:absolute;left:0;top:0">`, '#070B14'), w: 1024, h: 1024, out: join(S, 'profile-1024.png') });

// wide banner html generator: lit dial + two-tone wordmark, centered, tuned per aspect.
const bannerHtml = (w, h, markPx, fontPx, gap) => `<!doctype html><style>
  @font-face { font-family:'PJS'; font-weight:200 800; src:url('${fontUrl('pjs.woff2')}') format('woff2'); }
  body { margin:0; width:${w}px; height:${h}px; overflow:hidden; font-family:'PJS',sans-serif;
         background:radial-gradient(120% 140% at 50% 15%, #0F1B33 0%, #070B14 62%); }
  .row { position:absolute; left:0; right:0; top:50%; transform:translateY(-50%);
         display:flex; justify-content:center; align-items:center; gap:${gap}px; }
  .name { font-weight:800; font-size:${fontPx}px; letter-spacing:-0.04em; color:#EEF3FB; white-space:nowrap; }
  .name b { font-weight:800; background:linear-gradient(90deg,#34D399,#22D3EE,#3B82F6);
            -webkit-background-clip:text; background-clip:text; color:transparent; }
</style><body>
  <div class="row"><img src="${svgUrl('dial-lit.svg')}" width="${markPx}" height="${markPx}"><div class="name">On<b>Standard</b></div></div>
</body>`;

// X (Twitter) header: 1500x500
shoot({ name: 'soc-x', html: bannerHtml(1500, 500, 180, 78, 26), w: 1500, h: 500, out: join(S, 'x-header-1500x500.png') });
// LinkedIn banner (current spec): 1584x396
shoot({ name: 'soc-li', html: bannerHtml(1584, 396, 150, 66, 22), w: 1584, h: 396, out: join(S, 'linkedin-banner-1584x396.png') });
// Facebook page cover: 820x312
shoot({ name: 'soc-fb', html: bannerHtml(820, 312, 118, 52, 18), w: 820, h: 312, out: join(S, 'facebook-cover-820x312.png') });
// YouTube channel banner: 2560x1440, but keep the lockup inside the ~1546x423 safe zone centered
shoot({ name: 'soc-yt', html: bannerHtml(2560, 1440, 220, 96, 30), w: 2560, h: 1440, out: join(S, 'youtube-banner-2560x1440.png') });

// transparent lockup (mark + two-tone wordmark, no background) for placing on any color
shoot({ name: 'soc-lockup-t', html: `<!doctype html><style>
  @font-face { font-family:'PJS'; font-weight:200 800; src:url('${fontUrl('pjs.woff2')}') format('woff2'); }
  body { margin:0; width:1200px; height:320px; overflow:hidden; font-family:'PJS',sans-serif; }
  .row { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
         display:flex; justify-content:center; align-items:center; gap:28px; }
  .name { font-weight:800; font-size:84px; letter-spacing:-0.04em; color:#EEF3FB; white-space:nowrap; }
  .name b { font-weight:800; background:linear-gradient(90deg,#34D399,#22D3EE,#3B82F6);
            -webkit-background-clip:text; background-clip:text; color:transparent; }
</style><body>
  <div class="row"><img src="${svgUrl('dial-lit.svg')}" width="190" height="190"><div class="name">On<b>Standard</b></div></div>
</body>`, w: 1200, h: 320, out: join(S, 'lockup-transparent-1200x320.png'), transparent: true });

console.log('\nAll brand rasters regenerated from masters.');
