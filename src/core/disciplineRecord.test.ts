import { disciplineRecord, disciplineRecordText, RECORD_MIN_DAYS } from './disciplineRecord';
import type { DayScore, WeightPoint } from './types';

/** N consecutive dated days ending 2026-07-03, alternating the given scores. */
function days(scores: number[]): DayScore[] {
  const out: DayScore[] = [];
  const end = new Date(2026, 6, 3, 12);
  for (let i = 0; i < scores.length; i++) {
    const d = new Date(end.getTime() - (scores.length - 1 - i) * 86_400_000);
    out.push({ date: d.toISOString().slice(0, 10), score: scores[i] });
  }
  return out;
}

describe('disciplineRecord', () => {
  it('refuses to render a record below the minimum (no decorative numbers)', () => {
    expect(disciplineRecord(days([85, 85, 85]), 90)).toBeNull();
    expect(RECORD_MIN_DAYS).toBe(7);
  });

  it('computes the honest record from real history', () => {
    const h = days([85, 90, 70, 88, 92, 60, 95, 84]); // 8 days, 6 on standard
    const r = disciplineRecord(h, 90);
    expect(r).not.toBeNull();
    expect(r!.daysLogged).toBe(8);
    expect(r!.daysOnStandard).toBe(6);
    expect(r!.onStandardPct).toBe(75);
    expect(r!.since).toBe(h[0].date);
    expect(r!.avgScore).toBe(Math.round((85 + 90 + 70 + 88 + 92 + 60 + 95 + 84) / 8));
    expect(r!.longestStreak).toBeGreaterThanOrEqual(2);
  });

  it('carries the weight arc only with 2+ points', () => {
    const h = days([85, 85, 85, 85, 85, 85, 85]);
    const w: WeightPoint[] = [{ date: '2026-06-27', weight: 182 }, { date: '2026-07-03', weight: 186.5 }];
    expect(disciplineRecord(h, 85, w)!.weightDelta).toBe(4.5);
    expect(disciplineRecord(h, 85, [])!.weightDelta).toBeNull();
  });

  it('share text is factual, carries integrity, and bans em dashes', () => {
    const h = days([85, 90, 70, 88, 92, 60, 95, 84]);
    const text = disciplineRecordText(disciplineRecord(h, 90)!, 'Jihad Carter');
    expect(text).toContain('Jihad Carter');
    expect(text).toContain('8 logged days');
    expect(text).toContain('75% of days on standard');
    expect(text).toContain('Not self-reported');
    expect(text).not.toContain('—');
  });
});
