import { digestBody, breakthroughCopy, minutesLate, platformCopy, LATE_ACTION_LABEL } from './logic';
import { CHECK_IN_LABEL } from '../_shared/rollcall-category';

describe('digestBody', () => {
  it('says everyone answered', () => {
    expect(digestBody('5 AM Club', 12, [])).toBe('5 AM Club: 12/12 up. Everyone answered.');
  });
  it('names up to five and counts the rest', () => {
    expect(digestBody('Roll call', 10, ['A', 'B'])).toBe("Roll call: 8/10 up. 2 didn't answer: A, B.");
    expect(digestBody('Roll call', 10, ['A', 'B', 'C', 'D', 'E', 'F', 'G']))
      .toBe("Roll call: 3/10 up. 7 didn't answer: A, B, C, D, E and 2 more.");
  });
});

describe('breakthroughCopy: the LATE lock-screen state', () => {
  const deadline = '2026-09-01T10:05:00Z';
  const at = (iso: string) => Date.parse(iso);

  it('leads with lateness and its size, and names the roll call in the subtitle', () => {
    const c = breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call', deadline, at('2026-09-01T10:08:00Z'));
    expect(c.title).toBe("You're late · 3 min");
    expect(c.subtitle).toBe('Wake-Up Roll Call');
    expect(c.body).toBe('Check in now. Your coach can see this.');
  });
  it('moves the roll call name into the body on Android, which has no subtitle', () => {
    const c = breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call', deadline, at('2026-09-01T10:08:00Z'));
    expect(c.androidTitle).toBe("You're late · 3 min");
    expect(c.androidBody).toBe('Wake-Up Roll Call is still waiting. Check in now.');
    expect(platformCopy(c, 'android')).toEqual({
      title: "You're late · 3 min", subtitle: null,
      body: 'Wake-Up Roll Call is still waiting. Check in now.',
    });
    expect(platformCopy(c, 'ios')).toEqual({
      title: "You're late · 3 min", subtitle: 'Wake-Up Roll Call',
      body: 'Check in now. Your coach can see this.',
    });
  });
  it('rounds the minutes UP, like SQL rollcall_late_min', () => {
    expect(minutesLate(deadline, at('2026-09-01T10:05:01Z'))).toBe(1);
    expect(minutesLate(deadline, at('2026-09-01T10:06:00Z'))).toBe(1);
    expect(minutesLate(deadline, at('2026-09-01T10:06:01Z'))).toBe(2);
    expect(minutesLate(deadline, at('2026-09-01T10:11:00Z'))).toBe(6);
  });
  it('omits the number rather than saying "0 min" when the claim races the clock', () => {
    expect(minutesLate(deadline, at('2026-09-01T10:05:00Z'))).toBeNull();
    expect(minutesLate(deadline, at('2026-09-01T10:04:00Z'))).toBeNull();
    expect(minutesLate(null, at('2026-09-01T10:08:00Z'))).toBeNull();
    const c = breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call', deadline, at('2026-09-01T10:05:00Z'));
    expect(c.title).toBe("You're late");
  });
  it('omits the number when the caller passes no clock at all', () => {
    expect(breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call').title).toBe("You're late");
  });
  it('keeps the pre-0211 line for every other type', () => {
    const c = breakthroughCopy('practice', 'Practice', deadline, at('2026-09-01T10:08:00Z'));
    expect(c.title).toBe('Practice');
    expect(c.subtitle).toBeNull();
    expect(c.body).toBe('The window is closing. Answer now.');
    expect(breakthroughCopy(null, 'Study Hall').body).toBe('The window is closing. Answer now.');
  });
  it('never writes the app name into our own copy (the OS draws it)', () => {
    const c = breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call', deadline, at('2026-09-01T10:08:00Z'));
    expect(`${c.title} ${c.subtitle} ${c.body} ${c.androidBody}`).not.toContain('OnStandard');
  });
  it('uses the label the device registers at launch', () => {
    expect(LATE_ACTION_LABEL).toBe(CHECK_IN_LABEL);
  });
});
