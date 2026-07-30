// Hero-loop edit + encode — six clips in, one looping mp4 out.
//
// The edit (locked by the brief):
//   - order a..f, hard cuts ON the shutter pulse. The pulse is DETECTED, not
//     eyeballed: signalstats luma over the phone-screen band (x 25-65%,
//     y 52-72%) of each clip's final 40% finds the flash peak; the out-point
//     is one frame after it, so the cut itself is the shutter, six times.
//   - the wrap f -> a is a 6-frame (0.25s @24fps) dissolve built loop-safe:
//     the main (a) segment starts 6 frames in, and the file ends with f's
//     tail crossfading into a's FIRST 6 frames — frame N-1 -> frame 0 lands
//     mid-motion with no duplicated frame.
//   - encode: H.264 High, yuv420p, 24fps, 900x1350, -an, +faststart,
//     -tune film. CRF stays at 26 (the grain is the look); if the size gate
//     fails, CAP_S shortens every clip before grain is ever sacrificed.
//
// Usage:  node scripts/hero-video/assemble.mjs [--cap <seconds-per-clip>]
// Input:  .tmp/hero-video/clips/<a..f>.mp4
// Output: .tmp/hero-video/hero-loop.mp4  (copied to web/landing/assets/video/
//         only after the 3.5 MB gate and visual QA pass — never automatically)
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const dir = join(repo, '.tmp', 'hero-video');
const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const FPS = 24;
const XF = 6 / FPS; // 6-frame wrap dissolve
const capArg = process.argv.indexOf('--cap');
const CAP_S = capArg > -1 ? Number(process.argv[capArg + 1]) : Infinity;

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64e6 });

const duration = (f) =>
  Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]));

// Find the shutter pulse: per-frame mean luma of the screen band, peak inside
// the final 40% of the clip. Returns the out-point (peak + 1 frame).
function findPulse(file, dur) {
  const out = run('ffmpeg', [
    '-i', file, '-vf',
    'crop=iw*0.40:ih*0.20:iw*0.25:ih*0.52,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-',
  ]);
  const frames = [];
  let t = null;
  for (const line of out.split('\n')) {
    const pts = line.match(/pts_time:([\d.]+)/);
    if (pts) { t = Number(pts[1]); continue; }
    const y = line.match(/YAVG=([\d.]+)/);
    if (y && t !== null) frames.push({ t, y: Number(y[1]) });
  }
  const tail = frames.filter((f) => f.t >= dur * 0.6);
  if (!tail.length) throw new Error(`no signalstats frames for ${file}`);
  const peak = tail.reduce((a, b) => (b.y > a.y ? b : a));
  return { out: Math.min(peak.t + 1 / FPS, dur), peakY: peak.y, base: tail[0].y };
}

const cuts = [];
for (const id of IDS) {
  const file = join(dir, 'clips', `${id}.mp4`);
  const dur = duration(file);
  const { out, peakY, base } = findPulse(file, dur);
  const end = Math.min(out, CAP_S);
  cuts.push({ id, file, end });
  console.log(`[${id}] dur=${dur.toFixed(2)}s pulse@${out.toFixed(2)}s (YAVG ${base.toFixed(1)} -> ${peakY.toFixed(1)}) cut=${end.toFixed(2)}s`);
}

// Filtergraph: a_main = a[XF..endA]; wrap = xfade(f, a[0..XF]); concat all.
const norm = `fps=${FPS},scale=900:1350:flags=lanczos,setsar=1,format=yuv420p`;
const fEnd = cuts[5].end;
const TOTAL = cuts.reduce((s, c) => s + c.end, 0) - XF;
const parts = [
  `[0:v]trim=${XF}:${cuts[0].end},setpts=PTS-STARTPTS,${norm}[a_main]`,
  ...cuts.slice(1, 5).map((c, i) => `[${i + 1}:v]trim=0:${c.end},setpts=PTS-STARTPTS,${norm}[m${i + 1}]`),
  `[5:v]trim=0:${fEnd},setpts=PTS-STARTPTS,${norm}[f_cut]`,
  `[0:v]trim=0:${XF},setpts=PTS-STARTPTS,${norm}[a_head]`,
  `[f_cut][a_head]xfade=transition=fade:duration=${XF}:offset=${(fEnd - XF).toFixed(4)}[f_wrap]`,
  // xfade in this ffmpeg build over-holds a frozen tail past the dissolve, so
  // the output is hard-trimmed to the planned length: the dissolve's last
  // frame (a @ ~0.21s) and the file's first frame (a @ 0.25s) are consecutive
  // source frames — the loop seam is exact by construction.
  `[a_main][m1][m2][m3][m4][f_wrap]concat=n=6:v=1:a=0,trim=0:${TOTAL.toFixed(4)},setpts=PTS-STARTPTS[v]`,
].join(';');

const out = join(dir, 'hero-loop.mp4');
run('ffmpeg', [
  '-y', '-loglevel', 'error',
  ...cuts.flatMap((c) => ['-i', c.file]),
  '-filter_complex', parts, '-map', '[v]',
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryslow', '-tune', 'film',
  '-crf', '26', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', '-movflags', '+faststart',
  out,
]);
const mb = statSync(out).size / 1e6;
const total = cuts.reduce((s, c) => s + c.end, 0) - XF;
console.log(`\n${out}\n${mb.toFixed(2)} MB, ~${total.toFixed(1)}s — gate: ${mb < 3.5 ? 'PASS (< 3.5 MB)' : `FAIL — re-run with --cap ${(Math.min(...cuts.map((c) => c.end)) - 0.3).toFixed(1)} or lower`}`);
process.exit(mb < 3.5 ? 0 : 2);
