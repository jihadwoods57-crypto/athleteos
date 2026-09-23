/* Coach OS athlete statuses — PURE (no DOM, no fetch, no Date.now — callers pass nowMs; the one
   import is the dependency-free score-band.js): testable like notify-plan.js.
   One athlete → one status, precedence-ordered so the roster chip is never ambiguous:
   excused > overdue > needs_review > below_standard > due_soon > no_activity > on_standard.
   Every input is real data (day row, resolved requirement windows, exception rows) —
   an unknown score/window degrades to the safest honest answer, never an invented one. */
import { ON_STANDARD, tierColor } from './score-band.js';

/** @type {Record<string, { label: string, color: string }>} */
export const STATUS_META = {
  excused:        { label: 'Excused',        color: 'var(--text-3)' },
  overdue:        { label: 'Overdue',        color: 'var(--red)' },
  needs_review:   { label: 'Needs review',   color: 'var(--amber-bright)' },
  // Amber, not red (2026-09-22). Red means MISSED (overdue, nothing logged). An athlete who
  // logged every meal and scored 79 is below the bar, not absent, and was painted exactly like
  // one who logged nothing. Where a score is known, statusColor() narrows this to the tier.
  below_standard: { label: 'Below standard', color: 'var(--amber-bright)' },
  due_soon:       { label: 'Due soon',       color: 'var(--amber-bright)' },
  no_activity:    { label: 'No activity',    color: 'var(--text-3)' },
  on_standard:    { label: 'On standard',    color: 'var(--green-bright)' },
};
const DUE_SOON_MIN = 60;

/** The colour a status dot wears. Score-shaped statuses (below / on standard) take the score's
 *  TIER colour, so the dot, the number and the band header on one roster row agree. */
export function statusColor(status, score) {
  const key = status && status.key;
  const meta = STATUS_META[key];
  if ((key === 'below_standard' || key === 'on_standard') && score != null) return tierColor(score);
  return meta ? meta.color : 'var(--text-3)';
}

/** The words for a status: ONE word per state on every coach surface (2026-09-23 review pass).
 *  This used to narrow a below-standard day to its tier name ("Building"), so the same athlete
 *  read "Building" on the Roster, "Below standard" in Insights and "below the bar" in the Inbox.
 *  Tier names describe a SCORE (the tier chip beside a number); status words describe the
 *  athlete's DAY. `score` is still accepted so existing call sites need not change. */
export function statusLabel(status, _score) {
  const key = status && status.key;
  return STATUS_META[key] ? STATUS_META[key].label : '';
}

/* ---------------- The one team count ----------------
   Home's legend, the Inbox briefing, Insights' read and the Roster's chips all print "how many are
   in each state". Each used to count for itself (the Inbox from raw scores, a since-deleted
   Copilot from roster flags), so one team read "1 need attention · 2 overdue" on Home and
   "2 below the bar" in the Inbox at the same moment. Every surface reads teamCounts() now. */

/** The buckets a coach sees, in display order. `statuses` are STATUS_META keys; `cls` is the
 *  .dot / .seg accent. "need attention" is the one bucket that adds several statuses up. */
export const COUNT_BUCKETS = [
  { key: 'onStandard', cls: 'g', label: 'on standard', statuses: ['on_standard'] },
  { key: 'attention', cls: 'a', label: 'need attention', statuses: ['due_soon', 'below_standard', 'needs_review'] },
  { key: 'overdue', cls: 'r', label: 'overdue', statuses: ['overdue'] },
  { key: 'noActivity', cls: 'd', label: 'no activity', statuses: ['no_activity'] },
  { key: 'excused', cls: 'd', label: 'excused', statuses: ['excused'] },
];

/** Required items that are due by now (or already done), and how many are in, for ONE athlete.
 *  Counted from the athlete's STANDARD, never from whichever `tasks` rows happen to exist: an
 *  athlete with no day row still owes every item whose deadline has passed, and that is exactly
 *  the missed work the old row-sum made disappear (review pass C-M1).
 *  - an item not yet due and not done is not counted at all (it is not owed yet);
 *  - an item done early counts on both sides (it is in);
 *  - an off-schedule item never counts (runsOn);
 *  - on a day row whose `tasks` cannot prove anything (legacy / pre-writer), a non-meal item that
 *    is not proven done is UNKNOWN and left out of both sides, the same guard openItems uses. */
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

/** THE team count. `entries` are coach-data entriesFor() rows: { row, status, reqs?, nowMin?,
 *  nowDow? }. Excused athletes are counted as excused and left out of the requirement totals. */
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

/** Pure mirror of requirements.js `runsToday` — status.js stays free of app-state imports (no
 *  DOM, no fetch; only the leaf score-band.js), so the schedule semantics are reproduced here
 *  rather than imported.
 *  daily -> every day; days:[1,3,5] -> dow must be in the list; weekly -> only its one day.
 *  (exec.js additionally hard-excludes id 'weekly' from its own day filter because the
 *  Action Hub renders weekly check-in as a separate Sunday-only nav row outside that engine —
 *  the coach roster has no such separate surface, so here weekly simply falls out of the
 *  normal weekly rule below: due only on its scheduled day, never a phantom overdue any other day.)
 * @param {{ freq?: { type: string, days?: number[], day?: number } }} req
 * @param {number} dow 0=Sunday..6=Saturday
 */
export function runsOn(req, dow) {
  const f = req && req.freq;
  if (!f || !f.type) return true;
  if (f.type === 'daily') return true;
  if (f.type === 'days') return Array.isArray(f.days) && f.days.includes(dow);
  if (f.type === 'weekly') return f.day === dow;
  return true; // unknown freq shape (e.g. a coach-assigned 'once' task) — never phantom-hide it
}

/** Open required items with their due state at `nowMin`. Done-ness comes from day.tasks.
 *  `nowDow` (0-6), when supplied, gates each item by its schedule first — an off-day
 *  requirement (e.g. Tue/Thu/Sat for an MWF weigh-in) never enters the list at all. */
/** True when this row's `tasks` were written by a tasks-aware PROTO client, and therefore mean
 *  something. Ported from insights.js protoTasksAware(), which has guarded its own miss counts
 *  this way from the start: a legacy RN row carries NUMERIC task ids, and a pre-writer row carries
 *  none. Neither can prove an item was skipped, and status.js used to treat both as proof. */
function tasksTrustworthy(row) {
  const tasks = Array.isArray(row && row.tasks) ? row.tasks : [];
  return tasks.some((t) => t && t.id != null && !/^\d+$/.test(String(t.id)));
}

/** A photo-proof requirement is a meal slot, and days.meals is the map that actually records it. */
const isMealSlot = (r) => r && r.proof === 'photo';

function openItems(nowMin, row, reqs, nowDow) {
  const doneById = {};
  for (const t of (row.tasks || [])) if (t && t.done) doneById[t.id] = true;
  // The same slot map scoring and the coach's own profile screen read. null when the caller did
  // not fetch it (older callers), which means meals fall back to `tasks` like everything else.
  const meals = (row && row.meals && typeof row.meals === 'object') ? row.meals : null;
  const trusted = tasksTrustworthy(row);
  const out = [];
  for (const r of (reqs || [])) {
    if (!r || !r.required || doneById[r.id]) continue;
    if (nowDow != null && !runsOn(r, nowDow)) continue;
    // Logged, per the map that records meals. This is the line that stops a fully-logged day from
    // reading as three missed meals when days.tasks happens to be empty.
    if (meals && meals[r.id]) continue;
    // The guard is scoped to a row that SHOWS ACTIVITY, and the distinction is the whole point.
    // loggedToday false means there is no day row at all: nothing was logged, every required
    // window is honestly missed, and that alert is exactly what this feature is for. But once a
    // day row exists we know the athlete logged something, and an empty or numeric-id'd `tasks`
    // then proves nothing about WHICH items they skipped. Claiming specific ones is fabrication,
    // and it is what put three false "missed" notifications on a coach's lock screen for a day
    // with all three meals in.
    if (row.loggedToday && !trusted && !(meals && isMealSlot(r))) continue;
    const due = r.window && typeof r.window.due === 'number' ? r.window.due : null;
    const open = r.window && typeof r.window.open === 'number' ? r.window.open : 0;
    // Grace mirrors the athlete's OWN day engine (day.js slotGrace): a meal logged within
    // deadline+grace still counts on-time, so the coach must not flip an athlete to "overdue"
    // while that grace window is still open — inside it the item reads "due_soon" (closing), not
    // overdue. catalogFromItems carries each configured item's grace; the built-in CATALOG and
    // every shipped standard are 0, so a grace-free team stays byte-identical to before.
    const grace = typeof r.grace === 'number' && r.grace > 0 ? r.grace : 0;
    let state = 'ready';
    if (due != null && nowMin > due + grace) state = 'overdue';
    else if (due != null && nowMin >= due - DUE_SOON_MIN && nowMin >= open) state = 'due_soon';
    else if (nowMin < open) state = 'upcoming';
    out.push({ id: r.id, title: r.title || r.id, dueMin: due, state });
  }
  return out;
}

/** true when the latest meal is older than 24h AND nothing is logged today. */
function noActivity24h(row, nowMs) {
  if (row.loggedToday) return false;
  if (!row.lastMealAt) return true;
  if (!nowMs) return false;
  return (nowMs - new Date(row.lastMealAt).getTime()) > 24 * 3600 * 1000;
}

/** Grammatical join for the overdue-detail sentence: 1 item -> "a"; 2 -> "a and b" (byte-identical
 *  to the old two-item output); 3+ -> Oxford-style "a, b and c" instead of "a and b and c". */
function joinTitles(titles) {
  if (titles.length <= 2) return titles.join(' and ');
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

/* nowDow (0=Sunday..6=Saturday), when passed, gates every open item by its own schedule first —
   off-schedule requirements (e.g. a Mon/Wed/Fri weigh-in on a Thursday) never read as overdue.
   Left null/undefined only for backward test compat with pre-schedule callers; every real
   caller must pass it. */
export function athleteStatus({ nowMin, nowMs = /** @type {number | null} */ (null), row, reqs, excused, needsReview = false, nowDow = /** @type {number | null} */ (null) }) {
  const items = openItems(nowMin, row, reqs, nowDow);
  const overdue = items.filter(i => i.state === 'overdue');
  const dueSoon = items.filter(i => i.state === 'due_soon');
  const mk = (key, detail) => ({ key, label: STATUS_META[key].label, detail, openItems: items });
  if (excused) return mk('excused', 'Excused today');
  if (overdue.length) return mk('overdue', `${joinTitles(overdue.map(i => i.title))} overdue`);
  if (needsReview) return mk('needs_review', 'A log is waiting on your review');
  if (row.loggedToday && row.score != null && row.score < ON_STANDARD) return mk('below_standard', `Scored ${row.score} today`);
  if (dueSoon.length) {
    const next = dueSoon.reduce((a, b) => (a.dueMin ?? 9999) <= (b.dueMin ?? 9999) ? a : b);
    return mk('due_soon', `${next.title} window closes in ${Math.max(0, (next.dueMin ?? nowMin) - nowMin)} minutes`);
  }
  if (noActivity24h(row, nowMs)) return mk('no_activity', 'No activity in the last day');
  // needs_review is deliberately emitted from two precedence positions: the explicit
  // `needsReview` flag above (a flagged/reviewed log) and here (a log landed but the score
  // hasn't resolved yet) — both are honestly "needs a human", just different reasons why.
  if (row.loggedToday && row.score == null) return mk('needs_review', 'Logged today · score pending');
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
    // The counts behind that ratio. A percentage alone cannot be read honestly here: an athlete
    // with no requirements at all contributes to NEITHER side, so a roster with one unactivated
    // athlete and three finished ones reads "100% done today" directly above "1 overdue".
    // The coach surface prints "N of M requirements in" instead, which cannot contradict the
    // standing bar because it is counting a different, named thing.
    tasksDone: done,
    tasksTotal: total,
  };
}
