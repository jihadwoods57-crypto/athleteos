// Generate the five role-page hero photos with gpt-image-2.
// Style-matched to the live landing set: night, one warm tungsten floodlight,
// deep black shadows, gold rim light, unbranded kit, no readable text, no devices
// (real OnStandard UI gets overlaid in the page, never faked in the photo).
// PNG sources land in web/landing-src/src-png/roles-v1/ (the restore source);
// webp conversion for web/landing/assets/img/ happens in a separate ffmpeg pass.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'src-png', 'roles-v1');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(here, '..', '..', '.env'), 'utf8');
const KEY = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error('no OPENAI_API_KEY in .env'); process.exit(1); }

const STYLE = 'Cinematic editorial sports photography. Night scene, one warm tungsten floodlight as the key light, deep black shadows, subtle gold-amber rim light, shallow depth of field, shot on 35mm, photorealistic, natural skin texture. Plain unbranded athletic clothing and environments, absolutely no logos, no brand marks, no readable text anywhere, no phones, no screens, no watches. Hands natural and anatomically correct.';

const SHOTS = [
  {
    name: 'g-hero-coach',
    size: '1024x1536',
    prompt: `${STYLE} A college football coach in his 40s standing at the edge of a dark practice field at night, whistle around his neck, arms relaxed, looking out over the field with calm authority. The single stadium floodlight behind him throws a warm halo. Waist-up portrait, subject on the left third, generous dark negative space on the right.`,
  },
  {
    name: 'g-hero-athlete2',
    size: '1024x1536',
    prompt: `${STYLE} A young male athlete, around 19, sitting on a locker-room bench in near darkness, leaning forward, forearms on knees, taped wrists, focused eyes catching one warm shaft of light from above. Sweat sheen, quiet determination, not posing. Waist-up portrait, subject on the left third, dark negative space above and right.`,
  },
  {
    name: 'g-hero-parents',
    size: '1024x1536',
    prompt: `${STYLE} A mother and her teenage athlete son at a wooden kitchen table in the evening, warm pendant light overhead, the rest of the room falling to darkness. A simple healthy dinner plate between them, both mid-laugh, relaxed trust. The teen wears a plain athletic hoodie. Waist-up, subjects on the lower left, soft dark negative space upper right.`,
  },
  {
    name: 'g-hero-trainer',
    size: '1024x1536',
    prompt: `${STYLE} A female personal trainer in her 30s in a dark performance gym at night, crouched beside a client mid kettlebell deadlift, coaching with an open hand gesture, both lit by one warm overhead industrial lamp, black rubber floor, plates racked in the shadows. Subjects on the left, dark negative space right.`,
  },
  {
    name: 'g-hero-dietitian',
    size: '1024x1536',
    prompt: `${STYLE} A sports dietitian in her 30s, sleeves rolled, standing at a dark stone kitchen counter at night arranging three prepared performance meals — grilled chicken, rice, greens — on plain white plates, one warm pendant light overhead, everything else falling to black. Confident, editorial, chef-documentary mood. Waist-up, subject left, dark negative space right.`,
  },
];

const gen = async (shot) => {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: shot.prompt,
      size: shot.size,
      quality: 'high',
      n: 1,
    }),
  });
  const out = await res.json();
  if (!res.ok || !out.data?.[0]?.b64_json) {
    throw new Error(`${shot.name}: ${res.status} ${JSON.stringify(out).slice(0, 400)}`);
  }
  const file = join(outDir, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(out.data[0].b64_json, 'base64'));
  console.log('saved', file);
};

let failed = 0;
for (const shot of SHOTS) {
  try { await gen(shot); } catch (e) { failed++; console.error(String(e)); }
}
process.exit(failed ? 1 : 0);
