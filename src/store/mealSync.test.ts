// OnStandard — meal-record sync consent gate + projection (Part A safety core).
// Proves recordMeal FAILS CLOSED exactly like pushDay: it inserts a meal only when
// the backend is live AND realDataConsent passes, uploads the photo to the right
// path, and projects edited macros over the estimate. The supabase lib is mocked so
// the node env drives the gate without a real client; `isBackendLive` is toggled per
// case via isolateModules.
import { createInitialState } from '@/core/defaultState';
import { mealMacros, mealResultFor, type AppState, type EditableFood } from '@/core';

const insertMeal = jest.fn<Promise<void>, [unknown]>();
const upload = jest.fn<Promise<{ error: unknown }>, [string, unknown, unknown]>();
const from = jest.fn(() => ({ upload }));

/** Load a fresh copy of mealSync.ts with `isBackendLive` forced to a given value. */
function loadMealSync(backendLive: boolean) {
  let mod!: typeof import('./mealSync');
  jest.isolateModules(() => {
    jest.doMock('@/lib/supabase', () => ({
      isBackendLive: backendLive,
      requireSupabase: () => ({ storage: { from } }),
      db: { insertMeal },
    }));
    mod = require('./mealSync');
  });
  return mod;
}

const adultConsenting = (): AppState => ({
  ...createInitialState(),
  role: 'athlete',
  baseAge: 22,
  realDataConsent: true,
});

beforeEach(() => {
  insertMeal.mockReset().mockResolvedValue(undefined);
  upload.mockReset().mockResolvedValue({ error: null });
  from.mockClear();
});

describe('recordMeal consent gate', () => {
  it('does NOT insert and reads backend-off when the flag is off', async () => {
    const { recordMeal } = loadMealSync(false);
    const res = await recordMeal(adultConsenting(), 'a-1', 'dinner', '2026-06-28');
    expect(res).toEqual({ recorded: false, reason: 'backend-off' });
    expect(insertMeal).not.toHaveBeenCalled();
  });

  it('inserts when backend live + adult with consent', async () => {
    const { recordMeal } = loadMealSync(true);
    const res = await recordMeal(adultConsenting(), 'a-1', 'dinner', '2026-06-28');
    expect(res).toEqual({ recorded: true, reason: 'ok' });
    expect(insertMeal).toHaveBeenCalledTimes(1);
    const row = insertMeal.mock.calls[0][0] as { athlete_id: string; day_date: string; type: string };
    expect(row.athlete_id).toBe('a-1');
    expect(row.day_date).toBe('2026-06-28');
    expect(row.type).toBe('dinner');
  });

  it('blocks a minor athlete without consent (fails closed)', async () => {
    const { recordMeal } = loadMealSync(true);
    const minor: AppState = { ...adultConsenting(), baseAge: 15, realDataConsent: false };
    const res = await recordMeal(minor, 'm-1', 'lunch');
    expect(res).toEqual({ recorded: false, reason: 'minor-consent-required' });
    expect(insertMeal).not.toHaveBeenCalled();
  });

  it('blocks an adult athlete without consent', async () => {
    const { recordMeal } = loadMealSync(true);
    const adult: AppState = { ...adultConsenting(), realDataConsent: false };
    const res = await recordMeal(adult, 'a-2', 'lunch');
    expect(res).toEqual({ recorded: false, reason: 'consent-required' });
    expect(insertMeal).not.toHaveBeenCalled();
  });

  it('reads no-user when there is no signed-in athlete id', async () => {
    const { recordMeal } = loadMealSync(true);
    const res = await recordMeal(adultConsenting(), null, 'dinner');
    expect(res).toEqual({ recorded: false, reason: 'no-user' });
    expect(insertMeal).not.toHaveBeenCalled();
  });
});

describe('photo upload', () => {
  it('uploads the captured photo to {athlete}/{date}/{key}.jpg and stores the path', async () => {
    const { recordMeal } = loadMealSync(true);
    const s: AppState = { ...adultConsenting(), mealPhoto: 'aGVsbG8=' }; // "hello"
    await recordMeal(s, 'a-1', 'dinner', '2026-06-28');
    expect(from).toHaveBeenCalledWith('meal-photos');
    expect(upload.mock.calls[0][0]).toBe('a-1/2026-06-28/dinner.jpg');
    const row = insertMeal.mock.calls[0][0] as { photo_path: string | null };
    expect(row.photo_path).toBe('a-1/2026-06-28/dinner.jpg');
  });

  it('still records the meal with a null path when there is no photo', async () => {
    const { recordMeal } = loadMealSync(true);
    await recordMeal(adultConsenting(), 'a-1', 'dinner', '2026-06-28');
    expect(upload).not.toHaveBeenCalled();
    const row = insertMeal.mock.calls[0][0] as { photo_path: string | null };
    expect(row.photo_path).toBeNull();
  });

  it('records the meal even when the photo upload fails (upload never blocks)', async () => {
    const { recordMeal } = loadMealSync(true);
    upload.mockResolvedValue({ error: new Error('storage down') });
    const s: AppState = { ...adultConsenting(), mealPhoto: 'aGVsbG8=' };
    const res = await recordMeal(s, 'a-1', 'dinner', '2026-06-28');
    expect(res.recorded).toBe(true);
    const row = insertMeal.mock.calls[0][0] as { photo_path: string | null };
    expect(row.photo_path).toBeNull();
  });
});

describe('mapMealToRow projection', () => {
  const plate = (protein: number): EditableFood[] => [
    { name: 'Chicken', portion: '8 oz', servings: 1, per: { protein, kcal: 400, carbs: 0, fat: 10 } },
  ];

  it('uses the deterministic estimate when the plate was not edited', () => {
    const { mapMealToRow } = loadMealSync(true);
    const row = mapMealToRow(adultConsenting(), 'a-1', 'dinner', null, '2026-06-28');
    const est = mealResultFor('Dinner');
    expect(row.protein).toBe(est.protein);
    expect(row.name).toBe(est.name);
    expect(row.detected).toEqual(est.detected);
  });

  it('uses the edited plate macros over the estimate when foods were corrected', () => {
    const { mapMealToRow } = loadMealSync(true);
    const s: AppState = { ...adultConsenting(), mealFoods: { dinner: plate(99) } };
    const row = mapMealToRow(s, 'a-1', 'dinner', null, '2026-06-28');
    expect(row.protein).toBe(mealMacros(plate(99)).protein);
  });

  it('persists the AI confidence + description signal when a real analysis is present', () => {
    const { mapMealToRow } = loadMealSync(true);
    const s: AppState = {
      ...adultConsenting(),
      mealAnalysis: { name: 'X', quality: 80, protein: 40, kcal: 500, carbs: 40, fat: 15, detected: ['Chicken'], note: 'n', confidence: 'medium', descriptionSignal: 'photo_heavier' },
    };
    const row = mapMealToRow(s, 'a-1', 'dinner', null, '2026-06-28');
    expect(row.macro_confidence).toBe('medium');
    expect(row.description_signal).toBe('photo_heavier');
  });

  it('writes null signals on the deterministic fallback (no analysis)', () => {
    const { mapMealToRow } = loadMealSync(true);
    const row = mapMealToRow(adultConsenting(), 'a-1', 'dinner', null, '2026-06-28');
    expect(row.macro_confidence).toBeNull();
    expect(row.description_signal).toBeNull();
    expect(row.favorited).toBe(false);
  });
});

describe('base64ToBytes', () => {
  it('decodes a known base64 string to its bytes', () => {
    const { base64ToBytes } = loadMealSync(true);
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]); // "hello"
  });
});
