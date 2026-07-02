import { planView } from './planView';
import { buildPlanDraft } from './planDraft';
import { DEFAULT_PLAN } from './coachPlan';

const at = (h: number, m = 0) => new Date(2026, 6, 2, h, m);

describe('planView', () => {
  it('returns one entry per slot with a compliance state', () => {
    const plan = { ...DEFAULT_PLAN, slots: buildPlanDraft(DEFAULT_PLAN, 'gain') };
    const v = planView(plan, {}, at(12, 30));
    expect(v.map((e) => e.slot.key)).toEqual(plan.slots.map((s) => s.key));
    expect(v.find((e) => e.slot.key === 'breakfast')!.state).toBe('missed');
  });

  it('shows a note only once its window has opened', () => {
    const plan = {
      ...DEFAULT_PLAN,
      slots: buildPlanDraft(DEFAULT_PLAN, 'gain').map((s) => (s.key === 'dinner' ? { ...s, note: 'Extra salt' } : s)),
    };
    expect(planView(plan, {}, at(8)).find((e) => e.slot.key === 'dinner')!.showNote).toBe(false); // dinner window not open at 8am
    expect(planView(plan, {}, at(18)).find((e) => e.slot.key === 'dinner')!.showNote).toBe(true);
  });
});
