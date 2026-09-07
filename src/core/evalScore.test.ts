import { expectedMacros, scoreDetection, scoreMacroError, scoreVerifyTrigger, scoreDayLeak } from './evalScore';

describe('expectedMacros', () => {
  test('sums food-db macros times servings', () => {
    // chicken-breast per = protein35/kcal187/carbs0/fat4; 2 servings
    const m = expectedMacros([{ foodDbId: 'chicken-breast', servings: 2 }]);
    expect(m).toEqual({ protein: 70, kcal: 374, carbs: 0, fat: 8 });
  });
  test('unknown ids are skipped, not crashed', () => {
    expect(expectedMacros([{ foodDbId: 'nope', servings: 1 }])).toEqual({ protein: 0, kcal: 0, carbs: 0, fat: 0 });
  });
});

describe('scoreDetection', () => {
  test('precision/recall against expected foods', () => {
    const d = scoreDetection([{ name: 'grilled chicken' }, { name: 'white rice' }], [{ foodDbId: 'chicken-breast', servings: 1 }]);
    expect(d.recall).toBe(1);       // chicken found
    expect(d.expectedCount).toBe(1);
    expect(d.detectedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('scoreMacroError', () => {
  test('absolute + pct error per macro', () => {
    const e = scoreMacroError({ protein: 40, kcal: 600, carbs: 50, fat: 20 }, { protein: 50, kcal: 500, carbs: 50, fat: 20 });
    expect(e.protein.abs).toBe(10);
    expect(e.protein.pct).toBeCloseTo(0.2);
    expect(e.kcal.abs).toBe(100);
  });
});

describe('scoreVerifyTrigger', () => {
  test('accuracy trigger expected + fires', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'stew', kcal: 600, confidence: 'low' }], quality: 40 },
      { id: 'x', photo: 'x', caseType: 'known-failure', expectedFoods: [], expectVerify: 'accuracy' });
    expect(r).toEqual({ expected: 'accuracy', fired: 'accuracy', correct: true });
  });
  test('clear case expects none, stays quiet', () => {
    const r = scoreVerifyTrigger(
      { detected: [{ name: 'chicken', kcal: 500, confidence: 'high' }], quality: 85 },
      { id: 'y', photo: 'y', caseType: 'clear', expectedFoods: [], expectVerify: 'none' });
    expect(r.correct).toBe(true);
  });
});

/* The read must judge the plate the athlete is looking at, never narrate the day back at them —
   the app states the day itself in the very next sentence. These are held by the real prose that
   broke it (founder 2026-09-07), not by invented examples. */
describe('scoreDayLeak', () => {
  test("catches the founder's breakfast opener, both leaks in one read", () => {
    const r = scoreDayLeak({ analysis: "Zero on the board for protein until now, so this plate is a solid opening move but not enough on its own for a QB trying to build back toward 180g today." });
    expect(r.emptyDay).toBe(true);
    expect(r.dayTotal).toBe(true);
    expect(r.leaked).toBe(true);
  });

  test('catches the other ways a model says the board is empty', () => {
    expect(scoreDayLeak({ analysis: "Nothing logged yet, so this is the start." }).emptyDay).toBe(true);
    expect(scoreDayLeak({ analysis: "You are starting the day at zero and this helps." }).emptyDay).toBe(true);
    expect(scoreDayLeak({ analysis: "With 0g so far, this plate matters." }).emptyDay).toBe(true);
  });

  test('a number that IS the advice is not a leak', () => {
    // The prompt explicitly wants these. Flagging them would train everyone to ignore the metric.
    const r = scoreDayLeak({ analysis: "Add a second chicken thigh at lunch for another 25g of protein and this holds up through practice." });
    expect(r.leaked).toBe(false);
  });

  test('a clean verdict-and-move read passes', () => {
    const r = scoreDayLeak({ analysis: "Strong plate for a training morning, the eggs and sausage give you something to build on. Put a cup of Greek yogurt alongside it tomorrow and the same plate gets noticeably better. Fat runs a little high, so keep the bacon at two strips." });
    expect(r.leaked).toBe(false);
  });

  test('does not confuse a plate observation with a day observation', () => {
    // "no protein" about the FOOD is honest coaching; only the day framing is the leak.
    expect(scoreDayLeak({ analysis: "There is almost no protein on this plate." }).emptyDay).toBe(false);
    expect(scoreDayLeak({ analysis: "Zero vegetables here, which is the one thing to fix." }).emptyDay).toBe(false);
  });

  test('catches a running day tally in either word order', () => {
    expect(scoreDayLeak({ analysis: "That puts you at 120 of 180 on the day." }).dayTotal).toBe(true);
    expect(scoreDayLeak({ analysis: "Today you are sitting at 140g." }).dayTotal).toBe(true);
  });

  test('an empty analysis is not a leak', () => {
    expect(scoreDayLeak({}).leaked).toBe(false);
    expect(scoreDayLeak({ analysis: '' }).leaked).toBe(false);
  });
});
