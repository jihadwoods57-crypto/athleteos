/* Pure helper for the parent "Funded plans" list. Collapses the per-charge rows my_funded_plans
   returns into one plan per recurring subscription (newest charge wins, and drives cancel), while
   one-time purchases each stand alone. No DOM, no network — unit-tested in funded.test.mjs. */
/** "$45 / mo" for an offer row. One exported copy: fund-plan, my-trainer-offers and trainer-grow
    each carried their own, and all three mapped any UNKNOWN cadence to " / mo", which would
    price-label a future cadence as monthly, a money claim. An unrecognised cadence now names
    itself instead of pretending to be monthly. */
export function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time'
    : o.cadence === 'session' ? ' / session'
      : o.cadence === 'week' ? ' / wk'
        : o.cadence === 'month' ? ' / mo'
          : o.cadence ? ` / ${o.cadence}` : '';
  return `$${n}${per}`;
}

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
