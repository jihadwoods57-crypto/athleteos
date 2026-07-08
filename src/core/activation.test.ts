import { activationStatus, parseRosterTarget, TINY_ROSTER } from './activation';

describe('activationStatus', () => {
  it('with no target, prompts only while the roster is tiny', () => {
    expect(activationStatus(0, null)).toMatchObject({ show: true, needsTarget: true });
    expect(activationStatus(TINY_ROSTER, null)).toMatchObject({ show: true, needsTarget: true });
    expect(activationStatus(TINY_ROSTER + 1, null)).toMatchObject({ show: false });
  });

  it('tracks join rate against the coach-stated target', () => {
    const s = activationStatus(12, 40);
    expect(s).toMatchObject({ show: true, needsTarget: false, missing: 28, pct: 30 });
    expect(s.line).toBe('12 of 40 joined');
  });

  it('retires once the team is fully on', () => {
    expect(activationStatus(40, 40).show).toBe(false);
    expect(activationStatus(45, 40).show).toBe(false);
  });

  it('is defensive against garbage targets and negative joins', () => {
    expect(activationStatus(-3, 40).line).toBe('0 of 40 joined');
    expect(activationStatus(3, Number.NaN)).toMatchObject({ needsTarget: true });
    expect(activationStatus(3, 0)).toMatchObject({ needsTarget: true });
  });
});

describe('parseRosterTarget', () => {
  it('accepts sane sizes and rejects garbage', () => {
    expect(parseRosterTarget('40')).toBe(40);
    expect(parseRosterTarget(' 25 ')).toBe(25);
    expect(parseRosterTarget('0')).toBeNull();
    expect(parseRosterTarget('-5')).toBeNull();
    expect(parseRosterTarget('999')).toBeNull();
    expect(parseRosterTarget('a lot')).toBeNull();
  });
});
