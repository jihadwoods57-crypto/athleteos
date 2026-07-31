// Rights-clean minimal score for "One Day on Standard" — synthesized, not licensed.
//
// A designed pulse bed, not a song: heartbeat intro → 100 BPM sub-pulse that grows through
// the day → riser into the end card → one low hit → drone tail. Built sample-by-sample so
// there is nothing to license and nothing to audition blind. The edit sits on the same
// 100 BPM grid, so a licensed Artlist/Epidemic track can replace this file 1:1 later.
//
// Output: scripts/commercial/remotion/public/score.wav (48kHz stereo 16-bit), ~75.6s
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, 'remotion', 'public', 'score.wav');
mkdirSync(dirname(outFile), { recursive: true });

const SR = 48000;
const DUR = 75.6;                       // 126 beats at 100 BPM
const BEAT = 0.6;                       // seconds per beat
const N = Math.round(SR * DUR);
const L = new Float64Array(N);
const R = new Float64Array(N);

const TAU = Math.PI * 2;
// Deterministic noise — Date/Math.random-free by design (and reproducible run to run).
let seed = 0x05f5c0de;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1; };

/* ---------- helpers ---------- */
const env = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);   // attack/decay
const smooth = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/* ---------- 1. sub pulse: a soft 42Hz thump on each beat ----------
 * Heartbeat (lub-dub on half-time) for the first 12 beats, then a steady grid pulse that
 * grows from felt to heard across the day. Silent during the end-card tail. */
const thump = (at, gain, freq = 42) => {
  const start = Math.floor(at * SR);
  const len = Math.floor(0.42 * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const e = env(t, 0.004, 0.085);
    // slight downward pitch bend sells the "kick" without any transient click
    const ph = TAU * (freq * t - 14 * t * t);
    const v = Math.sin(ph) * e * gain;
    L[start + i] += v; R[start + i] += v;
  }
};
for (let b = 0; b < 12; b += 2) {            // 0–7.2s: heartbeat, half-time lub-dub
  thump(b * BEAT, 0.30);
  thump(b * BEAT + 0.32, 0.16);
}
for (let b = 12; b < 104; b++) {             // 7.2–62.4s: the day's pulse, growing
  const g = 0.16 + 0.22 * smooth((b - 12) / 92);
  thump(b * BEAT, b % 4 === 0 ? g * 1.35 : g);
}

/* ---------- 2. tick: a tiny filtered click on the off-grid 8ths, very low ---------- */
const tick = (at, gain) => {
  const start = Math.floor(at * SR);
  const len = Math.floor(0.03 * SR);
  let bp = 0, bp2 = 0;
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const e = env(t, 0.001, 0.008);
    const n = rand();
    bp += 0.25 * (n - bp); bp2 += 0.25 * (bp - bp2);   // crude bandpass-ish
    const v = (bp - bp2) * e * gain * 3;
    L[start + i] += v * 0.8; R[start + i] += v;        // a hair right of centre
  }
};
for (let b = 24; b < 104; b++) {             // enters at 14.4s with the day underway
  const g = 0.05 + 0.05 * smooth((b - 24) / 80);
  tick(b * BEAT + BEAT / 2, g);
}

/* ---------- 3. drone: D root (73.42Hz) + octave + detuned fifth, slow breathing ---------- */
for (let i = 0; i < N; i++) {
  const t = i / SR;
  // overall drone level: fades in over 6s, breathes on a 9.6s cycle, ducks after the hit
  const breathe = 0.75 + 0.25 * Math.sin(TAU * t / 9.6 - Math.PI / 2);
  let lvl = 0.055 * smooth(t / 6) * breathe;
  if (t > 62.4) lvl *= Math.exp(-(t - 62.4) / 7);      // long tail under the end card
  const a = Math.sin(TAU * 73.42 * t);
  const b2 = Math.sin(TAU * 146.83 * t + 0.7);
  const c = Math.sin(TAU * 110.4 * t);                 // fifth-ish, slightly flat: tension
  const d = Math.sin(TAU * 146.2 * t);                 // detune shimmer against the octave
  L[i] += (a * 0.9 + b2 * 0.5 + c * 0.30 + d * 0.25) * lvl;
  R[i] += (a * 0.9 + b2 * 0.5 + c * 0.28 + d * 0.27) * lvl * 1.02;
}

/* ---------- 4. air: lowpassed noise swells on 4-bar cycles ---------- */
{
  let lp = 0, lpR = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const cyc = (t % 9.6) / 9.6;
    const swell = Math.pow(Math.sin(Math.PI * cyc), 2);
    let lvl = 0.030 * smooth(t / 10) * swell;
    if (t > 62.4) lvl *= Math.exp(-(t - 62.4) / 5);
    const n = rand();
    lp += 0.018 * (n - lp);
    lpR += 0.017 * (n - lpR);
    L[i] += lp * lvl * 18;
    R[i] += lpR * lvl * 18;
  }
}

/* ---------- 5. riser: 55.2s → 62.4s, noise sweep + rising sine, into the hit ---------- */
{
  let hp = 0, prev = 0;
  const t0 = 55.2, t1 = 62.4;
  for (let i = Math.floor(t0 * SR); i < Math.min(N, Math.floor(t1 * SR)); i++) {
    const t = i / SR;
    const k = (t - t0) / (t1 - t0);
    const n = rand();
    hp += (0.02 + 0.28 * k) * (n - hp);                // opening filter
    const noise = (n - hp) * 0.10 * Math.pow(k, 1.6);
    const tone = Math.sin(TAU * (110 + 330 * k * k) * t) * 0.045 * Math.pow(k, 2);
    const v = noise + tone;
    L[i] += v * (1 - 0.2 * k); R[i] += v * (0.8 + 0.2 * k);
    prev = v;
  }
}

/* ---------- 6. the hit at 62.4s (end card lands), then silence-to-tail ---------- */
{
  const at = 62.4;
  const start = Math.floor(at * SR);
  const len = Math.floor(2.6 * SR);
  let lp = 0;
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const e = env(t, 0.002, 0.55);
    const body = Math.sin(TAU * (52 * t - 10 * t * t)) * e * 0.5;
    const n = rand(); lp += 0.05 * (n - lp);
    const thud = lp * e * 1.2;
    L[start + i] += body + thud; R[start + i] += body + thud * 0.9;
  }
}

/* ---------- master: gentle saturation + fade in/out + 16-bit WAV ---------- */
const fadeIn = 0.4, fadeOut = 3.0;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t < fadeIn) g = t / fadeIn;
  if (t > DUR - fadeOut) g = Math.max(0, (DUR - t) / fadeOut);
  const l = Math.tanh(L[i] * 1.4) * 0.9 * g;
  const r = Math.tanh(R[i] * 1.4) * 0.9 * g;
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
writeFileSync(outFile, Buffer.concat([header, pcm]));
console.log(`wrote ${outFile} (${((44 + pcm.length) / 1e6).toFixed(1)} MB, ${DUR}s)`);
