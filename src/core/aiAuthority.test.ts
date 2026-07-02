import { arbitrate, type SafetyBound } from './aiAuthority';

describe('arbitrate — the coach always wins over the AI', () => {
  it('keeps the coach plan value when the AI disagrees, and flags the conflict', () => {
    const d = arbitrate('protein_target', 180, 200, null);
    expect(d.effectiveValue).toBe(180); // plan, NOT the AI's 200
    expect(d.source).toBe('coach_plan');
    expect(d.aiSuggested).toBe(200);
    expect(d.conflict).toBe(true);
  });

  it('never lets the AI value become effective even when the AI is "more aggressive"', () => {
    for (const ai of [0, 999, -50, 250]) {
      expect(arbitrate('calories', 2200, ai, null).effectiveValue).toBe(2200);
    }
  });

  it('records no conflict when the AI agrees with the plan', () => {
    const d = arbitrate('protein_target', 180, 180, null);
    expect(d.conflict).toBe(false);
    expect(d.effectiveValue).toBe(180);
  });

  it('records aiSuggested as null when the AI proposed nothing', () => {
    const d = arbitrate('protein_target', 180, null, null);
    expect(d.aiSuggested).toBeNull();
    expect(d.conflict).toBe(false);
  });
});

describe('arbitrate — the safety floor outranks even the coach', () => {
  const minorFloor: SafetyBound = { min: 1800, reason: 'minor minimum calories' };

  it('clamps a coach plan value that dips below the floor', () => {
    const d = arbitrate('calories', 1500, 1400, minorFloor);
    expect(d.effectiveValue).toBe(1800); // the floor, above BOTH the coach and the AI
    expect(d.source).toBe('safety_floor');
    expect(d.conflict).toBe(true);
  });

  it('clamps above a max bound', () => {
    const d = arbitrate('deficit', 900, 1000, { max: 750, reason: 'safe deficit ceiling' });
    expect(d.effectiveValue).toBe(750);
    expect(d.source).toBe('safety_floor');
  });

  it('leaves a compliant coach value untouched', () => {
    const d = arbitrate('calories', 2400, 2600, minorFloor);
    expect(d.effectiveValue).toBe(2400);
    expect(d.source).toBe('coach_plan');
  });
});

describe('arbitrate — engine default when the coach has not set a value', () => {
  it('uses the engine (null plan) and records the AI as a suggestion only', () => {
    const d = arbitrate('protein_target', null, 190, null);
    expect(d.source).toBe('engine');
    expect(d.effectiveValue).toBeNull();
    expect(d.aiSuggested).toBe(190);
    expect(d.conflict).toBe(true);
  });
});
