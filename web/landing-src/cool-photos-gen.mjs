// Brand refresh 2026-07-31: regenerate the landing photo set in the unified brand light —
// cool blue-white key light + teal rim replacing the retired gold/tungsten look.
// Same compositions and filenames as the originals (role-heroes-gen.mjs / hf-gen.mjs);
// PNG sources land in web/landing-src/src-png/cool-v1/, then webp overwrites
// web/landing/assets/img/ at each file's current width. Run from repo root:
//   node web/landing-src/cool-photos-gen.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(here, 'src-png', 'cool-v1');
const imgDir = join(repo, 'web', 'landing', 'assets', 'img');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const KEY = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error('no OPENAI_API_KEY in .env'); process.exit(1); }

const STYLE = 'Cinematic editorial sports photography. Night scene, one cool blue-white stadium floodlight as the key light, deep blue-black shadows, subtle teal-cyan rim light, shallow depth of field, shot on 35mm, photorealistic, natural skin texture rendered faithfully. Plain unbranded athletic clothing and environments, absolutely no logos, no brand marks, no readable text anywhere, no watches. Hands natural and anatomically correct.';

const SHOTS = [
  // hero set (portrait) — compositions from role-heroes-gen.mjs / hf-gen.mjs, relit
  { name: 'g-hero-athlete', size: '1024x1536', w: 1600, prompt: `${STYLE} A young Black male athlete in a dark sleeveless training top, standing in a dark weight room at night, looking down at his phone held in one hand, cool blue-white rim light tracing his profile and shoulders from the left, the rest falling into near-black. Shot from chest up, slightly low angle.` },
  { name: 'g-hero-athlete2', size: '1024x1536', w: 900, prompt: `${STYLE} A young male athlete, around 19, sitting on a locker-room bench in near darkness, leaning forward, forearms on knees, taped wrists, focused eyes catching one cool shaft of light from above. Sweat sheen, quiet determination, not posing. Waist-up portrait, subject on the left third, dark negative space above and right. No phone in frame.` },
  { name: 'g-hero-coach', size: '1024x1536', w: 900, prompt: `${STYLE} A college football coach in his 40s standing at the edge of a dark practice field at night, whistle around his neck, arms relaxed, looking out over the field with calm authority. The single cool stadium floodlight behind him throws a blue-white halo. Waist-up portrait, subject on the left third, generous dark negative space on the right.` },
  { name: 'g-hero-parents', size: '1024x1536', w: 900, prompt: `${STYLE} A mother and her teenage athlete son at a wooden kitchen table in the evening, one cool modern pendant light overhead, the rest of the room falling to blue-black darkness. A simple healthy dinner plate between them, both mid-laugh, relaxed trust. The teen wears a plain athletic hoodie. Waist-up, subjects on the lower left, soft dark negative space upper right.` },
  { name: 'g-hero-trainer', size: '1024x1536', w: 900, prompt: `${STYLE} A female personal trainer in her 30s in a dark performance gym at night, crouched beside a client mid kettlebell deadlift, coaching with an open hand gesture, both lit by one cool overhead industrial lamp, black rubber floor, plates racked in the shadows. Subjects on the left, dark negative space right.` },
  { name: 'g-hero-dietitian', size: '1024x1536', w: 900, prompt: `${STYLE} A sports dietitian in her 30s, sleeves rolled, standing at a dark stone kitchen counter at night arranging three prepared performance meals — grilled chicken, rice, greens — on plain white plates, one cool pendant light overhead, everything else falling to blue-black. Confident, editorial, chef-documentary mood. Waist-up, subject left, dark negative space right.` },
  // role set — compositions from hf-gen.mjs, relit
  { name: 'g-role-coach', size: '1024x1536', w: 900, prompt: `${STYLE} A middle-aged male football coach in a dark cap and quarter-zip on a dark sideline at night, arms crossed, jaw set, looking off-frame at his team, cool blue-white floodlight catching one side of his face. Chest-up portrait.` },
  { name: 'g-role-trainer', size: '1024x1536', w: 900, prompt: `${STYLE} A female personal trainer in her 30s in dark athletic wear standing in a dark strength gym, holding a tablet, looking at the camera with calm authority, cool blue-white key light from above-left, squat racks fading into darkness behind. Chest-up portrait.` },
  { name: 'g-role-program', size: '1536x1024', w: 1200, prompt: `${STYLE} A football team huddle seen from behind at night: numbered dark jerseys tight together, heads bowed in, one cool blue-white stadium light overhead cutting through light haze. The numbers on two jerseys catch the light.` },
  { name: 'g-role-athlete', size: '1024x1536', w: 900, prompt: `${STYLE} A teenage female volleyball player with a towel around her neck, sitting on a bench in a dark gym after a late session, elbows on knees, looking up toward the light with quiet determination, cool blue-white side light. Chest-up portrait.` },
  { name: 'g-role-parents', size: '1024x1536', w: 900, prompt: `${STYLE} A mother and father standing together at the edge of a dark football field at night watching their kid practice in the far distance, seen from a three-quarter angle, cool blue-white stadium glow on their faces, calm and proud. Chest-up.` },
];

const gen = async (shot) => {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt: shot.prompt, size: shot.size, quality: 'high', n: 1 }),
  });
  if (!res.ok) throw new Error(`${shot.name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error(`${shot.name}: no image`);
  const src = join(outDir, `${shot.name}.png`);
  writeFileSync(src, Buffer.from(b64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${shot.w}:-2`, '-c:v', 'libwebp', '-q:v', '82', join(imgDir, `${shot.name}.webp`)]);
  // the index hero also ships a 780-wide variant
  if (shot.name === 'g-hero-athlete') {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=780:-2', '-c:v', 'libwebp', '-q:v', '82', join(imgDir, 'g-hero-athlete-780.webp')]);
  }
  console.log('ok', shot.name);
};

const results = await Promise.allSettled(SHOTS.map(gen));
const failed = results.filter((r) => r.status === 'rejected');
failed.forEach((r) => console.error('FAIL', r.reason.message));
console.log(`${SHOTS.length - failed.length}/${SHOTS.length} regenerated cool-lit.`);
