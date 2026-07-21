import {
  billingRowCopy,
  entitlementFeatures,
  entitlementFromRow,
  FEATURE_KEYS,
  hasFeature,
  isPro,
  needsBillingAttention,
  normalizeEntitlement,
  planLabel,
  previewEntitlement,
  type Entitlement,
} from './subscription';

describe('previewEntitlement / isPro', () => {
  it('preview is not pro', () => {
    expect(isPro(previewEntitlement())).toBe(false);
  });
  it('an active team plan is pro; past_due keeps access (grace); canceled and paused do not', () => {
    expect(isPro({ tier: 'team', status: 'active' })).toBe(true);
    expect(isPro({ tier: 'team', status: 'past_due' })).toBe(true);
    expect(isPro({ tier: 'team', status: 'canceled' })).toBe(false);
    expect(isPro({ tier: 'team', status: 'paused' })).toBe(false);
  });
});

describe('needsBillingAttention (dunning banner gate)', () => {
  it('fires only on past_due', () => {
    expect(needsBillingAttention({ tier: 'team', status: 'past_due' })).toBe(true);
    expect(needsBillingAttention({ tier: 'team', status: 'active' })).toBe(false);
    expect(needsBillingAttention({ tier: 'team', status: 'paused' })).toBe(false);
    expect(needsBillingAttention(previewEntitlement())).toBe(false);
  });
});

describe('entitlementFromRow (fail-safe)', () => {
  it('a null / non-team row falls back to free preview', () => {
    expect(entitlementFromRow(null)).toEqual(previewEntitlement());
    expect(entitlementFromRow({ tier: 'preview', status: 'active', seats: 9, seats_used: 1, current_period_end: null }).tier).toBe('preview');
  });
  it('maps a team row into the entitlement (0042 lifecycle columns included)', () => {
    const e = entitlementFromRow({
      tier: 'team', status: 'active', seats: 24, seats_used: 18, current_period_end: '2026-08-01',
      plan_id: 'pro_solo', cancel_at_period_end: false, payment_failed_at: null,
    });
    expect(e).toEqual({
      tier: 'team', status: 'active', planId: 'pro_solo', seats: 24, seatsUsed: 18,
      renewsAt: '2026-08-01', cancelAtPeriodEnd: false, paymentFailedAt: null,
    });
    expect(isPro(e)).toBe(true);
  });
  it('tolerates a pre-0042 row with no lifecycle columns', () => {
    const e = entitlementFromRow({ tier: 'team', status: 'active', seats: 24, seats_used: 18, current_period_end: '2026-08-01' });
    expect(e.planId).toBeNull();
    expect(e.cancelAtPeriodEnd).toBe(false);
    expect(isPro(e)).toBe(true);
  });
  it('maps paused and carries the dunning timestamp', () => {
    const paused = entitlementFromRow({ tier: 'team', status: 'paused', seats: 25, seats_used: 3, current_period_end: null });
    expect(paused.status).toBe('paused');
    expect(isPro(paused)).toBe(false);
    const dunned = entitlementFromRow({
      tier: 'team', status: 'past_due', seats: 25, seats_used: 3, current_period_end: null,
      payment_failed_at: '2026-07-04T12:00:00Z',
    });
    expect(dunned.paymentFailedAt).toBe('2026-07-04T12:00:00Z');
    expect(needsBillingAttention(dunned)).toBe(true);
  });
});

describe('normalizeEntitlement', () => {
  it('repairs garbage to preview', () => {
    expect(normalizeEntitlement({ tier: 'gold' as never })).toEqual(previewEntitlement());
    expect(normalizeEntitlement(null)).toEqual(previewEntitlement());
  });
});

describe('planLabel', () => {
  it('labels each state', () => {
    expect(planLabel(previewEntitlement())).toBe('Free preview');
    expect(planLabel({ tier: 'team', status: 'active' })).toBe('Team plan');
    expect(planLabel({ tier: 'team', status: 'active', cancelAtPeriodEnd: true })).toBe('Team · ending soon');
    expect(planLabel({ tier: 'team', status: 'past_due' })).toBe('Team · payment due');
    expect(planLabel({ tier: 'team', status: 'paused' })).toBe('Team · paused');
    expect(planLabel({ tier: 'team', status: 'canceled' })).toBe('Team · canceled');
  });
});

describe('hasFeature (the single gate; memo D4)', () => {
  it('preview unlocks the free core loop but not paid features', () => {
    const p = previewEntitlement();
    expect(hasFeature(p, 'dev_score')).toBe(true);
    expect(hasFeature(p, 'meal_analysis')).toBe(true);
    expect(hasFeature(p, 'reports')).toBe(false);
    expect(hasFeature(p, 'accountability_engine')).toBe(false);
  });
  it('an active team plan unlocks everything', () => {
    const t: Entitlement = { tier: 'team', status: 'active' };
    expect(hasFeature(t, 'reports')).toBe(true);
    expect(hasFeature(t, 'groups')).toBe(true);
    expect(entitlementFeatures(t).length).toBe(FEATURE_KEYS.length);
  });
  it('a canceled team plan reverts to the free set', () => {
    expect(hasFeature({ tier: 'team', status: 'canceled' }, 'reports')).toBe(false);
    expect(hasFeature({ tier: 'team', status: 'canceled' }, 'dev_score')).toBe(true);
  });
  it('past_due keeps paid access (grace)', () => {
    expect(hasFeature({ tier: 'team', status: 'past_due' }, 'reports')).toBe(true);
  });
});

describe('billingRowCopy', () => {
  it('preview athlete copy is byte-identical to the old static row', () => {
    expect(billingRowCopy(previewEntitlement(), 'app')).toEqual({
      hint: 'Free preview',
      detail: 'OnStandard is in free preview. There is no billing on this account yet.',
    });
  });
  it('a coach on an active plan sees seat usage', () => {
    const e: Entitlement = { tier: 'team', status: 'active', seats: 24, seatsUsed: 18 };
    const c = billingRowCopy(e, 'coach');
    expect(c.hint).toBe('Team · 24 seats');
    expect(c.detail).toContain('18 of 24');
  });
  it('an athlete on a team plan pays nothing (covered by the coach)', () => {
    expect(billingRowCopy({ tier: 'team', status: 'active' }, 'app').detail).toContain('covered by your coach');
  });
  it('a paused coach plan says nothing was deleted and how to resume', () => {
    const c = billingRowCopy({ tier: 'team', status: 'paused', seats: 25, seatsUsed: 4 }, 'trainer');
    expect(c.hint).toBe('Paused');
    expect(c.detail).toContain('nothing was deleted');
    expect(c.detail.toLowerCase()).toContain('resume');
  });
  it('a canceling-at-period-end plan says access continues and can be undone', () => {
    const c = billingRowCopy({ tier: 'team', status: 'active', seats: 25, cancelAtPeriodEnd: true, renewsAt: '2026-08-01' }, 'coach');
    expect(c.hint).toBe('Ending soon');
    expect(c.detail).toContain('until 2026-08-01');
    expect(c.detail.toLowerCase()).toContain('undo');
  });
  it('never uses an em dash (account copy ban)', () => {
    for (const flow of ['app', 'coach', 'trainer', 'parent'] as const) {
      for (const e of [
        previewEntitlement(),
        { tier: 'team', status: 'active', seats: 5 }, { tier: 'team', status: 'past_due', seats: 5 },
        { tier: 'team', status: 'paused', seats: 5 }, { tier: 'team', status: 'active', seats: 5, cancelAtPeriodEnd: true },
        { tier: 'team', status: 'canceled' },
        { tier: 'consumer', status: 'active', planId: 'individual' },
        { tier: 'consumer', status: 'past_due', planId: 'family' },
        { tier: 'consumer', status: 'paused', planId: 'individual_plus' },
        { tier: 'consumer', status: 'active', planId: 'family', cancelAtPeriodEnd: true, renewsAt: '2026-08-01' },
        { tier: 'consumer', status: 'canceled', planId: 'individual' },
      ] as Entitlement[]) {
        const c = billingRowCopy(e, flow);
        expect(c.hint).not.toContain('—');
        expect(c.detail).not.toContain('—');
      }
    }
  });
});

describe('consumer IAP tier (RevenueCat rail)', () => {
  it('an active consumer plan is pro; past_due keeps access; canceled/paused do not', () => {
    expect(isPro({ tier: 'consumer', status: 'active' })).toBe(true);
    expect(isPro({ tier: 'consumer', status: 'past_due' })).toBe(true);
    expect(isPro({ tier: 'consumer', status: 'canceled' })).toBe(false);
    expect(isPro({ tier: 'consumer', status: 'paused' })).toBe(false);
    expect(needsBillingAttention({ tier: 'consumer', status: 'past_due' })).toBe(true);
  });
  it('maps a consumer row (individual+/family) into the entitlement', () => {
    const e = entitlementFromRow({
      tier: 'consumer', status: 'active', seats: null, seats_used: null, current_period_end: '2026-08-01',
      plan_id: 'individual_plus', cancel_at_period_end: false, payment_failed_at: null,
    });
    expect(e.tier).toBe('consumer');
    expect(e.planId).toBe('individual_plus');
    expect(isPro(e)).toBe(true);
  });
  it('unlocks the athlete-facing paid set but NOT the B2B roster tools', () => {
    const c: Entitlement = { tier: 'consumer', status: 'active', planId: 'individual' };
    expect(hasFeature(c, 'ai_coach')).toBe(true);
    expect(hasFeature(c, 'weekly_insights')).toBe(true);
    expect(hasFeature(c, 'recruiting_record')).toBe(true);
    expect(hasFeature(c, 'client_dashboard')).toBe(false);
    expect(hasFeature(c, 'groups')).toBe(false);
    expect(hasFeature(c, 'white_label')).toBe(false);
  });
  it('a canceled consumer plan reverts to the free core loop', () => {
    expect(hasFeature({ tier: 'consumer', status: 'canceled', planId: 'individual' }, 'ai_coach')).toBe(false);
    expect(hasFeature({ tier: 'consumer', status: 'canceled', planId: 'individual' }, 'dev_score')).toBe(true);
  });
  it('labels consumer plans by name', () => {
    expect(planLabel({ tier: 'consumer', status: 'active', planId: 'individual' })).toBe('Individual');
    expect(planLabel({ tier: 'consumer', status: 'active', planId: 'family' })).toBe('Family');
    expect(planLabel({ tier: 'consumer', status: 'active', planId: 'individual_plus', cancelAtPeriodEnd: true })).toBe('Individual+ · ending soon');
    expect(planLabel({ tier: 'consumer', status: 'past_due', planId: 'individual' })).toBe('Individual · payment due');
  });
  it('billing row: a paying athlete sees their own store-managed plan', () => {
    const c = billingRowCopy({ tier: 'consumer', status: 'active', planId: 'individual', renewsAt: '2026-08-01' }, 'app');
    expect(c.hint).toBe('Individual');
    expect(c.detail.toLowerCase()).toContain('app store');
    const due = billingRowCopy({ tier: 'consumer', status: 'past_due', planId: 'family' }, 'app');
    expect(due.hint).toBe('Payment due');
  });
});
