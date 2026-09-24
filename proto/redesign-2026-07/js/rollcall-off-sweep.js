/* The roll call is switched off (commitments.js ROLLCALL_OFF, founder 2026-09-24). What the phone
 * itself still holds has to go too, because none of it asks the server before it fires:
 *
 *   - AlarmKit / setAlarmClock alarms armed up to 14 days ahead (roll call v3). They ring whether
 *     or not the app is open, for a roll call that no longer exists.
 *   - Geofences armed for walk-in check-in. The OS keeps them across launches.
 *   - A roll call Live Activity already on the lock screen.
 *
 * Once per launch (state.js _armLocation, which runs on every sign-in and restored session, calls
 * this INSTEAD of arming), feature-detected method by method, because an OTA lands this on builds
 * 43 and 46-49 whose bridges differ: a build without a method simply skips that part. Never throws,
 * never blocks boot. Lazy: nothing here is in the boot graph.
 */

let RUN = null;

/** Cancel every alarm, disarm every geofence, end every roll call card. Resolves what was done:
 *  { alarms, location, cards } (cards = how many the shell ended, or null when it cannot). */
export function sweepRollcallOff() {
  if (RUN) return RUN;
  RUN = (async () => {
    const out = { alarms: false, location: false, cards: null };
    const N = typeof window !== 'undefined' ? window.OnStandardNative : null;
    if (!N) return out;
    // The empty set, complete: the shell cancels everything it armed AND anything the push
    // extension armed. The same call sign-out makes (state.js signOut).
    try {
      if (N.wakeAlarms && typeof N.wakeAlarms.sync === 'function') {
        await N.wakeAlarms.sync([], { complete: true });
        out.alarms = true;
      }
    } catch { /* the next launch tries again */ }
    try {
      if (N.location && typeof N.location.disarm === 'function') out.location = (await N.location.disarm()) === true;
    } catch { /* the next launch tries again */ }
    try {
      if (N.rollcall && typeof N.rollcall.endAll === 'function') out.cards = Number(await N.rollcall.endAll()) || 0;
    } catch { /* a card left up ends at its own stale date */ }
    return out;
  })();
  return RUN;
}

/** Test seam: forget this launch's run. */
export function _resetRollcallOffSweep() { RUN = null; }
