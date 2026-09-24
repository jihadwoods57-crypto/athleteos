/* The coach's roster, projected onto each athlete's OWN today (coach score truth, 2026-09-24).

   Lazy on purpose: only loadCoachRoster / loadTrainerBook (roles.js) reach it, through a dynamic
   import, so none of this is parsed on an athlete's launch (boot-closure ratchet).

   Two rules the old projection (roles.js, until 2026-09-24) broke:
     1. "Today" is the ATHLETE's date, from their profile timezone (0088), falling back to this
        device's date. The coach's clock picked the day row before, so an athlete three zones
        west could have their yesterday matched as today, or their today dropped.
     2. "Yesterday" is exactly the day before that today. The group's "vs yesterday" used the
        last scored day before today instead, which could be last week.

   The score itself is never recomputed here. days.score is the number the athlete's own device
   computes and writes (day.js pushDay: clampedScore(DAY)), and since 2026-09-24 it is also the
   exact number the athlete's Home shows (state.js S.score), by the same function. Recomputing it
   from the row on the coach's device would be a SECOND computation from fewer inputs: the row
   does not carry the athlete's check-in configuration, Trust Pass credits or style knobs, and
   the prod day behind this fix (Jihad Woods, 2026-09-24) rescored to 61 against the stored 57. */
import { buildRosterRow } from './roles.js';
import { addDaysISO } from './day.js';

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for `nowMs` in the IANA zone `tz`; this device's own date when `tz` is absent or
 *  unknown to the engine. */
export function localDayISO(tz, nowMs = Date.now()) {
  if (tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(nowMs));
      const v = (t) => (p.find((x) => x.type === t) || {}).value;
      if (v('year') && v('month') && v('day')) return `${v('year')}-${v('month')}-${v('day')}`;
    } catch { /* an unknown zone falls through to the device date */ }
  }
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** PURE projection shared by both books: members + day rows + recent meals + timezones → sorted UI
 *  rows. No fetches, so each loader keeps its own parallelism. A coach's team book and a trainer's
 *  practice book differ only in which RPC produced `perBook`; every downstream engine (status,
 *  priority, inbox) then reads the same row shape. Each row also carries `dayISO` (the athlete's
 *  today it was matched on) and `yesterdayScore` (that athlete's final score for the day before,
 *  or null). */
export function projectRows(perBook, days, recentMeals, tzByAthlete, nowMs = Date.now()) {
  const byDate = {}, histByAthlete = {}, lastMealBy = {};
  for (const d of (days || [])) {
    (byDate[d.athlete_id] = byDate[d.athlete_id] || {})[d.date] = d;
    (histByAthlete[d.athlete_id] = histByAthlete[d.athlete_id] || []).push({ date: d.date, score: d.score });
  }
  for (const h of Object.values(histByAthlete)) h.sort((a, b) => a.date < b.date ? -1 : 1);
  for (const m of (recentMeals || [])) {
    if (!lastMealBy[m.athlete_id] || m.logged_at > lastMealBy[m.athlete_id]) lastMealBy[m.athlete_id] = m.logged_at;
  }
  const seen = new Set(); const rows = [];
  for (const members of perBook) {
    for (const m of members) {
      if (seen.has(m.athlete_id)) continue; seen.add(m.athlete_id);
      const tz = (tzByAthlete || {})[m.athlete_id] || null;
      const today = localDayISO(tz, nowMs);
      const mine = byDate[m.athlete_id] || {};
      const y = mine[addDaysISO(today, -1)];
      rows.push({
        ...buildRosterRow(m, mine[today], {
          scoreHistory: histByAthlete[m.athlete_id] || [],
          lastMealAt: lastMealBy[m.athlete_id] || null,
          timezone: tz,
        }),
        dayISO: today,
        yesterdayScore: y && y.score != null ? y.score : null,
      });
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return rows;
}
