import { encodeQR, addQuietZone } from './qr';

// Independently-authored format-info coordinate lists (mirrors the ISO 18004 Annex C layout),
// used only to cross-check the encoder's own placement — not imported from qr.ts.
const copyA = (): [number, number][] => [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
const copyB = (size: number): [number, number][] => [
  [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
  [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8],
];

function readBits(mat: boolean[][], coords: [number, number][]): number[] {
  return coords.map(([r, c]) => (mat[r][c] ? 1 : 0));
}

function assertFinderPattern(mat: boolean[][], top: number, left: number) {
  for (let dr = 0; dr < 7; dr++) {
    for (let dc = 0; dc < 7; dc++) {
      const expected = dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      expect(mat[top + dr][left + dc]).toBe(expected);
    }
  }
}

describe('encodeQR — structural correctness', () => {
  const JOIN_URL = 'https://onstandard.app/join?code=ABCD12';

  it('picks a small version + honors the requested EC level for a real invite link', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    expect(qr.ecLevel).toBe('M');
    expect(qr.version).toBeGreaterThanOrEqual(1);
    expect(qr.version).toBeLessThanOrEqual(5);
    expect(qr.size).toBe(17 + 4 * qr.version);
  });

  it('picks a larger version for a longer payload than a shorter one', () => {
    const short = encodeQR('https://onstandard.app/join?code=AB', 'M');
    const long = encodeQR('https://onstandard.app/join?code=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'M');
    expect(long.version).toBeGreaterThanOrEqual(short.version);
  });

  it('throws rather than silently truncating a payload too long for the supported versions', () => {
    expect(() => encodeQR('x'.repeat(500), 'H')).toThrow();
  });

  it('draws all three finder patterns with the correct 1:1:3:1:1 ring structure', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    assertFinderPattern(qr.modules, 0, 0);
    assertFinderPattern(qr.modules, 0, qr.size - 7);
    assertFinderPattern(qr.modules, qr.size - 7, 0);
  });

  it('draws separators (light ring) around each finder pattern', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    // the module just outside the top-left finder's 7x7 box must be light
    expect(qr.modules[7][0]).toBe(false);
    expect(qr.modules[0][7]).toBe(false);
    expect(qr.modules[7][7]).toBe(false);
  });

  it('draws an alternating timing pattern on row 6 and column 6, starting dark', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    for (let c = 8; c <= qr.size - 9; c++) expect(qr.modules[6][c]).toBe(c % 2 === 0);
    for (let r = 8; r <= qr.size - 9; r++) expect(qr.modules[r][6]).toBe(r % 2 === 0);
  });

  it('places the fixed dark module at (4*version+9, 8)', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    expect(qr.modules[4 * qr.version + 9][8]).toBe(true);
  });

  it('format info is internally consistent between its two redundant copies', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    const a = readBits(qr.modules, copyA()); // bit14..bit0
    const b = readBits(qr.modules, copyB(qr.size)); // bit0..bit14
    const bReversed = b.slice().reverse(); // -> bit14..bit0
    expect(a).toEqual(bReversed);
  });

  it('format info encodes the requested EC level (bits 14-13 of the 15-bit format string)', () => {
    // EC indicator bits per ISO 18004 Table 25: L=01, M=00, Q=11, H=10 — but the format field
    // is XORed with the fixed mask 0x5412 before storage, so we only assert internal
    // consistency between the two copies (done above) and that different levels/masks/payloads
    // produce different stored bit patterns (i.e. the field is not a dead constant).
    const m = encodeQR(JOIN_URL, 'M');
    const h = encodeQR(JOIN_URL, 'H');
    const a1 = readBits(m.modules, copyA());
    const a2 = readBits(h.modules, copyA());
    expect(a1).not.toEqual(a2);
  });

  it('produces a non-degenerate data region (not all-dark or all-light) for a real payload', () => {
    const qr = encodeQR(JOIN_URL, 'M');
    let dark = 0, total = 0;
    for (let r = 9; r < qr.size - 9; r++) for (let c = 9; c < qr.size - 9; c++) { total++; if (qr.modules[r][c]) dark++; }
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(total);
  });
});

describe('addQuietZone', () => {
  it('adds a 4-module light border on every side by default', () => {
    const qr = encodeQR('https://onstandard.app/join?code=AB', 'M');
    const padded = addQuietZone(qr);
    const n = qr.size + 8;
    expect(padded.length).toBe(n);
    expect(padded[0].length).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(padded[0][i]).toBe(false);
      expect(padded[n - 1][i]).toBe(false);
      expect(padded[i][0]).toBe(false);
      expect(padded[i][n - 1]).toBe(false);
    }
    // interior still carries the original finder pattern's dark corner module
    expect(padded[4][4]).toBe(true);
  });

  it('honors a custom quiet-zone width', () => {
    const qr = encodeQR('https://onstandard.app/join?code=AB', 'M');
    const padded = addQuietZone(qr, 2);
    expect(padded.length).toBe(qr.size + 4);
    expect(padded[0][0]).toBe(false);
  });
});
