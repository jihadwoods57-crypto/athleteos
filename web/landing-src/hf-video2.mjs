// Higgsfield top-tier image-to-video shootout for the hero cinemagraph.
// Runs Kling v2.1 Master, Kling v2.5-turbo Pro, and Hailuo-02 Pro in parallel.
// Output: web/landing-src/hero-loop/hero-<model>.mp4 (review only, not live).
//   node web/landing-src/hf-video2.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(here, 'hero-loop');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const rawKey = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawSecret = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const auth = rawKey.includes(':') ? rawKey : `${rawKey}:${rawSecret}`;
const H = { 'Authorization': `Key ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IMAGE_URL = 'https://onstandard.app/assets/img/g-hero-athlete.webp';
const PROMPT = `Subtle ambient cinemagraph, locked-off camera, absolutely no camera movement, no zoom. The athlete stays almost perfectly still: one slow calm breath, a tiny thumb movement on the phone screen. His face does not change. The warm golden rim light gently flickers like a distant stadium lamp, faint dust motes drift slowly through the light beam, the phone screen glow pulses very slightly on his hand. Background stays pitch black. Photoreal, cinematic, seamless-loop feel. No new objects, no text, no logos.`;

const MODELS = [
  ['kling-master', 'https://platform.higgsfield.ai/kling-video/v2.1/master/image-to-video'],
  ['kling-25turbo', 'https://platform.higgsfield.ai/kling-video/v2.5-turbo/pro/image-to-video'],
  ['hailuo02-pro', 'https://platform.higgsfield.ai/minimax/hailuo-02/pro/image-to-video'],
];

async function run(name, url) {
  let sub;
  for (const body of [
    { image_url: IMAGE_URL, prompt: PROMPT, duration: 5 },
    { image_url: IMAGE_URL, prompt: PROMPT },
  ]) {
    const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const txt = await res.text();
    if (res.ok) { sub = JSON.parse(txt); break; }
    console.error(`[${name}] submit -> ${res.status}: ${txt.slice(0, 220)}`);
    if (txt.includes('not_enough_credits')) throw new Error(`${name}: not enough credits`);
  }
  if (!sub) throw new Error(`${name}: all submit attempts rejected`);
  const id = sub.request_id || sub.id;
  console.log(`[${name}] submitted ${id}`);
  for (let i = 0; i < 240; i++) {
    await sleep(5000);
    const s = await (await fetch(`https://platform.higgsfield.ai/requests/${id}/status`, { headers: H })).json();
    if (i % 12 === 0) console.log(`[${name}] ${s.status}`);
    if (s.status === 'completed') {
      const u = s.videos?.[0]?.url || s.video?.url || s.result?.url;
      if (!u) throw new Error(`${name}: completed, no url: ${JSON.stringify(s).slice(0, 400)}`);
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      const file = join(outDir, `hero-${name}.mp4`);
      writeFileSync(file, buf);
      console.log(`[${name}] saved ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
      return name;
    }
    if (s.status === 'failed' || s.status === 'nsfw') throw new Error(`${name}: ${s.status}`);
  }
  throw new Error(`${name}: timed out`);
}

const results = await Promise.allSettled(MODELS.map(([n, u]) => run(n, u)));
for (const [i, r] of results.entries()) console.log(`${MODELS[i][0]}: ${r.status === 'fulfilled' ? 'OK' : r.reason.message}`);
