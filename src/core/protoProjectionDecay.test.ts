/**
 * THE LIVING NUMBER — honest decay in the SHIPPED proto engine
 * (docs/superpowers/specs/2026-07-15-living-number-hero-design.md).
 *
 * The Home hero shows "on pace for N". N must reflect reality: a meal the athlete has NOT
 * logged whose window has already closed can now only be logged LATE (half nutrition credit),
 * so the reachable projection honestly SLIPS as the day burns down. It must also stay
 * backward compatible — omit the clock (or collect no timestamps) and the projection is
 * byte-identical to before, so every existing surface and test is unaffected.
 *
 * day.js's pure functions are Node-importable (same pattern as scoreParity/protoStreakGrace).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { DAY, projectedDay, scoreFor, dayResetLocal, DEADLINE } = require('../../proto/redesign-2026-07/js/day.js');

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A fresh day with nothing logged: every meal slot is still open to be idealized. */
function emptyDay() {
  dayResetLocal();
  DAY.date = iso(0);
  DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
  DAY.slotMacros = {};
  DAY.mealLoggedAt = {};
  DAY.ciSubmitted = false;
  DAY.dailyCommitment = null;
}

describe('proto projectedDay — honest decay (clock-aware)', () => {
  it('late-stamps an unlogged meal whose window has already closed', () => {
    emptyDay();
    const p = projectedDay(10 * 60); // 10:00 — breakfast (deadline 9:30) has closed
    expect(p.mealLoggedAt.breakfast).toBe(10 * 60);
    // dinner's window (deadline 20:30) is still open, so it is NOT stamped late
    expect(p.mealLoggedAt.dinner).toBeUndefined();
  });

  it('reachable score DROPS once meal windows have closed vs early morning', () => {
    emptyDay();
    const early = scoreFor(projectedDay(6 * 60));   // everything still on time
    const late = scoreFor(projectedDay(22 * 60));   // every meal window closed
    expect(late).toBeLessThan(early);
  });

  it('is monotone: a later clock never RAISES the reachable score', () => {
    emptyDay();
    let prev = Infinity;
    for (const nowMin of [6 * 60, 10 * 60, 15 * 60, 18 * 60, 22 * 60]) {
      const s = scoreFor(projectedDay(nowMin));
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('omitting the clock is byte-identical to before (backward compatible)', () => {
    emptyDay();
    expect(JSON.stringify(projectedDay())).toBe(JSON.stringify(projectedDay(undefined)));
    // and the classic projection never late-stamps
    expect(projectedDay().mealLoggedAt.breakfast).toBeUndefined();
  });

  it('never re-stamps a meal the athlete already logged (real punctuality is authoritative)', () => {
    emptyDay();
    DAY.meals.breakfast = true;
    DAY.slotMacros.breakfast = { protein: 40, live: true };
    DAY.mealLoggedAt.breakfast = DEADLINE.breakfast - 30; // logged on time
    const p = projectedDay(22 * 60); // very late clock
    expect(p.mealLoggedAt.breakfast).toBe(DEADLINE.breakfast - 30); // untouched
  });
});
