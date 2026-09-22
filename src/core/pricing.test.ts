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
    expect(planById('individual')?.monthly).toBe(19.99);
    expect(planById('individual')?.annual).toBe(199.99);
    expect(planById('pro_solo')).toMatchObject({ monthly: 99, seatLimit: 25 });
    expect(planById('professional')).toMatchObject({ monthly: 179, seatLimit: 50, extraSeatMonthly: 10 });
    expect(planById('org_performance')).toMatchObject({ monthly: 799, seatLimit: 150 });
    expect(planById('family')).toMatchObject({ monthly: 24.99, annual: 249.99, seatLimit: 4, rail: 'iap' });
    expect(planById('enterprise')?.custom).toBe(true);
  });
  // INDIVIDUAL PLUS IS RETIRED (2026-09-21). It charged $5 for the recruiting card and the
  // portable record, and has_premium_access() never read tier, so every paid athlete already had
  // both. A catalog entry is the only thing that can put it back on a paywall, so the absence is
  // asserted rather than left to the reader noticing.
  it('carries no retired Individual Plus plan', () => {
    expect(planById('individual_plus')).toBeUndefined();
    expect(PLAN_CATALOG.some((p) => /plus/i.test(p.id) || /Plus/.test(p.name))).toBe(false);
  });
  // The trap this plan exists to avoid, checked against the CURRENT prices: it has been re-opened
  // twice by moving Individual and not Family.
  it('Family beats two Individuals, monthly and annually', () => {
    const ind = planById('individual')!;
    const fam = planById('family')!;
    expect(fam.monthly).toBeLessThan(ind.monthly * 2);
    expect(fam.annual).toBeLessThan(ind.annual * 2);
  });
  it('every priced plan gives a real annual discount', () => {
    for (const p of PLAN_CATALOG) {
      if (p.custom) continue;
      expect(annualSavings(p)).toBeGreaterThan(0);
      expect(p.annual).toBeLessThan(p.monthly * 12);
    }
  });
  // CONSUMER ANNUAL IS NO LONGER A PERCENTAGE (2026-09-21). It was pinned at ~30% off, and that
  // rule cannot survive the constraint that actually binds: the App Store ladder. $199.99 and
  // $249.99 are real price points; the percentages they happen to produce (~16.6%) are an output,
  // not an input. What is still worth locking is that consumer annual ends on a store price point
  // (never a round dollar Apple does not sell) and is worth at least a month off. Pro/org are
  // unchanged and keep the two-months-free anchor.
  it('consumer annual sits on an App Store price point; pro/org keep ~2 months free', () => {
    for (const p of PLAN_CATALOG) {
      if (p.custom) continue;
      if (p.audience === 'individual') {
        expect(p.rail).toBe('iap');
        expect(Math.round(p.annual * 100) % 100).toBe(99); // .99, the shape of every Apple tier
        expect(p.annual).toBeLessThanOrEqual(p.monthly * 11);
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
    expect(plansForFlow('app').map((p) => p.id)).toEqual(['individual', 'family']);
    expect(plansForFlow('parent').map((p) => p.id)).toContain('family');
    expect(plansForFlow('coach').every((p) => p.audience === 'organization')).toBe(true);
  });
});

describe('planTerms (compliant disclosure)', () => {
  it('states price, auto-renewal, trial, and easy cancellation up front', () => {
    const t = planTerms(planById('individual')!);
    expect(t.price).toBe('$19.99 / month');
    expect(t.renewal.toLowerCase()).toContain('auto-renews');
    expect(t.trial).toContain('14-day free trial');
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
