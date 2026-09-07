// The day line is what tells the meal read WHERE IN THE DAY the plate sits. The founder logged
// breakfast and got "Zero on the board for protein until now" (2026-09-07) — the prompt had
// handed the model a 0 and told it not to say 0. These tests hold the fix: on the first meal the
// zero is not sent at all, and the line says an empty board is expected.
import { dayContextLine } from './day-context';

describe('dayContextLine', () => {
  it('never puts a zero total in front of the model on the first meal of the day', () => {
    const out = dayContextLine({ proteinSoFar: 0, proteinTarget: 180, mealsRemaining: 2, mealsLoggedSoFar: 0 });
    expect(out).toContain('FIRST meal the athlete has logged today');
    expect(out).toContain('2 more required meals to come');
    expect(out).toContain('daily protein target is 180g');
    expect(out).not.toMatch(/\b0g\b/);
    expect(out).not.toContain('so far');
    expect(out).toContain('never open on it');
  });

  it('states the position in the day once meals are on the board', () => {
    const out = dayContextLine({ proteinSoFar: 26, proteinTarget: 180, mealsRemaining: 2, mealsLoggedSoFar: 1 });
    expect(out).toContain('logged approximately 26g of a 180g daily protein target');
    expect(out).toContain('their second meal of the day');
    expect(out).toContain('with 2 more required meals to come after this one');
    expect(out).not.toContain('FIRST meal');
  });

  it('does not greet a logged-but-protein-free day as the first plate', () => {
    // A black coffee is a meal on the board with zero protein banked. Protein alone cannot tell
    // these two athletes apart; mealsLoggedSoFar can.
    const out = dayContextLine({ proteinSoFar: 0, proteinTarget: 180, mealsRemaining: 2, mealsLoggedSoFar: 1 });
    expect(out).not.toContain('FIRST meal');
    expect(out).toContain('logged approximately 0g');
    expect(out).toContain('their second meal of the day');
  });

  it('falls back to the protein total when an older client sends no meal count', () => {
    expect(dayContextLine({ proteinSoFar: 0, proteinTarget: 180, mealsRemaining: 2 })).toContain('FIRST meal');
    expect(dayContextLine({ proteinSoFar: 26, proteinTarget: 180, mealsRemaining: 2 })).toContain('logged approximately 26g');
    // No count means no ordinal invented.
    expect(dayContextLine({ proteinSoFar: 26, proteinTarget: 180, mealsRemaining: 2 })).not.toContain('meal of the day');
  });

  it('renders nothing when it knows nothing, so the prompt stays byte-identical', () => {
    expect(dayContextLine(null)).toBe('');
    expect(dayContextLine(undefined)).toBe('');
    expect(dayContextLine({})).toBe('');
    expect(dayContextLine({ proteinSoFar: 20 })).toBe('');
    expect(dayContextLine({ proteinTarget: 180 })).toBe('');
  });

  it('drops implausible numbers rather than passing them to the model', () => {
    expect(dayContextLine({ proteinSoFar: -5, proteinTarget: 180 })).toBe('');
    expect(dayContextLine({ proteinSoFar: 900, proteinTarget: 180 })).toBe('');
    expect(dayContextLine({ proteinSoFar: 20, proteinTarget: 0 })).toBe('');
    expect(dayContextLine({ proteinSoFar: 20, proteinTarget: 900 })).toBe('');
    expect(dayContextLine({ proteinSoFar: 20, proteinTarget: 'lots' })).toBe('');
  });

  it('omits the meals clause rather than guessing when the count is out of range', () => {
    const out = dayContextLine({ proteinSoFar: 26, proteinTarget: 180, mealsRemaining: 99, mealsLoggedSoFar: 99 });
    expect(out).toContain('logged approximately 26g');
    expect(out).not.toContain('99');
    expect(out).not.toContain('meal of the day');
  });

  it('says the required meals are in when this is the last one', () => {
    expect(dayContextLine({ proteinSoFar: 120, proteinTarget: 180, mealsRemaining: 0, mealsLoggedSoFar: 2 }))
      .toContain('after this meal their required meals are in');
    expect(dayContextLine({ proteinSoFar: 120, proteinTarget: 180, mealsRemaining: 1, mealsLoggedSoFar: 2 }))
      .toContain('with 1 more required meal to come after this one');
  });

  it('always carries the ban on writing the day out, in both shapes', () => {
    const first = dayContextLine({ proteinSoFar: 0, proteinTarget: 180, mealsRemaining: 2, mealsLoggedSoFar: 0 });
    const later = dayContextLine({ proteinSoFar: 26, proteinTarget: 180, mealsRemaining: 2, mealsLoggedSoFar: 1 });
    for (const out of [first, later]) {
      expect(out).toContain('do NOT write day totals, targets or arithmetic into the analysis');
      expect(out.startsWith(' Day context:')).toBe(true);
    }
  });
});
