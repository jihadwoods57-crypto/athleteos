/**
 * MINOR CONSENT GATE (client half of migration 0050): a provable minor (dob < 18) without a
 * verified guardian consent must NOT push real data — the server rejects it anyway, so the
 * client holds the day on-device and the UI explains why, instead of failing silently. Adults
 * and verified minors sync normally. Locks _isProvableMinor, the sync-block arming, and S.consent.
 *
 * node + jsdom bootstrap (globals before the proto graph), same as the other proto tests.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, S, act } = require('../../proto/redesign-2026-07/js/state.js');
const { isSyncBlocked } = require('../../proto/redesign-2026-07/js/day.js');

/** dob string for someone `age` years old today. */
function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1); // safely past the birthday
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
});

describe('_isProvableMinor (mirrors 0050 is_provable_minor)', () => {
  test('dob under 18 → minor', () => {
    RT.profile = { dob: dobForAge(15) };
    expect(act._isProvableMinor()).toBe(true);
  });
  test('dob 18+ → not a minor', () => {
    RT.profile = { dob: dobForAge(20) };
    expect(act._isProvableMinor()).toBe(false);
  });
  test('unknown dob → treated as adult (the live-beta ruling)', () => {
    RT.profile = { name: 'No DOB' };
    expect(act._isProvableMinor()).toBe(false);
  });
});

describe('sync gate arming', () => {
  test('unconsented minor blocks sync; S.consent.needed is true', () => {
    RT.profile = { dob: dobForAge(16) };
    RT.consent = { status: 'none', guardianEmail: null };
    act._armSyncGate();
    expect(isSyncBlocked()).toBe(true);
    expect(S.consent.needed).toBe(true);
    expect(S.consent.minor).toBe(true);
    expect(S.syncIssue).toBe('blocked');
  });

  test('verified minor syncs normally', () => {
    RT.profile = { dob: dobForAge(16) };
    RT.consent = { status: 'verified', guardianEmail: 'p@x.io' };
    act._armSyncGate();
    expect(isSyncBlocked()).toBe(false);
    expect(S.consent.needed).toBe(false);
    expect(S.syncIssue).toBeNull();
  });

  test('adult is never gated regardless of consent state', () => {
    RT.profile = { dob: dobForAge(25) };
    RT.consent = { status: 'none', guardianEmail: null };
    act._armSyncGate();
    expect(isSyncBlocked()).toBe(false);
    expect(S.consent.needed).toBe(false);
    expect(S.consent.minor).toBe(false);
  });

  test('requesting consent flips a minor to pending and keeps the block until verified', async () => {
    RT.profile = { dob: dobForAge(14) };
    // stub sb.rpc for request_guardian_consent
    (dom.window as any).sb = { rpc: async () => ({ error: null }) };
    const r = await act.requestGuardianConsent('parent@example.com');
    expect(r.ok).toBe(true);
    expect(RT.consent.status).toBe('pending');
    expect(isSyncBlocked()).toBe(true); // pending is not verified — still on-device
    expect(S.consent.needed).toBe(true);
  });

  test('requestGuardianConsent rejects a malformed email without calling the server', async () => {
    RT.profile = { dob: dobForAge(14) };
    let called = false;
    (dom.window as any).sb = { rpc: async () => { called = true; return { error: null }; } };
    const r = await act.requestGuardianConsent('not-an-email');
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});
