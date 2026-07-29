/**
 * FOUNDING 50 price lock (supabase/functions/_shared/founding.ts).
 *
 * The landing page promises the first 50 coaches lock today's price permanently, including the
 * $10/mo overage, and that a later price rise never touches them. These tests are that promise
 * written as assertions — particularly the two parts a hand-managed lock forgets: the overage,
 * and what happens years later when prices have moved twice.
 */
import {
  FOUNDING_CAP, generationalLookupKey, normalizeGeneration, generationFor,
  extraSeatCentsFor, slotsRemaining, type FoundingLock,
} from '../../supabase/functions/_shared/founding';

const founder = (over: Partial<FoundingLock> = {}): FoundingLock =>
  ({ lockedGeneration: '', lockedExtraSeatCents: 1000, ...over });

describe('the cap is fifty', () => {
  test('FOUNDING_CAP matches the promise', () => expect(FOUNDING_CAP).toBe(50));
  test('slots run out and never go negative', () => {
    expect(slotsRemaining(0)).toBe(50);
    expect(slotsRemaining(49)).toBe(1);
    expect(slotsRemaining(50)).toBe(0);
    expect(slotsRemaining(51)).toBe(0);
  });
  test('junk counts are treated as none claimed', () => {
    expect(slotsRemaining(NaN)).toBe(50);
    expect(slotsRemaining(-5)).toBe(50);
  });
});

describe('lookup keys stay backward compatible', () => {
  test('the launch generation is unsuffixed, so every Price that exists today still resolves', () => {
    expect(generationalLookupKey('pro_solo', 'monthly', '')).toBe('pro_solo_monthly');
    expect(generationalLookupKey('professional', 'annual', '')).toBe('professional_annual');
  });

  test('a later generation is suffixed', () => {
    expect(generationalLookupKey('pro_solo', 'monthly', 'v2')).toBe('pro_solo_monthly_v2');
  });

  test('a malformed generation degrades to the base key instead of inventing a dead one', () => {
    // Interpolating junk would produce a lookup_key matching no Stripe Price, and checkout would
    // fail for a real buyer. Falling back to the base key keeps them purchasable.
    for (const bad of ['v 2', 'v2;drop', 'a'.repeat(20), '../x', null, undefined]) {
      expect(generationalLookupKey('pro_solo', 'monthly', bad as never)).toBe('pro_solo_monthly');
    }
  });

  test('normalizeGeneration lowercases and trims', () => {
    expect(normalizeGeneration(' V2 ')).toBe('v2');
    expect(normalizeGeneration('')).toBe('');
  });
});

describe('a price rise never touches a founding member', () => {
  test('a founder stays on their locked generation while everyone else moves', () => {
    expect(generationFor(founder(), 'v2')).toBe('');
    expect(generationFor(null, 'v2')).toBe('v2');
  });

  test('still true after prices have moved twice', () => {
    expect(generationFor(founder(), 'v3')).toBe('');
  });

  test('a member who joined ON a later generation keeps THAT one, not the base', () => {
    expect(generationFor(founder({ lockedGeneration: 'v2' }), 'v3')).toBe('v2');
  });

  test('before any rise, founders and everyone else resolve identically', () => {
    expect(generationFor(founder(), '')).toBe(generationFor(null, ''));
  });

  test('end to end: the founder buys Solo at the launch price after two rises', () => {
    const gen = generationFor(founder(), 'v3');
    expect(generationalLookupKey('pro_solo', 'monthly', gen)).toBe('pro_solo_monthly');
  });
});

describe('the overage is locked too — the clause a manual lock forgets', () => {
  test('a founder keeps $10/seat when the list price moves to $15', () => {
    expect(extraSeatCentsFor(founder({ lockedExtraSeatCents: 1000 }), 1500)).toBe(1000);
  });

  test('a non-founder pays the current overage', () => {
    expect(extraSeatCentsFor(null, 1500)).toBe(1500);
  });

  test('a corrupt locked value falls back to current rather than billing zero', () => {
    expect(extraSeatCentsFor(founder({ lockedExtraSeatCents: NaN }), 1500)).toBe(1500);
    expect(extraSeatCentsFor(founder({ lockedExtraSeatCents: -1 }), 1500)).toBe(1500);
  });

  test('a locked zero is honored — free overage is a real thing to promise', () => {
    expect(extraSeatCentsFor(founder({ lockedExtraSeatCents: 0 }), 1500)).toBe(0);
  });
});
