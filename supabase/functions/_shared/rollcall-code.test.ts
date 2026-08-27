// supabase/functions/_shared/rollcall-code.test.ts
import { signRollCallCode, signCoachCode, verifyRollCallCode } from './rollcall-code';

const SECRET = 'test-secret-please-change';
const base = { instanceId: 'inst-1', athleteId: 'ath-1', deadlineMs: 1_000_000, iatMs: 900_000 };

describe('rollcall-code', () => {
  it('verifies a freshly signed code before the deadline+grace', async () => {
    const code = await signRollCallCode(SECRET, base);
    const r = await verifyRollCallCode(SECRET, code, base.deadlineMs, 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.instanceId).toBe('inst-1');
      expect(r.claims.athleteId).toBe('ath-1');
    }
  });

  it('rejects a tampered signature', async () => {
    const code = await signRollCallCode(SECRET, base);
    const bad = code.slice(0, -2) + (code.endsWith('AA') ? 'BB' : 'AA');
    const r = await verifyRollCallCode(SECRET, bad, base.deadlineMs, 60_000);
    expect(r).toEqual({ ok: false, reason: 'bad_sig' });
  });

  it('rejects a code signed with a different secret', async () => {
    const code = await signRollCallCode('other-secret', base);
    const r = await verifyRollCallCode(SECRET, code, base.deadlineMs, 60_000);
    expect(r).toEqual({ ok: false, reason: 'bad_sig' });
  });

  it('rejects once past deadline + grace', async () => {
    const code = await signRollCallCode(SECRET, base);
    const r = await verifyRollCallCode(SECRET, code, base.deadlineMs + 61_000, 60_000);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a malformed code', async () => {
    const r = await verifyRollCallCode(SECRET, 'not-a-code', 0, 60_000);
    expect(r).toEqual({ ok: false, reason: 'malformed' });
  });
});

/* DOMAIN SEPARATION — the security property this module exists for.

   Athlete codes and coach codes are minted from the SAME secret, and an athlete legitimately holds
   a valid code for the very instance their coach is running. Without a kind claim, that athlete's
   own "I'm Up" code would be a working credential for "Nudge them" — the power to push every
   teammate's phone, handed to anyone the feature is aimed at. These are the tests that stop it. */
describe('rollcall-code kinds', () => {
  const coachBase = { instanceId: 'inst-1', coachId: 'coach-1', deadlineMs: 1_000_000, iatMs: 900_000 };

  it('refuses an ATHLETE code presented as a coach credential', async () => {
    const code = await signRollCallCode(SECRET, base);
    const r = await verifyRollCallCode(SECRET, code, base.deadlineMs, 60_000, 'coach');
    expect(r).toEqual({ ok: false, reason: 'bad_kind' });
  });

  it('refuses a COACH code presented to the athlete ack path', async () => {
    const code = await signCoachCode(SECRET, coachBase);
    const r = await verifyRollCallCode(SECRET, code, coachBase.deadlineMs, 60_000, 'athlete');
    expect(r).toEqual({ ok: false, reason: 'bad_kind' });
  });

  it("defaults to 'athlete', so an unqualified verify can never accept a coach code", async () => {
    const code = await signCoachCode(SECRET, coachBase);
    const r = await verifyRollCallCode(SECRET, code, coachBase.deadlineMs, 60_000);
    expect(r).toEqual({ ok: false, reason: 'bad_kind' });
  });

  it('verifies a coach code and reads the coach out of subjectId', async () => {
    const code = await signCoachCode(SECRET, coachBase);
    const r = await verifyRollCallCode(SECRET, code, coachBase.deadlineMs, 60_000, 'coach');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.kind).toBe('coach');
      expect(r.claims.subjectId).toBe('coach-1');
      expect(r.claims.instanceId).toBe('inst-1');
    }
  });

  it('reports the WRONG KIND rather than expiry, even when the code is also stale', async () => {
    // Order matters for the audit trail: a coach code at the ack endpoint is the wrong credential
    // whether or not it is fresh, and logging it as 'expired' would describe a security event as
    // a timing one.
    const code = await signCoachCode(SECRET, coachBase);
    const r = await verifyRollCallCode(SECRET, code, coachBase.deadlineMs + 10_000_000, 60_000, 'athlete');
    expect(r).toEqual({ ok: false, reason: 'bad_kind' });
  });

  it('still verifies a legacy athlete code that carries no kind claim', async () => {
    // Codes minted before 2026-08-26 have no `k`. They are in flight for minutes across a deploy,
    // and every one of them is an athlete code, so absent must read as 'athlete'.
    const legacy = await signRollCallCode(SECRET, base);
    expect(JSON.parse(Buffer.from(legacy.split('.')[0], 'base64url').toString()).k).toBeUndefined();
    const r = await verifyRollCallCode(SECRET, legacy, base.deadlineMs, 60_000, 'athlete');
    expect(r.ok).toBe(true);
  });

  it('will not let a coach code be forged by editing an athlete code', async () => {
    // The kind is inside the signed payload, not alongside it. Re-encoding the payload with k:'c'
    // and keeping the original signature must fail on the signature, not sneak through on kind.
    const code = await signRollCallCode(SECRET, base);
    const [payload, sig] = code.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, k: 'c' })).toString('base64url');
    const r = await verifyRollCallCode(SECRET, `${forged}.${sig}`, base.deadlineMs, 60_000, 'coach');
    expect(r).toEqual({ ok: false, reason: 'bad_sig' });
  });
});
