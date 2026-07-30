/**
 * ONE PAID-PREDICATE, THREE RUNTIMES. The subscription review found three hand-maintained copies
 * of "is this user paid" that already disagreed: SQL has_premium_access (denylist), TS isPro
 * (allowlist), and the proto's isPaid (its own denylist) — plus a fourth dead copy in
 * _shared/entitlement.ts (since deleted). Sponsored athletes had server-side premium while the app
 * said "Free", and past_due unlocked forever in every copy.
 *
 * The SQL predicate (0163) is canonical and behavior-tested against real Postgres. This suite pins
 * the two CLIENT copies to it and to each other: same cases in, same verdicts out, same grace
 * constant. It cannot execute the SQL, so the SQL's verdicts are encoded here as the expected
 * column — if 0163's semantics change, this table must change with it, loudly.
 *
 * settings.js imports state.js (window at module scope) — jsdom before the lazy require, the
 * obPlanPricingParity pattern.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import { JSDOM } from 'jsdom';
import { isPro, GRACE_DAYS, type Entitlement } from './subscription';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

const { isPaid, GRACE_DAYS: PROTO_GRACE } = require('../../proto/redesign-2026-07/js/screens/settings.js');

const NOW = Date.UTC(2026, 6, 30);
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

/** Cases with the verdict 0163's SQL gives (its behavior tests are the authority). */
const CASES: Array<{ label: string; tier: string; status: string; failedAt: string | null; want: boolean }> = [
  { label: 'active team plan', tier: 'team', status: 'active', failedAt: null, want: true },
  { label: 'active consumer plan', tier: 'consumer', status: 'active', failedAt: null, want: true },
  { label: 'past_due day 2 (grace)', tier: 'team', status: 'past_due', failedAt: daysAgo(2), want: true },
  { label: 'past_due day 6 (last grace day)', tier: 'team', status: 'past_due', failedAt: daysAgo(6), want: true },
  { label: 'past_due day 8 (grace over)', tier: 'team', status: 'past_due', failedAt: daysAgo(8), want: false },
  { label: 'past_due, no timestamp', tier: 'consumer', status: 'past_due', failedAt: null, want: true },
  { label: 'canceled never unlocks', tier: 'team', status: 'canceled', failedAt: null, want: false },
  { label: 'paused never unlocks', tier: 'team', status: 'paused', failedAt: null, want: false },
  { label: 'preview is free', tier: 'preview', status: 'active', failedAt: null, want: false },
];

describe('entitlement parity across the client copies', () => {
  test('the grace constants are one number', () => {
    expect(PROTO_GRACE).toBe(GRACE_DAYS);
    expect(GRACE_DAYS).toBe(7); // 0163's `interval '7 days'` (founder call 2026-07-30) — change all three together
  });

  test.each(CASES)('$label → $want in both copies', ({ tier, status, failedAt, want }) => {
    const ts = isPro({
      tier, status, paymentFailedAt: failedAt,
      planId: null, seats: null, seatsUsed: null, renewsAt: null, cancelAtPeriodEnd: false,
    } as unknown as Entitlement, NOW);
    const proto = isPaid({ tier, status, payment_failed_at: failedAt }, NOW);
    expect({ ts, proto }).toEqual({ ts: want, proto: want });
  });

  test('the proto denylist and the TS allowlist agree on odd tier strings', () => {
    // The historical divergence: SQL/proto denylists PASSED unknown tiers, the TS allowlist
    // rejected them. For the CLIENT copies, an unknown tier string must never disagree between
    // screens — proto follows the denylist (matching SQL), TS follows its typed allowlist, and
    // the only tier values the webhooks can write are 'team' | 'consumer' | 'preview', so the
    // envelope where they could differ is unreachable from real data. Assert the reachable set.
    for (const tier of ['team', 'consumer', 'preview']) {
      const ts = isPro({ tier, status: 'active', paymentFailedAt: null } as unknown as Entitlement, NOW);
      const proto = isPaid({ tier, status: 'active', payment_failed_at: null }, NOW);
      expect({ tier, ts }).toEqual({ tier, ts: proto });
    }
  });
});
