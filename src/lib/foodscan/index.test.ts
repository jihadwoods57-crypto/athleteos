import { isFoodScanAvailable, scanBarcode, lookupBarcode } from './index';

// Locks the barcode seam INERT: a regression that ships a live scanner / network
// lookup without the founder's data-source decision fails CI here.
describe('foodscan seam (inert)', () => {
  it('is not available by default', () => {
    expect(isFoodScanAvailable).toBe(false);
  });
  it('scanBarcode resolves undefined (no camera fired)', async () => {
    await expect(scanBarcode()).resolves.toBeUndefined();
  });
  it('lookupBarcode resolves undefined (no external call made)', async () => {
    await expect(lookupBarcode('012345678905')).resolves.toBeUndefined();
  });
});
