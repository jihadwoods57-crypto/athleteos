import { isMinor, realDataConsent, consentSummary } from './consent';

describe('isMinor', () => {
  it('is true under 18 and for unknown age (fail-safe)', () => {
    expect(isMinor(16)).toBe(true);
    expect(isMinor(null)).toBe(true);
    expect(isMinor(undefined)).toBe(true);
  });
  it('is false at 18+', () => {
    expect(isMinor(18)).toBe(false);
    expect(isMinor(22)).toBe(false);
  });
});

describe('realDataConsent', () => {
  const base = { backendLive: true, role: 'athlete', age: 16, consentGiven: false };

  it('never collects when the backend is off', () => {
    expect(realDataConsent({ ...base, backendLive: false, consentGiven: true })).toEqual({ ok: false, reason: 'backend-off' });
  });
  it('blocks a minor athlete without consent', () => {
    expect(realDataConsent(base)).toEqual({ ok: false, reason: 'minor-consent-required' });
  });
  it('blocks an adult athlete without consent', () => {
    expect(realDataConsent({ ...base, age: 20 })).toEqual({ ok: false, reason: 'consent-required' });
  });
  it('allows an adult athlete with consent', () => {
    expect(realDataConsent({ ...base, age: 20, consentGiven: true })).toEqual({ ok: true, reason: 'ok' });
  });
  it('blocks a minor with consent but no guardian (fail-closed: absent status)', () => {
    expect(realDataConsent({ ...base, consentGiven: true })).toEqual({ ok: false, reason: 'minor-guardian-unverified' });
  });
  it('blocks a minor with consent while guardian approval is only pending', () => {
    expect(realDataConsent({ ...base, consentGiven: true, guardianStatus: 'pending' })).toEqual({ ok: false, reason: 'minor-guardian-unverified' });
  });
  it('allows a minor with consent once the guardian is verified', () => {
    expect(realDataConsent({ ...base, consentGiven: true, guardianStatus: 'verified' })).toEqual({ ok: true, reason: 'ok' });
  });
  it('treats unknown age as a minor (guardian still required)', () => {
    expect(realDataConsent({ ...base, age: null, consentGiven: true })).toEqual({ ok: false, reason: 'minor-guardian-unverified' });
  });
  it('does not gate non-athlete roles (they generate no athlete health data)', () => {
    expect(realDataConsent({ backendLive: true, role: 'coach', consentGiven: false })).toEqual({ ok: true, reason: 'ok' });
  });
});

describe('consentSummary', () => {
  it('names a guardian for a minor', () => {
    expect(consentSummary(true)).toContain('parent or guardian');
  });
  it('is athlete-only for an adult', () => {
    expect(consentSummary(false).startsWith('You control')).toBe(true);
  });
  it('discloses third-party AI photo analysis (Anthropic)', () => {
    expect(consentSummary(false)).toContain('Anthropic');
    expect(consentSummary(true)).toContain('Anthropic');
  });
});
