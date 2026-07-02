import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

describe('buildPlanDraft', () => {
  it('creates one slot per window, keyed to the windows', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    expect(slots.map((s) => s.key)).toEqual(DEFAULT_PLAN.windows.map((w) => w.key));
  });

  it('slot macros roughly sum to the plan protein target (required-weighted)', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    const totalProtein = slots.reduce((n, s) => n + s.macros.protein, 0);
    // required meals carry a full share, snack a half — total lands near the plan target, not above it.
    expect(totalProtein).toBeGreaterThan(DEFAULT_PLAN.proteinTarget * 0.6);
    expect(totalProtein).toBeLessThanOrEqual(DEFAULT_PLAN.proteinTarget + 5);
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
