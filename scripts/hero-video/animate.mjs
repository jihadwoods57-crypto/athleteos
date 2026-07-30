// Hero-loop animation — approved keyframes in, 4s micro-motion clips out.
//
// Client written against the docs at docs.higgsfield.ai (2026-07-29):
//   auth    Authorization: Key <key>:<secret>
//   submit  POST https://platform.higgsfield.ai/{model_id}  { image_url, prompt, duration }
//           kling v2.5-turbo accepts duration 5 or 10 ONLY (4 -> 400), hence the ladder below;
//           the 5s clip gets cut down to ~3.5s at the shutter pulse in assemble.mjs anyway
//   poll    GET  https://platform.higgsfield.ai/requests/{id}/status
//           queued | in_progress | completed | failed | nsfw (failed/nsfw refund)
// The API takes input images by PUBLIC URL only (the upload helper exists only
// in the Python SDK), so keyframes are staged on catbox.moe first — they are
// non-sensitive generated marketing frames. Model: kling v2.5-turbo pro, which
// the earlier shootout showed returns the INPUT aspect (2:3 -> 1176x1764) at a
// native 24fps — no crop, no reframe, plenty of resolution for 900x1350.
//
// Usage:  node scripts/hero-video/animate.mjs a [b c ...]
// Input:  .tmp/hero-video/keyframes/<id>.png (the approved take)
// Output: .tmp/hero-video/clips/<id>.mp4
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const keyDir = join(repo, '.tmp', 'hero-video', 'keyframes');
const outDir = join(repo, '.tmp', 'hero-video', 'clips');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const rawKey = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawSecret = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const auth = rawKey.includes(':') ? rawKey : (rawKey && rawSecret ? `${rawKey}:${rawSecret}` : '');
if (!auth) { console.error('no Higgsfield credentials in .env'); process.exit(1); }
const H = { 'Authorization': `Key ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODEL = 'kling-video/v2.5-turbo/pro/image-to-video';

export const MOTION_BRIEF = `Four-second cinematic shot. The camera pushes in very slowly and smoothly, no more than 4 percent total — no pan, no orbit, no rack focus, no handheld shake. The subject moves with quiet purpose: they steady the phone over the food and tilt it slightly to line up the photo, a single blink, a small pleased tilt of the head as the shot comes together, fabric settling, faint steam drifting off the food. Energy is upbeat and engaged — absolutely no sighing, no slumping, no heavy exhale, no visible chest heave. The warm, quietly pleased expression stays exactly as it is throughout — no frowning, no furrowed brow. In the final half second the phone screen glow pulses once, as if the shutter just fired. Do not alter the face, identity, body, clothing or food. No text, no screen UI, no added people or objects, no audio.`;

// Stage a keyframe where the API can fetch it. catbox.moe first, 0x0.st fallback.
async function stage(id) {
  const png = readFileSync(join(keyDir, `${id}.png`));
  const blob = new Blob([png], { type: 'image/png' });
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', blob, `onstd-hero-${id}.png`);
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const url = (await res.text()).trim();
    if (res.ok && url.startsWith('https://')) return url;
    throw new Error(`catbox ${res.status}: ${url.slice(0, 120)}`);
  } catch (e) {
    console.error(`  [${id}] catbox failed (${e.message}), trying 0x0.st`);
    const form = new FormData();
    form.append('file', blob, `onstd-hero-${id}.png`);
    const res = await fetch('https://0x0.st', {
      method: 'POST', body: form, headers: { 'User-Agent': 'onstandard-hero-video/1.0' },
    });
    const url = (await res.text()).trim();
    if (res.ok && url.startsWith('http')) return url;
    throw new Error(`0x0.st ${res.status}: ${url.slice(0, 120)}`);
  }
}

async function animate(id) {
  const imageUrl = await stage(id);
  console.log(`[${id}] staged keyframe`);
  let sub;
  for (const body of [
    { image_url: imageUrl, prompt: MOTION_BRIEF, duration: 4 },
    { image_url: imageUrl, prompt: MOTION_BRIEF, duration: 5 },
    { image_url: imageUrl, prompt: MOTION_BRIEF },
  ]) {
    const res = await fetch(`https://platform.higgsfield.ai/${MODEL}`, {
      method: 'POST', headers: H, body: JSON.stringify(body),
    });
    const txt = await res.text();
    if (res.ok) { sub = JSON.parse(txt); break; }
    console.error(`[${id}] submit duration=${body.duration ?? 'default'} -> ${res.status}: ${txt.slice(0, 200)}`);
    if (txt.includes('not_enough_credits')) throw new Error('not enough Higgsfield credits');
    if (res.status === 401 || res.status === 403) throw new Error('auth failed');
  }
  if (!sub) throw new Error(`[${id}] all submit attempts rejected`);
  const reqId = sub.request_id || sub.id;
  console.log(`[${id}] submitted ${reqId}`);
  for (let i = 0; i < 240; i++) {
    await sleep(5000);
    const s = await (await fetch(`https://platform.higgsfield.ai/requests/${reqId}/status`, { headers: H })).json();
    if (i % 12 === 0) console.log(`[${id}] ${s.status}`);
    if (s.status === 'completed') {
      const u = s.videos?.[0]?.url || s.video?.url || s.result?.url;
      if (!u) throw new Error(`[${id}] completed but no url: ${JSON.stringify(s).slice(0, 400)}`);
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      const file = join(outDir, `${id}.mp4`);
      writeFileSync(file, buf);
      console.log(`[${id}] saved ${file} (${(buf.length / 1e6).toFixed(1)} MB)`);
      return;
    }
    if (s.status === 'failed' || s.status === 'nsfw') throw new Error(`[${id}] generation ${s.status}`);
  }
  throw new Error(`[${id}] timed out after 20 min`);
}

const ids = process.argv.slice(2);
if (!ids.length) { console.error('usage: node scripts/hero-video/animate.mjs <id> [...]'); process.exit(1); }
const results = await Promise.allSettled(ids.map(animate));
let failed = 0;
for (const [i, r] of results.entries()) {
  if (r.status === 'rejected') { failed++; console.error(`${ids[i]}: ${r.reason.message}`); }
}
process.exit(failed ? 1 : 0);
