// The admin "attention" decision system is pure + deterministic (no LLM) so it is jest-testable the
// same way the proto modules are: import the browser ESM file directly.
import { evaluateFlags, briefing, type AdminMetrics } from '../../web/admin/attention.js';

// A baseline metrics bundle where NOTHING should flag — each test perturbs one field.
const ok: AdminMetrics = {
  activeToday: 40, activeTodayPrev: 35,
  costPerMeal: 0.019, costPerMealAvg7: 0.019, calls: 120,
  medianDelta: -2, deltaEvents: 200,
  textConflictRate: 0.03,
  verifyFired: 20, verifyChanged: 8,
  funnel: { opens: 100, rolePicked: 80, goalPicked: 70, completed: 55 },
  aiOkByFn: [{ fn: 'analyze-meal', okRate: 1, calls: 100 }],
  appErrorsToday: 2, appErrors7dAvg: 3,
  subs: 0,
};

const keys = (m: AdminMetrics) => evaluateFlags(m).map((f) => f.key).sort();

describe('evaluateFlags', () => {
  test('clean metrics produce no flags', () => {
    expect(evaluateFlags(ok)).toEqual([]);
  });

  test('AI cost/meal >30% over the 7-day avg warns', () => {
    expect(keys({ ...ok, costPerMeal: 0.019 * 1.31 })).toContain('ai_cost');
    expect(keys({ ...ok, costPerMeal: 0.019 * 1.29 })).not.toContain('ai_cost');
  });

  test('median score-delta <= -15 warns (one-sided AI bias)', () => {
    expect(keys({ ...ok, medianDelta: -15 })).toContain('score_delta');
    expect(keys({ ...ok, medianDelta: -14 })).not.toContain('score_delta');
  });

  test('|median delta| > 25 warns only after 50+ events', () => {
    expect(keys({ ...ok, medianDelta: 30, deltaEvents: 60 })).toContain('score_delta');
    expect(keys({ ...ok, medianDelta: 30, deltaEvents: 40 })).not.toContain('score_delta');
  });

  test('text conflict rate > 0.10 warns', () => {
    expect(keys({ ...ok, textConflictRate: 0.11 })).toContain('text_conflict');
    expect(keys({ ...ok, textConflictRate: 0.10 })).not.toContain('text_conflict');
  });

  test('verify never fired -> note (too tight); rarely changes -> note (too loose)', () => {
    expect(keys({ ...ok, verifyFired: 0, verifyChanged: 0 })).toContain('verify_tight');
    expect(keys({ ...ok, verifyFired: 30, verifyChanged: 1 })).toContain('verify_loose');
  });

  test('onboarding step conversion below floor warns', () => {
    expect(keys({ ...ok, funnel: { opens: 100, rolePicked: 80, goalPicked: 30, completed: 25 } })).toContain('funnel_role_goal');
    expect(keys({ ...ok, funnel: { opens: 100, rolePicked: 80, goalPicked: 70, completed: 20 } })).toContain('funnel_goal_complete');
  });

  test('an AI function below 100% ok-rate warns and names the function', () => {
    const flags = evaluateFlags({ ...ok, aiOkByFn: [{ fn: 'meal-chat', okRate: 0.9, calls: 30 }] });
    const f = flags.find((x) => x.key === 'ai_ok_rate');
    expect(f).toBeTruthy();
    expect(f!.value).toContain('meal-chat');
  });

  test('a low-volume failing function does not warn (noise floor)', () => {
    expect(keys({ ...ok, aiOkByFn: [{ fn: 'x', okRate: 0.5, calls: 2 }] })).not.toContain('ai_ok_rate');
  });

  test('app_error spike vs 7-day average warns', () => {
    expect(keys({ ...ok, appErrorsToday: 20, appErrors7dAvg: 3 })).toContain('app_error');
    expect(keys({ ...ok, appErrorsToday: 4, appErrors7dAvg: 3 })).not.toContain('app_error');
  });

  test('every flag carries a level, label, value and evidence link', () => {
    for (const f of evaluateFlags({ ...ok, costPerMeal: 1 })) {
      expect(['warn', 'note']).toContain(f.level);
      expect(typeof f.label).toBe('string');
      expect(typeof f.value).toBe('string');
      expect(typeof f.link).toBe('string');
    }
  });
});

describe('briefing', () => {
  test('fills real numbers into the template with a signed weekly delta', () => {
    const s = briefing(ok);
    expect(s).toContain('40 athletes active today (+5 vs last week)');
    expect(s).toContain('over 120 calls');
    expect(s).toContain('0 paying subscriptions');
    expect(s).toContain('0 items need attention');
  });

  test('negative weekly delta keeps its sign; item count matches evaluateFlags', () => {
    const m = { ...ok, activeToday: 30, activeTodayPrev: 40, costPerMeal: 1 };
    const s = briefing(m);
    expect(s).toContain('(-10 vs last week)');
    expect(s).toContain(`${evaluateFlags(m).length} item`);
  });
});
