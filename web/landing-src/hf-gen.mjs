// Higgsfield (Soul) regeneration of the landing photo set.
// Turnkey: put HIGGSFIELD_API_KEY (and HIGGSFIELD_API_SECRET, or KEY as "key:secret")
// into the repo .env, then run from repo root:
//   node web/landing-src/hf-gen.mjs
// It generates the same art-directed set, saves PNG/JPG sources to
// web/landing-src/src-png/hf/, converts to webp with the SAME filenames the
// site already uses (assets/img/g-*.webp), so no HTML changes are needed.
// Originals from gpt-image-2 stay in src-png/ untouched.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const srcDir = join(here, 'src-png', 'hf');
const imgDir = join(repo, 'web', 'landing', 'assets', 'img');
mkdirSync(srcDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const rawKey = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawSecret = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const auth = rawKey.includes(':') ? rawKey : (rawKey && rawSecret ? `${rawKey}:${rawSecret}` : '');
if (!auth) {
  console.error('No Higgsfield credentials. Add to .env:\n  HIGGSFIELD_API_KEY=<key>\n  HIGGSFIELD_API_SECRET=<secret>\n(or HIGGSFIELD_API_KEY=key:secret on one line)');
  process.exit(1);
}

const STYLE = `Cinematic editorial sports photograph. Near-black environment, a single warm golden key light like sodium stadium lamps, deep shadows, rich contrast, gentle film grain, true photorealism, highly detailed. Serious, composed, quietly confident mood. No text, no logos, no watermarks.`;

const jobs = [
  ['g-hero-athlete', '3:4', `A young Black male athlete in a dark sleeveless training top, standing in a dark weight room at night, looking down at his phone held in one hand, warm golden rim light tracing his profile and shoulders from the left, the rest falling into near-black. Shot from chest up, slightly low angle. ${STYLE}`],
  ['g-role-coach', '3:4', `A middle-aged male football coach in a dark cap and quarter-zip on a dark sideline at night, arms crossed, jaw set, looking off-frame at his team, warm golden floodlight catching one side of his face. Chest-up portrait. ${STYLE}`],
  ['g-role-trainer', '3:4', `A female personal trainer in her 30s in dark athletic wear standing in a dark strength gym, holding a tablet, looking at the camera with calm authority, warm golden key light from above-left, squat racks fading into darkness behind. Chest-up portrait. ${STYLE}`],
  ['g-role-program', '4:3', `A football team huddle seen from behind at night: numbered dark jerseys tight together, heads bowed in, one warm golden stadium light overhead cutting through light haze. The numbers on two jerseys catch the light. ${STYLE}`],
  ['g-role-athlete', '3:4', `A teenage female volleyball player with a towel around her neck, sitting on a bench in a dark gym after a late session, elbows on knees, looking up toward the light with quiet determination, warm golden side light. Chest-up portrait. ${STYLE}`],
  ['g-role-parents', '3:4', `A mother and father standing together at the edge of a dark football field at night watching their kid practice in the far distance, seen from a three-quarter angle, warm golden stadium glow on their faces, calm and proud. Chest-up. ${STYLE}`],
];

const H = { 'Authorization': `Key ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(prompt, aspect) {
  const attempts = [
    { aspect_ratio: aspect, resolution: '1080p' },
    { aspect_ratio: aspect, resolution: '720p' },
    { aspect_ratio: aspect === '4:3' ? '16:9' : '9:16', resolution: '720p' },
  ];
  for (const params of attempts) {
    const res = await fetch('https://platform.higgsfield.ai/higgsfield-ai/soul/standard', {
      method: 'POST', headers: H, body: JSON.stringify({ prompt, ...params }),
    });
    if (res.ok) return res.json();
    const txt = (await res.text()).slice(0, 300);
    console.error(`  submit ${JSON.stringify(params)} -> ${res.status}: ${txt}`);
    if (res.status === 401 || res.status === 403) throw new Error('auth failed — check key/secret');
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

let swapped = 0;
for (const [name, aspect, prompt] of jobs) {
  process.stdout.write(`higgsfield ${name}... `);
  try {
    const sub = await submit(prompt, aspect);
    const done = await waitFor(sub.request_id || sub.id);
    const url = done.images?.[0]?.url;
    if (!url) throw new Error('no image url in result');
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const ext = url.split('?')[0].split('.').pop().slice(0, 4) || 'jpg';
    const src = join(srcDir, `${name}.${ext}`);
    writeFileSync(src, buf);
    const width = name === 'g-role-program' ? 1200 : 900;
    execSync(`ffmpeg -y -loglevel error -i "${src}" -vf scale=${width}:-2 -c:v libwebp -q:v 80 "${join(imgDir, name + '.webp')}"`);
    swapped++;
    console.log('ok');
  } catch (e) {
    console.log(`SKIPPED (${e.message}) — keeping the current gpt-image-2 version`);
  }
}
console.log(`\n${swapped}/${jobs.length} images regenerated via Higgsfield Soul.`);
if (swapped) console.log('Review web/landing locally, then redeploy:\n  cd web/landing-src/deploy && npx wrangler deploy   (with CLOUDFLARE_API_TOKEN set)');
