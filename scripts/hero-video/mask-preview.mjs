// Hero-loop mask preview harness.
//
// Every keyframe for the hero video gets judged THROUGH this, never raw: the
// .hero-ath slot applies a two-axis dissolve mask (site.css:378-386), so what
// the homepage actually shows is only the band x=27%..80%, y=9%..88% at full
// opacity, with everything outside melting into the page background (#0B0A08).
//
// Rather than re-deriving the mask math, this renders the frame through the
// LITERAL CSS from site.css in headless Chromium (via lib/cdp.mjs — no deps),
// then draws guide lines on top:
//   red solid    — full-opacity band edges (x 27/80%, y 9/88%)
//   red dashed   — total-dissolve edges (x 3/99%)
//   gold bands   — composition lock: crown y 8-12%, eyeline y 27-33%,
//                  chin y 43-48%, head-centre x 45-55%
//   green rect   — phone + plate zone x 30-50%, y 60-85%
//
// Usage:  node scripts/hero-video/mask-preview.mjs <image> [<image>...]
// Output: .tmp/hero-video/previews/<basename>-masked.png (1024x1536)
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, goto, screenshot } from '../../web/landing-src/lib/cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(repo, '.tmp', 'hero-video', 'previews');
mkdirSync(outDir, { recursive: true });

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.error('usage: node scripts/hero-video/mask-preview.mjs <image> [...]');
  process.exit(1);
}

// The mask below is copied verbatim from web/landing/css/site.css (.hero-ath).
// If that rule ever changes, this harness must change with it.
const page = (imgUrl) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0B0A08">
<div style="position:relative;width:512px;height:768px;font:700 9px/1 Consolas,monospace">
  <div style="position:absolute;inset:0;
    -webkit-mask-image:
      linear-gradient(to right, transparent 3%, #000 27%, #000 80%, transparent 99%),
      linear-gradient(to bottom, transparent 0%, #000 9%, #000 88%, rgba(0,0,0,0.55) 100%);
    -webkit-mask-composite: source-in;
    mask-image:
      linear-gradient(to right, transparent 3%, #000 27%, #000 80%, transparent 99%),
      linear-gradient(to bottom, transparent 0%, #000 9%, #000 88%, rgba(0,0,0,0.55) 100%);
    mask-composite: intersect;">
    <img src="${imgUrl}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 16%">
  </div>

  <!-- full-opacity band (what actually survives) -->
  <div style="position:absolute;top:0;bottom:0;left:27%;border-left:1px solid rgba(255,60,60,.85)"></div>
  <div style="position:absolute;top:0;bottom:0;left:80%;border-left:1px solid rgba(255,60,60,.85)"></div>
  <div style="position:absolute;left:0;right:0;top:9%;border-top:1px solid rgba(255,60,60,.85)"></div>
  <div style="position:absolute;left:0;right:0;top:88%;border-top:1px solid rgba(255,60,60,.85)"></div>
  <!-- total-dissolve edges -->
  <div style="position:absolute;top:0;bottom:0;left:3%;border-left:1px dashed rgba(255,60,60,.4)"></div>
  <div style="position:absolute;top:0;bottom:0;left:99%;border-left:1px dashed rgba(255,60,60,.4)"></div>

  <!-- composition lock -->
  <div style="position:absolute;left:0;right:0;top:8%;height:4%;background:rgba(232,180,74,.14);border-top:1px solid rgba(232,180,74,.6);border-bottom:1px solid rgba(232,180,74,.6)"></div>
  <div style="position:absolute;left:0;right:0;top:27%;height:6%;background:rgba(232,180,74,.14);border-top:1px solid rgba(232,180,74,.6);border-bottom:1px solid rgba(232,180,74,.6)"></div>
  <div style="position:absolute;left:0;right:0;top:43%;height:5%;background:rgba(232,180,74,.14);border-top:1px solid rgba(232,180,74,.6);border-bottom:1px solid rgba(232,180,74,.6)"></div>
  <div style="position:absolute;top:0;bottom:0;left:45%;width:10%;background:rgba(232,180,74,.08);border-left:1px solid rgba(232,180,74,.45);border-right:1px solid rgba(232,180,74,.45)"></div>
  <!-- phone + plate zone -->
  <div style="position:absolute;left:30%;top:60%;width:20%;height:25%;border:1px solid rgba(74,222,128,.8)"></div>

  <!-- labels -->
  <span style="position:absolute;left:28%;top:calc(9% + 3px);color:rgba(255,60,60,.9)">MASK x27-80 y9-88</span>
  <span style="position:absolute;left:81%;top:8.2%;color:rgba(232,180,74,.9)">CROWN 8-12</span>
  <span style="position:absolute;left:81%;top:28%;color:rgba(232,180,74,.9)">EYES 27-33</span>
  <span style="position:absolute;left:81%;top:44%;color:rgba(232,180,74,.9)">CHIN 43-48</span>
  <span style="position:absolute;left:45.6%;top:2%;color:rgba(232,180,74,.9)">HEAD x45-55</span>
  <span style="position:absolute;left:30.5%;top:calc(60% + 3px);color:rgba(74,222,128,.9)">PHONE+PLATE</span>
</div>`;

const browser = await launch({ port: 9341, scale: 2 });
try {
  const tab = await browser.newPage({ width: 512, height: 768, mobile: false });
  for (const input of inputs) {
    const src = resolve(input);
    const html = join(repo, '.tmp', 'hero-video', 'mask-preview.html');
    writeFileSync(html, page(pathToFileURL(src).href));
    await goto(tab, pathToFileURL(html).href, { settleMs: 350 });
    const out = join(outDir, `${basename(src, extname(src))}-masked.png`);
    writeFileSync(out, await screenshot(tab));
    console.log(out);
  }
} finally {
  await browser.close();
}
