/* OnStandard — photo integrity helpers (no DOM, no state; Node-importable for tests).
   Owns: base64→bytes, the sha256 hex of the downscaled JPEG (the duplicate-photo wall now that
   gallery photos score — founder reversal of Rule A, 2026-07-15), and a minimal EXIF
   DateTimeOriginal reader for gallery staleness transparency. The EXIF read MUST run on the
   ORIGINAL picked file's bytes — the canvas re-encode in downscaleToJpeg strips all metadata. */

/** Raw base64 (no data: prefix) → Uint8Array. Returns an empty array on junk input. */
export function base64ToBytes(b64) {
  try {
    const bin = atob(String(b64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return new Uint8Array(0); }
}

/** sha256 of bytes as 64 lowercase hex chars (the shape migration 0062's check constraint and
 *  unique index expect), or null when WebCrypto is unavailable / input empty. */
export async function sha256Hex(bytes) {
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
  if (!subtle || !bytes || !bytes.length) return null;
  try {
    const d = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/* ---- minimal EXIF DateTimeOriginal (tag 0x9003) reader for JPEG bytes ----
   Bounds-checked at every step; any anomaly returns null (many apps strip EXIF — absence is
   normal, never an error). Returns a LOCAL-time ISO-like string "YYYY-MM-DDTHH:MM:SS" (EXIF
   carries no timezone; treating it as the athlete's local time is the honest reading). */
export function exifDateTimeOriginal(bytes) {
  try {
    const b = bytes;
    if (!b || b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8) return null; // not a JPEG
    const u16 = (o, little) => (o + 1 < b.length ? (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : -1);
    // Plain arithmetic (not |) so a value with the high bit set can't go negative via 32-bit ops.
    const u32 = (o, little) => (o + 3 < b.length
      ? (little
        ? (b[o] + b[o + 1] * 0x100 + b[o + 2] * 0x10000 + b[o + 3] * 0x1000000)
        : (b[o] * 0x1000000 + b[o + 1] * 0x10000 + b[o + 2] * 0x100 + b[o + 3]))
      : -1);
    // Walk JPEG segments looking for APP1/"Exif\0\0". Stop at SOS (0xDA) — image data follows.
    let o = 2;
    let tiff = -1;
    while (o + 4 <= b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      if (marker === 0xda) return null; // start of scan, no EXIF found
      const len = u16(o + 2, false);
      if (len < 2 || o + 2 + len > b.length) return null;
      if (marker === 0xe1 && len >= 14
        && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66
        && b[o + 8] === 0x00 && b[o + 9] === 0x00) { // "Exif\0\0"
        tiff = o + 10;
        break;
      }
      o += 2 + len;
    }
    if (tiff < 0) return null;
    // TIFF header: byte order + magic 42 + IFD0 offset (all offsets are tiff-relative).
    const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
    const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
    if (!little && !big) return null;
    if (u16(tiff + 2, little) !== 42) return null;
    const readIfd = (ifdOff, wantTag) => {
      const base = tiff + ifdOff;
      const n = u16(base, little);
      if (n < 0 || n > 512) return -1;
      for (let i = 0; i < n; i++) {
        const e = base + 2 + i * 12;
        if (u16(e, little) === wantTag) return e;
      }
      return -1;
    };
    const ifd0 = u32(tiff + 4, little);
    if (ifd0 < 0) return null;
    const exifPtrEntry = readIfd(ifd0, 0x8769); // ExifIFDPointer
    if (exifPtrEntry < 0) return null;
    const exifIfd = u32(exifPtrEntry + 8, little);
    if (exifIfd < 0) return null;
    const dtEntry = readIfd(exifIfd, 0x9003); // DateTimeOriginal
    if (dtEntry < 0) return null;
    if (u16(dtEntry + 2, little) !== 2) return null; // type must be ASCII
    const count = u32(dtEntry + 4, little);
    if (count < 19 || count > 24) return null;
    const valOff = tiff + u32(dtEntry + 8, little); // count>4 → value is always an offset
    if (valOff < 0 || valOff + 19 > b.length) return null;
    let s = '';
    for (let i = 0; i < 19; i++) s += String.fromCharCode(b[valOff + i]);
    // "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
    if (!m) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  } catch { return null; }
}

/** Age of a photo in whole minutes given its EXIF local-time string and `now` (ms epoch).
 *  Null when unknown/absent or the timestamp is in the future (clock skew — don't accuse). */
export function photoAgeMinutes(exifLocal, nowMs) {
  if (!exifLocal) return null;
  const t = new Date(exifLocal).getTime();
  if (!isFinite(t)) return null;
  const mins = Math.floor((nowMs - t) / 60000);
  return mins >= 0 ? mins : null;
}

/** Human line for a stale gallery photo ("taken 2 days ago"), or null when fresh (<60 min)
 *  or unknown. Transparency, never a block — the founder-approved staleness badge. */
export function describePhotoAge(mins) {
  if (mins == null || mins < 60) return null;
  if (mins < 120) return 'taken about an hour ago';
  if (mins < 1440) return `taken ${Math.floor(mins / 60)} hours ago`;
  const days = Math.floor(mins / 1440);
  return days === 1 ? 'taken yesterday' : `taken ${days} days ago`;
}
