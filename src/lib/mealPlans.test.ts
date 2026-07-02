import { isMealPlanSyncConfigured, saveMealPlan, assignPlan } from './mealPlans';

// In the test/offline env EXPO_PUBLIC_BACKEND_LIVE is unset, so the seam must be fully inert:
// every write returns early (null/false) and never touches the network.
describe('meal plans backend seam — inert when backend off', () => {
  it('reports not configured', () => {
    expect(isMealPlanSyncConfigured).toBe(false);
  });

  it('saveMealPlan resolves to null without a live backend', async () => {
    await expect(saveMealPlan({ name: 'Team plan', slots: [] })).resolves.toBeNull();
  });

  it('assignPlan resolves to false without a live backend', async () => {
    await expect(assignPlan('plan-1', ['a', 'b'])).resolves.toBe(false);
  });

  it('assignPlan resolves to false for an empty athlete list', async () => {
    await expect(assignPlan('plan-1', [])).resolves.toBe(false);
  });
});
