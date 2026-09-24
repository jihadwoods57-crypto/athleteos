/* The athlete's record read off the CALENDAR (Progress cleanup, 2026-09-23). The old reading took
 * the last seven ROWS, so a day with no log vanished and today's open score sat in the average
 * (a 90 athlete at 9am read "71, -17 vs prior week"). Here: the week is seven calendar days ending
 * today; a day before the start is blank, a finished day with no score is MISSED, today is open.
 * COUNTED days are every finished day since the start plus today once it reached 80. The average
 * is over counted days that were logged; misses are counted, not averaged in as zeros.
 * Nothing before the earliest fetched row is known (history is a ~60-day window, day.js
 * streakInfo's rule), so it is never a miss; `startKey` (activation) wins over an older row, so a
 * re-activated athlete's old gap is not a miss either. `windowDays` is the fetch window, used only
 * to say a best streak runs past what was fetched (bestCut).
 * `rows` are DAY.scoreHistory; `todayScore` is null until today has scored. */
import { ON_STANDARD } from './score-band.js';
import { dateKey } from './fmt-date.js';

const shift = (key, n) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
};
const avgOf = (days) => {
  const s = days.filter((d) => d.score != null);
  return s.length ? Math.round(s.reduce((a, d) => a + d.score, 0) / s.length) : null;
};

export function progressRead({ rows = [], todayKey, todayScore = null, startKey = null, windowDays = 60 } = {}) {
  const byDay = new Map();
  for (const r of rows || []) if (r && r.date) byDay.set(String(r.date).slice(0, 10), Number(r.score) || 0);
  const first = [...byDay.keys()].sort()[0] || null;
  const began = startKey || first || todayKey;
  const known = first && first < todayKey ? first : todayKey;
  const start = began > known ? began : known;
  const live = todayScore != null && Number(todayScore) > 0 ? Number(todayScore) : null;

  const day = (key) => {
    const label = 'SMTWTFS'[new Date(`${key}T12:00:00`).getDay()];
    if (key === todayKey) return { key, label, score: live, state: 'today', counted: live != null && live >= ON_STANDARD };
    if (key < start) return { key, label, score: null, state: 'before', counted: false };
    const s = byDay.get(key);
    return s > 0 ? { key, label, score: s, state: 'scored', counted: true } : { key, label, score: null, state: 'missed', counted: true };
  };
  /** Seven days ending `back` days before today, oldest first. */
  const block = (back) => Array.from({ length: 7 }, (_, i) => day(shift(todayKey, i - 6 - back)));

  const week = block(0);
  const counted = week.filter((d) => d.counted);
  const on = counted.filter((d) => d.score != null && d.score >= ON_STANDARD).length;
  const avg = avgOf(counted);
  const prior = block(7).filter((d) => d.counted);
  const prevAvg = avgOf(prior);

  // Up to eight weekly averages, oldest first, for the trend line. A week the athlete had not
  // started yet is left off; a started week with nothing logged stays in as a gap (null).
  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const b = block(w * 7).filter((d) => d.counted);
    if (!b.length) continue;
    weeks.push({ from: b[0].key, avg: avgOf(b) });
  }

  // The last 30 days, on the same counted rule. Under a week of days it is not a rate yet.
  const month = Array.from({ length: 30 }, (_, i) => day(shift(todayKey, i - 29))).filter((d) => d.counted);
  const month30 = month.length >= 7 ? { on: month.filter((d) => d.score >= ON_STANDARD).length, days: month.length } : null;
  const rate30 = month30 ? Math.round((month30.on / month30.days) * 100) : null;

  // Longest run of counted days at 80+, on the calendar: a missed day breaks it.
  let run = 0, best = 0;
  for (let k = start; k <= todayKey; k = shift(k, 1)) {
    const d = day(k);
    if (!d.counted) continue;
    run = d.score != null && d.score >= ON_STANDARD ? run + 1 : 0;
    best = Math.max(best, run);
  }

  // The best run began on the first known day and history goes back further than that: it may
  // be longer than we can see.
  const edge = shift(todayKey, 1 - windowDays);
  let firstRun = 0;
  for (let k = start; k <= todayKey; k = shift(k, 1)) { const d = day(k); if (!d.counted) continue; if (d.score >= ON_STANDARD) firstRun++; else break; }
  const bestCut = best > 0 && firstRun === best && start === known && start <= edge && (!startKey || startKey < start);

  return {
    week, days: counted.length, on, bestCut,
    missed: counted.filter((d) => d.state === 'missed').length,
    avg, prevAvg, delta: avg != null && prevAvg != null ? avg - prevAvg : null,
    weeks, rate30, month30, bestRun: best,
    logged: [...byDay.values()].filter((s) => s > 0).length + (live != null ? 1 : 0),
  };
}

/** The headline, as a sentence. Null when no day has finished yet. */
export function weekHeadline(r) {
  if (!r || !r.days) return null;
  if (r.days === 1) return r.on ? 'On standard on day one' : 'Day one finished under 80';
  return r.on === r.days ? `On standard all ${r.days} days` : `On standard ${r.on} of ${r.days} days`;
}

/** The line under it: the average and how it moved. Never "+0", never a sign without a word. */
export function weekSubline(r) {
  if (!r || r.avg == null) return null;
  const d = r.delta;
  const move = d == null ? '' : d > 0 ? `, up ${d} on the week before` : d < 0 ? `, down ${-d} on the week before` : ', same as the week before';
  const miss = r.missed ? `. ${r.missed === 1 ? 'One day' : `${r.missed} days`} with no log` : '';
  return `Averaging ${r.avg}${move}${miss}.`;
}
