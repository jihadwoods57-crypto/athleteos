/* Coach Voice nudge — the client half of the 0094 consumer. PURE: no DOM, no network, no window.
   It decides WHEN a nudge is worth asking for and packages ONLY data the app already computed; the
   coach-voice-nudge edge function holds the model and the coach's tone. Absence of a nudge (Voice
   off, no coach, offline, or nothing to reinforce) leaves the deterministic Home exactly as it is —
   the nudge is purely additive. */

/** Worth a nudge only when the athlete is genuinely slipping today: the day is not fully met AND at
 *  least one required item is overdue. A clean or finished day gets no nudge (nothing to reinforce). */
export function shouldNudge(e) {
  if (!e || typeof e.met !== 'number' || typeof e.total !== 'number') return false;
  if (e.met >= e.total) return false;
  return Array.isArray(e.overdue) && e.overdue.length > 0;
}

/** A stable key for one slipping-state so the client asks the model at most once per distinct state
 *  per day (cached in RT). Changes when the date, the met/total, or the overdue set changes. */
export function nudgeSignature(dateISO, e) {
  const ids = (e && Array.isArray(e.overdue) ? e.overdue.map((o) => o.id) : []).slice().sort().join(',');
  const met = e ? `${e.met}/${e.total}` : '0/0';
  return `${dateISO}|${met}|${ids}`;
}

/** The deterministic payload the edge function narrates over. Every field is already on screen —
 *  the model may re-phrase it in the coach's voice but never fetches or invents. `why` strings drop
 *  the bold markers the UI uses. */
export function nudgeData(e, dateISO) {
  return {
    date: dateISO || null,
    score: e.score, possible: e.possible,
    completed: e.met, remaining: Math.max(0, e.total - e.met), total: e.total,
    overdue: (Array.isArray(e.overdue) ? e.overdue : []).map((o) => ({
      title: o.title,
      why: String(o.why || '').replace(/\*\*/g, '').trim(),
    })),
    now: e.now ? { title: e.now.title, dueIn: e.now.countdown } : null,
  };
}
