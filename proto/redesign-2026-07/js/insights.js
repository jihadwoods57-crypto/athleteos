/* OnStandard — Coach OS Slice E: team insights engine.
   PURE (no imports of state, no DOM, no fetch, no Date.now — callers pass todayISO/nowMs).
   `new Date(isoString)` parsing is fine; every date op below parses at UTC noon to dodge DST edges.
   Deterministic: same input -> deep-equal output, always.

   ATHLETE-LOCAL-DATE BLUR (inherited from 0076): rollup `day` is the athlete's device-local
   date; intervention `day` is coach-device-local. Both are treated here as plain calendar-day
   strings — a documented +/-1 day cross-timezone blur at week granularity, same trade the SQL
   layer already made. This engine never re-derives "today" from a row; todayISO is always the
   caller's own clock.

   SILENCE OVER NOISE (binding house rule): a metric with zero contributing data points emits
   no sentence at all rather than a hedge ("not enough data yet"). Concretely: weeklyBrief lines
   are simply omitted; weekVsMonth.text is '' ; interventionOutcomes.text/byKind are omitted
   while locked. Percentages are always rounded to whole numbers; no scoring formulas appear in
   any user-facing sentence; sentences use " * " or a comma, never an em dash (house style). */

// ---------------- date helpers (local, no external libs) ----------------

/** Add `n` days to an ISO date string, parsing at UTC noon to avoid DST edges. */
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole-day distance from `fromISO` to `toISO` (positive when to is later). */
function dayDiff(fromISO, toISO) {
  const a = new Date(`${fromISO}T12:00:00Z`).getTime();
  const b = new Date(`${toISO}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** 0=Sunday..6=Saturday, from an ISO date string, parsed at UTC noon. */
function dowOf(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Mirrors status.js's runsOn (that file stays import-free too, by the same house rule) —
 *  reproduced locally so insights.js never imports anything. daily -> every day; days:[..] ->
 *  dow must be in the list; weekly -> only its one day; unknown/missing freq -> always runs. */
function runsOnLocal(freq, dow) {
  if (!freq || !freq.type) return true;
  if (freq.type === 'daily') return true;
  if (freq.type === 'days') return Array.isArray(freq.days) && freq.days.includes(dow);
  if (freq.type === 'weekly') return freq.day === dow;
  return true;
}

function round1(n) { return Math.round(n * 10) / 10; }
function dirOf(delta) { return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'; }
function dirWord(delta) { return delta > 0 ? 'improved' : delta < 0 ? 'declined' : 'held steady'; }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

// ---------------- windows ----------------

/** This week = the 7 days ending today (inclusive); prev = the 7 before that; month = the
 *  28 days ending today (inclusive). All ISO strings, all derived from `todayISO` only. */
export function weekWindows(todayISO) {
  const thisTo = todayISO;
  const thisFrom = addDaysISO(todayISO, -6);
  const prevTo = addDaysISO(todayISO, -7);
  const prevFrom = addDaysISO(todayISO, -13);
  const monthFrom = addDaysISO(todayISO, -27);
  return { thisFrom, thisTo, prevFrom, prevTo, monthFrom };
}

function inWindow(day, from, to) { return day >= from && day <= to; }

// ---------------- weeklyBrief ----------------

/** A meal-kind requirement's per-day "done" signal is unreliable by req.id: custom sets map
 *  onto fixed physical slot keys (breakfast/lunch/dinner/meal-5/meal-6 — see requirements.js
 *  STD_SLOT_MAP), not the coach's arbitrary item id. So completion here is POSITIONAL: an
 *  athlete's Nth meal requirement (0-based index among their own meal-kind reqs) counts as
 *  logged once meals_logged exceeds that index. With no reqsByAthlete entry at all for an
 *  athlete, we fall back to a binary "logged-any" signal (meals_logged > 0) — a real signal,
 *  just a coarser one. */
function completionFraction(row, reqsByAthlete) {
  const reqs = (reqsByAthlete && reqsByAthlete[row.athlete_id]) || [];
  const mealReqs = reqs.filter(r => r && r.kind === 'meal');
  const logged = Number(row.meals_logged) || 0;
  if (mealReqs.length > 0) {
    const denom = mealReqs.length;
    return Math.min(logged, denom) / denom;
  }
  return logged > 0 ? 1 : 0;
}

function avgCompletionPct(rows, reqsByAthlete) {
  if (!rows.length) return { pct: 0, n: 0 };
  const fracs = rows.map(r => completionFraction(r, reqsByAthlete));
  return { pct: (fracs.reduce((a, b) => a + b, 0) / fracs.length) * 100, n: fracs.length };
}

function avgScore(rows) {
  const scored = rows.filter(r => r.score != null && !Number.isNaN(Number(r.score)));
  if (!scored.length) return { avg: 0, n: 0 };
  return { avg: scored.reduce((a, r) => a + Number(r.score), 0) / scored.length, n: scored.length };
}

function avgCheckinPct(rows) {
  if (!rows.length) return { pct: 0, n: 0 };
  const done = rows.filter(r => r.checkin_done === true).length;
  return { pct: (done / rows.length) * 100, n: rows.length };
}

/** `reqsByAthlete` is optional (not part of the caller-facing destructure in the brief's
 *  call shape, but harmless to pass — see completionFraction above for what it changes). */
export function weeklyBrief({ rollup = [], roster = [], todayISO, reqsByAthlete = {} }) {
  const { thisFrom, thisTo, prevFrom, prevTo } = weekWindows(todayISO);
  const thisRows = rollup.filter(r => inWindow(r.day, thisFrom, thisTo));
  const prevRows = rollup.filter(r => inWindow(r.day, prevFrom, prevTo));

  const lines = [];

  const compThis = avgCompletionPct(thisRows, reqsByAthlete);
  const compPrev = avgCompletionPct(prevRows, reqsByAthlete);
  if (compThis.n > 0 && compPrev.n > 0) {
    const delta = Math.round(compThis.pct - compPrev.pct);
    lines.push({ text: `Meal completion ${dirWord(delta)} ${Math.abs(delta)}% this week.`, dir: dirOf(delta) });
  }

  const scoreThis = avgScore(thisRows);
  const scorePrev = avgScore(prevRows);
  if (scoreThis.n > 0 && scorePrev.n > 0) {
    const delta = Math.round(scoreThis.avg - scorePrev.avg);
    lines.push({ text: `Average score ${dirWord(delta)} ${plural(Math.abs(delta), 'point')} this week.`, dir: dirOf(delta) });
  }

  const ciThis = avgCheckinPct(thisRows);
  const ciPrev = avgCheckinPct(prevRows);
  if (ciThis.n > 0 && ciPrev.n > 0) {
    const delta = Math.round(ciThis.pct - ciPrev.pct);
    lines.push({ text: `Check-in compliance ${dirWord(delta)} ${Math.abs(delta)}% this week.`, dir: dirOf(delta) });
  }

  const rooms = {};
  for (const r of roster) {
    if (!r || !r.athleteId) continue;
    const room = r.position || 'Unassigned';
    (rooms[room] = rooms[room] || []).push(r.athleteId);
  }
  const byRoom = [];
  for (const room of Object.keys(rooms)) {
    const ids = rooms[room];
    if (ids.length < 2) continue; // by-room lines only for rooms with >=2 athletes
    const idSet = new Set(ids);
    const roomThis = avgCompletionPct(thisRows.filter(r => idSet.has(r.athlete_id)), reqsByAthlete);
    const roomPrev = avgCompletionPct(prevRows.filter(r => idSet.has(r.athlete_id)), reqsByAthlete);
    if (roomThis.n === 0 || roomPrev.n === 0) continue;
    const delta = Math.round(roomThis.pct - roomPrev.pct);
    if (delta === 0) continue; // ... and a nonzero delta
    byRoom.push({
      room, completionDelta: delta,
      text: `Meal completion ${dirWord(delta)} ${Math.abs(delta)}% in the ${room} room this week.`,
    });
  }

  return { lines, byRoom };
}

// ---------------- athletesToWatch ----------------

/** Simple least-squares slope over (index, score) pairs in day order — the simplest
 *  deterministic trend line for a short (<=7 point) series; documented here since the brief
 *  left the exact formula unspecified. */
function linearSlope(points) {
  const n = points.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const [x, y] of points) { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function athletesToWatch({ rollup = [], roster = [], todayISO }) {
  const { thisFrom, thisTo } = weekWindows(todayISO);
  const nameOf = (id) => { const r = roster.find(x => x && x.athleteId === id); return (r && r.name) || id; };

  const byAthlete = {};
  for (const r of rollup) {
    if (!r || !r.athlete_id) continue;
    (byAthlete[r.athlete_id] = byAthlete[r.athlete_id] || []).push(r);
  }

  const decliners = [];
  for (const athleteId of Object.keys(byAthlete)) {
    const weekRows = byAthlete[athleteId]
      .filter(r => inWindow(r.day, thisFrom, thisTo) && r.score != null && !Number.isNaN(Number(r.score)))
      .slice()
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    if (weekRows.length < 3) continue; // >=3 scored days required
    const slope = linearSlope(weekRows.map((r, i) => [i, Number(r.score)]));
    if (slope < 0) {
      const s = round1(slope);
      decliners.push({
        athleteId, name: nameOf(athleteId), slope: s,
        text: `${nameOf(athleteId)}'s score is trending down this week, about ${Math.abs(s)} points/day.`,
      });
    }
  }
  decliners.sort((a, b) => a.slope - b.slope); // worst (most negative) first

  // Disengaging: consecutive no-data days ending today. Bounded by the earliest day present
  // anywhere in the supplied rollup, since a pure function has no other honest notion of
  // "how far back to look" — with zero rollup rows at all, there is nothing to compare
  // against and we emit nothing (silence over a guess).
  const disengaging = [];
  const allDays = rollup.map(r => r.day).filter(Boolean);
  if (allDays.length) {
    const minDay = allDays.reduce((a, b) => (a < b ? a : b));
    for (const r of roster) {
      if (!r || !r.athleteId) continue;
      const daySet = new Set((byAthlete[r.athleteId] || []).map(x => x.day));
      let gap = 0;
      let cursor = todayISO;
      while (cursor >= minDay && !daySet.has(cursor)) { gap++; cursor = addDaysISO(cursor, -1); }
      if (gap >= 3) {
        disengaging.push({ athleteId: r.athleteId, name: r.name || r.athleteId, gapDays: gap,
          text: `${r.name || r.athleteId} has no logged activity in ${gap} days.` });
      }
    }
  }
  disengaging.sort((a, b) => b.gapDays - a.gapDays);

  // recoverers is intentionally always empty here — the brief has interventionOutcomes()
  // own that computation (its avgLift >= +5 rule); the caller merges the two lists.
  return { decliners, disengaging, recoverers: [] };
}

// ---------------- mostMissed ----------------

/** Team-wide "most missed required item" for the current week. A day counts as "the athlete
 *  had data" simply by having a rollup row — team_day_rollup only returns rows joined off the
 *  `days` table, so a present row already IS the "any data" signal; there is no separate check.
 *  Per-kind done rule, using the fields 0076 actually gives us instead of guessing from ids:
 *   - kind 'weigh'   -> row.weight_logged
 *   - kind 'checkin' -> row.checkin_done
 *   - kind 'meal'    -> positional vs meals_logged (see completionFraction's comment above —
 *                       tasks_done carries physical slot keys, not the coach's req id)
 *   - anything else  -> tasks_done includes the req id directly
 *  Freq-gated: a requirement that doesn't run on that day's weekday (e.g. Mon/Wed/Fri weigh-in)
 *  is never counted as missed. */
export function mostMissed({ rollup = [], reqsByAthlete = {}, todayISO }) {
  const { thisFrom, thisTo } = weekWindows(todayISO);
  const rows = rollup.filter(r => r && r.athlete_id && inWindow(r.day, thisFrom, thisTo));

  const totals = {}; // reqId -> { title, missedCount }
  for (const row of rows) {
    const reqs = reqsByAthlete[row.athlete_id] || [];
    const mealReqs = reqs.filter(r => r && r.kind === 'meal');
    const dow = dowOf(row.day);
    const loggedMeals = Number(row.meals_logged) || 0;
    for (const req of reqs) {
      if (!req || !req.required) continue;
      if (!runsOnLocal(req.freq, dow)) continue;
      let done;
      if (req.kind === 'weigh') done = row.weight_logged === true;
      else if (req.kind === 'checkin') done = row.checkin_done === true;
      else if (req.kind === 'meal') done = loggedMeals > mealReqs.indexOf(req);
      else done = Array.isArray(row.tasks_done) && row.tasks_done.includes(req.id);

      if (!done) {
        if (!totals[req.id]) totals[req.id] = { title: req.title || req.id, missedCount: 0 };
        totals[req.id].missedCount++;
      }
    }
  }

  return Object.keys(totals)
    .map(reqId => ({ reqId, ...totals[reqId] }))
    .filter(x => x.missedCount > 0) // silence over noise
    .sort((a, b) => b.missedCount - a.missedCount)
    .map(x => ({
      reqId: x.reqId, title: x.title, missedCount: x.missedCount,
      text: `${x.title} was missed ${plural(x.missedCount, 'time')} across the team this week.`,
    }));
}

// ---------------- weekVsMonth ----------------

export function weekVsMonth({ rollup = [], todayISO }) {
  const { thisFrom, thisTo, monthFrom } = weekWindows(todayISO);
  const weekRows = rollup.filter(r => r.score != null && !Number.isNaN(Number(r.score)) && inWindow(r.day, thisFrom, thisTo));
  const monthRows = rollup.filter(r => r.score != null && !Number.isNaN(Number(r.score)) && inWindow(r.day, monthFrom, thisTo));

  if (!weekRows.length || !monthRows.length) return { weekAvg: null, monthAvg: null, text: '' };

  const weekAvg = Math.round(weekRows.reduce((a, r) => a + Number(r.score), 0) / weekRows.length);
  const monthAvg = Math.round(monthRows.reduce((a, r) => a + Number(r.score), 0) / monthRows.length);
  const delta = weekAvg - monthAvg;
  const text = delta === 0
    ? `This week's average score (${weekAvg}) matches the trailing 28-day average.`
    : `This week's average score (${weekAvg}) is ${delta > 0 ? 'above' : 'below'} the trailing 28-day average (${monthAvg}).`;
  return { weekAvg, monthAvg, text };
}

// ---------------- interventionOutcomes ----------------

/** Unlocks only when BOTH: the span from the earliest outcome `day` to todayISO is >=14 days,
 *  AND there are >=5 "qualifying" outcomes (days_before>0 && days_after>0, i.e. both windows
 *  actually have scored days to average — an outcome logged yesterday has an empty after-window
 *  and can't qualify yet). Locked state still carries `sinceISO` (earliest outcome day, or
 *  todayISO when there are no outcomes at all) so the empty-state copy can say something true
 *  ("since <date>, N interventions logged") without inventing a number. PostgREST numerics
 *  arrive as strings; every numeric field is Number()'d and NaN rows are dropped rather than
 *  corrupting an average. */
export function interventionOutcomes({ outcomes = [], roster = [], todayISO }) {
  const nameOf = (id) => { const r = roster.find(x => x && x.athleteId === id); return (r && r.name) || id; };

  const norm = outcomes
    .map(o => ({
      ...o,
      score_before: Number(o.score_before),
      score_after: Number(o.score_after),
      days_before: Number(o.days_before),
      days_after: Number(o.days_after),
    }))
    .filter(o => o.day && !Number.isNaN(o.days_before) && !Number.isNaN(o.days_after));

  const days = norm.map(o => o.day);
  const sinceISO = days.length ? days.reduce((a, b) => (a < b ? a : b)) : todayISO;
  const spanDays = days.length ? dayDiff(sinceISO, todayISO) : 0;

  const qualifying = norm.filter(o => o.days_before > 0 && o.days_after > 0
    && !Number.isNaN(o.score_before) && !Number.isNaN(o.score_after));

  const unlocked = spanDays >= 14 && qualifying.length >= 5;
  if (!unlocked) return { unlocked: false, sinceISO, recoverers: [] };

  const byKindMap = {};
  const byAthleteMap = {};
  for (const o of qualifying) {
    const lift = o.score_after - o.score_before;
    const kind = o.kind || 'unknown';
    (byKindMap[kind] = byKindMap[kind] || []).push(lift);
    (byAthleteMap[o.athlete_id] = byAthleteMap[o.athlete_id] || []).push(lift);
  }

  const byKind = Object.keys(byKindMap)
    .map(kind => ({ kind, n: byKindMap[kind].length, avgLift: round1(byKindMap[kind].reduce((a, b) => a + b, 0) / byKindMap[kind].length) }))
    .sort((a, b) => b.n - a.n);

  const recoverers = Object.keys(byAthleteMap)
    .map(athleteId => ({ athleteId, name: nameOf(athleteId), lift: round1(byAthleteMap[athleteId].reduce((a, b) => a + b, 0) / byAthleteMap[athleteId].length) }))
    .filter(r => r.lift >= 5)
    .sort((a, b) => b.lift - a.lift);

  const overallLift = round1(qualifying.reduce((a, o) => a + (o.score_after - o.score_before), 0) / qualifying.length);
  const text = `Since ${sinceISO}, ${plural(qualifying.length, 'intervention')} show an average lift of ${overallLift >= 0 ? '+' : ''}${overallLift} points.`;

  return { unlocked: true, sinceISO, text, byKind, recoverers };
}
