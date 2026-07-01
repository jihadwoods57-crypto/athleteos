// OnStandard — verifiable parental consent (VPC) model. Proves the gate keeps a minor's
// real data on-device until a guardian is verified, and email validation is sane.
import { isValidGuardianEmail, guardianConsentRequired, guardianConsentCopy, guardianStatusFromRequests } from './guardianConsent';

describe('isValidGuardianEmail', () => {
  it('accepts a normal email and trims', () => {
    expect(isValidGuardianEmail('  parent@email.com ')).toBe(true);
  });
  it('rejects malformed input', () => {
    for (const bad of ['', 'parent', 'parent@', '@email.com', 'a@b']) {
      expect(isValidGuardianEmail(bad)).toBe(false);
    }
  });
});

describe('guardianConsentRequired', () => {
  it('requires consent for a minor until the guardian is verified', () => {
    expect(guardianConsentRequired(15, 'none')).toBe(true);
    expect(guardianConsentRequired(15, 'pending')).toBe(true);
    expect(guardianConsentRequired(15, 'verified')).toBe(false);
  });
  it('treats unknown age as a minor (fail-safe)', () => {
    expect(guardianConsentRequired(null, 'none')).toBe(true);
    expect(guardianConsentRequired(undefined, 'verified')).toBe(false);
  });
  it('never requires guardian consent for an adult', () => {
    expect(guardianConsentRequired(20, 'none')).toBe(false);
  });
});

describe('guardianStatusFromRequests', () => {
  it('returns none for no rows', () => {
    expect(guardianStatusFromRequests([])).toBe('none');
  });
  it('returns verified if ANY row is verified (most-approving-wins)', () => {
    expect(guardianStatusFromRequests([{ status: 'pending' }, { status: 'verified' }])).toBe('verified');
  });
  it('returns pending if a request is open but none verified', () => {
    expect(guardianStatusFromRequests([{ status: 'pending' }])).toBe('pending');
  });
  it('treats only-revoked (or unknown) as none', () => {
    expect(guardianStatusFromRequests([{ status: 'revoked' }])).toBe('none');
    expect(guardianStatusFromRequests([{ status: 'whatever' }])).toBe('none');
  });
  it('a real verified row clears the minor gate', () => {
    const status = guardianStatusFromRequests([{ status: 'verified' }]);
    expect(guardianConsentRequired(15, status)).toBe(false);
  });
});

describe('guardianConsentCopy', () => {
  it('is honest per status', () => {
    expect(guardianConsentCopy('pending')).toMatch(/stays on this device/i);
    expect(guardianConsentCopy('verified')).toMatch(/approved/i);
    expect(guardianConsentCopy('none')).toMatch(/must approve/i);
  });
});
