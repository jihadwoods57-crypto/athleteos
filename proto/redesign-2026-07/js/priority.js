/* Coach Priorities — PURE ranking engine (no imports/DOM/fetch/Date.now — callers pass nowMs): testable like status.js.
   The app ranks problems instead of painting every struggling athlete the same red.
   Deterministic: same inputs, same queue, every render — and testable, so "why is Devin #1" always has an answer.

   Mark-handled: every coach action (nudge/message/assign/handled) logs an intervention
   with this file's reasonKey. A card whose CURRENT signature already has an intervention
   today stays out of the queue; a genuinely new reason (extra overdue item, new tier)
   changes the signature and resurfaces the athlete. */

/* 'overdue' is one late item on an athlete who is otherwise active (2026-09-22). It used to share
   the 'due_soon' tier, so the card read "Due soon" beside its own reason line "Lunch overdue", and
   the nudge preset told the athlete their log was due soon when it was already late. Same rank
   slot as before, so the queue order does not move; only the name and the preset tell the truth. */
const TIER_RANK = { critical: 0, below: 1, overdue: 2, due_soon: 2 };

export function reasonKey(status) {
  const ids = (status.openItems || []).filter(i => i.state === 'overdue' || i.state === 'due_soon')
    .map(i => i.id).sort().join('+');
  return `${status.key}:${ids}`;
}

function tierOf(row, status, nowMs) {
  if (status.key === 'overdue' || status.key === 'no_activity') {
    const n = (status.openItems || []).filter(i => i.state === 'overdue').length;
    const stale = !row.loggedToday && (!row.lastMealAt || (nowMs != null && (nowMs - new Date(row.lastMealAt).getTime()) > 24 * 3600 * 1000));
    return (n >= 2 || (n >= 1 && stale) || status.key === 'no_activity') ? 'critical' : n >= 1 ? 'overdue' : 'due_soon';
  }
  if (status.key === 'below_standard' || status.key === 'needs_review') return 'below';
  if (status.key === 'due_soon') return 'due_soon';
  return null; // on_standard / excused — not a problem
}

function suggestion(tier, status) {
  if (tier === 'critical') return { kind: 'message', label: 'Send direct reminder' };
  if (tier === 'below') return { kind: 'review', label: 'Review the log' };
  if (tier === 'overdue') return { kind: 'nudge', label: 'Nudge' };
  if (status.key === 'due_soon') return { kind: 'nudge', label: 'Nudge' };
  return { kind: 'message', label: 'Check in' };
}

function reasons(row, status, nowMs) {
  const out = [];
  if (status.detail) out.push(status.detail);
  if (!row.loggedToday && row.lastMealAt) {
    if (nowMs != null) {
      const h = Math.floor((nowMs - new Date(row.lastMealAt).getTime()) / 3600000);
      if (h >= 12) out.push(`No activity for ${h >= 48 ? Math.floor(h / 24) + ' days' : h + ' hours'}`);
    }
  } else if (!row.loggedToday && !row.lastMealAt) {
    // Meals are read for 2 days, scores for 7 (review pass C-M2): an athlete quiet since Monday is
    // not "no activity on record". Their last scored day says so; the old line is kept for an
    // athlete with no history at all.
    const d = row.lastDayISO && /^\d{4}-\d{2}-\d{2}$/.test(row.lastDayISO) ? new Date(`${row.lastDayISO}T12:00:00`) : null;
    out.push(d && !isNaN(d.getTime()) ? `Last logged ${d.toLocaleDateString('en-US', { weekday: 'short' })}` : 'No activity on record');
  }
  return out;
}

/** entries: [{row, status}] (already scope-filtered). interventions: today's rows.
 *  nowMin is accepted but not consumed here — tiering only needs nowMs for staleness.
 *  Kept in the destructure (rather than dropped) so existing/future callers that pass it
 *  don't trip TS's excess-property check on the call-site object literal. */
export function buildPriorities({ nowMin, nowMs = /** @type {number | null} */ (null), entries, interventions }) {
  const acted = new Set((interventions || []).filter(i => i.reason_key).map(i => `${i.athlete_id}|${i.reason_key}`));
  const cards = [];
  for (const { row, status, shown } of (entries || [])) {
    // `shown`: the score the athlete's own Home shows (team-count.js shownScore), when passed.
    const score = shown !== undefined ? shown : row.score;
    const tier = tierOf(row, status, nowMs);
    if (!tier) continue;
    const key = reasonKey(status);
    if (acted.has(`${row.athleteId}|${key}`)) continue;
    const overdueN = (status.openItems || []).filter(i => i.state === 'overdue').length;
    cards.push({
      athleteId: row.athleteId, name: row.name, unit: row.unit || '',
      tier, statusKey: status.key, reasons: reasons(row, status, nowMs), detail: status.detail, score,
      suggestedAction: suggestion(tier, status), reasonKey: key,
      _sort: TIER_RANK[tier] * 1000 - overdueN * 10 - (score != null ? (100 - score) / 100 : 0.5),
    });
  }
  cards.sort((a, b) => a._sort - b._sort);
  return cards.map(({ _sort, ...c }) => c);
}
