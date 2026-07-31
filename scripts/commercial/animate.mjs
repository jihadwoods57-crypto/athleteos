// "One Day on Standard" — keyframes in, 5s cinematic clips out (Kling v2.5-turbo pro).
// Same client shape as scripts/hero-video/animate.mjs (docs.higgsfield.ai, 2026-07-29):
// public-URL inputs staged on catbox.moe, duration must be 5 or 10, poll /requests/{id}/status.
//
// Usage:  node scripts/commercial/animate.mjs s1 s2 s3 s4 s5
// Input:  .tmp/commercial/keyframes/<id>-final.png
// Output: .tmp/commercial/clips/<id>.mp4
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const keyDir = join(repo, '.tmp', 'commercial', 'keyframes');
const outDir = join(repo, '.tmp', 'commercial', 'clips');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const rawKey = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawSecret = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const auth = rawKey.includes(':') ? rawKey : (rawKey && rawSecret ? `${rawKey}:${rawSecret}` : '');
if (!auth) { console.error('no Higgsfield credentials in .env'); process.exit(1); }
const H = { 'Authorization': `Key ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MODEL = 'kling-video/v2.5-turbo/pro/image-to-video';

const COMMON = `Five-second cinematic shot. The camera pushes in very slowly and smoothly, no more than 4 percent total — no pan, no orbit, no rack focus, no handheld shake. Energy is calm and purposeful — absolutely no sighing, no slumping, no heavy exhale, no visible chest heave, no frowning. The mouth stays (or settles) in a relaxed CLOSED-mouth expression — no teeth. Do not alter the face, identity, body, clothing, room or food. No text, no screen user interface, no added people or objects, no audio.`;

const BRIEFS = {
  s1: `The young man lying in bed wakes with quiet resolve: his eyes open fully, he turns his head a fraction toward the glowing phone, and his outstretched hand closes around the phone and lifts it slightly off the nightstand. The phone's glow brightens once as he takes it. Bedding shifts subtly with the movement. ${COMMON}`,
  s2: `The athlete steadies the phone hovering flat above the breakfast plate, tilting it a few degrees to line up the photo, one slow blink, a small pleased tilt of the head as the shot comes together; faint steam drifts off the food. In the final half second the phone's screen glow pulses once, as if the shutter just fired. ${COMMON}`,
  s3: `The woman at the desk reads her phone; her soft proud closed-mouth smile deepens a touch, her thumb taps the screen once, and she gives the smallest shake of the head — the good kind, quiet pride. Window light stays soft and steady; loose strands of hair move faintly. ${COMMON}`,
  s4: `The coach reads the phone in his hand and gives ONE small approving nod, jaw set, the faint closed-mouth smile holding; his thumb taps the screen once. A light breeze moves his shirt sleeve and the lanyard slightly; the empty field and bleachers behind stay still. ${COMMON}`,
  s5: `The athlete sitting against the headboard at night reads the phone with quiet satisfaction; his mouth settles into a relaxed closed-mouth smile, his thumb makes one slow scroll, and he leans back a fraction deeper into the pillow — the day is done. The phone glow shifts subtly on his face as the screen changes. ${COMMON}`,
};

// 2026-07-31: catbox started returning 200-with-empty-body and 0x0.st stopped resolving from
// this machine — uguu.se (48h retention, plenty for Kling's immediate fetch) is the one that
// works today, so it goes first; the old two stay as fallbacks.
async function stage(id) {
  const png = readFileSync(join(keyDir, `${id}-final.png`));
  const blob = new Blob([png], { type: 'image/png' });
  try {
    const form = new FormData();
    form.append('files[]', blob, `onstd-com-${id}.png`);
    const res = await fetch('https://uguu.se/upload', { method: 'POST', body: form });
    const j = await res.json();
    const url = j?.files?.[0]?.url;
    if (res.ok && url && url.startsWith('http')) return url;
    throw new Error(`uguu ${res.status}: ${JSON.stringify(j).slice(0, 120)}`);
  } catch (e) {
    console.error(`  [${id}] uguu failed (${e.message}), trying catbox`);
  }
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', blob, `onstd-com-${id}.png`);
    const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const url = (await res.text()).trim();
    if (res.ok && url.startsWith('https://')) return url;
    throw new Error(`catbox ${res.status}: ${url.slice(0, 120)}`);
  } catch (e) {
    console.error(`  [${id}] catbox failed (${e.message}), trying 0x0.st`);
    const form = new FormData();
    form.append('file', blob, `onstd-com-${id}.png`);
    const res = await fetch('https://0x0.st', {
      method: 'POST', body: form, headers: { 'User-Agent': 'onstandard-commercial/1.0' },
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
    { image_url: imageUrl, prompt: BRIEFS[id], duration: 5 },
    { image_url: imageUrl, prompt: BRIEFS[id] },
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
if (!ids.length || ids.some((i) => !BRIEFS[i])) {
  console.error('usage: node scripts/commercial/animate.mjs <s1|s2|s3|s4|s5> [...]');
  process.exit(1);
}
const results = await Promise.allSettled(ids.map(animate));
let failed = 0;
for (const [i, r] of results.entries()) {
  if (r.status === 'rejected') { failed++; console.error(`${ids[i]}: ${r.reason.message}`); }
}
process.exit(failed ? 1 : 0);
