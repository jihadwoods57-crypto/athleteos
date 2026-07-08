import { COMEBACK_THRESHOLD, comebackInfo } from './comeback';
import type { DayScore } from './types';

const h = (...dates: string[]): DayScore[] => dates.map((date) => ({ date, score: 85 }));

describe('comebackInfo', () => {
  it('fires after a real lapse (>= 3 days away, nothing done today)', () => {
    const info = comebackInfo(h('2026-06-28', '2026-06-30'), '2026-07-04', false);
    expect(info.isComeback).toBe(true);
    expect(info.daysAway).toBe(4);
    expect(info.headline).toBe('Good to see you back.');
    expect(info.detail).toContain('4 days');
    expect(info.cta).toBe('Log your first meal');
  });

  it('does NOT fire for normal cadence (1-2 days)', () => {
    expect(comebackInfo(h('2026-07-03'), '2026-07-04', false).isComeback).toBe(false);
    expect(comebackInfo(h('2026-07-02'), '2026-07-04', false).isComeback).toBe(false);
    expect(comebackInfo(h('2026-07-01'), '2026-07-04', false).isComeback).toBe(true); // exactly 3
    expect(COMEBACK_THRESHOLD).toBe(3);
  });

  it('is killed by action, not by being seen', () => {
    expect(comebackInfo(h('2026-06-20'), '2026-07-04', true).isComeback).toBe(false);
  });

  it('brand-new athletes (no history) get the Day-1 empty state, not a comeback', () => {
    expect(comebackInfo([], '2026-07-04', false).isComeback).toBe(false);
  });

  it('softens the count after two weeks ("a while", never a shame number)', () => {
    const info = comebackInfo(h('2026-06-01'), '2026-07-04', false);
    expect(info.isComeback).toBe(true);
    expect(info.detail).toContain('a while');
    expect(info.detail).not.toContain('33');
  });

  it('ignores unordered history and future-dated garbage', () => {
    const messy: DayScore[] = [
      { date: '2026-06-25', score: 90 },
      { date: '2026-07-09', score: 88 }, // future row must not count as "last logged"
      { date: '2026-06-30', score: 82 },
    ];
    const info = comebackInfo(messy, '2026-07-04', false);
    expect(info.daysAway).toBe(4); // from 06-30, not the future row
  });

  it('copy is forgiving and em-dash free', () => {
    const info = comebackInfo(h('2026-06-28'), '2026-07-04', false);
    for (const text of [info.headline, info.detail, info.cta]) {
      expect(text).not.toContain('—');
      expect(text.toLowerCase()).not.toContain('streak');
      expect(text.toLowerCase()).not.toContain('lost');
      expect(text.toLowerCase()).not.toContain('behind');
    }
  });
});
