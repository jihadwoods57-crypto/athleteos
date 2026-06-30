// AthleteOS — weight-progress tone. Proves a weight change is judged by GOAL, not direction, so a
// weight-loss client's loss never reads as an alert (the Role Review Board's shame-landmine fix).
import { weightProgressTone } from './weightProgress';

describe('weightProgressTone', () => {
  it('weight loss is GOOD for a lose goal, BAD for a gain goal', () => {
    expect(weightProgressTone(-4, 'lose')).toBe('good');
    expect(weightProgressTone(-4, 'gain')).toBe('bad');
  });

  it('weight gain is GOOD for a gain goal, BAD for a lose goal', () => {
    expect(weightProgressTone(6, 'gain')).toBe('good');
    expect(weightProgressTone(6, 'lose')).toBe('bad');
  });

  it('never moralizes weight movement for maintain or performance goals', () => {
    expect(weightProgressTone(6, 'maintain')).toBe('neutral');
    expect(weightProgressTone(-6, 'maintain')).toBe('neutral');
    expect(weightProgressTone(6, 'performance')).toBe('neutral');
    expect(weightProgressTone(-6, 'performance')).toBe('neutral');
  });

  it('treats a negligible change as neutral for every goal', () => {
    expect(weightProgressTone(0, 'lose')).toBe('neutral');
    expect(weightProgressTone(0.01, 'gain')).toBe('neutral');
  });
});
