// OnStandard — dependency-free QR Code encoder (ISO/IEC 18004 Model 2), byte mode.
// Supports versions 1-5 (up to 106 bytes at level L), which comfortably covers the Practice
// HQ invite link (https://onstandard.app/join?code=XXXXXX, ~40 chars). No CDN, no native
// module — the WebView prototype and the RN app can both inline this.
//
// This is a from-scratch encoder (real risk per the build plan), so practiceIdentity's sibling
// qr.test.ts asserts structural correctness (finder patterns, timing pattern, quiet zone,
// version/EC selection) rather than trusting it blind.

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  version: number;
  ecLevel: EcLevel;
  size: number;
  /** The mask pattern (0-7) chosen by penalty scoring — exposed for testability. */
  mask: number;
  /** true = dark module. Row-major, no quiet zone (see addQuietZone). */
  modules: boolean[][];
}

/* ---------------- Per-version/level codeword table (versions 1-5; ISO 18004 Table 9) ----------
   groups: [blockCount, dataCodewordsPerBlockInGroup][] — a version can split data across two
   groups of differently-sized blocks (e.g. v5-Q: two 15-byte blocks + two 16-byte blocks). */
interface LevelInfo { ecPerBlock: number; groups: [number, number][]; }
const BLOCK_TABLE: Record<number, Record<EcLevel, LevelInfo>> = {
  1: { L: { ecPerBlock: 7, groups: [[1, 19]] }, M: { ecPerBlock: 10, groups: [[1, 16]] }, Q: { ecPerBlock: 13, groups: [[1, 13]] }, H: { ecPerBlock: 17, groups: [[1, 9]] } },
  2: { L: { ecPerBlock: 10, groups: [[1, 34]] }, M: { ecPerBlock: 16, groups: [[1, 28]] }, Q: { ecPerBlock: 22, groups: [[1, 22]] }, H: { ecPerBlock: 28, groups: [[1, 16]] } },
  3: { L: { ecPerBlock: 15, groups: [[1, 55]] }, M: { ecPerBlock: 26, groups: [[1, 44]] }, Q: { ecPerBlock: 18, groups: [[2, 17]] }, H: { ecPerBlock: 22, groups: [[2, 13]] } },
  4: { L: { ecPerBlock: 20, groups: [[1, 80]] }, M: { ecPerBlock: 18, groups: [[2, 32]] }, Q: { ecPerBlock: 26, groups: [[2, 24]] }, H: { ecPerBlock: 16, groups: [[4, 9]] } },
  5: { L: { ecPerBlock: 26, groups: [[1, 108]] }, M: { ecPerBlock: 24, groups: [[2, 43]] }, Q: { ecPerBlock: 18, groups: [[2, 15], [2, 16]] }, H: { ecPerBlock: 22, groups: [[2, 11], [2, 12]] } },
};
const MAX_VERSION = 5;
/** Alignment pattern center for versions 2-5 (v1 has none). Versions 2-6 each have exactly
    one alignment pattern, at (pos,pos) — the other 3 combinations fall inside a finder zone. */
const ALIGNMENT_POS: Record<number, number | null> = { 1: null, 2: 18, 3: 22, 4: 26, 5: 30 };

const sizeForVersion = (v: number) => 17 + 4 * v;
const totalDataCodewords = (info: LevelInfo) => info.groups.reduce((s, [n, len]) => s + n * len, 0);

/* ---------------- GF(256) arithmetic (primitive poly 0x11D), for Reed-Solomon ---------------- */
const GF_EXP = new Array<number>(512);
const GF_LOG = new Array<number>(256);
(function buildGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGeneratorPoly(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], GF_EXP[i]);
    }
    g = next;
  }
  return g;
}
/** Polynomial long division over GF(256): returns the `ecCount` remainder codewords. */
function rsEncode(dataBytes: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const res = dataBytes.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < dataBytes.length; i++) {
    const coef = res[i];
    if (coef !== 0) for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return res.slice(dataBytes.length);
}

/* ---------------- Version selection (byte mode only) ---------------- */
function chooseVersion(byteLen: number, ecLevel: EcLevel): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const info = BLOCK_TABLE[v][ecLevel];
    const capacityBits = totalDataCodewords(info) * 8;
    const headerBits = 4 /* mode */ + 8 /* byte-mode char count, v1-9 */;
    const maxBytes = Math.floor((capacityBits - headerBits) / 8);
    if (byteLen <= maxBytes) return v;
  }
  throw new Error(`qr: text too long (${byteLen} bytes) for supported versions 1-${MAX_VERSION}`);
}

/* ---------------- Bit buffer -> codewords ---------------- */
function toUtf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!;
    if (c > 0xffff) i++; // consumed a surrogate pair
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function buildDataCodewords(text: string, version: number, info: LevelInfo): number[] {
  const bytes = toUtf8Bytes(text);
  const totalData = totalDataCodewords(info);
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); // byte-mode indicator
  push(bytes.length, 8); // char count (v1-9)
  for (const b of bytes) push(b, 8);
  // terminator (up to 4 zero bits, only as much as fits)
  const capacityBits = totalData * 8;
  const term = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData) codewords.push(PAD[p++ % 2]);
  return codewords;
}

/** Split into per-block data, RS-encode each block, then interleave data + EC per spec. */
function interleave(dataCodewords: number[], info: LevelInfo): number[] {
  const blocks: number[][] = [];
  let offset = 0;
  for (const [count, len] of info.groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(dataCodewords.slice(offset, offset + len));
      offset += len;
    }
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, info.ecPerBlock));
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < info.ecPerBlock; i++) for (const eb of ecBlocks) out.push(eb[i]);
  return out;
}

/* ---------------- Format info (BCH(15,5), ISO 18004 Annex C) ---------------- */
const EC_BITS: Record<EcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
function formatBits(ecLevel: EcLevel, mask: number): number[] {
  const data = (EC_BITS[ecLevel] << 3) | mask; // 5 bits
  let d = data << 10;
  const gen = 0b10100110111; // degree-10 generator, 0x537
  for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= gen << i;
  const rem = d & 0x3ff;
  let bits15 = (data << 10) | rem;
  bits15 ^= 0b101010000010010; // fixed mask, 0x5412
  const out: number[] = [];
  for (let i = 14; i >= 0; i--) out.push((bits15 >> i) & 1);
  return out; // MSB (bit14) first, 15 entries
}
const FORMAT_COPY_A: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
function formatCopyB(size: number): [number, number][] {
  return [
    [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
    [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8],
  ];
}

/* ---------------- Mask patterns (ISO 18004 Table 10) ---------------- */
const MASK_FNS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/* ---------------- Matrix builder ---------------- */
function drawFinder(mat: boolean[][], fn: boolean[][], top: number, left: number, size: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = top + dr, c = left + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      fn[r][c] = true;
      const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      mat[r][c] = inRing && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
    }
  }
}
function drawAlignment(mat: boolean[][], fn: boolean[][], pos: number) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = pos + dr, c = pos + dc;
      fn[r][c] = true;
      mat[r][c] = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
    }
  }
}

function buildSkeleton(version: number): { mat: boolean[][]; fn: boolean[][]; size: number } {
  const size = sizeForVersion(version);
  const mat: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  drawFinder(mat, fn, 0, 0, size);
  drawFinder(mat, fn, 0, size - 7, size);
  drawFinder(mat, fn, size - 7, 0, size);

  for (let c = 8; c <= size - 9; c++) { fn[6][c] = true; mat[6][c] = c % 2 === 0; }
  for (let r = 8; r <= size - 9; r++) { fn[r][6] = true; mat[r][6] = r % 2 === 0; }

  const dr = 4 * version + 9;
  fn[dr][8] = true; mat[dr][8] = true; // dark module

  // reserve format-info areas (value filled in later, after mask selection)
  for (const [r, c] of FORMAT_COPY_A) fn[r][c] = true;
  for (const [r, c] of formatCopyB(size)) fn[r][c] = true;

  const ap = ALIGNMENT_POS[version];
  if (ap != null) drawAlignment(mat, fn, ap);

  return { mat, fn, size };
}

function placeData(mat: boolean[][], fn: boolean[][], size: number, codewords: number[]): boolean[][] {
  const bits: boolean[] = [];
  for (const b of codewords) for (let i = 7; i >= 0; i--) bits.push(((b >> i) & 1) === 1);
  const out = mat.map((row) => row.slice());
  let bitIndex = 0;
  let dir = -1; // -1 = upward, 1 = downward
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // timing column carries no data
    for (let i = 0; i < size; i++) {
      const row = dir === -1 ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fn[row][c]) continue;
        out[row][c] = bitIndex < bits.length ? bits[bitIndex] : false;
        bitIndex++;
      }
    }
    dir = -dir;
  }
  return out;
}

function applyMask(mat: boolean[][], fn: boolean[][], size: number, maskFn: (r: number, c: number) => boolean): boolean[][] {
  const out = mat.map((row) => row.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && maskFn(r, c)) out[r][c] = !out[r][c];
  return out;
}
function stampFormat(mat: boolean[][], size: number, ecLevel: EcLevel, mask: number): boolean[][] {
  const out = mat.map((row) => row.slice());
  const bits = formatBits(ecLevel, mask); // bit14..bit0
  FORMAT_COPY_A.forEach(([r, c], i) => { out[r][c] = bits[i] === 1; });
  const copyB = formatCopyB(size);
  copyB.forEach(([r, c], k) => { out[r][c] = bits[14 - k] === 1; }); // k-th entry is bit_k
  return out;
}

/* ---------------- Penalty scoring (ISO 18004 Annex D) — picks the most scan-reliable mask ---- */
function penalty(mat: boolean[][], size: number): number {
  let score = 0;
  // Rule 1: runs of >=5 same-colour modules, per row and column
  const runPenalty = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let r = 0; r < size; r++) runPenalty((i) => mat[r][i]);
  for (let c = 0; c < size; c++) runPenalty((i) => mat[i][c]);
  // Rule 2: 2x2 blocks of one colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mat[r][c];
      if (mat[r][c + 1] === v && mat[r + 1][c] === v && mat[r + 1][c + 1] === v) score += 3;
    }
  }
  // Rule 3: finder-like 1:1:3:1:1 ratio with 4 light modules on one side, in rows/cols
  const patternAt = (bits: boolean[], i: number) => {
    const seqA = [true, false, true, true, true, false, true, false, false, false, false];
    const seqB = [false, false, false, false, true, false, true, true, true, false, true];
    const match = (seq: boolean[]) => seq.every((v, k) => bits[i + k] === v);
    return (match(seqA) ? 1 : 0) + (match(seqB) ? 1 : 0);
  };
  for (let r = 0; r < size; r++) { const row = mat[r]; for (let c = 0; c <= size - 11; c++) score += 40 * patternAt(row, c); }
  for (let c = 0; c < size; c++) { const col = mat.map((row) => row[c]); for (let r = 0; r <= size - 11; r++) score += 40 * patternAt(col, r); }
  // Rule 4: dark-module percentage deviation from 50%
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mat[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Encode `text` (byte mode) into a QR matrix. Picks the smallest of versions 1-5 that fits,
 *  runs real Reed-Solomon error correction, and chooses the lowest-penalty of the 8 standard
 *  mask patterns — the same process a spec-compliant encoder performs. Throws if `text` is
 *  too long for the supported version range (never silently truncates a join link). */
export function encodeQR(text: string, ecLevel: EcLevel = 'M'): QrCode {
  const byteLen = toUtf8Bytes(text).length;
  const version = chooseVersion(byteLen, ecLevel);
  const info = BLOCK_TABLE[version][ecLevel];
  const dataCw = buildDataCodewords(text, version, info);
  const allCw = interleave(dataCw, info);
  const { mat: skeleton, fn, size } = buildSkeleton(version);
  const withData = placeData(skeleton, fn, size, allCw);

  let best: { mask: number; mat: boolean[][]; score: number } | null = null;
  for (let m = 0; m < 8; m++) {
    const masked = stampFormat(applyMask(withData, fn, size, MASK_FNS[m]), size, ecLevel, m);
    const score = penalty(masked, size);
    if (!best || score < best.score) best = { mask: m, mat: masked, score };
  }
  return { version, ecLevel, size, mask: best!.mask, modules: best!.mat };
}

/** Add the spec-minimum quiet zone (4 light modules) on all sides — required for scanners to
 *  lock onto the finder patterns. Rendering layers should always call this before drawing. */
export function addQuietZone(qr: QrCode, quiet = 4): boolean[][] {
  const n = qr.size + quiet * 2;
  const out: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) out[r + quiet][c + quiet] = qr.modules[r][c];
  return out;
}
