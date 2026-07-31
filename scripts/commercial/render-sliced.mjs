// Sliced Remotion render — the render tab on this machine wedges after a few hundred frames
// (OffthreadVideo, <Video> AND <Img> pipelines all die; the "delayRender fonts" timeout is the
// reloaded page hanging afterwards). Rendering in short slices gives every slice a fresh
// browser, then ffmpeg concats the h264 segments losslessly and muxes the score once.
//
// Usage: node scripts/commercial/render-sliced.mjs Master commercial-master.mp4 2268 [sliceLen]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rem = join(here, 'remotion');
const SILENT = process.argv.includes('--silent');
const [comp, outName, totalStr, sliceStr] = process.argv.slice(2).filter((a) => a !== '--silent');
if (!comp || !outName || !totalStr) {
  console.error('usage: node render-sliced.mjs <CompId> <out.mp4> <totalFrames> [sliceLen=252] [--silent]');
  process.exit(1);
}
const TOTAL = Number(totalStr);
const SLICE = Number(sliceStr || 252);

const workDir = join(rem, 'out', `${comp}-slices`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const slices = [];
for (let start = 0; start < TOTAL; start += SLICE) {
  const end = Math.min(TOTAL - 1, start + SLICE - 1);
  const file = join(workDir, `s${String(start).padStart(5, '0')}.mp4`);
  process.stdout.write(`slice ${start}-${end} ... `);
  execFileSync(npx, ['remotion', 'render', 'src/index.ts', comp, file,
    '--codec', 'h264', '--crf', '16', '--muted', '--concurrency', '2',
    `--frames=${start}-${end}`], { cwd: rem, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  if (!existsSync(file)) { console.error('MISSING OUTPUT'); process.exit(1); }
  slices.push(file);
  console.log('ok');
}

const listFile = join(workDir, 'list.txt');
writeFileSync(listFile, slices.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
const outFile = join(rem, 'out', outName);
// concat the video segments untouched; --silent skips the score (mix-audio.mjs muxes later)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', listFile,
  ...(SILENT ? ['-c:v', 'copy', '-an']
    : ['-i', join(rem, 'public', 'score.wav'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest']),
  outFile]);
console.log(`\nwrote ${outFile}`);
