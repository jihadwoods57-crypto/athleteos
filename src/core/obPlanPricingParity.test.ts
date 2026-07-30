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

type OfferedPlan = { variant: string; id: string; price: string; name: string; sub: string; tag?: string; custom?: boolean };

/** Every plan the onboarding step offers, flattened with everything drift-prone attached. */
function offeredPlans(): OfferedPlan[] {
  const out: OfferedPlan[] = [];
  for (const [variant, list] of Object.entries(PLANS as Record<string, Array<Record<string, unknown>>>)) {
    for (const p of list) {
      out.push({
        variant, id: String(p.id), price: String(p.price ?? p.monthly),
        name: String(p.name), sub: String(p.sub ?? ''), tag: p.tag as string | undefined,
        custom: !!p.custom,
      });
    }
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
      .map(({ variant, id, price, custom }) => {
        const plan = PLAN_CATALOG.find((p) => p.id === id)!;
        // A custom plan has no self-serve price; it must SAY so rather than print $0.
        const want = plan.custom ? 'Custom' : formatPrice(plan.monthly);
        if (custom !== !!plan.custom) return `${variant}:${id} custom flag disagrees with the catalog`;
        return price === want ? null : `${variant}:${id} shows ${price}, catalog says ${want}`;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  /* THE HOLE THE NAME DRIFT FELL THROUGH: this suite locked ids and prices but not names, so the
     same plan rendered as "Pro Solo" / "Nutrition Pro" in onboarding and "Solo" on Plan & billing
     in one session. Names are canonical everywhere; audience tailoring lives in the SUBTITLE. */
  test('every printed plan name is the catalog name, not an audience flavour', () => {
    const mismatches = offeredPlans()
      .map(({ variant, id, name }) => {
        const plan = PLAN_CATALOG.find((p) => p.id === id)!;
        return name === plan.name ? null : `${variant}:${id} is named "${name}", catalog says "${plan.name}"`;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  test('seat counts and the overage price printed in subtitles match the catalog', () => {
    const mismatches = offeredPlans()
      .map(({ variant, id, sub }) => {
        const plan = PLAN_CATALOG.find((p) => p.id === id)!;
        if (plan.seatLimit && plan.rail === 'stripe' && !sub.includes(String(plan.seatLimit))) {
          return `${variant}:${id} subtitle never states the included ${plan.seatLimit} seats`;
        }
        if (plan.extraSeatMonthly && !sub.includes(`$${plan.extraSeatMonthly}`)) {
          return `${variant}:${id} subtitle never states the $${plan.extraSeatMonthly} overage`;
        }
        return null;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  test('every trial tag states the catalog trial length', () => {
    const mismatches = offeredPlans()
      .map(({ variant, id, tag }) => {
        if (!tag || !/trial/i.test(tag)) return null;
        const plan = PLAN_CATALOG.find((p) => p.id === id)!;
        const want = `${plan.trialDays}-day free trial`;
        return tag === want ? null : `${variant}:${id} tags "${tag}", catalog trial is ${plan.trialDays} days`;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  test('the org list offers every organization plan — Enterprise cannot be silently omitted', () => {
    const orgIds = PLAN_CATALOG.filter((p) => p.audience === 'organization').map((p) => p.id).sort();
    const offered = (PLANS.org as Array<{ id: string }>).map((p) => p.id).sort();
    expect(offered).toEqual(orgIds);
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
