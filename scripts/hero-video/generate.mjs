// Hero-loop keyframes — six subjects, one silhouette.
//
// gpt-image-2 at 1024x1536 (2:3, same as the slot). The whole edit depends on
// every head landing on the SAME anchor coordinates (crown y8-12%, eyes
// y27-33%, chin y43-48%, centre x45-55%, phone+plate x30-50% y60-85%), so the
// framing block below is not styling — it is the cut. Judge every output
// through scripts/hero-video/mask-preview.mjs, never raw.
//
// Usage:  node scripts/hero-video/generate.mjs a          (one shot)
//         node scripts/hero-video/generate.mjs b c d e f  (several)
// Output: .tmp/hero-video/keyframes/<id>.png — an existing take is never
// overwritten; re-rolls land as <id>-2.png, <id>-3.png for manual selection.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(repo, '.tmp', 'hero-video', 'keyframes');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const KEY = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();

// --engine soul falls back to Higgsfield Soul (same credit pool as the video
// gens) — added 2026-07-30 when the OpenAI account hit its billing hard limit.
const engineArg = process.argv.indexOf('--engine');
const ENGINE = engineArg > -1 ? process.argv[engineArg + 1] : 'openai';
const rawHk = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawHs = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const HAUTH = rawHk.includes(':') ? rawHk : (rawHk && rawHs ? `${rawHk}:${rawHs}` : '');
if (ENGINE === 'openai' && !KEY) { console.error('no OPENAI_API_KEY in .env'); process.exit(1); }
if (ENGINE === 'soul' && !HAUTH) { console.error('no Higgsfield credentials in .env'); process.exit(1); }

// Brand refresh 2026-07-31: the landing site retired its warm gold chrome for the
// product's own dark-navy + blue/teal signature (docs/brand/LOGO.md). This LOOK constant
// used to bake the old gold (#E8B44A) / near-black-warm (#0B0A08) palette directly into the
// art direction — updated to the cool key light used by every other landing photo
// (web/landing-src/cool-photos-hf.mjs). NOTE: this alone does not fix the LIVE hero-loop.mp4,
// which was rendered under the old LOOK and is still visibly warm/gold on faces and clothing
// (confirmed by frame inspection) — it only stops a future re-run from reproducing that look.
const LOOK = `Photorealistic editorial sport photography. Full-frame camera, 50mm lens at f/2.0, shallow depth of field, rich fine film grain, deep crushed blacks. One large soft cool blue-white key light from camera left, wrapping the cheekbone, jaw and forearm in cool light. A second subtle teal-cyan rim light traces the right shoulder and the far side of the face. The phone screen adds a faint cool-neutral fill under the chin and on the hands, consistent with the key light. Background: near-black blue-dark (#070B14), completely unreadable, the real environment implied by one or two soft out-of-focus shapes only. Muted, desaturated palette. No haze, no lens flare, no bloom.`;

const FRAMING = `Vertical 2:3 portrait, chest-up. A thin strip of darkness, about one twelfth of the frame height, separates the top of the hair from the top edge of the frame — the hair never touches the top edge and the strip never grows taller than that. The eyes sit roughly one third of the way down the frame. The chin sits just above the vertical centre of the frame. The head is centred horizontally. The shoulders and chest run off the bottom edge of the frame — never a floating cut-off torso. The phone and the meal sit together in the lower middle of the frame, slightly left of centre, both fully inside frame and clearly readable as phone-over-food.`;

const ACTION = `The subject holds a phone flat in one hand, camera side down, photographing the meal in front of them. Their eyes are on the food or on the screen, never toward the camera. The expression is warm and quietly pleased: a faint, natural closed-mouth smile just starting at the corners of the mouth, relaxed brows, bright engaged eyes — the look of someone genuinely looking forward to a meal they feel good about earning. Content and alive, never solemn, never a posed grin, no visible teeth. Caught unposed a fraction of a second before the shutter fires: a slight forward lean, real body weight, one shoulder a little lower than the other. The phone screen shows only a soft neutral glow — no interface, no icons, no images on it.`;

const RULES = `Absolutely no text, letters, numbers, logos, brand marks or user interface anywhere in the image — not on the phone screen, not on clothing, nowhere. No watermark. No white or bright background, no studio backdrop. Not smiling at the camera, no laughing. The food is real, ordinary and a little unphotogenic — no glossy food styling, no restaurant plating. Hands natural and anatomically correct.`;

// Camera-angle grammar: every shot keeps the head on the SAME anchor
// coordinates (that lock is what makes the cuts read as one silhouette and
// what blends the video into the hero mask), but the camera attitude varies
// per subject so the sequence feels like a multi-camera shoot, not six
// repeats. Shot (a) stays dead frontal — it must register with the live
// still through the 1.2s cross-fade.
const SUBJECTS = {
  a: `A Black male college football player in his early twenties, broad shoulders, wearing a sweat-damp plain practice tee, sitting at a training-table in a dark dining hall, a compartment tray of grilled chicken, white rice and broccoli in front of him. Camera straight on at his chest level.`,
  b: `An East Asian female volleyball player in her late teens, hair tied back, knee pads pushed down to her shins, sitting on a gym bench in a dark gymnasium, a rice bowl with salmon and greens resting on her lap. Camera slightly above her eye level, angled gently down, catching the bowl on her lap.`,
  c: `A white male CrossFit athlete in his late thirties, chalk dust on his hands, hoodie sleeves shoved up his forearms, standing at his home kitchen counter at night, fried eggs, sliced avocado and sourdough toast on a chipped ceramic plate. Camera in a three-quarter view from his left, slightly below his chest level, looking gently up.`,
  d: `A Latina distance runner in her late twenties, lean, wearing a plain long-sleeve running top, at a kitchen table before dawn, a bowl of oatmeal with berries and a cup of black coffee in front of her. Camera in a three-quarter view from her right at table level.`,
  e: `A South Asian woman in her mid forties, an everyday gym client in plain athleisure, in a dim office break room, a packed glass meal-prep container of lentils, chicken and salad open in front of her. Camera slightly above eye level in a gentle three-quarter view from her left, catching the open container.`,
  f: `A Black female basketball player in her early twenties, wearing a plain warm-up shooting shirt, sitting on a locker-room bench, an open takeout container of pasta and grilled chicken beside her. Camera slightly below her eye level in a three-quarter view from her right, lockers falling into darkness behind.`,
};

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== 'soul' && a !== 'openai');
if (!ids.length || ids.some((s) => !SUBJECTS[s])) {
  console.error(`usage: node scripts/hero-video/generate.mjs <${Object.keys(SUBJECTS).join('|')}> [...] [--engine soul|openai]`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function genOpenai(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1536', quality: 'high', n: 1 }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from((await res.json()).data[0].b64_json, 'base64');
}

async function genSoul(prompt) {
  const H = { 'Authorization': `Key ${HAUTH}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  let sub;
  for (const params of [
    { aspect_ratio: '2:3', resolution: '1080p' },
    { aspect_ratio: '3:4', resolution: '1080p' },
  ]) {
    const res = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/standard', {
      method: 'POST', headers: H, body: JSON.stringify({ prompt, ...params }),
    });
    const txt = await res.text();
    if (res.ok) { sub = JSON.parse(txt); break; }
    console.error(`  soul ${params.aspect_ratio} -> ${res.status}: ${txt.slice(0, 160)}`);
    if (txt.includes('not_enough_credits')) throw new Error('not enough Higgsfield credits');
  }
  if (!sub) throw new Error('soul: all submit attempts rejected');
  const reqId = sub.request_id || sub.id;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const s = await (await fetch(`https://platform.higgsfield.ai/requests/${reqId}/status`, { headers: H })).json();
    if (s.status === 'completed') {
      const u = s.images?.[0]?.url;
      if (!u) throw new Error(`soul completed, no url: ${JSON.stringify(s).slice(0, 300)}`);
      return Buffer.from(await (await fetch(u)).arrayBuffer());
    }
    if (s.status === 'failed' || s.status === 'nsfw') throw new Error(`soul generation ${s.status}`);
  }
  throw new Error('soul timed out');
}

for (const id of ids) {
  let out = join(outDir, `${id}.png`);
  for (let take = 2; existsSync(out); take++) out = join(outDir, `${id}-${take}.png`);
  process.stdout.write(`${ENGINE} shot (${id}) -> ${out} ... `);
  const prompt = `${SUBJECTS[id]} ${ACTION} ${FRAMING} ${LOOK} ${RULES}`;
  try {
    const buf = ENGINE === 'soul' ? await genSoul(prompt) : await genOpenai(prompt);
    writeFileSync(out, buf);
    console.log('ok');
  } catch (e) {
    console.error(`FAILED ${e.message}`);
    process.exit(1);
  }
}
