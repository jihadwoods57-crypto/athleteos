// Locks the food-lookup client's FAIL-SOFT contract: with no backend configured (the test env has
// no EXPO_PUBLIC_SUPABASE_* vars) every call degrades quietly — [] for a name search, null for a
// barcode / best-match — and NEVER fires a live request. A regression that hard-requires the
// network, or throws instead of degrading, fails CI here.
jest.mock('@/lib/supabase/client', () => ({ supabase: null }));

import { isFoodLookupConfigured, searchFood, searchFoods, lookupBarcode } from './index';

describe('food-lookup client (fail-soft, unconfigured)', () => {
  it('is not configured without EXPO_PUBLIC_SUPABASE_* env', () => {
    expect(isFoodLookupConfigured).toBe(false);
  });

  it('searchFoods returns [] when unconfigured (no live call)', async () => {
    await expect(searchFoods('chicken breast')).resolves.toEqual([]);
  });

  it('searchFoods returns [] for a blank query', async () => {
    await expect(searchFoods('   ')).resolves.toEqual([]);
  });

  it('searchFood (best match) resolves null when unconfigured', async () => {
    await expect(searchFood('chicken breast')).resolves.toBeNull();
  });

  it('lookupBarcode resolves null when unconfigured or blank', async () => {
    await expect(lookupBarcode('012345678905')).resolves.toBeNull();
    await expect(lookupBarcode('')).resolves.toBeNull();
  });
});
