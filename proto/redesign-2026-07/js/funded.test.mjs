import assert from 'node:assert';
import { groupFundedPlans } from './funded.js';

// two charges of one monthly subscription collapse to a single active plan
const monthly = groupFundedPlans([
  { id: 'b', offer_name: 'Full', child_name: 'Sam', amount_cents: 15000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_1', subscription_cancelled_at: null, created_at: '2026-07-02T00:00:00Z' },
  { id: 'a', offer_name: 'Full', child_name: 'Sam', amount_cents: 15000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_1', subscription_cancelled_at: null, created_at: '2026-06-02T00:00:00Z' },
]);
assert.strictEqual(monthly.length, 1);
assert.strictEqual(monthly[0].recurring, true);
assert.strictEqual(monthly[0].cancelled, false);
assert.strictEqual(monthly[0].id, 'b'); // newest row drives cancel

// a cancelled subscription is reported cancelled
const cancelled = groupFundedPlans([
  { id: 'c', offer_name: 'Light', child_name: 'Sam', amount_cents: 5000, cadence: 'month', status: 'paid', stripe_subscription_id: 'sub_2', subscription_cancelled_at: '2026-07-10T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
]);
assert.strictEqual(cancelled[0].cancelled, true);

// one-time purchases each stand alone and are never recurring
const oneTime = groupFundedPlans([
  { id: 'd', offer_name: 'Review', child_name: 'Sam', amount_cents: 7500, cadence: 'session', status: 'paid', stripe_subscription_id: null, subscription_cancelled_at: null, created_at: '2026-07-05T00:00:00Z' },
  { id: 'e', offer_name: 'Review', child_name: 'Sam', amount_cents: 7500, cadence: 'session', status: 'paid', stripe_subscription_id: null, subscription_cancelled_at: null, created_at: '2026-07-06T00:00:00Z' },
]);
assert.strictEqual(oneTime.length, 2);
assert.strictEqual(oneTime[0].recurring, false);

console.log('groupFundedPlans: all assertions passed');
