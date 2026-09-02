import { digestBody, breakthroughCopy, LATE_ACTION_LABEL } from './logic';
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

describe('breakthroughCopy', () => {
  it('tells a late wake-up what happened, in OnStandard\'s voice', () => {
    expect(breakthroughCopy('morning_roll_call', 'Wake-Up Roll Call')).toEqual({
      title: "You're late",
      body: "You haven't answered Wake-Up Roll Call. Your coach can see your status.",
    });
  });
  it('keeps the pre-0211 line for every other type', () => {
    expect(breakthroughCopy('practice', 'Practice')).toEqual({ title: 'Practice', body: 'The window is closing. Answer now.' });
    expect(breakthroughCopy(null, 'Study Hall').body).toBe('The window is closing. Answer now.');
  });
  it('uses the label the device registers at launch', () => {
    expect(LATE_ACTION_LABEL).toBe(CHECK_IN_LABEL);
  });
});
