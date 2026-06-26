import { isHealthAvailable, readRecoverySample } from './index';
import { blendRecovery } from '@/core';

// Locks the recovery-source seam INERT: a regression that ships live health
// ingestion (and silently moves the recovery sub-score) without the founder's
// device wiring fails CI here.
describe('health seam (inert)', () => {
  it('is not available by default', () => {
    expect(isHealthAvailable).toBe(false);
  });
  it('readRecoverySample resolves null (no health store read)', async () => {
    await expect(readRecoverySample()).resolves.toBeNull();
  });
  it('with the seam off, the recovery sub-score is unchanged', async () => {
    const sample = await readRecoverySample();
    expect(blendRecovery(86, sample)).toBe(86); // null sample -> self-report unchanged
  });
});
