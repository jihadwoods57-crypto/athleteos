/* Pure helper for the parent "Funded plans" list. Collapses the per-charge rows my_funded_plans
   returns into one plan per recurring subscription (newest charge wins, and drives cancel), while
   one-time purchases each stand alone. No DOM, no network — unit-tested in funded.test.mjs. */
export function groupFundedPlans(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  // newest first so the first row seen for a subscription is the one we keep
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const out = [];
  const seenSub = new Set();
  for (const r of list) {
    const recurring = r.cadence === 'month' || r.cadence === 'week';
    const sub = r.stripe_subscription_id || null;
    if (recurring && sub) {
      if (seenSub.has(sub)) continue;
      seenSub.add(sub);
    }
    out.push({
      key: (recurring && sub) ? sub : r.id,
      id: r.id,
      offer_name: r.offer_name || 'Package',
      child_name: r.child_name || '',
      amount_cents: r.amount_cents,
      cadence: r.cadence,
      recurring: !!(recurring && sub),
      cancelled: !!r.subscription_cancelled_at,
    });
  }
  return out;
}
