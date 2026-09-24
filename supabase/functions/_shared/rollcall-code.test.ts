// supabase/functions/_shared/rollcall-code.test.ts
import { signRollCallCode, signCoachCode, signWindowCode, verifyRollCallCode } from './rollcall-code';

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

// ---------------------------------------------------------------- window codes (2026-09-23)
// A WINDOW code is minted days ahead, handed to the native Live Activity / alarm, and spent from
// the lock screen with the app closed. It is bound to one athlete + one instance + that instance's
// own window, so it is valid only while that roll call is answerable, however long ago it was signed.
describe('window codes', () => {
  const opensMs = Date.UTC(2026, 8, 25, 10, 50), closesMs = Date.UTC(2026, 8, 25, 11, 30);
  const GRACE = 10 * 60 * 1000;

  test('a window code verifies anywhere inside the window, days after it was signed', async () => {
    const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
    const r = await verifyRollCallCode('s', code, Date.UTC(2026, 8, 25, 11, 1), GRACE, 'athlete');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.window).toBe(true);
      expect(r.claims.athleteId).toBe('a');
      expect(r.claims.iatMs).toBe(opensMs);
      expect(r.claims.deadlineMs).toBe(closesMs);
    }
  });
  test('a window code is refused after the window', async () => {
    const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
    const r = await verifyRollCallCode('s', code, Date.UTC(2026, 8, 25, 12, 0), GRACE, 'athlete');
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });
  test('the window is open-15 min to close+10 min, whatever grace the caller passes', async () => {
    const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
    const at = (ms: number) => verifyRollCallCode('s', code, ms, 0, 'athlete');
    expect((await at(opensMs - 15 * 60e3)).ok).toBe(true);
    expect((await at(closesMs + 10 * 60e3)).ok).toBe(true);
    expect(await at(closesMs + 10 * 60e3 + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(await at(opensMs - 15 * 60e3 - 1)).toEqual({ ok: false, reason: 'not_yet' });
  });
  test('a window code is an ATHLETE credential: the coach door refuses it', async () => {
    const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
    expect(await verifyRollCallCode('s', code, opensMs, GRACE, 'coach')).toEqual({ ok: false, reason: 'bad_kind' });
    const claims = JSON.parse(Buffer.from(code.split('.')[0], 'base64url').toString());
    expect(claims.w).toBe(1);
    expect(claims.k).toBeUndefined();
  });
  test('the w claim is signed: stripping it off a window code breaks the signature', async () => {
    const code = await signWindowCode('s', { instanceId: 'i', athleteId: 'a', opensMs, closesMs });
    const [payload, sig] = code.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    delete claims.w;
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(await verifyRollCallCode('s', `${forged}.${sig}`, opensMs, GRACE, 'athlete')).toEqual({ ok: false, reason: 'bad_sig' });
  });
  test('an ordinary one-shot code is unchanged: no window, grace from the caller', async () => {
    const code = await signRollCallCode(SECRET, base);
    const r = await verifyRollCallCode(SECRET, code, base.deadlineMs, 60_000);
    expect(r.ok && r.claims.window).toBe(false);
  });
});

describe('allowEarly: the push extension reports an alarm armed days ahead', () => {
  it('accepts a window code long before its window, and never after its close', async () => {
    const code = await signWindowCode(SECRET, { instanceId: 'i', athleteId: 'a', opensMs: 10_000_000, closesMs: 11_000_000 });
    expect(await verifyRollCallCode(SECRET, code, 1_000, 0, 'athlete', { allowEarly: true })).toMatchObject({ ok: true });
    expect(await verifyRollCallCode(SECRET, code, 1_000, 0, 'athlete')).toEqual({ ok: false, reason: 'not_yet' });
    expect(await verifyRollCallCode(SECRET, code, 11_000_000 + 10 * 60e3 + 1, 0, 'athlete', { allowEarly: true }))
      .toEqual({ ok: false, reason: 'expired' });
  });
  it('still refuses a coach code', async () => {
    const coach = await signCoachCode(SECRET, { instanceId: 'i', coachId: 'c', deadlineMs: 5_000_000, iatMs: 1_000 });
    expect(await verifyRollCallCode(SECRET, coach, 2_000, 0, 'athlete', { allowEarly: true })).toEqual({ ok: false, reason: 'bad_kind' });
  });
});
