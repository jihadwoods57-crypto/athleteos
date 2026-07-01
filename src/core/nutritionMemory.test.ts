import {
  nutritionMemory,
  memoryReadiness,
  sampleMemoryInput,
  type NutritionMemoryInput,
} from './nutritionMemory';
import type { StoredMeal } from './types';

const today = new Date('2026-06-29T12:00:00Z');

function meal(dayAgoIso: string, type: string, protein: number, name = 'Meal', quality = 90): StoredMeal {
  return { type, name, protein, kcal: protein * 9, quality, photo_path: null, day_date: dayAgoIso, logged_at: `${dayAgoIso}T12:00:00Z` };
}

const empty: NutritionMemoryInput = { meals: [], nutritionHistory: [], weightHistory: [], proteinTarget: 140 };

describe('memoryReadiness', () => {
  it('is not ready with no history', () => {
    expect(memoryReadiness(empty).ready).toBe(false);
    expect(memoryReadiness(empty).daysLogged).toBe(0);
  });

  it('becomes ready once enough distinct days or meals exist', () => {
    const days = [{ date: '2026-06-20', score: 80 }, { date: '2026-06-21', score: 82 }, { date: '2026-06-22', score: 84 }, { date: '2026-06-23', score: 86 }];
    expect(memoryReadiness({ ...empty, nutritionHistory: days }).ready).toBe(true);
  });
});

describe('nutritionMemory — slot protein trend (flagship)', () => {
  it('surfaces a rising breakfast-protein insight from real meals', () => {
    const meals: StoredMeal[] = [
      meal('2026-06-10', 'breakfast', 18), meal('2026-06-11', 'breakfast', 17), meal('2026-06-12', 'breakfast', 19),
      meal('2026-06-26', 'breakfast', 36), meal('2026-06-27', 'breakfast', 38), meal('2026-06-28', 'breakfast', 37),
    ];
    const out = nutritionMemory({ ...empty, meals });
    const trend = out.find((i) => i.id === 'slot_protein_breakfast');
    expect(trend).toBeTruthy();
    expect(trend!.tone).toBe('win');
    // windows are thirds: early [18,17]→18g, recent [38,37]→38g, delta +20g
    expect(trend!.detail).toMatch(/18g/);
    expect(trend!.detail).toMatch(/38g/);
    expect(trend!.metric).toBe('+20g');
  });

  it('flags a slipping slot as a watch', () => {
    const meals: StoredMeal[] = [
      meal('2026-06-10', 'dinner', 50), meal('2026-06-11', 'dinner', 52), meal('2026-06-12', 'dinner', 48),
      meal('2026-06-26', 'dinner', 30), meal('2026-06-27', 'dinner', 28), meal('2026-06-28', 'dinner', 32),
    ];
    const trend = nutritionMemory({ ...empty, meals }).find((i) => i.id === 'slot_protein_dinner');
    expect(trend!.tone).toBe('watch');
    expect(trend!.headline).toMatch(/slipping/i);
  });

  it('does not fire a trend without enough evidence', () => {
    const meals = [meal('2026-06-26', 'breakfast', 18), meal('2026-06-27', 'breakfast', 38)];
    expect(nutritionMemory({ ...empty, meals }).some((i) => i.kind === 'slot_protein_trend')).toBe(false);
  });
});

describe('nutritionMemory — other insights', () => {
  it('computes a nutrition-score trend', () => {
    const nutritionHistory = ['2026-06-20', '2026-06-22', '2026-06-24', '2026-06-26', '2026-06-28', '2026-06-29']
      .map((date, i) => ({ date, score: 70 + i * 3 }));
    const t = nutritionMemory({ ...empty, nutritionHistory }).find((i) => i.kind === 'score_trend');
    expect(t).toBeTruthy();
    expect(t!.tone).toBe('win');
  });

  it('counts a trailing protein streak from daily totals', () => {
    const meals = ['2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29'].flatMap((d) => [meal(d, 'lunch', 80), meal(d, 'dinner', 70)]);
    const s = nutritionMemory({ ...empty, meals, proteinTarget: 140 }).find((i) => i.kind === 'protein_streak');
    expect(s!.metric).toBe('4 days');
  });

  it('flags a frequently-skipped slot', () => {
    // 5 recent days with breakfast+lunch+snack logged but dinner only once → dinner gap.
    const days = ['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29'];
    const meals = days
      .flatMap((d) => [meal(d, 'breakfast', 30), meal(d, 'lunch', 40), meal(d, 'snack', 15)])
      .concat([meal('2026-06-29', 'dinner', 50)]);
    const gap = nutritionMemory({ ...empty, meals }).find((i) => i.kind === 'slot_gap');
    expect(gap).toBeTruthy();
    expect(gap!.headline).toMatch(/Dinner/);
    expect(gap!.metric).toBe('4/5');
  });

  it('reads weight progress against the goal direction', () => {
    const weightHistory = [{ date: '2026-06-08', weight: 188 }, { date: '2026-06-15', weight: 186 }, { date: '2026-06-22', weight: 184 }, { date: '2026-06-29', weight: 182 }];
    const w = nutritionMemory({ ...empty, weightHistory, weightTarget: 178, weightDirection: 'lose' }).find((i) => i.kind === 'weight_progress');
    expect(w!.tone).toBe('win');
    expect(w!.metric).toBe('-6 lb');
  });

  it('names a signature meal logged repeatedly', () => {
    const meals = ['2026-06-20', '2026-06-23', '2026-06-26', '2026-06-29'].map((d) => meal(d, 'dinner', 52, 'Chicken, Rice & Broccoli', 94));
    const sig = nutritionMemory({ ...empty, meals }).find((i) => i.kind === 'signature_meal');
    expect(sig!.detail).toMatch(/Chicken, Rice & Broccoli/);
    expect(sig!.metric).toBe('×4');
  });

  it('ranks higher-signal insights first and caps the list', () => {
    const out = nutritionMemory(sampleMemoryInput(today), 3);
    expect(out.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].rank).toBeGreaterThanOrEqual(out[i].rank);
  });
});

describe('sampleMemoryInput (preview seed)', () => {
  it('produces a ready, insight-rich demo deterministically', () => {
    const input = sampleMemoryInput(today);
    expect(memoryReadiness(input).ready).toBe(true);
    const out = nutritionMemory(input);
    const kinds = out.map((i) => i.kind);
    expect(kinds).toContain('slot_protein_trend'); // the flagship breakfast climb
    expect(out.length).toBeGreaterThan(2);
  });
});
