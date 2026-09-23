/* The one team count (review pass 2026-09-23, C-M1 / C-M3; DESIGN.md "one count, one word").
   Home, the Inbox, Insights and the Roster all read teamCounts(), so their numbers cannot disagree.
   Its own module, off status.js, because only the lazily loaded coach screens need it: status.js
   sits in the eager boot graph. PURE, like status.js. */
import { STATUS_META, runsOn, tasksTrustworthy, isMealSlot } from './status.js';

/* Buckets in display order; `cls` is the .dot / .seg accent. */
export const COUNT_BUCKETS = [
  { key: 'onStandard', cls: 'g', label: 'on standard', statuses: ['on_standard'] },
  { key: 'attention', cls: 'a', label: 'need attention', one: 'needs attention', statuses: ['due_soon', 'below_standard', 'needs_review'] },
  { key: 'overdue', cls: 'r', label: 'overdue', statuses: ['overdue'] },
  { key: 'noActivity', cls: 'd', label: 'no activity', statuses: ['no_activity'] },
  { key: 'excused', cls: 'd', label: 'excused', statuses: ['excused'] },
];

/** The bucket's words for a count: "1 needs attention", "2 need attention". */
export const bucketLabel = (b, n) => (n === 1 && b.one ? b.one : b.label);

/** Required items due by now (or done early) and how many are in, for ONE athlete, from the
 *  STANDARD, not the rows that exist (C-M1). An unprovable non-meal item on a legacy row is left
 *  out of both sides, the same guard openItems uses. */
export function requirementsDue({ nowMin, nowDow = null, row, reqs }) {
  const doneById = {};
  for (const t of ((row && row.tasks) || [])) if (t && t.done) doneById[t.id] = true;
  const meals = (row && row.meals && typeof row.meals === 'object') ? row.meals : null;
  const trusted = tasksTrustworthy(row);
  let due = 0, done = 0;
  for (const r of (reqs || [])) {
    if (!r || !r.required) continue;
    if (nowDow != null && !runsOn(r, nowDow)) continue;
    const isDone = !!(doneById[r.id] || (meals && meals[r.id]));
    const d = r.window && typeof r.window.due === 'number' ? r.window.due : null;
    const grace = typeof r.grace === 'number' && r.grace > 0 ? r.grace : 0;
    const pastDue = d != null && nowMin > d + grace;
    if (!isDone && !pastDue) continue;
    if (!isDone && row && row.loggedToday && !trusted && !(meals && isMealSlot(r))) continue;
    due++;
    if (isDone) done++;
  }
  return { due, done };
}

/** `entries` are entriesFor() rows; excused athletes stay out of the requirement totals. */
export function teamCounts(entries) {
  const list = entries || [];
  const byStatus = {};
  for (const k of Object.keys(STATUS_META)) byStatus[k] = 0;
  for (const e of list) { const k = e && e.status && e.status.key; if (k in byStatus) byStatus[k]++; }
  const out = { total: list.length, byStatus };
  for (const b of COUNT_BUCKETS) out[b.key] = b.statuses.reduce((n, k) => n + (byStatus[k] || 0), 0);
  const scoredRows = list.filter(e => e && e.row && e.row.score != null);
  out.scored = scoredRows.length;
  out.avg = scoredRows.length ? Math.round(scoredRows.reduce((a, e) => a + e.row.score, 0) / scoredRows.length) : null;
  let reqDue = 0, reqDone = 0;
  for (const e of list) {
    if (!e || !e.row || (e.status && e.status.key === 'excused') || !Array.isArray(e.reqs)) continue;
    const t = requirementsDue({ nowMin: e.nowMin, nowDow: e.nowDow, row: e.row, reqs: e.reqs });
    reqDue += t.due; reqDone += t.done;
  }
  out.reqDue = reqDue;
  out.reqDone = reqDone;
  return out;
}
