// Higgsfield image-to-video: ambient hero cinemagraph for review.
// Output goes to web/landing-src/hero-loop/ ONLY — never into the live site.
//   node web/landing-src/hf-video.mjs
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
const PROMPT = `Subtle ambient cinemagraph, locked-off camera, no camera movement. The athlete stays almost perfectly still, only a slow calm breath and a tiny shift of the thumb on the phone. The warm golden rim light gently flickers like a distant stadium lamp, faint dust motes drift slowly through the beam of light, soft glow from the phone screen pulses very slightly. Dark background stays pitch black. Cinematic, photoreal, seamless loop feel, slow motion mood. No new objects, no text, no logos.`;

const ENDPOINTS = [
  ['dop', 'https://platform.higgsfield.ai/higgsfield-ai/dop/standard'],
  ['kling', 'https://platform.higgsfield.ai/kling-video/v2.1/pro/image-to-video'],
  ['seedance', 'https://platform.higgsfield.ai/bytedance/seedance/v1/pro/image-to-video'],
];

async function submit() {
  for (const [name, url] of ENDPOINTS) {
    for (const body of [
      { image_url: IMAGE_URL, prompt: PROMPT, duration: 5 },
      { image_url: IMAGE_URL, prompt: PROMPT },
      { input_image_url: IMAGE_URL, prompt: PROMPT, duration: 5 },
    ]) {
      const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
      const txt = await res.text();
      if (res.ok) { console.log(`submitted via ${name}`); return JSON.parse(txt); }
      console.error(`  ${name} ${Object.keys(body).join(',')} -> ${res.status}: ${txt.slice(0, 240)}`);
      if (txt.includes('not_enough_credits')) throw new Error('not enough Higgsfield API credits for video — top up at cloud.higgsfield.ai');
    }
  }
  throw new Error('all endpoints rejected the request');
}

const sub = await submit();
const id = sub.request_id || sub.id;
console.log('request id:', id);
for (let i = 0; i < 180; i++) {
  await sleep(5000);
  const s = await (await fetch(`https://platform.higgsfield.ai/requests/${id}/status`, { headers: H })).json();
  if (i % 6 === 0) console.log('  status:', s.status);
  if (s.status === 'completed') {
    const url = s.videos?.[0]?.url || s.video?.url || s.images?.[0]?.url || s.result?.url;
    if (!url) { console.error('completed but no url; full payload:', JSON.stringify(s).slice(0, 800)); process.exit(1); }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const file = join(outDir, 'hero-loop.mp4');
    writeFileSync(file, buf);
    console.log(`saved ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
    process.exit(0);
  }
  if (s.status === 'failed' || s.status === 'nsfw') { console.error('generation', s.status, JSON.stringify(s).slice(0, 400)); process.exit(1); }
}
console.error('timed out');
process.exit(1);
