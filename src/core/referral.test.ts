import {
  generateReferralCode, isValidReferralCode, normalizeReferralCode,
  referralShareMessage, referralSummary, REFERRAL_CODE_LENGTH,
} from './referral';

describe('generateReferralCode', () => {
  it('produces a valid 8-char code from the unambiguous alphabet', () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(isValidReferralCode(code)).toBe(true);
    // No look-alike characters (0/O/1/I/L are excluded by design).
    expect(code).not.toMatch(/[0O1IL]/);
  });
  it('is deterministic under an injected rand', () => {
    const a = generateReferralCode(() => 0.42);
    const b = generateReferralCode(() => 0.42);
    expect(a).toBe(b);
  });
});

describe('isValidReferralCode / normalizeReferralCode', () => {
  it('accepts the server rule (6-12 uppercase alphanumerics) and rejects garbage', () => {
    expect(isValidReferralCode('ABC234')).toBe(true);
    expect(isValidReferralCode('ABCDEFGH2345')).toBe(true);
    expect(isValidReferralCode('abc234')).toBe(false);
    expect(isValidReferralCode('SHORT')).toBe(false);
    expect(isValidReferralCode('WAY-TOO-LONG-CODE')).toBe(false);
    expect(isValidReferralCode('')).toBe(false);
  });
  it('normalizes pasted input (case, spaces, dashes)', () => {
    expect(normalizeReferralCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeReferralCode('mn pq 78')).toBe('MNPQ78');
  });
});

describe('referralSummary', () => {
  it('renders the empty state as an invitation, not a zero', () => {
    const s = referralSummary([]);
    expect(s.joined).toBe(0);
    expect(s.line).toContain('free month');
  });
  it('counts joined / earned / pending honestly', () => {
    const s = referralSummary([
      { status: 'rewarded', rewarded_at: '2026-07-01' },
      { status: 'rewarded', rewarded_at: '2026-07-02' },
      { status: 'pending' },
    ]);
    expect(s.joined).toBe(3);
    expect(s.monthsEarned).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.line).toContain('3 people joined');
    expect(s.line).toContain('2 free months earned');
    expect(s.line).toContain('1 pending');
  });
  it('uses singular forms for one', () => {
    const s = referralSummary([{ status: 'rewarded' }]);
    expect(s.line).toContain('1 person joined');
    expect(s.line).toContain('1 free month earned');
  });
});

describe('referralShareMessage', () => {
  it('carries the code and no em dashes', () => {
    const msg = referralShareMessage('ABCD2345');
    expect(msg).toContain('ABCD2345');
    expect(msg).not.toContain('—');
  });
});
