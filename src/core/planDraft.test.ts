import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

describe('buildPlanDraft', () => {
  it('creates one slot per window, keyed to the windows', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    expect(slots.map((s) => s.key)).toEqual(DEFAULT_PLAN.windows.map((w) => w.key));
  });

  it('required slots sum to about the daily protein target; snack adds a bonus on top', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    const requiredKeys = new Set(DEFAULT_PLAN.windows.filter((w) => w.required).map((w) => w.key));
    const requiredProtein = slots.filter((s) => requiredKeys.has(s.key)).reduce((n, s) => n + s.macros.protein, 0);
    const totalProtein = slots.reduce((n, s) => n + s.macros.protein, 0);
    // required meals each carry a full 1/required share, so together they ~= the daily target
    expect(requiredProtein).toBeGreaterThanOrEqual(DEFAULT_PLAN.proteinTarget - 3);
    expect(requiredProtein).toBeLessThanOrEqual(DEFAULT_PLAN.proteinTarget + 3);
    // the optional snack is a bonus half-share on top
    expect(totalProtein).toBeGreaterThan(requiredProtein);
  });

  it('every slot has one seeded option in open mode', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'maintain');
    for (const s of slots) {
      expect(s.mode).toBe('open');
      expect(s.options).toHaveLength(1);
      expect(s.options[0].source).toBe('ai');
      expect(s.options[0].macros.protein).toBe(s.macros.protein);
    }
  });
});
