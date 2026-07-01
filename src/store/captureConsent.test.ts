// OnStandard — F1 regression: the meal-photo AI path must honor the consent gate.
// Sending a meal photo (or its description) to the AI endpoint is real athlete data
// leaving the device to a third party (Anthropic), so capture() must clear the SAME
// fail-closed gate as pushDay/recordMeal: an un-consented athlete, an unverified minor,
// or an athlete who paused sharing must NEVER trigger the remote analysis. The AI seam
// is mocked so isAiConfigured is true (the egress switch on) while we vary consent.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const analyzeMeal = jest.fn();
const analyzeLabel = jest.fn();

function loadStore(): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/ai', () => ({
      isAiConfigured: true, // egress endpoint configured — the condition F1 is about
      analyzeMeal,
      analyzeLabel,
      AI_ENDPOINT: 'https://example.test/functions/v1/analyze-meal',
      aiCoachTag: '', aiCoachName: '', aiTeamSummaryTag: '', aiMemoryTag: '', aiPrefix: '',
    }));
    // Camera off → the remote branch still calls analyzeMeal (text egress), which is
    // exactly what the gate must also stop. Keeps the path deterministic.
    jest.doMock('@/lib/capture', () => ({ capturePhotoBase64: jest.fn().mockResolvedValue('PHOTOB64'), isCameraAvailable: false }));
    jest.doMock('@/lib/supabase', () => ({ isBackendLive: false, isSupabaseConfigured: false, auth: {}, db: {} }));
    store = require('./useStore').useStore;
  });
  return store;
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  analyzeMeal.mockReset().mockResolvedValue({ name: 'Meal', protein: 0, kcal: 0, carbs: 0, fat: 0, quality: 0, detected: [], note: '' });
  analyzeLabel.mockReset().mockResolvedValue({ productName: 'Bar', calories: 200, protein: 20, carbs: 20, fat: 7, ingredients: [] });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('does NOT send a minor athlete without consent to the AI endpoint (fail closed)', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 15, realDataConsent: false, guardianStatus: 'none', sharingPaused: false, mealType: 'Lunch', primaryGoal: null });
  useStore.getState().capture();
  await flush();
  expect(analyzeMeal).not.toHaveBeenCalled();
});

it('does NOT send while sharing is paused, even with consent', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 25, realDataConsent: true, sharingPaused: true, mealType: 'Lunch', primaryGoal: null });
  useStore.getState().capture();
  await flush();
  expect(analyzeMeal).not.toHaveBeenCalled();
});

it('does NOT send a minor with consent but an unverified guardian', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 16, realDataConsent: true, guardianStatus: 'pending', sharingPaused: false, mealType: 'Lunch', primaryGoal: null });
  useStore.getState().capture();
  await flush();
  expect(analyzeMeal).not.toHaveBeenCalled();
});

it('DOES send for a consenting adult athlete (gate passes)', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 25, realDataConsent: true, sharingPaused: false, mealType: 'Lunch', primaryGoal: null });
  useStore.getState().capture();
  await flush();
  expect(analyzeMeal).toHaveBeenCalledTimes(1);
});

it('captureLabel honors the same egress gate: minor without consent never sends', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 15, realDataConsent: false, sharingPaused: false });
  useStore.getState().captureLabel();
  await flush();
  expect(analyzeLabel).not.toHaveBeenCalled();
});

it('captureLabel DOES send the label for a consenting adult', async () => {
  const useStore = loadStore();
  useStore.setState({ role: 'athlete', baseAge: 25, realDataConsent: true, sharingPaused: false });
  useStore.getState().captureLabel();
  await flush();
  expect(analyzeLabel).toHaveBeenCalledTimes(1);
});

it('addMeal logs a real AI analysis as the slot foods so its macros drive the score', async () => {
  const useStore = loadStore();
  useStore.setState({
    mealType: 'Dinner',
    mealAnalysis: { name: 'Chicken & Rice', quality: 92, protein: 48, kcal: 700, carbs: 70, fat: 16, detected: ['Chicken'], note: '' },
  });
  useStore.getState().addMeal();
  expect(useStore.getState().meals.dinner).toBe(true);
  expect(useStore.getState().mealFoods.dinner?.[0]?.per.protein).toBe(48);
  expect(useStore.getState().mealAnalysis).toBeNull(); // cleared after logging
});

it('addMeal without an AI analysis does NOT touch mealFoods (demo path unchanged)', async () => {
  const useStore = loadStore();
  useStore.setState({ mealType: 'Lunch', mealAnalysis: null });
  useStore.getState().addMeal();
  expect(useStore.getState().meals.lunch).toBe(true);
  expect(useStore.getState().mealFoods.lunch).toBeUndefined();
});

it('addScannedLabel logs the scaled label macros into the meal slot', async () => {
  const useStore = loadStore();
  // 20g protein per serving × 2 servings = 40g logged into the Snack slot.
  useStore.setState({
    mealType: 'Snack',
    labelServings: 2,
    labelFacts: { productName: 'Bar', servingSize: '1 bar', calories: 200, protein: 20, carbs: 20, fat: 7, ingredients: [] },
  });
  useStore.getState().addScannedLabel();
  expect(useStore.getState().meals.snack).toBe(true);
  expect(useStore.getState().mealFoods.snack?.[0]?.per.protein).toBe(40);
  expect(useStore.getState().labelFacts).toBeNull(); // reset after logging
});
