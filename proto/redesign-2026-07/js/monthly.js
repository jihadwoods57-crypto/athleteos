/* Pure month aggregation for the premium monthly report. Takes the athlete's day rows + a 'YYYY-MM'
   period, returns the deterministic sections the report renders and the AI narrates from. No DOM, no
   network, no invented numbers — a month with no logs yields loggedDays 0 and null aggregates. */
export function buildMonthPayload(days, period) {
  const inMonth = (Array.isArray(days) ? days : []).filter(d => d && typeof d.date === 'string' && d.date.slice(0, 7) === period);
  inMonth.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const scored = inMonth.filter(d => typeof d.score === 'number');
  const weights = inMonth.filter(d => typeof d.weight === 'number');
  const avg = scored.length ? Math.round(scored.reduce((s, d) => s + d.score, 0) / scored.length) : null;
  const best = scored.length ? scored.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  const worst = scored.length ? scored.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  return {
    period,
    loggedDays: inMonth.length,
    avgScore: avg,
    bestDay: best ? { date: best.date, score: best.score } : null,
    worstDay: worst ? { date: worst.date, score: worst.score } : null,
    weightStart: weights.length ? weights[0].weight : null,
    weightEnd: weights.length ? weights[weights.length - 1].weight : null,
    streakBest: bestStreak(inMonth),
  };
}

function bestStreak(days) {
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    const t = Date.parse(d.date);
    if (prev !== null && t - prev === 86400000) run += 1; else run = 1;
    if (run > best) best = run;
    prev = t;
  }
  return best;
}
