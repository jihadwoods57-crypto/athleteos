/**
 * OB2 PAYWALL PRICE PARITY: the onboarding plan step (proto/.../js/ob2.js PLANS) is display-only —
 * it captures intent, it never charges. That is exactly why it drifts silently: no failing payment
 * ever reveals a wrong number. It shipped ~2x under the real pro/org prices (Solo $49 vs $99,
 * Professional $99 vs $179, org tiers likewise), so an onboarding trainer was quoted half of what
 * they would later be billed.
 *
 * src/core/pricing.ts PLAN_CATALOG is the single source of truth. This locks every price the
 * onboarding step prints to it, and locks the consumer list to the full IAP catalog so a new
 * consumer plan (Family) can't be silently omitted.
 *
 * ob2.js imports state.js, whose module body touches window — same gotcha as coachAnnounce.test.ts.
 * Install jsdom globals before the lazy require. Default node environment (the repo's
 * jest-environment-jsdom is v29, incompatible with its jest 30 runtime).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import { JSDOM } from 'jsdom';
import { PLAN_CATALOG, formatPrice } from './pricing';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

const { PLANS } = require('../../proto/redesign-2026-07/js/ob2.js');

/** Every plan the onboarding step offers, flattened to (variant, id, printed price). */
function offeredPlans(): Array<{ variant: string; id: string; price: string }> {
  const out: Array<{ variant: string; id: string; price: string }> = [];
  for (const [variant, list] of Object.entries(PLANS as Record<string, Array<Record<string, string>>>)) {
    for (const p of list) out.push({ variant, id: p.id, price: p.price ?? p.monthly });
  }
  return out;
}

describe('ob2 PLANS ↔ pricing.ts PLAN_CATALOG', () => {
  test('every offered plan id exists in the catalog', () => {
    for (const { variant, id } of offeredPlans()) {
      expect(PLAN_CATALOG.find((p) => p.id === id)).toBeDefined();
      expect(`${variant}:${id}`).toBeTruthy();
    }
  });

  test('every printed monthly price matches the catalog exactly', () => {
    const mismatches = offeredPlans()
      .map(({ variant, id, price }) => {
        const plan = PLAN_CATALOG.find((p) => p.id === id)!;
        const want = formatPrice(plan.monthly);
        return price === want ? null : `${variant}:${id} shows ${price}, catalog says ${want}`;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  test('the consumer list offers the whole IAP catalog (Family included)', () => {
    const iapIds = PLAN_CATALOG.filter((p) => p.rail === 'iap').map((p) => p.id).sort();
    const offered = (PLANS.individual as Array<{ id: string }>).map((p) => p.id).sort();
    expect(offered).toEqual(iapIds);
  });

  test('consumer annual prices and per-month effective rates match the catalog', () => {
    for (const p of PLANS.individual as Array<Record<string, string>>) {
      const plan = PLAN_CATALOG.find((c) => c.id === p.id)!;
      expect(p.annual).toBe(formatPrice(plan.annual));
      expect(p.annualPer).toBe(formatPrice(Math.round((plan.annual / 12) * 100) / 100));
    }
  });
});
