import { buildDeepDivePayload, deepDiveReady, parseDeepDiveResult, DEEP_MIN_DAYS, DEEP_SCORE_DAYS } from './deepDive';
import type { DayScore } from './types';

const days = (n: number): DayScore[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, score: 80 + (i % 10) }));

describe('buildDeepDivePayload', () => {
  it('bounds every series so the paid call stays small', () => {
    const p = buildDeepDivePayload({
      scoreHistory: days(120),
      nutritionHistory: days(120),
      weightHistory: Array.from({ length: 200 }, (_, i) => ({ date: `d${i}`, weight: 180 + i * 0.1 })),
      liveScore: 84, proteinToday: 141.6, proteinTarget: 180, kcalToday: 2412.4, calTarget: 3200,
      streakDays: 5, compliancePct: 78,
    });
    expect(p.scores).toHaveLength(DEEP_SCORE_DAYS);
    expect(p.weights).toHaveLength(60);
    expect(p.today).toEqual({ score: 84, protein: 142, proteinTarget: 180, kcal: 2412, kcalTarget: 3200 });
  });
});

describe('deepDiveReady', () => {
  it('needs a real week of history before spending the weekly slot', () => {
    expect(deepDiveReady(days(DEEP_MIN_DAYS - 1))).toBe(false);
    expect(deepDiveReady(days(DEEP_MIN_DAYS))).toBe(true);
  });
});

describe('parseDeepDiveResult (defensive render gate)', () => {
  const good = { headline: 'Strong week with one leak', sections: [{ title: 'Pattern', body: 'Your dips follow late lunches.' }], focus: 'Log lunch before 1pm.' };
  it('passes a well-formed result through', () => {
    expect(parseDeepDiveResult(good)).toEqual(good);
  });
  it('drops garbage whole rather than half-rendering', () => {
    expect(parseDeepDiveResult(null)).toBeNull();
    expect(parseDeepDiveResult({})).toBeNull();
    expect(parseDeepDiveResult({ ...good, sections: [] })).toBeNull();
    expect(parseDeepDiveResult({ ...good, sections: [{ title: 'x' }] })).toBeNull();
    expect(parseDeepDiveResult({ ...good, headline: '' })).toBeNull();
  });
  it('caps sections at 4', () => {
    const many = { ...good, sections: Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, body: 'b' })) };
    expect(parseDeepDiveResult(many)!.sections).toHaveLength(4);
  });
});
