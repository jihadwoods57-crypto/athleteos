/**
 * RevenueCat consumer-IAP mapping (the risky half of the webhook — the event->row projection).
 * Pure functions, imported straight from the edge function's shared module so the test locks the
 * exact logic the deployed webhook runs.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
import {
  planIdFromProduct, mapStore, ownerOf, rcEventToRow, HANDLED_RC_EVENTS,
  type RcEvent,
} from '../../supabase/functions/_shared/revenuecat';

const OWNER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NOW = '2026-07-21T00:00:00.000Z';

describe('planIdFromProduct', () => {
  it('maps the known store products to catalog plan ids', () => {
    expect(planIdFromProduct('onstandard_individual_annual')).toBe('individual');
    expect(planIdFromProduct('onstandard_individual_plus_monthly')).toBe('individual_plus');
    expect(planIdFromProduct('onstandard_family_annual')).toBe('family');
  });
  it('loose-matches a renamed/suffixed SKU, most specific first', () => {
    expect(planIdFromProduct('com.onstandard.individual_plus.annual.us')).toBe('individual_plus');
    expect(planIdFromProduct('com.onstandard.individual.monthly')).toBe('individual');
    expect(planIdFromProduct('com.onstandard.family.yearly')).toBe('family');
  });
  it('returns null for an unknown product (still a valid consumer plan, planId unknown)', () => {
    expect(planIdFromProduct('mystery_sku')).toBeNull();
    expect(planIdFromProduct(null)).toBeNull();
    expect(planIdFromProduct(undefined)).toBeNull();
  });
});

describe('mapStore', () => {
  it('normalizes the RC store enum', () => {
    expect(mapStore('APP_STORE')).toBe('app_store');
    expect(mapStore('MAC_APP_STORE')).toBe('app_store');
    expect(mapStore('PLAY_STORE')).toBe('play_store');
    expect(mapStore('STRIPE')).toBeNull();
    expect(mapStore(null)).toBeNull();
  });
});

describe('ownerOf (never guess)', () => {
  it('accepts a clean UUID from app_user_id or original_app_user_id', () => {
    expect(ownerOf({ app_user_id: OWNER })).toBe(OWNER);
    expect(ownerOf({ original_app_user_id: OWNER })).toBe(OWNER);
  });
  it('rejects anonymous/garbage ids', () => {
    expect(ownerOf({ app_user_id: '$RCAnonymousID:abc123' })).toBeNull();
    expect(ownerOf({ app_user_id: 'not-a-uuid' })).toBeNull();
    expect(ownerOf({})).toBeNull();
  });
});

describe('rcEventToRow', () => {
  const base: RcEvent = {
    app_user_id: OWNER, product_id: 'onstandard_individual_annual', store: 'APP_STORE',
    expiration_at_ms: 1786000000000,
  };

  it('INITIAL_PURCHASE / RENEWAL -> active consumer, ending flag off', () => {
    for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION']) {
      const r = rcEventToRow({ ...base, type }, NOW)!;
      expect(r.tier).toBe('consumer');
      expect(r.status).toBe('active');
      expect(r.cancel_at_period_end).toBe(false);
      expect(r.plan_id).toBe('individual');
      expect(r.store).toBe('app_store');
      expect(r.store_product_id).toBe('onstandard_individual_annual');
      expect(r.current_period_end).toBe(new Date(1786000000000).toISOString());
      expect(r.payment_failed_at).toBeNull();
    }
  });

  it('CANCELLATION keeps access but marks ending at period end', () => {
    const r = rcEventToRow({ ...base, type: 'CANCELLATION' }, NOW)!;
    expect(r.status).toBe('active');
    expect(r.tier).toBe('consumer');
    expect(r.cancel_at_period_end).toBe(true);
  });

  it('BILLING_ISSUE -> past_due with a dunning timestamp', () => {
    const r = rcEventToRow({ ...base, type: 'BILLING_ISSUE' }, NOW)!;
    expect(r.status).toBe('past_due');
    expect(r.tier).toBe('consumer');
    expect(r.payment_failed_at).toBe(NOW);
  });

  it('SUBSCRIPTION_PAUSED -> paused', () => {
    expect(rcEventToRow({ ...base, type: 'SUBSCRIPTION_PAUSED' }, NOW)!.status).toBe('paused');
  });

  it('EXPIRATION -> canceled, tier reverts to preview', () => {
    const r = rcEventToRow({ ...base, type: 'EXPIRATION' }, NOW)!;
    expect(r.status).toBe('canceled');
    expect(r.tier).toBe('preview');
    expect(r.cancel_at_period_end).toBe(false);
  });

  it('ignores event types we do not act on', () => {
    expect(rcEventToRow({ ...base, type: 'TEST' }, NOW)).toBeNull();
    expect(rcEventToRow({ ...base, type: 'TRANSFER' }, NOW)).toBeNull();
    expect(rcEventToRow({ ...base, type: '' }, NOW)).toBeNull();
    // the ones we DO handle are exactly the documented set
    expect(HANDLED_RC_EVENTS.has('INITIAL_PURCHASE')).toBe(true);
    expect(HANDLED_RC_EVENTS.has('TRANSFER')).toBe(false);
  });

  it('tolerates a missing expiration (lifetime / non-renewing) with a null period end', () => {
    const r = rcEventToRow({ ...base, type: 'INITIAL_PURCHASE', expiration_at_ms: null }, NOW)!;
    expect(r.current_period_end).toBeNull();
  });
});
