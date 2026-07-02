import { planCompliance } from './planCompliance';
import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

const at = (h: number, m = 0) => new Date(2026, 6, 2, h, m);

function planWithSlots() {
  return { ...DEFAULT_PLAN, slots: buildPlanDraft(DEFAULT_PLAN, 'gain') };
}

describe('planCompliance', () => {
  it('marks a slot completed when logged protein meets 85% of its target', () => {
    const plan = planWithSlots();
    const bfast = plan.slots.find((s) => s.key === 'breakfast')!;
    const logged = { breakfast: { protein: Math.ceil(bfast.macros.protein * 0.9), kcal: bfast.macros.kcal } };
    const r = planCompliance(plan, logged, at(10));
    expect(r.slots.find((s) => s.key === 'breakfast')!.state).toBe('completed');
  });

  it('marks a logged-but-short slot partial', () => {
    const plan = planWithSlots();
    const bfast = plan.slots.find((s) => s.key === 'breakfast')!;
    const logged = { breakfast: { protein: Math.floor(bfast.macros.protein * 0.4), kcal: 200 } };
    expect(planCompliance(plan, logged, at(10)).slots.find((s) => s.key === 'breakfast')!.state).toBe('partial');
  });

  it('marks an unlogged past-deadline slot missed, a future one upcoming', () => {
    const plan = planWithSlots();
    const r = planCompliance(plan, {}, at(12, 30)); // breakfast deadline 9:30 passed; dinner future
    expect(r.slots.find((s) => s.key === 'breakfast')!.state).toBe('missed');
    expect(r.slots.find((s) => s.key === 'dinner')!.state).toBe('upcoming');
  });

  it('compliancePct counts only required slots', () => {
    const plan = planWithSlots(); // breakfast/lunch/dinner required, snack optional
    const logged = {
      breakfast: { protein: 999, kcal: 999 },
      lunch: { protein: 999, kcal: 999 },
      dinner: { protein: 999, kcal: 999 },
    };
    const r = planCompliance(plan, logged, at(21));
    expect(r.requiredTotal).toBe(3);
    expect(r.completedRequired).toBe(3);
    expect(r.compliancePct).toBe(100);
  });
});
