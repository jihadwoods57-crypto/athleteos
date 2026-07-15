/**
 * Camera capture staging + the 0062 duplicate pre-check (WS3 live-camera rework).
 * captureMeal stages provenance (source/capturedAt/EXIF takenAt) and hashes the JPEG in the
 * background; act.checkPhotoReuse is the free pre-analysis gate; the confirm screen refuses
 * to render without a staged photo. Same node+jsdom bootstrap as the other proto tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).location = dom.window.location;
// state.js hashes via WebCrypto and decodes via atob — install Node equivalents.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webcrypto } = require('node:crypto');
if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;
if (typeof (globalThis as any).atob !== 'function') {
  (globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { act, MEAL } = require('../../proto/redesign-2026-07/js/state.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
// The capture hash computes in the background (native digest) — poll instead of racing one tick.
const untilHashed = async () => { for (let i = 0; i < 50 && !MEAL.photoHash; i++) await tick(); };
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

afterEach(() => { act.clearMeal(); delete (dom.window as any).sb; });

describe('captureMeal staging (provenance + background hash)', () => {
  test('live capture stages source=live, capture time, no EXIF', async () => {
    act.captureMeal('YWJj', 'data:image/jpeg;base64,YWJj', 'lunch', true);
    expect(MEAL.source).toBe('live');
    expect(typeof MEAL.capturedAtMin).toBe('number');
    expect(MEAL.takenAt).toBeNull();
    await untilHashed();
    expect(MEAL.photoHash).toBe(SHA_ABC); // sha256("abc")
  });
  test('gallery capture stages source=gallery and carries the EXIF takenAt', () => {
    act.captureMeal('YWJj', 'data:image/jpeg;base64,YWJj', 'lunch', false, { takenAt: '2026-07-13T08:30:00' });
    expect(MEAL.source).toBe('gallery');
    expect(MEAL.live).toBe(false);
    expect(MEAL.takenAt).toBe('2026-07-13T08:30:00');
  });
  test('clearMeal wipes every integrity field', () => {
    act.captureMeal('YWJj', 'data:x', 'lunch', false, { takenAt: '2026-07-13T08:30:00' });
    act.clearMeal();
    expect(MEAL.photoHash).toBeNull();
    expect(MEAL.source).toBeNull();
    expect(MEAL.takenAt).toBeNull();
    expect(MEAL.capturedAtMin).toBeNull();
  });
});

describe('act.checkPhotoReuse — the free pre-analysis duplicate gate', () => {
  test('no staged photo → never reused', async () =>
    expect(await act.checkPhotoReuse()).toEqual({ reused: false }));

  test('clean hash (no prior rows) → not reused; fail-open without a client', async () => {
    act.captureMeal('YWJj', 'data:x', 'lunch', false);
    await tick();
    expect((await act.checkPhotoReuse()).reused).toBe(false); // window.sb absent → fail open
  });

  test('server reports a prior use → reused with the prior row surfaced', async () => {
    (dom.window as any).sb = {
      rpc: async (fn: string, args: any) => {
        expect(fn).toBe('check_photo_reuse');
        expect(args.p_hash).toBe(SHA_ABC);
        return { data: [{ day_date: '2026-07-12', meal_type: 'lunch', logged_at: 'x' }], error: null };
      },
    };
    act.captureMeal('YWJj', 'data:x', 'dinner', false);
    await tick();
    const r = await act.checkPhotoReuse();
    expect(r.reused).toBe(true);
    expect(r.prior.day_date).toBe('2026-07-12');
  });
});

describe('camera-confirm render gate', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { cameraConfirm } = require('../../proto/redesign-2026-07/js/screens/camera.js');
  test('no staged photo → empty render (mount guard mirrors it)', () => {
    act.clearMeal();
    expect(cameraConfirm.render({})).toBe('');
  });
  test('staged gallery photo renders the confirm UI with provenance badge', () => {
    act.captureMeal('YWJj', 'data:image/jpeg;base64,YWJj', 'lunch', false);
    const html = cameraConfirm.render({});
    expect(html).toContain('Use this photo?');
    expect(html).toContain('FROM GALLERY');
    expect(html).toContain('cc-analyze');
    expect(html).toContain('cc-retake');
  });
});
