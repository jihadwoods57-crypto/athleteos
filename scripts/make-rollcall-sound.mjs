#!/usr/bin/env node
// OnStandard: generate assets/sounds/rollcall_alarm.caf, the roll call v3 backup alert tone.
//
// WHAT IT IS. The sound the start-time push names (commitment-reminders openingDelivery,
// BACKUP_SOUND) for an athlete whose phone has no armed alarm. A generated tone, no licensed
// audio: 880 Hz, two quarter-second beeps a second, 28 seconds (iOS plays a notification sound
// for at most 30 and falls back to the DEFAULT sound for a longer one).
//
// FORMAT. Linear PCM, 16-bit little-endian, mono, 22,050 Hz, in a CAF container: one of the
// formats Apple documents for notification sounds, and the plainest. 22,050 Hz (not 44,100) halves
// the file for a tone that sits far below its 11 kHz ceiling. Each beep fades in and out over 2 ms
// so its edges do not click (880 Hz is not a whole number of samples at this rate).
//
// DETERMINISTIC. No ffmpeg, no randomness: the same bytes every run (V8's Math.sin is the same
// fdlibm port on every platform). `--check` regenerates in memory and fails if the committed file
// differs, so the asset can never drift from this recipe unnoticed.
//
//   node scripts/make-rollcall-sound.mjs          # write the file
//   node scripts/make-rollcall-sound.mjs --check  # verify the committed file
//
// A notification sound is part of the BINARY (app.json, expo-notifications `sounds`): changing it
// reaches phones with the next native build, never over the air.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'assets/sounds/rollcall_alarm.caf');

export const RATE = 22_050;
export const SECONDS = 28;
const HZ = 880;
const AMP = 0.6;

/** The whole CAF file as bytes. */
export function buildCaf() {
  const frames = RATE * SECONDS;
  const period = RATE / 2;      // a beep cycle every half second
  const on = RATE / 4;          // of which the first quarter second sounds
  const pcm = Buffer.alloc(frames * 2);
  const ramp = Math.round(RATE * 0.002); // 2 ms in and out of every beep
  for (let n = 0; n < frames; n++) {
    const k = n % period;
    const env = k < on ? Math.min(1, k / ramp, (on - k) / ramp) : 0;
    const s = env * AMP * Math.sin((2 * Math.PI * HZ * n) / RATE);
    pcm.writeInt16LE(Math.round(s * 32767), n * 2);
  }

  // File header: 'caff', version 1, flags 0.
  const head = Buffer.alloc(8);
  head.write('caff', 0, 'ascii'); head.writeUInt16BE(1, 4); head.writeUInt16BE(0, 6);

  // 'desc' (Audio Description), 32 bytes, big-endian.
  const desc = Buffer.alloc(12 + 32);
  desc.write('desc', 0, 'ascii'); desc.writeBigInt64BE(32n, 4);
  desc.writeDoubleBE(RATE, 12);             // mSampleRate
  desc.write('lpcm', 20, 'ascii');          // mFormatID
  desc.writeUInt32BE(2, 24);                // mFormatFlags: kCAFLinearPCMFormatFlagIsLittleEndian
  desc.writeUInt32BE(2, 28);                // mBytesPerPacket
  desc.writeUInt32BE(1, 32);                // mFramesPerPacket
  desc.writeUInt32BE(1, 36);                // mChannelsPerFrame
  desc.writeUInt32BE(16, 40);               // mBitsPerChannel

  // 'data': a 4-byte edit count, then the samples.
  const data = Buffer.alloc(12 + 4);
  data.write('data', 0, 'ascii'); data.writeBigInt64BE(BigInt(4 + pcm.length), 4);
  data.writeUInt32BE(0, 12);

  return Buffer.concat([head, desc, data, pcm]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bytes = buildCaf();
  if (process.argv.includes('--check')) {
    const same = existsSync(OUT) && Buffer.compare(readFileSync(OUT), bytes) === 0;
    console.log(same ? `ok: ${OUT} matches the recipe` : `DIFFERS: ${OUT} is not what this script makes; re-run without --check`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} (${bytes.length} bytes, ${SECONDS} s, ${RATE} Hz mono 16-bit PCM)`);
}
