// OnStandard — daily plan-commitment scoring tests.
// Locks the honesty invariant the council ruled: no <= partial <= yes, an honest
// "no" scores 0 (never a quarter-credit participation floor), unanswered = 0.
import { commitmentScore, type CommitmentAnswer } from './commitment';

describe('commitmentScore', () => {
  it('maps yes/partial/no to 100/60/0', () => {
    expect(commitmentScore('yes')).toBe(100);
    expect(commitmentScore('partial')).toBe(60);
    expect(commitmentScore('no')).toBe(0);
  });

  it('an unanswered commitment (null/undefined) scores 0', () => {
    expect(commitmentScore(null)).toBe(0);
    expect(commitmentScore(undefined)).toBe(0);
  });

  it('honesty invariant: no <= partial <= yes (honesty is never scored below a lie)', () => {
    const answers: CommitmentAnswer[] = ['no', 'partial', 'yes'];
    const scores = answers.map(commitmentScore);
    expect(scores[0]).toBeLessThanOrEqual(scores[1]);
    expect(scores[1]).toBeLessThanOrEqual(scores[2]);
  });

  it('an honest "no" is exactly 0, not a quarter-credit floor', () => {
    // A 0.25*base participation floor sneaking back through the commitment is the
    // banned "feel-good" credit (founder D-B). "no" must be a hard 0.
    expect(commitmentScore('no')).toBe(0);
  });
});
