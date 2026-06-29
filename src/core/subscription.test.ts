import {
  billingRowCopy,
  entitlementFeatures,
  entitlementFromRow,
  FEATURE_KEYS,
  hasFeature,
  isPro,
  normalizeEntitlement,
  planLabel,
  previewEntitlement,
  type Entitlement,
} from './subscription';

describe('previewEntitlement / isPro', () => {
  it('preview is not pro', () => {
    expect(isPro(previewEntitlement())).toBe(false);
  });
  it('an active team plan is pro; past_due keeps access (grace); canceled does not', () => {
    expect(isPro({ tier: 'team', status: 'active' })).toBe(true);
    expect(isPro({ tier: 'team', status: 'past_due' })).toBe(true);
    expect(isPro({ tier: 'team', status: 'canceled' })).toBe(false);
  });
});

describe('entitlementFromRow (fail-safe)', () => {
  it('a null / non-team row falls back to free preview', () => {
    expect(entitlementFromRow(null)).toEqual(previewEntitlement());
    expect(entitlementFromRow({ tier: 'preview', status: 'active', seats: 9, seats_used: 1, current_period_end: null }).tier).toBe('preview');
  });
  it('maps a team row into the entitlement', () => {
    const e = entitlementFromRow({ tier: 'team', status: 'active', seats: 24, seats_used: 18, current_period_end: '2026-08-01' });
    expect(e).toEqual({ tier: 'team', status: 'active', seats: 24, seatsUsed: 18, renewsAt: '2026-08-01' });
    expect(isPro(e)).toBe(true);
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
    expect(planLabel({ tier: 'team', status: 'past_due' })).toBe('Team · payment due');
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
      detail: 'AthleteOS is in free preview. There is no billing on this account yet.',
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
  it('never uses an em dash (account copy ban)', () => {
    for (const flow of ['app', 'coach', 'trainer', 'parent'] as const) {
      for (const e of [previewEntitlement(), { tier: 'team', status: 'active', seats: 5 }, { tier: 'team', status: 'past_due', seats: 5 }, { tier: 'team', status: 'canceled' }] as Entitlement[]) {
        const c = billingRowCopy(e, flow);
        expect(c.hint).not.toContain('—');
        expect(c.detail).not.toContain('—');
      }
    }
  });
});
