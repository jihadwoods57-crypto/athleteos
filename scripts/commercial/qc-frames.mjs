// Extract one frame per story beat from the rendered master for a visual QC pass.
// Usage: node scripts/commercial/qc-frames.mjs [path-to-master]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2] || join('scripts', 'commercial', 'remotion', 'out', 'commercial-master.mp4');
const out = join('.tmp', 'commercial', 'qc-master');
mkdirSync(out, { recursive: true });

// beat boundaries (seconds) — from Master.tsx timeline
const BEATS = [
  ['open', 1.4], ['s1', 4.5], ['s1-text', 6.2], ['rollcall-pre', 9.0], ['rollcall-post', 12.8],
  ['timecard1', 15.2], ['s2', 18.0], ['snap-confirm', 21.5], ['snap-scan', 26.0],
  ['bfast', 30.5], ['timecard2', 33.6], ['s3', 35.6], ['s4', 39.4], ['coachtype', 43.0],
  ['thread-top', 47.0], ['thread-conv', 52.0], ['timecard3', 54.4], ['s5', 57.0],
  ['ring-fill', 61.5], ['ring-locked', 64.2], ['card-lockup', 67.5], ['card-cta', 71.0],
];
for (const [name, t] of BEATS) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', src, '-frames:v', '1', join(out, `${name}.png`)]);
}
console.log(`${BEATS.length} frames -> ${out}`);
