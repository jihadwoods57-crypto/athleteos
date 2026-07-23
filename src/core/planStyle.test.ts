/**
 * Plan-style behavior: the permission model, the grandfather rule, and the three adherence
 * curves. The caps invariant lives in planStyleCaps.test.ts; proto parity in planStyleParity.test.ts.
 */
import {
  resolvePlanStyle, knobsFor, styleForStructureAnswer, rangeAdherence, fuelingAdequacy,
  awarenessScore, answeredSignals, styleLabel, DEFAULT_STYLE, LEGACY_STYLE,
} from './planStyle';

describe('onboarding answer -> recommended style', () => {
  test('each answer maps to its style; "not sure" recommends the default', () => {
    expect(styleForStructureAnswer('numbers')).toBe('structured');
    expect(styleForStructureAnswer('flexible')).toBe('guided');
    expect(styleForStructureAnswer('signals')).toBe('intuitive');
    expect(styleForStructureAnswer('unsure')).toBe(DEFAULT_STYLE);
    expect(styleForStructureAnswer(null)).toBe(DEFAULT_STYLE);
  });
});

describe('permission model — who decides', () => {
  test('an independent adult chooses their own style', () => {
    const r = resolvePlanStyle({ role: 'solo', selfChoice: 'intuitive' });
    expect(r).toMatchObject({ style: 'intuitive', source: 'self', locked: false, canChoose: true });
  });

  test('a trainer client runs on their preference provisionally until the trainer confirms', () => {
    const pending = resolvePlanStyle({ role: 'client', preference: 'intuitive' });
    expect(pending).toMatchObject({ style: 'intuitive', source: 'preference', locked: false });

    const confirmed = resolvePlanStyle({
      role: 'client', preference: 'intuitive',
      proAssignment: { style: 'guided', setBy: 'Sam' },
    });
    // The trainer adjusted it — their call stands, and the client's preference is still carried.
    expect(confirmed).toMatchObject({ style: 'guided', source: 'pro', locked: true, lockedBy: 'Sam' });
    expect(confirmed.preference).toBe('intuitive');
  });

  test('a team athlete cannot switch away from the team standard', () => {
    const r = resolvePlanStyle({
      role: 'athlete',
      teamStandard: { style: 'structured', setBy: 'Coach Reed' },
      proAssignment: { style: 'guided' },
      selfChoice: 'intuitive',   // the athlete tried
      preference: 'intuitive',
    });
    expect(r.style).toBe('structured');       // the standard wins over everything
    expect(r.locked).toBe(true);
    expect(r.canChoose).toBe(false);
    expect(r.lockedBy).toBe('Coach Reed');
  });

  test('a locked athlete is never a dead end — the preference always survives resolution', () => {
    const r = resolvePlanStyle({
      role: 'athlete', teamStandard: { style: 'structured' }, preference: 'intuitive',
    });
    // This is what the pro roster surfaces ("N athletes prefer more flexibility").
    expect(r.preference).toBe('intuitive');
    expect(r.style).toBe('structured');
  });

  test('a team athlete with no assignment at all is still locked, on the default', () => {
    const r = resolvePlanStyle({ role: 'athlete', preference: 'intuitive' });
    expect(r).toMatchObject({ style: DEFAULT_STYLE, source: 'default', locked: true, canChoose: false });
    expect(r.preference).toBe('intuitive');
  });

  test('a nutrition professional assigns and customizes', () => {
    const r = resolvePlanStyle({
      role: 'nutrition',
      proAssignment: { style: 'guided', styleOverrides: { nutrition: { calorieBand: 0.08 } }, setBy: 'RD' },
    });
    expect(r.style).toBe('guided');
    expect(r.canChoose).toBe(true);            // a pro may change their own assignment
    expect(r.knobs.nutrition.calorieBand).toBe(0.08);
    expect(r.knobs.customized).toBe(true);
  });
});

describe('precedence order', () => {
  test('team > pro > self > default', () => {
    const base = { role: 'solo' as const };
    expect(resolvePlanStyle({ ...base }).source).toBe('default');
    expect(resolvePlanStyle({ ...base, selfChoice: 'intuitive' }).source).toBe('self');
    expect(resolvePlanStyle({ ...base, selfChoice: 'intuitive', proAssignment: { style: 'guided' } }).source).toBe('pro');
    expect(resolvePlanStyle({
      ...base, selfChoice: 'intuitive', proAssignment: { style: 'guided' }, teamStandard: { style: 'structured' },
    }).source).toBe('team');
  });
});

describe('grandfathering', () => {
  test('an account with pre-release history keeps Structured, not the new default', () => {
    const r = resolvePlanStyle({ role: 'solo', hasHistory: true });
    expect(r.style).toBe(LEGACY_STYLE);
    expect(r.source).toBe('legacy');
  });

  test('a brand-new account gets the Guided default', () => {
    expect(resolvePlanStyle({ role: 'solo' }).style).toBe(DEFAULT_STYLE);
  });

  test('an explicit choice always beats the grandfather rule', () => {
    const r = resolvePlanStyle({ role: 'solo', hasHistory: true, selfChoice: 'intuitive' });
    expect(r).toMatchObject({ style: 'intuitive', source: 'self' });
  });
});

describe('rangeAdherence — Guided is genuinely more forgiving', () => {
  test('full credit anywhere inside the band', () => {
    expect(rangeAdherence(3000, 3000, 0.12)).toBe(1);
    expect(rangeAdherence(2700, 3000, 0.12)).toBe(1);   // -10%, inside +/-12%
    expect(rangeAdherence(3300, 3000, 0.12)).toBe(1);   // +10%
  });

  test('linear falloff to zero at 4x the band, both directions symmetrically', () => {
    expect(rangeAdherence(3000 * 1.48, 3000, 0.12)).toBe(0);
    expect(rangeAdherence(3000 * 0.52, 3000, 0.12)).toBe(0);
    const under = rangeAdherence(3000 * 0.7, 3000, 0.12);
    const over = rangeAdherence(3000 * 1.3, 3000, 0.12);
    expect(under).toBeCloseTo(over, 12);
    expect(under).toBeGreaterThan(0);
    expect(under).toBeLessThan(1);
  });

  test('a Guided range is wider than the Structured curve at the same deviation', () => {
    // 20% off target: Structured's calorieAdherence gives (0.4-0.2)/0.3 = 0.667.
    expect(rangeAdherence(3600, 3000, 0.12)).toBeGreaterThan(0.667);
  });

  test('no target, or a zero band, degrades honestly', () => {
    expect(rangeAdherence(3000, 0, 0.12)).toBe(0);
    expect(rangeAdherence(3000, 3000, 0)).toBe(1);       // exact hit still credits
    expect(rangeAdherence(2000, 3000, 0)).toBe(0);       // 33% off, past the 0.3 fallback outer
  });
});

describe('fuelingAdequacy — Intuitive never penalizes eating more', () => {
  test('full credit at or above 85% of target, and forever above it', () => {
    expect(fuelingAdequacy(2550, 3000)).toBe(1);
    expect(fuelingAdequacy(3000, 3000)).toBe(1);
    expect(fuelingAdequacy(9000, 3000)).toBe(1);   // the whole point: food is not a debt
  });

  test('genuine under-fueling loses credit, to zero at 45%', () => {
    expect(fuelingAdequacy(1350, 3000)).toBe(0);
    expect(fuelingAdequacy(0, 3000)).toBe(0);
    const mid = fuelingAdequacy(1950, 3000); // 65%
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  test('it is strictly more generous than the gain-profile floor it resembles', () => {
    // calorieFloorAdherence(2550, 3000) = (0.85-0.6)/0.4 = 0.625; adequacy gives full credit.
    expect(fuelingAdequacy(2550, 3000)).toBeGreaterThan(0.625);
  });
});

describe('awarenessScore — the act of noticing, never the value noticed', () => {
  const knobs = knobsFor('intuitive', null);
  const ALL = ['hunger', 'fullness', 'satisfaction', 'digestion', 'cravings'];

  test('a low answer scores exactly the same as a high one', () => {
    const low = answeredSignals({ signals: { breakfast: { hunger: 1, fullness: 1, satisfaction: 1 } } }, false);
    const high = answeredSignals({ signals: { breakfast: { hunger: 5, fullness: 5, satisfaction: 5 } } }, false);
    expect(awarenessScore(low, knobs)).toBe(awarenessScore(high, knobs));
  });

  test('answering everything is full credit', () => {
    expect(awarenessScore(ALL, knobs, 1)).toBe(1);
  });

  test('one skipped day barely moves a consistent week', () => {
    const skipped = awarenessScore([], knobs, 1);   // nothing today, perfect week behind it
    expect(skipped).toBeCloseTo(0.4, 12);           // 0.6*0 + 0.4*1 — a dent, not a failure
  });

  test('with no history, today stands in for the week', () => {
    expect(awarenessScore(['hunger', 'fullness', 'satisfaction', 'digestion', 'cravings'], knobs)).toBe(1);
    expect(awarenessScore([], knobs)).toBe(0);
  });

  test('a style that tracks nothing is never punished for it', () => {
    expect(awarenessScore([], knobsFor('structured', null))).toBe(1);
  });

  test('a hostile weekRate cannot push credit out of 0..1', () => {
    expect(awarenessScore(ALL, knobs, 99)).toBeLessThanOrEqual(1);
    expect(awarenessScore([], knobs, -99)).toBeGreaterThanOrEqual(0);
  });
});

describe('answeredSignals — reads both capture surfaces', () => {
  test('meal-prompt signals are collected across every logged slot', () => {
    const day = { signals: { breakfast: { hunger: 3 }, dinner: { fullness: 4, satisfaction: 2 } } };
    expect([...answeredSignals(day, false)].sort()).toEqual(['fullness', 'hunger', 'satisfaction']);
  });

  test('check-in signals only count when a check-in actually backs them', () => {
    const day = { ci: { digestion: 8, cravings: 3 }, signals: {} };
    expect([...answeredSignals(day, false)]).toEqual([]);
    expect([...answeredSignals(day, true)].sort()).toEqual(['cravings', 'digestion']);
  });

  test('a non-numeric or absent value is not an answer', () => {
    const day = { signals: { lunch: { hunger: null, fullness: undefined, satisfaction: NaN } } };
    expect([...answeredSignals(day, false)]).toEqual([]);
  });

  test('an empty day yields nothing and never throws', () => {
    expect([...answeredSignals({}, true)]).toEqual([]);
    expect([...answeredSignals(null, true)]).toEqual([]);
  });
});

describe('disclosure copy', () => {
  test('Intuitive never promises calorie or macro targets', () => {
    const how = styleLabel('intuitive').how.toLowerCase();
    expect(how).toContain('no calorie or macro targets');
    expect(how).toContain('never restriction');
  });

  test('every style has a name, a short line and a how', () => {
    for (const s of ['structured', 'guided', 'intuitive']) {
      const l = styleLabel(s);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.short.length).toBeGreaterThan(0);
      expect(l.how.length).toBeGreaterThan(0);
    }
  });
});
