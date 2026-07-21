import {
  annualSavings, audienceForFlow, formatPrice, planById, plansForFlow, planTerms, purchaseCtaLabel, PLAN_CATALOG,
} from './pricing';

describe('formatPrice', () => {
  it('drops cents for whole dollars, keeps two places otherwise', () => {
    expect(formatPrice(69)).toBe('$69');
    expect(formatPrice(14.99)).toBe('$14.99');
    expect(formatPrice(124.99)).toBe('$124.99');
  });
});

describe('catalog shape', () => {
  it('has the recommended consumer + pro + org plans', () => {
    expect(planById('individual')?.monthly).toBe(14.99);
    expect(planById('individual_plus')?.monthly).toBe(24.99);
    expect(planById('pro_solo')).toMatchObject({ monthly: 99, seatLimit: 25 });
    expect(planById('professional')).toMatchObject({ monthly: 179, seatLimit: 50, extraSeatMonthly: 10 });
    expect(planById('org_performance')).toMatchObject({ monthly: 799, seatLimit: 150 });
    expect(planById('family')).toMatchObject({ monthly: 39.99, seatLimit: 4, rail: 'iap' });
    expect(planById('enterprise')?.custom).toBe(true);
  });
  it('every priced plan gives a real annual discount', () => {
    for (const p of PLAN_CATALOG) {
      if (p.custom) continue;
      expect(annualSavings(p)).toBeGreaterThan(0);
      expect(p.annual).toBeLessThan(p.monthly * 12);
    }
  });
  it('consumer plans anchor annual at ~30% off; pro/org keep ~2 months free', () => {
    for (const p of PLAN_CATALOG) {
      if (p.custom) continue;
      const discount = 1 - p.annual / (p.monthly * 12);
      if (p.audience === 'individual') {
        expect(discount).toBeGreaterThan(0.28); // ~30% consumer anchor
        expect(discount).toBeLessThan(0.32);
      } else {
        // within a dollar of "pay for 10 months" (2 months free)
        expect(Math.abs(p.annual - p.monthly * 10)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('plansForFlow', () => {
  it('shows the right audience per dashboard flow', () => {
    expect(audienceForFlow('app')).toBe('individual');
    expect(audienceForFlow('parent')).toBe('individual');
    expect(audienceForFlow('trainer')).toBe('professional');
    expect(audienceForFlow('coach')).toBe('organization');
    expect(plansForFlow('app').map((p) => p.id)).toEqual(['individual', 'individual_plus', 'family']);
    expect(plansForFlow('parent').map((p) => p.id)).toContain('family');
    expect(plansForFlow('coach').every((p) => p.audience === 'organization')).toBe(true);
  });
});

describe('planTerms (compliant disclosure)', () => {
  it('states price, auto-renewal, trial, and easy cancellation up front', () => {
    const t = planTerms(planById('individual')!);
    expect(t.price).toBe('$14.99 / month');
    expect(t.renewal.toLowerCase()).toContain('auto-renews');
    expect(t.trial).toContain('7-day free trial');
    expect(t.cancellation.toLowerCase()).toContain('cancel anytime');
    expect(t.cancellation.toLowerCase()).toContain('no phone call');
    expect(t.annual).toContain('/year');
  });
  it('routes the cancel surface by rail (IAP store vs account settings)', () => {
    expect(planTerms(planById('individual')!).cancellation).toContain('App Store');
    expect(planTerms(planById('pro_solo')!).cancellation).toContain('account settings');
  });
  it('handles enterprise/custom with no fake price or trial', () => {
    const t = planTerms(planById('enterprise')!);
    expect(t.price).toBe('Custom pricing');
    expect(t.trial).toBe('');
  });
});

describe('purchaseCtaLabel (consent in the button — FTC)', () => {
  it('carries the auto-renewal terms in the label', () => {
    expect(purchaseCtaLabel(planById('professional')!)).toBe('Start — $179/mo, auto-renews');
    expect(purchaseCtaLabel(planById('enterprise')!)).toBe('Contact sales');
  });
});
