/* OnStandard — dependency-free QR Code encoder (ISO/IEC 18004 Model 2), byte mode.
   Mirror of src/core/qr.ts — same algorithm, ported to a plain ES module so the WebView
   prototype needs no CDN. Supports versions 1-5 (up to 106 bytes at level L), which
   comfortably covers the Practice HQ invite link (https://onstandard.app/join?code=XXXXXX). */

const BLOCK_TABLE = {
  1: { L: { ecPerBlock: 7, groups: [[1, 19]] }, M: { ecPerBlock: 10, groups: [[1, 16]] }, Q: { ecPerBlock: 13, groups: [[1, 13]] }, H: { ecPerBlock: 17, groups: [[1, 9]] } },
  2: { L: { ecPerBlock: 10, groups: [[1, 34]] }, M: { ecPerBlock: 16, groups: [[1, 28]] }, Q: { ecPerBlock: 22, groups: [[1, 22]] }, H: { ecPerBlock: 28, groups: [[1, 16]] } },
  3: { L: { ecPerBlock: 15, groups: [[1, 55]] }, M: { ecPerBlock: 26, groups: [[1, 44]] }, Q: { ecPerBlock: 18, groups: [[2, 17]] }, H: { ecPerBlock: 22, groups: [[2, 13]] } },
  4: { L: { ecPerBlock: 20, groups: [[1, 80]] }, M: { ecPerBlock: 18, groups: [[2, 32]] }, Q: { ecPerBlock: 26, groups: [[2, 24]] }, H: { ecPerBlock: 16, groups: [[4, 9]] } },
  5: { L: { ecPerBlock: 26, groups: [[1, 108]] }, M: { ecPerBlock: 24, groups: [[2, 43]] }, Q: { ecPerBlock: 18, groups: [[2, 15], [2, 16]] }, H: { ecPerBlock: 22, groups: [[2, 11], [2, 12]] } },
};
const MAX_VERSION = 5;
const ALIGNMENT_POS = { 1: null, 2: 18, 3: 22, 4: 26, 5: 30 };

const sizeForVersion = (v) => 17 + 4 * v;
const totalDataCodewords = (info) => info.groups.reduce((s, g) => s + g[0] * g[1], 0);

const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
(function buildGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGeneratorPoly(degree) {
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
function rsEncode(dataBytes, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = dataBytes.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < dataBytes.length; i++) {
    const coef = res[i];
    if (coef !== 0) for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return res.slice(dataBytes.length);
}

function chooseVersion(byteLen, ecLevel) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const info = BLOCK_TABLE[v][ecLevel];
    const capacityBits = totalDataCodewords(info) * 8;
    const headerBits = 4 + 8;
    const maxBytes = Math.floor((capacityBits - headerBits) / 8);
    if (byteLen <= maxBytes) return v;
  }
  throw new Error(`qr: text too long (${byteLen} bytes) for supported versions 1-${MAX_VERSION}`);
}

function toUtf8Bytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function buildDataCodewords(text, version, info) {
  const bytes = toUtf8Bytes(text);
  const totalData = totalDataCodewords(info);
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const capacityBits = totalData * 8;
  const term = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
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

function interleave(dataCodewords, info) {
  const blocks = [];
  let offset = 0;
  for (const [count, len] of info.groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(dataCodewords.slice(offset, offset + len));
      offset += len;
    }
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, info.ecPerBlock));
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < info.ecPerBlock; i++) for (const eb of ecBlocks) out.push(eb[i]);
  return out;
}

const EC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
function formatBits(ecLevel, mask) {
  const data = (EC_BITS[ecLevel] << 3) | mask;
  let d = data << 10;
  const gen = 0b10100110111;
  for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= gen << i;
  const rem = d & 0x3ff;
  let bits15 = (data << 10) | rem;
  bits15 ^= 0b101010000010010;
  const out = [];
  for (let i = 14; i >= 0; i--) out.push((bits15 >> i) & 1);
  return out;
}
const FORMAT_COPY_A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
function formatCopyB(size) {
  return [
    [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
    [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8],
  ];
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function drawFinder(mat, fn, top, left, size) {
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
function drawAlignment(mat, fn, pos) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = pos + dr, c = pos + dc;
      fn[r][c] = true;
      mat[r][c] = dr === -2 || dr === 2 || dc === -2 || dc === 2 || (dr === 0 && dc === 0);
    }
  }
}

function buildSkeleton(version) {
  const size = sizeForVersion(version);
  const mat = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));

  drawFinder(mat, fn, 0, 0, size);
  drawFinder(mat, fn, 0, size - 7, size);
  drawFinder(mat, fn, size - 7, 0, size);

  for (let c = 8; c <= size - 9; c++) { fn[6][c] = true; mat[6][c] = c % 2 === 0; }
  for (let r = 8; r <= size - 9; r++) { fn[r][6] = true; mat[r][6] = r % 2 === 0; }

  const dr = 4 * version + 9;
  fn[dr][8] = true; mat[dr][8] = true;

  for (const [r, c] of FORMAT_COPY_A) fn[r][c] = true;
  for (const [r, c] of formatCopyB(size)) fn[r][c] = true;

  const ap = ALIGNMENT_POS[version];
  if (ap != null) drawAlignment(mat, fn, ap);

  return { mat, fn, size };
}

function placeData(mat, fn, size, codewords) {
  const bits = [];
  for (const b of codewords) for (let i = 7; i >= 0; i--) bits.push(((b >> i) & 1) === 1);
  const out = mat.map((row) => row.slice());
  let bitIndex = 0;
  let dir = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
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

function applyMask(mat, fn, size, maskFn) {
  const out = mat.map((row) => row.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && maskFn(r, c)) out[r][c] = !out[r][c];
  return out;
}
function stampFormat(mat, size, ecLevel, mask) {
  const out = mat.map((row) => row.slice());
  const bits = formatBits(ecLevel, mask);
  FORMAT_COPY_A.forEach(([r, c], i) => { out[r][c] = bits[i] === 1; });
  const copyB = formatCopyB(size);
  copyB.forEach(([r, c], k) => { out[r][c] = bits[14 - k] === 1; });
  return out;
}

function penalty(mat, size) {
  let score = 0;
  const runPenalty = (get) => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let r = 0; r < size; r++) runPenalty((i) => mat[r][i]);
  for (let c = 0; c < size; c++) runPenalty((i) => mat[i][c]);
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mat[r][c];
      if (mat[r][c + 1] === v && mat[r + 1][c] === v && mat[r + 1][c + 1] === v) score += 3;
    }
  }
  const patternAt = (bits, i) => {
    const seqA = [true, false, true, true, true, false, true, false, false, false, false];
    const seqB = [false, false, false, false, true, false, true, true, true, false, true];
    const match = (seq) => seq.every((v, k) => bits[i + k] === v);
    return (match(seqA) ? 1 : 0) + (match(seqB) ? 1 : 0);
  };
  for (let r = 0; r < size; r++) { const row = mat[r]; for (let c = 0; c <= size - 11; c++) score += 40 * patternAt(row, c); }
  for (let c = 0; c < size; c++) { const col = mat.map((row) => row[c]); for (let r = 0; r <= size - 11; r++) score += 40 * patternAt(col, r); }
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mat[r][c]) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Encode `text` (byte mode) into a QR matrix: { version, ecLevel, size, mask, modules }. */
export function encodeQR(text, ecLevel = 'M') {
  const byteLen = toUtf8Bytes(text).length;
  const version = chooseVersion(byteLen, ecLevel);
  const info = BLOCK_TABLE[version][ecLevel];
  const dataCw = buildDataCodewords(text, version, info);
  const allCw = interleave(dataCw, info);
  const { mat: skeleton, fn, size } = buildSkeleton(version);
  const withData = placeData(skeleton, fn, size, allCw);

  let best = null;
  for (let m = 0; m < 8; m++) {
    const masked = stampFormat(applyMask(withData, fn, size, MASK_FNS[m]), size, ecLevel, m);
    const score = penalty(masked, size);
    if (!best || score < best.score) best = { mask: m, mat: masked, score };
  }
  return { version, ecLevel, size, mask: best.mask, modules: best.mat };
}

/** Pad with the spec-minimum quiet zone (4 light modules) on all sides. */
export function addQuietZone(qr, quiet = 4) {
  const n = qr.size + quiet * 2;
  const out = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) out[r + quiet][c + quiet] = qr.modules[r][c];
  return out;
}

/** Render a QR matrix (with quiet zone already added) as an inline SVG string sized to fit
 *  a `box`px square. Two colors only — dark on a transparent/light background — matching the
 *  Practice HQ invite card. `aria-label` makes the code accessible to screen readers, since the
 *  encoded payload (a join link) is otherwise opaque to anyone who can't scan it. */
export function qrSvg(matrix, box = 148, dark = '#0B0D12', label = 'QR code to join') {
  const n = matrix.length;
  const cell = box / n;
  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) rects += `<rect x="${(c * cell).toFixed(2)}" y="${(r * cell).toFixed(2)}" width="${(cell + 0.4).toFixed(2)}" height="${(cell + 0.4).toFixed(2)}"/>`;
    }
  }
  return `<svg role="img" aria-label="${label}" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${box}" height="${box}" fill="#fff" rx="8"/>
    <g fill="${dark}">${rects}</g>
  </svg>`;
}
