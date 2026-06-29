// AthleteOS — F1 regression: the meal-photo AI path must honor the consent gate.
// Sending a meal photo (or its description) to the AI endpoint is real athlete data
// leaving the device to a third party (Anthropic), so capture() must clear the SAME
// fail-closed gate as pushDay/recordMeal: an un-consented athlete, an unverified minor,
// or an athlete who paused sharing must NEVER trigger the remote analysis. The AI seam
// is mocked so isAiConfigured is true (the egress switch on) while we vary consent.
import type { Store } from './useStore';
import type { StoreApi, UseBoundStore } from 'zustand';

const analyzeMeal = jest.fn();

function loadStore(): UseBoundStore<StoreApi<Store>> {
  let store!: UseBoundStore<StoreApi<Store>>;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () =>
      require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
    );
    jest.doMock('@/lib/ai', () => ({
      isAiConfigured: true, // egress endpoint configured — the condition F1 is about
      analyzeMeal,
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
