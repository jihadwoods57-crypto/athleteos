// supabase/functions/_shared/rollcall-code.test.ts
import { signRollCallCode, verifyRollCallCode } from './rollcall-code';

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
