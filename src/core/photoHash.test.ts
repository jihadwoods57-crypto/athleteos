/**
 * Photo integrity helpers (0062): base64→bytes, sha256 hex (the duplicate-photo wall now that
 * gallery photos score), the minimal EXIF DateTimeOriginal reader (staleness transparency),
 * and the staleness copy. Pure module — no DOM.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import { base64ToBytes, sha256Hex, exifDateTimeOriginal, photoAgeMinutes, describePhotoAge } from '../../proto/redesign-2026-07/js/photo-hash.js';

// jsdom/jest envs don't always expose WebCrypto — install Node's implementation.
beforeAll(() => {
  const g: any = globalThis;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require('node:crypto');
  if (!g.crypto || !g.crypto.subtle) g.crypto = webcrypto;
  if (typeof g.atob !== 'function') g.atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
});

describe('base64ToBytes', () => {
  test('decodes raw base64', () => expect(Array.from(base64ToBytes('YWJj'))).toEqual([97, 98, 99]));
  test('junk input yields empty bytes, never throws', () => expect(base64ToBytes('%%%').length).toBe(0));
});

describe('sha256Hex', () => {
  test('known vector: sha256("abc")', async () => {
    const hex = await sha256Hex(new Uint8Array([97, 98, 99]));
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex).toMatch(/^[0-9a-f]{64}$/); // the exact shape migration 0062's check constraint expects
  });
  test('empty input yields null (nothing to wall)', async () =>
    expect(await sha256Hex(new Uint8Array(0))).toBeNull());
});

/** Assemble a minimal little-endian JPEG/EXIF carrying DateTimeOriginal. */
function jpegWithExif(dt = '2026:07:13 08:30:00'): Uint8Array {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const tiff = [
    ...ascii('II'), ...u16le(42), ...u32le(8),                      // header, IFD0 @8
    ...u16le(1), ...u16le(0x8769), ...u16le(4), ...u32le(1), ...u32le(26), ...u32le(0), // IFD0: ExifIFD ptr → 26
    ...u16le(1), ...u16le(0x9003), ...u16le(2), ...u32le(20), ...u32le(44), ...u32le(0), // ExifIFD: DateTimeOriginal @44
    ...ascii(dt), 0,                                                 // 20 ASCII bytes at offset 44
  ];
  const payload = [...ascii('Exif'), 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload, 0xff, 0xd9]);
}

describe('exifDateTimeOriginal', () => {
  test('reads DateTimeOriginal from a real APP1/EXIF block', () =>
    expect(exifDateTimeOriginal(jpegWithExif())).toBe('2026-07-13T08:30:00'));
  test('JPEG without EXIF yields null (normal, not an error)', () =>
    expect(exifDateTimeOriginal(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0, 0]))).toBeNull());
  test('non-JPEG bytes yield null, never throw', () => {
    expect(exifDateTimeOriginal(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(exifDateTimeOriginal(undefined as any)).toBeNull();
  });
  test('malformed date string yields null', () =>
    expect(exifDateTimeOriginal(jpegWithExif('not a real datetime!!'))).toBeNull());
});

describe('photo age + staleness copy', () => {
  const now = new Date('2026-07-15T12:00:00').getTime();
  test('age in minutes from a local EXIF time', () =>
    expect(photoAgeMinutes('2026-07-15T10:00:00', now)).toBe(120));
  test('future timestamps (clock skew) read as unknown, not negative', () =>
    expect(photoAgeMinutes('2026-07-15T13:00:00', now)).toBeNull());
  test('fresh photos earn no badge', () => expect(describePhotoAge(30)).toBeNull());
  test('staleness copy scales hour → day', () => {
    expect(describePhotoAge(90)).toBe('taken about an hour ago');
    expect(describePhotoAge(300)).toBe('taken 5 hours ago');
    expect(describePhotoAge(1500)).toBe('taken yesterday');
    expect(describePhotoAge(4000)).toBe('taken 2 days ago');
  });
});
