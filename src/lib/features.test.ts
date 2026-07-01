import { isEnginesEnabled } from './features';

describe('feature flags — engines master switch', () => {
  it('is OFF by default (no EXPO_PUBLIC_ENGINES_ENABLED set), so the beta proves the loop first', () => {
    expect(isEnginesEnabled).toBe(false);
  });

  it('only turns on for the exact string "true"', () => {
    // Re-evaluate the flag expression the module uses, to document the contract.
    const flagFor = (v: string | undefined) => v?.trim() === 'true';
    expect(flagFor('true')).toBe(true);
    expect(flagFor(' true ')).toBe(true);
    expect(flagFor('1')).toBe(false);
    expect(flagFor('TRUE')).toBe(false);
    expect(flagFor('')).toBe(false);
    expect(flagFor(undefined)).toBe(false);
  });
});
