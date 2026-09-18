import { isHealthAvailable, readRecoverySample, readActivity, observeActivity, connectHealth, lastNightWindow } from './index';
import { blendRecovery } from '@/core';
import { progressFromSample } from '@/core/activity';

// Locks the health seam INERT: a regression that ships live health ingestion (and silently moves
// the recovery sub-score, or starts writing activity progress) without the founder's device
// wiring fails CI here.
//
// Every assertion is guarded on isHealthAvailable, so the founder flipping that flag as step 3 of
// docs/go-live/WEARABLES.md turns this suite into a no-op instead of a red build they have to
// delete — a lock that can only be satisfied by never shipping the feature gets deleted, and then
// it protects nothing.
describe('health seam (inert)', () => {
  it('is not available by default', () => {
    expect(isHealthAvailable).toBe(false);
  });

  (isHealthAvailable ? describe.skip : describe)('while the seam is off', () => {
    it('readRecoverySample resolves null (no health store read)', async () => {
      await expect(readRecoverySample()).resolves.toBeNull();
    });

    it('the recovery sub-score is unchanged', async () => {
      const sample = await readRecoverySample();
      expect(blendRecovery(86, sample)).toBe(86); // null sample -> self-report unchanged
    });

    it('readActivity resolves null, and null is not a zero', async () => {
      const sample = await readActivity('2026-07-28T04:00:00Z', '2026-07-28T22:00:00Z');
      expect(sample).toBeNull();
      // The distinction the whole feature rests on: with no reading, progress is UNKNOWN. If this
      // ever returned 0 instead, every athlete would be reported as having done nothing, and the
      // deadline cron would have "evidence" of a shortfall it never actually had.
      expect(progressFromSample(sample, { metric: 'steps' })).toBeNull();
    });

    it('observeActivity registers nothing', async () => {
      await expect(observeActivity()).resolves.toBe(false);
    });

    it('connecting reports an honest unavailable rather than a fake success', async () => {
      await expect(connectHealth(['activity'])).resolves.toEqual({
        connected: false, reason: 'unavailable',
      });
    });
  });
});

// The window "last night" means. A rolling 24 hours is not a night: read at 9pm it starts at 9pm
// yesterday, swallowing an afternoon nap and sometimes the tail of the night before. Harmless as
// context; not harmless once a Recovery Standard scores it.
describe('lastNightWindow', () => {
  const at = (iso: string) => lastNightWindow(new Date(iso));

  it('runs 18:00 yesterday to noon today when read in the afternoon', () => {
    const { start, end } = at('2026-09-18T21:00:00');
    expect(start.getDate()).toBe(17);
    expect(start.getHours()).toBe(18);
    expect(end.getDate()).toBe(18);
    expect(end.getHours()).toBe(12);
  });

  it('ends NOW when read before noon, so a morning read is not waiting on the clock', () => {
    const { start, end } = at('2026-09-18T07:30:00');
    expect(start.getHours()).toBe(18);
    expect(end.getHours()).toBe(7);
    expect(end.getMinutes()).toBe(30);
  });

  it('excludes an afternoon nap, which is the whole reason it exists', () => {
    const { start, end } = at('2026-09-18T21:00:00');
    const nap = new Date('2026-09-18T15:00:00');   // 3pm today
    expect(nap > end).toBe(true);
    expect(nap > start).toBe(true);                // inside a rolling 24h, outside this window
  });

  it('still contains a 2am to 10am night', () => {
    const { start, end } = at('2026-09-18T21:00:00');
    expect(new Date('2026-09-18T02:00:00') > start).toBe(true);
    expect(new Date('2026-09-18T10:00:00') < end).toBe(true);
  });
});
