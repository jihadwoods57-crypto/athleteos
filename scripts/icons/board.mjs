// OnStandard icon direction board — gpt-image-2.
//
// This is the DESIGN step, not the ship step. It renders the signature symbols large, in the
// instrument language, so the vocabulary can be judged before 46 SVGs get hand-cut. Nothing
// this script produces is shippable: the app's icons are inline SVG at a 24 viewBox with a 2px
// currentColor stroke (proto/redesign-2026-07/js/icons.js), and raster at 22px would go mushy,
// ignore the light/dark theme, and add weight to proto.zip on every OTA.
//
// Usage:  node scripts/icons/board.mjs [name]
// Output: .tmp/icons/<name>.png  (re-rolls land as <name>-2.png, -3.png ...)
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(repo, '.tmp', 'icons');
mkdirSync(outDir, { recursive: true });

const KEY =
  process.env.OPENAI_API_KEY ||
  (readFileSync(join(repo, '.env'), 'utf8').match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('OPENAI_API_KEY missing (env or .env)');

/* ---------- the grammar ----------------------------------------------------------------
   Derived from docs/brand/LOGO.md: the Performance Dial is an arc that does NOT close (gap at
   the bottom) with a marker sitting ON the arc at the reading position, round caps throughout.
   Those four traits are what survive the shrink to 24px, so they are what the whole symbol set
   inherits. Colour is deliberately absent — every icon renders in currentColor, so the board
   must be judged on FORM alone. ------------------------------------------------------------ */
const GRAMMAR = `
A design sheet of 9 monoline icons for a precision-instrument design system, arranged in a clean
even 3x3 grid with generous equal margins between cells. Every icon is drawn in the SAME strict
style, as one coherent family:

- Pure monoline outline. Uniform stroke weight on every icon and every path, roughly 1/12th of
  the icon's own height. Round line caps and round line joins everywhere, no exceptions.
- Geometric and constructed, as if drawn with a compass and ruler on a grid: true circles, true
  arcs, clean tangents. Precise, not hand-drawn, not sketchy, not calligraphic.
- Each icon occupies the same optical square and the same optical weight, so the grid reads
  perfectly even.
- Signature trait: arcs and rings BREAK rather than close, leaving one deliberate gap, and a
  small SOLID FILLED DOT sits on the path at the break or at the top reading position, like the
  marker on a gauge needle. This gauge-marker motif recurs across the set.
- Secondary trait: short measurement tick marks radiating from arcs, like the bezel of a
  chronograph or the graduations on a caliper.
- The mood is scientific measurement equipment: dials, gauges, calipers, chronograph bezels,
  surveying marks. Restrained, engineered, expensive. NOT playful, NOT rounded-cartoon,
  NOT sporty, NOT decorative.

The 9 icons, reading left to right, top to bottom:
1. A lightning bolt, angular and geometric, with a small filled marker dot at its tip.
2. A shield, its outline broken by one clean gap, with a filled marker dot on the break.
3. A clipboard holding a document, with three short graduation ticks as the lines of text.
4. A concentric target of two broken rings with a filled dot at the exact center.
5. A flame drawn as two clean nested arcs with a filled dot at the tip.
6. A weighing scale platform seen from the front, with a graduated tick arc above it.
7. A crescent moon whose inner curve is broken, with a small filled dot in the gap.
8. Three vertical bars of stepping height, with a small filled marker dot above the tallest.
9. A clock face as a broken circle with a graduation tick bezel and two hands.

Flat vector rendering. Absolutely no text, no letters, no numbers, no labels, no captions, no
watermarks anywhere on the image. No drop shadows, no gradients, no 3D, no bevel, no gloss, no
skeuomorphism, no photographic texture.
`;

const LOOK = `
Very dark near-black background, a deep cool navy-black. The icons are stroked in a soft cool
off-white with a faint blue cast. Even, flat, high-contrast rendering. No background texture, no
vignette, no glow, no lighting effects.
`;

const name = process.argv[2] || 'board';
let out = join(outDir, `${name}.png`);
for (let take = 2; existsSync(out); take++) out = join(outDir, `${name}-${take}.png`);

const prompt = `${GRAMMAR}\n${LOOK}`;
process.stdout.write(`gpt-image-2 -> ${out} ... `);

const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1024', quality: 'high', n: 1 }),
});
if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
writeFileSync(out, Buffer.from((await res.json()).data[0].b64_json, 'base64'));
console.log('ok');
