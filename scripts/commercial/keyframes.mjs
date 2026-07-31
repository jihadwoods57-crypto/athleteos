// "One Day on Standard" — human-shot keyframes (gpt-image-2 → Kling via animate.mjs).
//
// Five cinematic moments across one day. Landscape 3:2 (1536x1024): Kling preserves input
// aspect, and the 16:9 master crops from 3:2 with headroom to spare. CENTER-SAFE: every
// subject and phone stays inside the middle ~56% of width, because the 9:16 social cuts are
// a straight center crop of the same footage.
//
// Continuity: S1/S2/S5 are the SAME athlete (verbatim description, same bedroom in S1/S5).
// S3 is the parent, S4 the coach — the same trio the UI capture names (Marcus / Angela /
// James), though no name ever appears on screen.
//
// Usage:  node scripts/commercial/keyframes.mjs s1 s2 s3 s4 s5
// Output: .tmp/commercial/keyframes/<id>.png (re-rolls land as <id>-2.png etc.)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const outDir = join(repo, '.tmp', 'commercial', 'keyframes');
mkdirSync(outDir, { recursive: true });

const env = readFileSync(join(repo, '.env'), 'utf8');
const KEY = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();

// --engine soul: Higgsfield Soul fallback (same credit pool as the Kling gens) — the OpenAI
// account re-hit its billing hard limit 2026-07-31. Soul fought the hero brief's silhouette
// lock (cyan rim, invented logos, toothy grins); this brief is landscape cinematic scenes,
// closer to its house style, and RULES below guard the known failure modes. Judge each take.
const engineArg = process.argv.indexOf('--engine');
const ENGINE = engineArg > -1 ? process.argv[engineArg + 1] : 'openai';
const rawHk = env.match(/HIGGSFIELD_API_KEY\s*=\s*(\S+)/)?.[1] || '';
const rawHs = env.match(/HIGGSFIELD_API_SECRET\s*=\s*(\S+)/)?.[1] || '';
const HAUTH = rawHk.includes(':') ? rawHk : (rawHk && rawHs ? `${rawHk}:${rawHs}` : '');
if (ENGINE === 'openai' && !KEY) { console.error('no OPENAI_API_KEY in .env'); process.exit(1); }
if (ENGINE === 'soul' && !HAUTH) { console.error('no Higgsfield credentials in .env'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function genSoul(prompt) {
  const H = { 'Authorization': `Key ${HAUTH}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  let sub;
  for (const params of [
    { aspect_ratio: '3:2', resolution: '1080p' },
    { aspect_ratio: '16:9', resolution: '1080p' },
    { aspect_ratio: '4:3', resolution: '1080p' },
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

// Same cool signature as the landing photography (brand v4: dark-navy + blue/teal, gold retired).
const LOOK = `Photorealistic cinematic still. Full-frame camera, 35mm lens at f/1.8, shallow depth of field, rich fine film grain, deep crushed blacks, gentle anamorphic feel. Cool blue-white key light with a subtle teal-cyan rim; where a phone appears, its screen adds a faint cool-neutral glow consistent with the key. Background falls to near-black blue-dark (#070B14) or deep out-of-focus environment. Muted desaturated palette. No haze, no lens flare.`;

const SAFE = `Wide 3:2 landscape. The subject and the phone sit inside the middle half of the frame width — nothing that matters touches the left or right quarter of the frame. Generous dark negative space on both sides.`;

const RULES = `Full-bleed photograph with no white border and no frame around the image. Every piece of clothing is COMPLETELY PLAIN and unbranded: no logos, no swoosh, no crest, no printing, no patches, no lanyards, no credentials — any cap is a plain blank cap. Absolutely no text, letters, numbers, logos, brand marks, team crests or user interface anywhere in the image — not on the phone screen, not on clothing, not in the background, nowhere. No watermark. The phone screen shows only a soft neutral glow. Hands natural and anatomically correct. Expression: lips together — a faint closed-mouth expression, calm and quietly resolved or warmly pleased. Never a sigh, never annoyance, NEVER visible teeth, never looking at the camera.`;
const ATHLETE = `A Black male college football player in his early twenties, lean and athletic with broad shoulders and a trim waist, short hair, wearing a completely plain dark athletic tee with no printing of any kind`;

const SHOTS = {
  s1: `${ATHLETE}, lying in bed in a dark bedroom at five in the morning, head on the pillow, eyes just opened — awake, calm, resolved. His arm reaches toward a phone that glows softly on the nightstand beside him; the phone glow is the only light source, washing his face in cool light. The room behind him is nearly black, a hint of a window with pre-dawn darkness. Camera at pillow height, close, from the side, his face and the reaching hand and the glowing phone all inside the middle of the frame.`,
  s2: `${ATHLETE}, lips together in a faint focused half-smile, standing at a small kitchen counter in soft early-morning window light. He holds the phone HORIZONTAL AND FLAT like a serving tray, screen facing up toward the ceiling, hovering forty centimetres directly above a breakfast plate — a fried egg on toast with sliced tomatoes and a few greens on a plain white ceramic plate — using the phone to photograph the food from straight above. His eyes look down at the phone screen, chin dropped. Slight forward lean over the counter, real body weight. Camera three-quarter from his left at chest height, the plate and hovering phone in the lower middle of the frame.`,
  s3: `A Black woman in her mid-forties, warm and composed, business-casual blouse, sitting at an office desk by a window at midday, a laptop half-closed in front of her. She has just picked up her phone from the desk and looks down at it with the beginning of a proud, soft closed-mouth smile. Daylight from the window is cool and diffuse; the office behind her falls into deep soft-focus shadow. Camera across the desk at eye level, slightly three-quarter from her right.`,
  s4: `A Black man in his early fifties, a football coach, weathered and calm, wearing a plain dark polo and a plain dark cap, a whistle on a lanyard around his neck, standing at the edge of a practice field under an overcast sky. He glances down at the phone in his hand and gives one small approving nod, jaw set, the faintest closed-mouth smile. Empty field and low bleachers fall out of focus into cool grey-blue behind him. Camera at chest height, three-quarter from his left.`,
  s5: `${ATHLETE}, the same athlete and the same dark bedroom as the five-A.M. shot, now at ten at night — sitting up against the headboard in low light, holding the phone in both hands at chest height, looking at it with quiet satisfaction, the day done. The phone glow washes his face and chest in cool light; everything else is near-black. Camera slightly below eye level, frontal, close.`,
};

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== 'soul' && a !== 'openai');
if (!ids.length || ids.some((s) => !SHOTS[s])) {
  console.error(`usage: node scripts/commercial/keyframes.mjs <${Object.keys(SHOTS).join('|')}> [...] [--engine soul|openai]`);
  process.exit(1);
}

async function genOpenai(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1536x1024', quality: 'high', n: 1 }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from((await res.json()).data[0].b64_json, 'base64');
}

for (const id of ids) {
  let out = join(outDir, `${id}.png`);
  for (let take = 2; existsSync(out); take++) out = join(outDir, `${id}-${take}.png`);
  process.stdout.write(`${ENGINE} shot ${id} -> ${out} ... `);
  const prompt = `${SHOTS[id]} ${SAFE} ${LOOK} ${RULES}`;
  try {
    const buf = ENGINE === 'soul' ? await genSoul(prompt) : await genOpenai(prompt);
    writeFileSync(out, buf);
    console.log('ok');
  } catch (e) {
    console.error(`FAILED ${e.message}`);
    process.exit(1);
  }
}
