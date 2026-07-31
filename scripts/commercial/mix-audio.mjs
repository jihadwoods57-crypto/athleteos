// Lay music under a silent render. Prefers the founder's licensed track — drop any
// .mp3/.wav into scripts/commercial/music/ and it wins automatically; otherwise the
// synthesized demo bed ships. Trims to video length with a 2.5s fade-out.
//
// Usage: node scripts/commercial/mix-audio.mjs <video.mp4> <out.mp4> [trackNameFilter]
// The source video's own audio (if any) is discarded — the new track replaces it.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [src, out, filter] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node mix-audio.mjs <video.mp4> <out.mp4> [trackNameFilter]'); process.exit(1); }

const musicDir = join(here, 'music');
let licensed = existsSync(musicDir)
  ? readdirSync(musicDir).filter((f) => /\.(mp3|wav|m4a|aac|flac)$/i.test(f)).sort()
  : [];
if (filter) {
  const hit = licensed.filter((f) => f.toLowerCase().includes(filter.toLowerCase()));
  if (!hit.length) { console.error(`no track in music/ matches "${filter}"`); process.exit(1); }
  licensed = hit;
}
const track = licensed.length
  ? join(musicDir, licensed[0])
  : join(here, 'remotion', 'public', 'demo-bed.wav');
console.log(`music: ${licensed.length ? 'LICENSED ' : 'temp bed '}${track}`);

const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', src]).toString());
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-i', track,
  '-filter_complex', `[1:a]atrim=0:${dur.toFixed(2)},afade=t=in:d=0.4,afade=t=out:st=${(dur - 2.5).toFixed(2)}:d=2.5,loudnorm=I=-18:TP=-1.5[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', out]);
console.log(`wrote ${out} (${dur.toFixed(1)}s)`);
