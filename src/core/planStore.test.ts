import { applySlotPatch, toggleMode } from './planStore';
import { DEFAULT_PLAN } from './coachPlan';
import { buildPlanDraft } from './planDraft';

describe('applySlotPatch', () => {
  it('patches only the targeted slot', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain');
    const out = applySlotPatch(slots, 'lunch', { note: 'Finish everything', photoRequired: true });
    const lunch = out.find((s) => s.key === 'lunch')!;
    expect(lunch.note).toBe('Finish everything');
    expect(lunch.photoRequired).toBe(true);
    expect(out.find((s) => s.key === 'breakfast')!.note).toBeNull();
  });
});

describe('toggleMode', () => {
  it('flips pinned <-> open for one slot', () => {
    const slots = buildPlanDraft(DEFAULT_PLAN, 'gain'); // all open
    const out = toggleMode(slots, 'dinner');
    expect(out.find((s) => s.key === 'dinner')!.mode).toBe('pinned');
    expect(toggleMode(out, 'dinner').find((s) => s.key === 'dinner')!.mode).toBe('open');
  });
});
