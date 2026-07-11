/**
 * ONBOARDING WEIGHT-DIRECTION VALIDATION (cycle 6 walkthrough finding): a target weight that
 * contradicts the chosen goal (Lose fat with a target at/above current, or Gain with one
 * at/below) must be detectable so onboarding can warn instead of silently feeding a
 * nonsensical plan. Locks the pure predicate the step-5 hint consumes.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { weightDirection, weightContradictsGoal } = require('../../proto/redesign-2026-07/js/ob-helpers.js');

describe('weightDirection', () => {
  test('lose → down, gain/build → up, maintain/perform/unknown → null', () => {
    expect(weightDirection('lose')).toBe('down');
    expect(weightDirection('gain')).toBe('up');
    expect(weightDirection('build')).toBe('up');
    expect(weightDirection('maintain')).toBeNull();
    expect(weightDirection('perform')).toBeNull();
    expect(weightDirection(undefined)).toBeNull();
  });
});

describe('weightContradictsGoal', () => {
  test('Lose fat with a target ABOVE current is a contradiction', () => {
    expect(weightContradictsGoal('lose', 178, 190)).toBe(true);
    expect(weightContradictsGoal('lose', 178, 178)).toBe(true); // equal is not a loss
    expect(weightContradictsGoal('lose', 178, 168)).toBe(false); // correct direction
  });

  test('Gain with a target BELOW current is a contradiction', () => {
    expect(weightContradictsGoal('gain', 160, 150)).toBe(true);
    expect(weightContradictsGoal('gain', 160, 160)).toBe(true);
    expect(weightContradictsGoal('gain', 160, 175)).toBe(false);
    expect(weightContradictsGoal('build', 160, 150)).toBe(true);
  });

  test('no strong direction (maintain/perform) never contradicts', () => {
    expect(weightContradictsGoal('maintain', 180, 200)).toBe(false);
    expect(weightContradictsGoal('perform', 180, 150)).toBe(false);
  });

  test('incomplete or invalid input never fires (validation is opt-in, not nagging)', () => {
    expect(weightContradictsGoal('lose', 178, NaN)).toBe(false);
    expect(weightContradictsGoal('lose', null, 190)).toBe(false);
    expect(weightContradictsGoal('lose', 0, 190)).toBe(false);
    expect(weightContradictsGoal('lose', 178, 0)).toBe(false);
    expect(weightContradictsGoal(undefined, 178, 190)).toBe(false);
  });
});
