/**
 * The scoring engine's plan-style axis (proto day.js), driven through the REAL engine — the same
 * computeComponents/scoreFor that grades a live day, never a second formula.
 *
 * The invariant this file exists to protect: a day with NO style stamp scores exactly as it did
 * before plan styles shipped. scoreParity.test.ts proves that for the shipped fixtures; this
 * proves it for the style axis specifically, and then proves the three styles genuinely differ.
 */
// @ts-ignore — proto is plain ESM JS (allowJs)
import {
  computeComponents, scoreFor, weightsForDay, styleOf, knobsOf, setDayPlanStyle,
  PROFILE_WEIGHTS, MEAL_KEYS,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/day.js';
import { knobsFor } from './planStyle';

/** A fully-executed day: every classic slot logged on time with a real plate.
 *  quality is 100 deliberately — on Guided (which scores plate quality) an 80 would make the
 *  "perfect day" fixture imperfect, and would confound the calorie-curve comparisons below. */
function fullDay(over: any = {}) {
  const slotMacros: any = {};
  const mealLoggedAt: any = {};
  const meals: any = {};
  for (const k of MEAL_KEYS as string[]) {
    meals[k] = true;
    mealLoggedAt[k] = 0;                       // always on time
    slotMacros[k] = { protein: 45, kcal: 800, carbs: 80, fat: 25, quality: 100 };
  }
  return {
    date: '2026-07-23',
    meals, mealLoggedAt, slotMacros,
    quickAdded: [false, false, false],
    hydrationL: 3,
    dailyCommitment: 'yes',
    ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, soreness: 2, motivation: 8 },
    ciConfig: { energy: true, recovery: true, sleep: true, confidence: true, soreness: false, motivation: false },
    ciSubmitted: true,
    ciLast: null,
    proteinTarget: 180,
    calTarget: 3200,
    scoringProfile: 'athlete',
    planStyle: null,
    planKnobs: null,
    signals: {},
    currentWeight: null,
    scoreHistory: [],
    ...over,
  };
}

const styled = (style: string, over: any = {}) =>
  fullDay({ planStyle: style, planKnobs: knobsFor(style, null), ...over });

afterEach(() => setDayPlanStyle(null, null));   // never leak runtime style between tests

describe('an unstamped day is the shipped classic scoring, untouched', () => {
  test('no style stamp => the legacy per-profile formula', () => {
    const d = fullDay();
    // athlete: protein 65 + meals 35, both maxed => nutrition 100
    expect(computeComponents(d).nutrition).toBe(100);
    expect(styleOf(d)).toBe('structured');       // the default IS the classic path
  });

  test('a partial classic day matches the hand-computed shipped formula', () => {
    const d = fullDay({
      meals: { breakfast: true, lunch: false, snack: false, dinner: false },
      slotMacros: { breakfast: { protein: 45, kcal: 800 } },
      mealLoggedAt: { breakfast: 0 },
    });
    // proteinFrac = 45/180 = .25 -> 16.25 ; mealsFrac = 1/4 = .25 -> 8.75 ; round(25) = 25
    expect(computeComponents(d).nutrition).toBe(25);
  });

  test('the general and gain profiles are equally untouched', () => {
    for (const scoringProfile of ['general', 'gain']) {
      const d = fullDay({ scoringProfile });
      const withStamp = fullDay({ scoringProfile, planStyle: 'structured', planKnobs: knobsFor('structured', null) });
      expect(computeComponents(withStamp).nutrition).toBe(computeComponents(d).nutrition);
    }
  });

  test('an explicit Structured stamp scores identically to no stamp at all', () => {
    // This is the grandfathering guarantee: naming the style changes nothing.
    for (const scoringProfile of ['athlete', 'general', 'gain']) {
      for (const hydrationL of [0, 3]) {
        const bare = fullDay({ scoringProfile, hydrationL });
        const stamped = styled('structured', { scoringProfile, hydrationL });
        expect(scoreFor(stamped)).toBe(scoreFor(bare));
      }
    }
  });

  test('...including on a day with NO hydration, which Structured would otherwise score', () => {
    // The trap this guards: adding hydration to Structured's composition would silently drop
    // every existing athlete's score on release day.
    const dry = fullDay({ hydrationL: 0 });
    expect(computeComponents(dry).nutrition).toBe(100);
  });
});

describe('headline weights per style x profile', () => {
  test('a structured/unstamped day weighs exactly PROFILE_WEIGHTS', () => {
    for (const scoringProfile of ['athlete', 'general', 'gain']) {
      expect(weightsForDay(fullDay({ scoringProfile }))).toEqual((PROFILE_WEIGHTS as any)[scoringProfile]);
      expect(weightsForDay(styled('structured', { scoringProfile }))).toEqual((PROFILE_WEIGHTS as any)[scoringProfile]);
    }
  });

  test('Guided and Intuitive shift weight toward recovery where the caps allow', () => {
    expect(weightsForDay(styled('guided', { scoringProfile: 'general' })).recovery)
      .toBeGreaterThan((PROFILE_WEIGHTS as any).general.recovery);
    expect(weightsForDay(styled('intuitive', { scoringProfile: 'general' })).recovery)
      .toBeGreaterThan((PROFILE_WEIGHTS as any).general.recovery);
  });

  test('every resolved mix still sums to 1', () => {
    for (const style of ['structured', 'guided', 'intuitive']) {
      for (const scoringProfile of ['athlete', 'general', 'gain']) {
        const w = weightsForDay(styled(style, { scoringProfile }));
        expect(w.nutrition + w.recovery + w.commitment + w.checkin).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('Guided — ranges are genuinely more forgiving than exact targets', () => {
  test('a day 12% under the calorie target still earns full calorie credit on Guided', () => {
    const kcal = 3200 * 0.88;                       // inside Guided's +/-12% band, outside Structured's +/-10%
    const per = { protein: 45, kcal: kcal / 4, quality: 100 };
    const macros: any = {};
    for (const k of MEAL_KEYS as string[]) macros[k] = { ...per };

    const guided = styled('guided', { scoringProfile: 'general', slotMacros: macros });
    const structured = styled('structured', { scoringProfile: 'general', slotMacros: macros });
    expect(computeComponents(guided).nutrition).toBeGreaterThan(computeComponents(structured).nutrition);
  });

  test('plate quality is scored on Guided and ignored on Structured', () => {
    const lowQ: any = {}; const highQ: any = {};
    for (const k of MEAL_KEYS as string[]) {
      lowQ[k] = { protein: 45, kcal: 800, quality: 10 };
      highQ[k] = { protein: 45, kcal: 800, quality: 95 };
    }
    const gLow = computeComponents(styled('guided', { slotMacros: lowQ })).nutrition;
    const gHigh = computeComponents(styled('guided', { slotMacros: highQ })).nutrition;
    expect(gHigh).toBeGreaterThan(gLow);

    const sLow = computeComponents(styled('structured', { slotMacros: lowQ })).nutrition;
    const sHigh = computeComponents(styled('structured', { slotMacros: highQ })).nutrition;
    expect(sHigh).toBe(sLow);                       // Structured never reads quality
  });

  test('a missing quality read never costs the athlete', () => {
    const noQ: any = {};
    for (const k of MEAL_KEYS as string[]) noQ[k] = { protein: 45, kcal: 800 };   // no `quality`
    expect(computeComponents(styled('guided', { slotMacros: noQ })).nutrition).toBe(100);
  });
});

describe('Intuitive — awareness and adequate fueling, never restriction', () => {
  const allSignals = {
    breakfast: { hunger: 3, fullness: 4, satisfaction: 4 },
  };
  const withCi = { ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, soreness: 2, motivation: 8, digestion: 7, cravings: 3 } };

  test('eating well OVER target is never penalized', () => {
    const huge: any = {}; const atTarget: any = {};
    for (const k of MEAL_KEYS as string[]) {
      huge[k] = { protein: 45, kcal: 1600 };        // ~2x the target
      atTarget[k] = { protein: 45, kcal: 800 };
    }
    const over = computeComponents(styled('intuitive', { slotMacros: huge, signals: allSignals, ...withCi })).nutrition;
    const at = computeComponents(styled('intuitive', { slotMacros: atTarget, signals: allSignals, ...withCi })).nutrition;
    expect(over).toBe(at);
  });

  test('...but a genuine under-fueling day does lose credit', () => {
    const tiny: any = {};
    for (const k of MEAL_KEYS as string[]) tiny[k] = { protein: 10, kcal: 250 };  // ~31% of target
    const under = computeComponents(styled('intuitive', { slotMacros: tiny, signals: allSignals, ...withCi })).nutrition;
    const at = computeComponents(styled('intuitive', { signals: allSignals, ...withCi })).nutrition;
    expect(under).toBeLessThan(at);
  });

  test('protein is not scored at all on Intuitive', () => {
    const lowP: any = {}; const highP: any = {};
    for (const k of MEAL_KEYS as string[]) {
      lowP[k] = { protein: 2, kcal: 800 };
      highP[k] = { protein: 80, kcal: 800 };
    }
    const a = computeComponents(styled('intuitive', { slotMacros: lowP, signals: allSignals, ...withCi })).nutrition;
    const b = computeComponents(styled('intuitive', { slotMacros: highP, signals: allSignals, ...withCi })).nutrition;
    expect(a).toBe(b);
  });

  test('meal TIMING is not scored on Intuitive', () => {
    const late: any = {};
    for (const k of MEAL_KEYS as string[]) late[k] = 1439;   // every meal logged at 11:59pm
    const onTime = computeComponents(styled('intuitive', { signals: allSignals, ...withCi })).nutrition;
    const veryLate = computeComponents(styled('intuitive', { mealLoggedAt: late, signals: allSignals, ...withCi })).nutrition;
    expect(veryLate).toBe(onTime);
  });

  test('answering signals raises the score; the VALUE answered never changes it', () => {
    const none = computeComponents(styled('intuitive', { signals: {}, ...withCi })).nutrition;
    const answered = computeComponents(styled('intuitive', { signals: allSignals, ...withCi })).nutrition;
    expect(answered).toBeGreaterThan(none);

    const lowValues = { breakfast: { hunger: 1, fullness: 1, satisfaction: 1 } };
    const highValues = { breakfast: { hunger: 5, fullness: 5, satisfaction: 5 } };
    expect(computeComponents(styled('intuitive', { signals: lowValues, ...withCi })).nutrition)
      .toBe(computeComponents(styled('intuitive', { signals: highValues, ...withCi })).nutrition);
  });

  test('a consistent week keeps a single skipped signal day from cratering awareness', () => {
    const skipped = computeComponents(styled('intuitive', { signals: {}, ci: {}, signalWeekRate: 1 })).nutrition;
    const cold = computeComponents(styled('intuitive', { signals: {}, ci: {}, signalWeekRate: 0 })).nutrition;
    expect(skipped).toBeGreaterThan(cold);
  });

  test('hydration carries real weight on Intuitive', () => {
    const dry = computeComponents(styled('intuitive', { hydrationL: 0, signals: allSignals, ...withCi })).nutrition;
    const hydrated = computeComponents(styled('intuitive', { hydrationL: 3, signals: allSignals, ...withCi })).nutrition;
    expect(hydrated).toBeGreaterThan(dry);
  });
});

describe('the per-day stamp — a style change never rewrites history', () => {
  test('a stamped day is graded by ITS style, not the runtime style', () => {
    setDayPlanStyle('intuitive', knobsFor('intuitive', null));
    // A day from back when the athlete was Structured still grades Structured.
    const past = fullDay({ planStyle: 'structured', planKnobs: knobsFor('structured', null), hydrationL: 0 });
    expect(computeComponents(past).nutrition).toBe(100);   // the classic formula, hydration ignored
    expect(styleOf(past)).toBe('structured');
  });

  test('an unstamped day follows the live runtime style', () => {
    setDayPlanStyle('intuitive', knobsFor('intuitive', null));
    expect(styleOf(fullDay())).toBe('intuitive');
    setDayPlanStyle(null, null);
    expect(styleOf(fullDay())).toBe('structured');
  });

  test('a junk stamp degrades to the shipped default rather than scoring nothing', () => {
    const d = fullDay({ planStyle: 'keto' });
    expect(styleOf(d)).toBe('structured');
    expect(computeComponents(d).nutrition).toBe(100);
  });
});

describe('professional customization reaches the engine', () => {
  test('customizing Structured opts into the composition path', () => {
    const custom = knobsFor('structured', { nutrition: { hydrationScored: true } });
    expect(custom.nutrition.formula).toBe('parts');
    // ...so hydration now matters for this client, where default Structured ignored it.
    const dry = fullDay({ planStyle: 'structured', planKnobs: custom, hydrationL: 0 });
    const wet = fullDay({ planStyle: 'structured', planKnobs: custom, hydrationL: 3 });
    expect(computeComponents(wet).nutrition).toBeGreaterThan(computeComponents(dry).nutrition);
  });

  test('a tighter pro band on Guided is genuinely stricter', () => {
    const macros: any = {};
    for (const k of MEAL_KEYS as string[]) macros[k] = { protein: 45, kcal: (3200 * 0.9) / 4, quality: 80 };
    const wide = fullDay({ scoringProfile: 'general', planStyle: 'guided', planKnobs: knobsFor('guided', null), slotMacros: macros });
    const tight = fullDay({
      scoringProfile: 'general', planStyle: 'guided',
      planKnobs: knobsFor('guided', { nutrition: { calorieBand: 0.03 } }), slotMacros: macros,
    });
    expect(computeComponents(tight).nutrition).toBeLessThan(computeComponents(wide).nutrition);
  });

  test('knobsOf falls back to the style preset when a day carries no explicit knobs', () => {
    expect(knobsOf(fullDay({ planStyle: 'guided' })).nutrition.calorie).toBe('range');
    expect(knobsOf(fullDay()).nutrition.formula).toBe('legacy');
  });
});

describe('the new check-in signals never move an existing athlete', () => {
  const classicCfg = { energy: true, recovery: true, sleep: true, confidence: true, soreness: false, motivation: false };

  test('digestion and cravings are ignored while their ciConfig gate is off', () => {
    const without = fullDay({ ciConfig: classicCfg, ci: { energy: 8, recovery: 6, sleep: 8, confidence: 8 } });
    const withValues = fullDay({
      ciConfig: classicCfg,                                   // gate OFF...
      ci: { energy: 8, recovery: 6, sleep: 8, confidence: 8, digestion: 1, cravings: 10 }, // ...values present
    });
    expect(computeComponents(withValues).recovery).toBe(computeComponents(without).recovery);
  });

  test('turning them on brings them into the recovery average', () => {
    const on = { ...classicCfg, digestion: true, cravings: true };
    const good = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 6, sleep: 8, confidence: 8, digestion: 10, cravings: 0 } });
    const rough = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 6, sleep: 8, confidence: 8, digestion: 1, cravings: 10 } });
    expect(computeComponents(good).recovery).toBeGreaterThan(computeComponents(rough).recovery);
  });

  test('cravings scores in the RIGHT direction — high cravings is the negative pole', () => {
    const on = { ...classicCfg, cravings: true };
    const noCravings = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, cravings: 0 } });
    const constant = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, cravings: 10 } });
    expect(computeComponents(noCravings).recovery).toBeGreaterThan(computeComponents(constant).recovery);
  });

  test('soreness still inverts exactly as it always did', () => {
    const on = { ...classicCfg, soreness: true };
    const fresh = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, soreness: 0 } });
    const beatUp = fullDay({ ciConfig: on, ci: { energy: 8, recovery: 8, sleep: 8, confidence: 8, soreness: 10 } });
    expect(computeComponents(fresh).recovery).toBeGreaterThan(computeComponents(beatUp).recovery);
  });
});

describe('every style still produces one comparable 0..100', () => {
  test('a fully-executed day tops out at 100 in all three styles', () => {
    const signals = { breakfast: { hunger: 3, fullness: 4, satisfaction: 4 } };
    const ci = { energy: 10, recovery: 10, sleep: 10, confidence: 10, soreness: 0, motivation: 10, digestion: 9, cravings: 1 };
    for (const style of ['structured', 'guided', 'intuitive']) {
      const s = scoreFor(styled(style, { signals, ci, signalWeekRate: 1 }));
      expect({ style, ok: s === 100 }).toEqual({ style, ok: true });
    }
  });

  test('an empty day floors at 0 in all three styles', () => {
    for (const style of ['structured', 'guided', 'intuitive']) {
      const empty = styled(style, {
        meals: {}, slotMacros: {}, mealLoggedAt: {}, hydrationL: 0,
        dailyCommitment: null, ciSubmitted: false, ci: {}, signals: {}, signalWeekRate: 0,
      });
      expect({ style, score: scoreFor(empty) }).toEqual({ style, score: 0 });
    }
  });
});
