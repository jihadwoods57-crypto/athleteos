// OnStandard: server-side quiet hours and opt-outs for scheduled pushes (2026-09-05).
//
// Plain ES module on purpose: Deno imports it from the edge functions and node:test imports it
// from the *.test.mjs suites (the send-push logic.mjs precedent), so the decision that keeps a
// push out of someone's night is pinned by a test that runs in `npm run test:fn` without Docker.
//
// The window semantics are the client's `inQuiet` (js/notify-plan.js) exactly: minutes from
// midnight, `from === to` means no window, and a window whose end is before its start wraps
// midnight. Profiles that never synced a window (either column null, 0221) have NO quiet window
// here. The server never assumes the client default; silencing someone who never asked is a
// worse surprise than one late reminder.

/** Local clock parts at `nowMs` in `tz` (falling back to `fallbackTz` for a missing or unknown
 *  zone): `minute` is minutes from local midnight (0..1439), `weekday` is 0 = Sunday .. 6 =
 *  Saturday, `hour` is 0..23. Pure; no Date-local arithmetic anywhere, so it is right wherever
 *  the function happens to run. */
export function localParts(nowMs, tz, fallbackTz = 'America/New_York') {
  const read = (zone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date(nowMs));
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const hour = Number(get('hour')) % 24;           // some engines print 24 at midnight
    const minute = Number(get('minute')) || 0;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { hour, minute: hour * 60 + minute, weekday: weekday < 0 ? 0 : weekday };
  };
  try { return read(tz || fallbackTz); } catch { return read(fallbackTz); }
}

/** Is minute-of-day `t` inside the window [from, to)? Wraps midnight when to < from. */
export function inQuietWindow(t, from, to) {
  if (from === to) return false;
  return from < to ? t >= from && t < to : t >= from || t < to;
}

const isMinute = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1440;

/** The synced quiet window on a profiles row, or null when the device never synced one. */
export function quietWindowOf(prof) {
  if (!prof) return null;
  const from = prof.quiet_from_min;
  const to = prof.quiet_to_min;
  if (!isMinute(from) || !isMinute(to)) return null;
  return { from, to };
}

/** Why a scheduled push must NOT go to this profile right now, or null when it may.
 *    'opted_out'  the master switch (notifications_opt_out, 0067) or the team-standard switch
 *                 (team_standard_pushes_opt_out, 0221) is on
 *    'quiet'      it is inside their synced quiet window in their own timezone
 *  Order matters: an opt-out is permanent and quiet is temporary, and the caller counts them
 *  separately, so a profile that is both reads as opted out. */
export function pushSkipReason(prof, nowMs, fallbackTz = 'America/New_York') {
  if (prof?.notifications_opt_out === true || prof?.team_standard_pushes_opt_out === true) return 'opted_out';
  const win = quietWindowOf(prof);
  if (!win) return null;
  const { minute } = localParts(nowMs, prof?.timezone, fallbackTz);
  return inQuietWindow(minute, win.from, win.to) ? 'quiet' : null;
}
