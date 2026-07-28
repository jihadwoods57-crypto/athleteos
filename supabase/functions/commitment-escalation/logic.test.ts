// supabase/functions/commitment-escalation/logic.test.ts
import { digestBody } from './logic';

describe('digestBody', () => {
  it('summarizes counts and names the non-responders', () => {
    expect(digestBody('5 AM Club', 20, ['Marcus', 'Dee', 'Sol']))
      .toBe("5 AM Club: 17/20 up. 3 didn't answer: Marcus, Dee, Sol.");
  });
  it('reads clean when everyone answered', () => {
    expect(digestBody('5 AM Club', 12, [])).toBe('5 AM Club: 12/12 up. Everyone answered.');
  });
  it('truncates a long non-responder list', () => {
    const names = Array.from({ length: 9 }, (_, i) => 'A' + i);
    expect(digestBody('Lift', 30, names)).toContain('and 4 more');
  });
});
