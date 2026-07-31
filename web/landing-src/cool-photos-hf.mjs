// Brand refresh 2026-07-31 — Higgsfield Soul port of cool-photos-gen.mjs (used when the
// OpenAI account is at its billing cap). Same compositions/filenames, cool brand light.
// Run from repo root: node web/landing-src/cool-photos-hf.mjs
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
const rawKey = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawSecret = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const auth = rawKey.includes(':') ? rawKey : (rawKey && rawSecret ? `${rawKey}:${rawSecret}` : '');
if (!auth) { console.error('no Higgsfield credentials in .env'); process.exit(1); }
const H = { Authorization: `Key ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STYLE = 'Cinematic editorial sports photograph. Near-black night environment, a single cool blue-white stadium floodlight as the key light, deep blue-black shadows, subtle teal-cyan rim light, rich contrast, gentle film grain, true photorealism, highly detailed, natural skin texture rendered faithfully. Serious, composed, quietly confident mood. Plain unbranded clothing, no text, no logos, no watermarks, no watches.';

const SHOTS = [
  ['g-hero-athlete', '3:4', 1600, `A young Black male athlete in a dark sleeveless training top, standing in a dark weight room at night, looking down at his phone held in one hand, cool blue-white rim light tracing his profile and shoulders from the left, the rest falling into near-black. Shot from chest up, slightly low angle. ${STYLE}`],
  ['g-hero-athlete2', '3:4', 900, `A young male athlete, around 19, sitting on a locker-room bench in near darkness, leaning forward, forearms on knees, taped wrists, focused eyes catching one cool shaft of light from above. Sweat sheen, quiet determination, not posing, no phone in frame. Waist-up portrait, subject on the left third, dark negative space above and right. ${STYLE}`],
  ['g-hero-coach', '3:4', 900, `A college football coach in his 40s standing at the edge of a dark practice field at night, whistle around his neck, arms relaxed, looking out over the field with calm authority, a single cool stadium floodlight behind him throwing a blue-white halo. Waist-up portrait, subject on the left third, generous dark negative space on the right. ${STYLE}`],
  ['g-hero-parents', '3:4', 900, `A mother and her teenage athlete son at a wooden kitchen table in the evening, one cool modern pendant light overhead, the rest of the room falling to blue-black darkness, a simple healthy dinner plate between them, both mid-laugh, relaxed trust, the teen in a plain athletic hoodie. Waist-up, subjects on the lower left, soft dark negative space upper right. ${STYLE}`],
  ['g-hero-trainer', '3:4', 900, `A female personal trainer in her 30s in a dark performance gym at night, crouched beside a client mid kettlebell deadlift, coaching with an open hand gesture, both lit by one cool overhead industrial lamp, black rubber floor, plates racked in the shadows. Subjects on the left, dark negative space right. ${STYLE}`],
  ['g-hero-dietitian', '3:4', 900, `A sports dietitian in her 30s, sleeves rolled, standing at a dark stone kitchen counter at night arranging three prepared performance meals — grilled chicken, rice, greens — on plain white plates, one cool pendant light overhead, everything else falling to blue-black. Confident, editorial, chef-documentary mood. Waist-up, subject left, dark negative space right. ${STYLE}`],
  ['g-role-coach', '3:4', 900, `A middle-aged male football coach in a dark cap and quarter-zip on a dark sideline at night, arms crossed, jaw set, looking off-frame at his team, cool blue-white floodlight catching one side of his face. Chest-up portrait. ${STYLE}`],
  ['g-role-trainer', '3:4', 900, `A female personal trainer in her 30s in dark athletic wear standing in a dark strength gym, holding a tablet, looking at the camera with calm authority, cool blue-white key light from above-left, squat racks fading into darkness behind. Chest-up portrait. ${STYLE}`],
  ['g-role-program', '4:3', 1200, `A football team huddle seen from behind at night: numbered dark jerseys tight together, heads bowed in, one cool blue-white stadium light overhead cutting through light haze, the numbers on two jerseys catching the light. ${STYLE}`],
  ['g-role-athlete', '3:4', 900, `A teenage female volleyball player with a towel around her neck, sitting on a bench in a dark gym after a late session, elbows on knees, looking up toward the light with quiet determination, cool blue-white side light. Chest-up portrait. ${STYLE}`],
  ['g-role-parents', '3:4', 900, `A mother and father standing together at the edge of a dark football field at night watching their kid practice in the far distance, seen from a three-quarter angle, cool blue-white stadium glow on their faces, calm and proud. Chest-up. ${STYLE}`],
];

async function submit(prompt, aspect) {
  const attempts = [
    { aspect_ratio: aspect, resolution: '1080p' },
    { aspect_ratio: aspect, resolution: '720p' },
  ];
  for (const params of attempts) {
    const res = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/standard', {
      method: 'POST', headers: H, body: JSON.stringify({ prompt, ...params }),
    });
    if (res.ok) return res.json();
    const txt = (await res.text()).slice(0, 300);
    console.error(`  submit ${JSON.stringify(params)} -> ${res.status}: ${txt}`);
    if (txt.includes('not_enough_credits')) throw new Error('no Higgsfield credits');
    if (res.status === 401 || res.status === 403) throw new Error('auth failed');
  }
  throw new Error('all parameter attempts rejected');
}

async function waitFor(id) {
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const res = await fetch(`https://platform.higgsfield.ai/requests/${id}/status`, { headers: H });
    const s = await res.json();
    if (s.status === 'completed') return s;
    if (s.status === 'failed' || s.status === 'nsfw') throw new Error(`generation ${s.status}`);
  }
  throw new Error('timed out');
}

let done = 0;
for (const [name, aspect, width, prompt] of SHOTS) {
  process.stdout.write(`soul ${name}... `);
  try {
    const sub = await submit(prompt, aspect);
    const fin = await waitFor(sub.request_id || sub.id);
    const url = fin.images?.[0]?.url;
    if (!url) throw new Error('no image url');
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const ext = url.split('?')[0].split('.').pop().slice(0, 4) || 'jpg';
    const src = join(outDir, `${name}.${ext}`);
    writeFileSync(src, buf);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${width}:-2`, '-c:v', 'libwebp', '-q:v', '82', join(imgDir, `${name}.webp`)]);
    if (name === 'g-hero-athlete') {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=780:-2', '-c:v', 'libwebp', '-q:v', '82', join(imgDir, 'g-hero-athlete-780.webp')]);
    }
    done++;
    console.log('ok');
  } catch (e) {
    console.log(`SKIPPED (${e.message}) — keeping current image`);
    if (e.message === 'no Higgsfield credits') break;
  }
}
console.log(`\n${done}/${SHOTS.length} regenerated cool-lit via Higgsfield Soul.`);
