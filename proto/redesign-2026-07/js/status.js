/* Coach OS athlete statuses — PURE (no imports, no DOM, no fetch): testable like notify-plan.js.
   One athlete → one status, precedence-ordered so the roster chip is never ambiguous:
   excused > overdue > needs_review > below_standard > due_soon > no_activity > on_standard.
   Every input is real data (day row, resolved requirement windows, exception rows) —
   an unknown score/window degrades to the safest honest answer, never an invented one. */

export const STATUS_META = {
  excused:        { label: 'Excused',        color: 'var(--text-3)' },
  overdue:        { label: 'Overdue',        color: 'var(--red)' },
  needs_review:   { label: 'Needs review',   color: 'var(--amber-bright)' },
  below_standard: { label: 'Below standard', color: 'var(--red)' },
  due_soon:       { label: 'Due soon',       color: 'var(--amber-bright)' },
  no_activity:    { label: 'No activity',    color: 'var(--red)' },
  on_standard:    { label: 'On standard',    color: 'var(--green-bright)' },
};
const DUE_SOON_MIN = 60;

/** Open required items with their due state at `nowMin`. Done-ness comes from day.tasks. */
function openItems(nowMin, row, reqs) {
  const doneById = {};
  for (const t of (row.tasks || [])) if (t && t.done) doneById[t.id] = true;
  const out = [];
  for (const r of (reqs || [])) {
    if (!r || !r.required || doneById[r.id]) continue;
    const due = r.window && typeof r.window.due === 'number' ? r.window.due : null;
    const open = r.window && typeof r.window.open === 'number' ? r.window.open : 0;
    let state = 'ready';
    if (due != null && nowMin > due) state = 'overdue';
    else if (due != null && nowMin >= due - DUE_SOON_MIN && nowMin >= open) state = 'due_soon';
    else if (nowMin < open) state = 'upcoming';
    out.push({ id: r.id, title: r.title || r.id, dueMin: due, state });
  }
  return out;
}

/** true when the latest meal is older than 24h AND nothing is logged today. */
function noActivity24h(row) {
  if (row.loggedToday) return false;
  if (!row.lastMealAt) return true;
  return (Date.now() - new Date(row.lastMealAt).getTime()) > 24 * 3600 * 1000;
}

export function athleteStatus({ nowMin, row, reqs, excused, needsReview }) {
  const items = openItems(nowMin, row, reqs);
  const overdue = items.filter(i => i.state === 'overdue');
  const dueSoon = items.filter(i => i.state === 'due_soon');
  const mk = (key, detail) => ({ key, label: STATUS_META[key].label, detail, openItems: items });
  if (excused) return mk('excused', 'Excused today');
  if (overdue.length) return mk('overdue', `${overdue.map(i => i.title).join(' and ')} overdue`);
  if (needsReview) return mk('needs_review', 'A log is waiting on your review');
  if (row.loggedToday && row.score != null && row.score < 80) return mk('below_standard', `Scored ${row.score} today`);
  if (dueSoon.length) {
    const next = dueSoon.reduce((a, b) => (a.dueMin ?? 9999) <= (b.dueMin ?? 9999) ? a : b);
    return mk('due_soon', `${next.title} window closes in ${Math.max(0, (next.dueMin ?? nowMin) - nowMin)} minutes`);
  }
  if (noActivity24h(row)) return mk('no_activity', 'No activity in the last day');
  if (row.loggedToday) return mk('on_standard', 'On standard today');
  return mk('no_activity', 'Nothing logged yet today');
}

/** Aggregate pulse over VISIBLE (scope-filtered) rows. dateISO = today, for the delta. */
export function teamPulse(rows, statuses, dateISO) {
  const scored = rows.filter(r => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  let ySum = 0, yN = 0;
  for (const r of rows) {
    const h = (r.scoreHistory || []).filter(x => x.date < dateISO && x.score != null);
    if (h.length) { ySum += h[h.length - 1].score; yN++; }
  }
  const yAvg = yN ? Math.round(ySum / yN) : null;
  let done = 0, total = 0;
  for (const r of rows) for (const t of (r.tasks || [])) { total++; if (t && t.done) done++; }
  const count = (k) => rows.filter(r => statuses[r.athleteId] && statuses[r.athleteId].key === k).length;
  return {
    avg,
    deltaVsYesterday: (avg != null && yAvg != null) ? avg - yAvg : null,
    onStandard: count('on_standard'),
    dueSoon: count('due_soon'),
    overdue: count('overdue') + count('no_activity'),
    completionPct: total ? Math.round((done / total) * 100) : null,
  };
}
