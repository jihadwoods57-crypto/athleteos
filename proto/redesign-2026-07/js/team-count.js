/* The one team count (review pass 2026-09-23, C-M1 / C-M3; DESIGN.md "one count, one word").
   Home, the Inbox, Insights and the Roster all read teamCounts(), so their numbers cannot disagree.
   Its own module, off status.js, because only the lazily loaded coach screens need it: status.js
   sits in the eager boot graph. PURE, like status.js. */
import { STATUS_META, runsOn, tasksTrustworthy, isMealSlot } from './status.js';
import { tierFor, ON_STANDARD } from './score-band.js';
import { dateKey } from './fmt-date.js';
import { localDayISO } from './roster-day.js';

/* Buckets in display order; `cls` is the .dot / .seg accent. */
export const COUNT_BUCKETS = [
  { key: 'onStandard', cls: 'g', label: 'on standard', statuses: ['on_standard'] },
  { key: 'inProgress', cls: 'b', label: 'in progress', statuses: ['in_progress'] },
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
  // The score each athlete's own Home shows right now (shownScore), so "N scored" and the group
  // average never count a number the athlete is not looking at.
  const shown = list.map((e) => shownScore(e)).filter((v) => v != null);
  out.scored = shown.length;
  out.avg = shown.length ? Math.round(shown.reduce((a, v) => a + v, 0) / shown.length) : null;
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

/* ---------------- where each athlete's day stands (coach score truth, 2026-09-24) ----------------
   The athlete's Home and the coach read ONE number per athlete: days.score, which the athlete's
   own device writes with the same function its Home ring draws (state.js S.score). What differs by
   time of day is not the number but whether it can be COMPARED yet, and whether the ring shows a
   digit at all. Both rules below are the athlete Home's own, restated over a roster row. */

/** `done`: required items in today. `settled`: no required window is still open on time — every
 *  required, windowed item is in or past its close (+grace). The coach twin of dayverdict.js
 *  dayDecided, the rule the athlete's Home uses before it shows any verdict or delta. An item
 *  with no window (a coach task) never holds the day open, exactly as there. */
export function dayStanding({ nowMin, nowDow = null, row, reqs }) {
  const doneById = {};
  for (const t of ((row && row.tasks) || [])) if (t && t.done) doneById[t.id] = true;
  const meals = (row && row.meals && typeof row.meals === 'object') ? row.meals : null;
  let done = 0, open = 0;
  for (const r of (reqs || [])) {
    if (!r || !r.required) continue;
    if (nowDow != null && !runsOn(r, nowDow)) continue;
    if (doneById[r.id] || (meals && meals[r.id])) { done++; continue; }
    const w = r.window;
    if (!w || typeof w.due !== 'number') continue;
    const grace = typeof w.grace === 'number' ? w.grace : (typeof r.grace === 'number' ? r.grace : 0);
    if (nowMin <= w.due + Math.max(0, grace)) open++;
  }
  return { done, settled: open === 0 };
}

/** The score this athlete's Home shows right now, or null where it shows none:
 *   - no day row today, or a row matched on a day that has since ended for them (their midnight
 *     passed since the roster loaded): yesterday's number is never today's;
 *   - nothing required is in yet on a live day and the number is still in the red band: the
 *     athlete's ring shows "not started" (home.js liveHero `notStarted`), not a digit. This is
 *     the roll-call morning, where an on-time wake-up alone writes a real 8.
 *  `e` is an entriesFor() entry. */
export function shownScore(e, nowMs = Date.now()) {
  const row = e && e.row;
  if (!row || row.score == null) return null;
  if (row.dayISO && row.dayISO !== localDayISO(row.timezone, nowMs)) return null;
  const s = dayStanding(e);
  return (!s.settled && !s.done && tierFor(row.score).cls === 'r') ? null : row.score;
}

/** The group score and its "vs yesterday", like for like.
 *  avg:       mean of shownScore over the entries (the ring).
 *  yesterday: mean of the same entries' final scores for their own yesterday (a label).
 *  delta:     only once every athlete counted today is SETTLED (or excused), and only over the
 *             athletes with a score on BOTH days. A 12:13 PM average against a finished
 *             yesterday read "down 28" because dinner had not happened yet (founder, 2026-09-24).
 *             Settled days compare finished windows with finished windows. */
export function groupPulse(entries, nowMs = Date.now()) {
  const list = (entries || []).filter((e) => e && e.row);
  const mean = (a) => Math.round(a.reduce((x, v) => x + v, 0) / a.length);
  const today = list.map((e) => ({ e, s: shownScore(e, nowMs) })).filter((x) => x.s != null);
  // Yesterday over the SAME athletes the ring averages; before anyone has a score today (the
  // ring is not started) it is the whole group's yesterday, labelled as such.
  const ys = (today.length ? today.map((x) => x.e) : list).map((e) => e.row.yesterdayScore).filter((v) => v != null);
  const settled = today.length > 0
    && today.every(({ e }) => (e.status && e.status.key === 'excused') || dayStanding(e).settled);
  const pairs = today.filter(({ e }) => e.row.yesterdayScore != null);
  return {
    avg: today.length ? mean(today.map((x) => x.s)) : null,
    scored: today.length,
    yesterday: ys.length ? mean(ys) : null,
    settled,
    delta: settled && pairs.length
      ? mean(pairs.map((x) => x.s)) - mean(pairs.map((x) => x.e.row.yesterdayScore)) : null,
  };
}

/* ---------- Trust Pass milestone (0196; moved from coach-data.js, off the boot graph): who just earned a reward, from data already loaded ---
   `row.scoreHistory` is what buildRosterRow already carries — up to 7 days back plus today, the
   same window loadCoachRoster/loadTrainerBook fetch for the sparkline. No new query. */

/** Consecutive on-standard (score >= 80) days ending at the most recent entry in scoreHistory.
 *  Counting BACKWARD from the newest row and stopping at the first gap or sub-80 score means the
 *  result is a LOWER BOUND on the athlete's real streak, never an inflated one: a streak that
 *  started before this 7-day window is real but invisible here, and this function only ever
 *  under-counts, so a milestone that fires is always true.
 *
 *  A day with no ROW at all (never logged) must break the chain exactly like a sub-80 score does
 *  — "absent days count as misses" is the same rule the streak screen states outright, and a
 *  version of this that just skipped a gap in the dates would count two Tuesdays a week apart as
 *  adjacent. So each older row is required to be exactly one calendar day before the one after
 *  it; anything else ends the count right there. */
export function consecutiveOnStandard(scoreHistory) {
  const rows = (scoreHistory || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  let n = 0;
  let expected = null;
  for (const r of rows) {
    if (!r || typeof r.score !== 'number' || r.score < ON_STANDARD) break;
    if (expected !== null && r.date !== expected) break;
    n++;
    const d = new Date(r.date + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    expected = dateKey(d);
  }
  return n;
}

/** Clients who just crossed the reward milestone and hold no active pass, ranked by streak length
 *  (the athlete closest to earning a moment gets it). `passes` is the map fetchRosterPasses
 *  already returns for the roster's own trust-pass section.
 *
 *  `minStreak` default is 5, NOT the 14 days floated at design time — the roster fetch carries at
 *  most ~8 days of scoreHistory (7 back + today), so a 14-day threshold could never fire on data
 *  this screen actually has. 5 is the largest number the current window can prove without lying.
 *  Widening this needs widening the roster's own date fetch (roles.js loadCoachRoster /
 *  loadTrainerBook), which is a real product decision, not a default to guess past. */
export function passWorthy(rows, passesMap, minStreak = 5) {
  return (rows || [])
    .map((r) => ({ row: r, streak: consecutiveOnStandard(r.scoreHistory) }))
    .filter((x) => x.streak >= minStreak && !(passesMap || {})[x.row.athleteId])
    .sort((a, b) => b.streak - a.streak);
}
