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
// The paywall's own catalog — the THIRD mirror, and until 2026-09-21 the only one with no gate.
// ob2.js was locked to pricing.ts while proto/js/pricing.js (what the in-app paywall actually
// renders and what mints the store product id) was free to drift, which is the same hole this
// suite exists to close, one file over.
const { CONSUMER_PLANS } = require('../../proto/redesign-2026-07/js/pricing.js');

/* THE FACTS EACH CONSUMER PLAN MUST STATE, on every screen that describes it. Individual Plus was
   retired on 2026-09-21 and its selling points (full history, unlimited supporters, the recruiting
   card) moved onto Individual, because has_premium_access() never read tier and every paid athlete
   always had them. Deleting a plan is easy; deleting a plan and silently dropping the three things
   it advertised is how a paywall stops describing what it sells. Both descriptions of a plan must
   carry these. */
const CONSUMER_FACTS: Record<string, string[]> = {
  individual: ['history', 'supporters', 'recruiting card'],
  family: ['4 athletes', 'one bill'],
};

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

  /* INDIVIDUAL PLUS IS RETIRED (2026-09-21). The consumer-list test above already fails if ob2
     offers a plan the catalog does not carry, but it fails with a diff of two sorted arrays. This
     names the thing, in every variant and in the paywall catalog too, so the next person reading a
     red test knows a retired plan came back rather than that a list changed. */
  test('no screen offers a retired Individual Plus plan', () => {
    const offenders = [
      ...offeredPlans().filter((p) => /plus/i.test(p.id) || /plus/i.test(p.name))
        .map((p) => `ob2 ${p.variant}:${p.id}`),
      ...(CONSUMER_PLANS as Array<{ id: string; name: string }>)
        .filter((p) => /plus/i.test(p.id) || /plus/i.test(p.name)).map((p) => `paywall:${p.id}`),
      ...PLAN_CATALOG.filter((p) => /plus/i.test(p.id) || /plus/i.test(p.name)).map((p) => `catalog:${p.id}`),
    ];
    expect(offenders).toEqual([]);
  });

  test('the paywall catalog is the IAP catalog, plan for plan and field for field', () => {
    const iap = PLAN_CATALOG.filter((p) => p.rail === 'iap');
    expect((CONSUMER_PLANS as Array<{ id: string }>).map((p) => p.id)).toEqual(iap.map((p) => p.id));
    const mismatches = (CONSUMER_PLANS as Array<Record<string, unknown>>)
      .map((p) => {
        const plan = PLAN_CATALOG.find((c) => c.id === p.id)!;
        if (p.name !== plan.name) return `${p.id}: name "${p.name}" vs catalog "${plan.name}"`;
        if (p.monthly !== plan.monthly) return `${p.id}: monthly ${p.monthly} vs catalog ${plan.monthly}`;
        if (p.annual !== plan.annual) return `${p.id}: annual ${p.annual} vs catalog ${plan.annual}`;
        if (p.trialDays !== plan.trialDays) return `${p.id}: trial ${p.trialDays} vs catalog ${plan.trialDays}`;
        // seatLimit is 0 on the paywall where the catalog leaves it undefined (one seat).
        if ((p.seatLimit || 0) !== (plan.seatLimit || 0)) return `${p.id}: seats ${p.seatLimit} vs catalog ${plan.seatLimit}`;
        return null;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  test('both descriptions of a consumer plan state the same facts', () => {
    const obSub = new Map((PLANS.individual as Array<Record<string, string>>).map((p) => [p.id, String(p.sub || '')]));
    const pwBlurb = new Map((CONSUMER_PLANS as Array<Record<string, string>>).map((p) => [p.id, String(p.blurb || '')]));
    const misses: string[] = [];
    for (const [id, facts] of Object.entries(CONSUMER_FACTS)) {
      for (const [where, text] of [['onboarding', obSub.get(id)], ['paywall', pwBlurb.get(id)]] as const) {
        if (text === undefined) { misses.push(`${where} never describes ${id}`); continue; }
        for (const f of facts) {
          if (!text.toLowerCase().includes(f.toLowerCase())) misses.push(`${where}:${id} never states "${f}"`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  test('consumer annual prices and per-month effective rates match the catalog', () => {
    for (const p of PLANS.individual as Array<Record<string, string>>) {
      const plan = PLAN_CATALOG.find((c) => c.id === p.id)!;
      expect(p.annual).toBe(formatPrice(plan.annual));
      expect(p.annualPer).toBe(formatPrice(Math.round((plan.annual / 12) * 100) / 100));
    }
  });
});
