// Steady demo-video bed (temp track until the founder's licensed music lands).
// Same synthesis approach as music.mjs but flat: pulse + drone + air, no riser, no hit —
// mix-audio.mjs trims and fades it per video. 110s @ 48kHz stereo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, 'remotion', 'public', 'demo-bed.wav');
mkdirSync(dirname(outFile), { recursive: true });

const SR = 48000, DUR = 110, BEAT = 0.6;
const N = SR * DUR;
const L = new Float64Array(N), R = new Float64Array(N);
const TAU = Math.PI * 2;
let seed = 0xbedbed01;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1; };
const env = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);
const smooth = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

for (let b = 0; b * BEAT < DUR - 1; b++) {
  const at = b * BEAT, g = (b % 4 === 0 ? 0.34 : 0.24) * smooth(at / 4);
  const start = Math.floor(at * SR), len = Math.floor(0.4 * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const v = Math.sin(TAU * (44 * t - 12 * t * t)) * env(t, 0.004, 0.08) * g;
    L[start + i] += v; R[start + i] += v;
  }
  if (b % 2 === 1) { // off-beat tick
    const s2 = Math.floor((at + BEAT / 2) * SR), l2 = Math.floor(0.025 * SR);
    let bp = 0, bp2 = 0;
    for (let i = 0; i < l2 && s2 + i < N; i++) {
      const n = rand(); bp += 0.28 * (n - bp); bp2 += 0.28 * (bp - bp2);
      const v = (bp - bp2) * env(i / SR, 0.001, 0.007) * 0.16;
      L[s2 + i] += v * 0.8; R[s2 + i] += v;
    }
  }
}
let lp = 0, lpR = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const breathe = 0.75 + 0.25 * Math.sin(TAU * t / 9.6 - Math.PI / 2);
  const lvl = 0.05 * smooth(t / 5) * breathe;
  const a = Math.sin(TAU * 73.42 * t), b2 = Math.sin(TAU * 146.83 * t + 0.7);
  const c = Math.sin(TAU * 110.4 * t), d = Math.sin(TAU * 146.2 * t);
  L[i] += (a * 0.9 + b2 * 0.5 + c * 0.3 + d * 0.25) * lvl;
  R[i] += (a * 0.9 + b2 * 0.5 + c * 0.28 + d * 0.27) * lvl * 1.02;
  const cyc = (t % 9.6) / 9.6, swell = Math.pow(Math.sin(Math.PI * cyc), 2);
  const n = rand(); lp += 0.018 * (n - lp); lpR += 0.017 * (n - lpR);
  const air = 0.026 * smooth(t / 8) * swell;
  L[i] += lp * air * 18; R[i] += lpR * air * 18;
}
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.4, Math.max(0, (DUR - t) / 2));
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Math.tanh(L[i] * 1.4) * 0.88 * g * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Math.tanh(R[i] * 1.4) * 0.88 * g * 32767))), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync(outFile, Buffer.concat([h, pcm]));
console.log(`wrote ${outFile}`);
