// OnStandard: weekly-digest's timing and idempotency decisions, as a plain module so node:test
// can pin them (`npm run test:fn`) without Deno or a database.
//
// The job fires every hour of every day (migration 0220). Each hourly run walks two gates:
//   1. digestWindowOpen: is it local Monday DIGEST_HOUR ANYWHERE on earth right now? Local Monday
//      7 AM across UTC-12 .. UTC+14 spans Sunday 17:00 UTC to Monday 19:00 UTC. Outside that the
//      function returns before reading a single row, which is 138 of the 168 weekly runs.
//   2. digestDecision, per coach: opted out; not their Monday morning yet (waiting); already sent
//      this week (deduped, by the profiles.digest_last_sent_at marker OR a recent `digest`
//      notification row); or send.
//
// The 0218 gate compared the local HOUR only, which was correct while the cron ran only on UTC
// Monday and wrong the moment it runs on other days, so the weekday is now part of the gate.

import { localParts } from '../_shared/quiet-hours.mjs';

export const DIGEST_WEEKDAY = 1;                 // Monday, localParts convention (0 = Sunday)
export const DEDUPE_MS = 6 * 86_400_000;         // a week minus a day of slack for DST and cron jitter

/** Hour of day (0-23) at `nowMs` in `tz`, falling back for a missing or unknown zone. */
export function localHour(nowMs, tz, fallbackTz) {
  return localParts(nowMs, tz, fallbackTz).hour;
}

/** True while SOME timezone (UTC-12 .. UTC+14) is at local Monday `hour` right now. Cheap
 *  early exit for the hourly cron; the per-coach decision below is what actually gates sending. */
export function digestWindowOpen(nowMs, hour) {
  const d = new Date(nowMs);
  const wd = d.getUTCDay();
  const h = d.getUTCHours();
  // UTC+14 reaches Monday `hour` at Sunday (hour - 14) UTC; UTC-12 reaches it at Monday (hour + 12) UTC.
  const sundayFrom = ((hour - 14) % 24 + 24) % 24;   // hour 7 -> Sunday 17:00 UTC
  const mondayTo = hour + 12;                          // hour 7 -> Monday 19:00 UTC
  return (wd === 0 && h >= sundayFrom) || (wd === 1 && h <= mondayTo);
}

/** True when `sentAtIso` (profiles.digest_last_sent_at) is inside the dedupe window. A null,
 *  missing or unparsable stamp is "never sent", never a reason to skip. */
export function sentRecently(sentAtIso, nowMs) {
  if (!sentAtIso) return false;
  const t = Date.parse(sentAtIso);
  return Number.isFinite(t) && nowMs - t < DEDUPE_MS;
}

/** What to do for one coach this run. `hasRecentRow` is the notifications-table belt (a `digest`
 *  row inside the dedupe window), read by the caller only when the cheaper checks pass.
 *    'opted_out'  never send (profiles.notifications_opt_out)
 *    'waiting'    not local Monday `hour` for them; a later run this week will be
 *    'deduped'    already sent inside the dedupe window
 *    'send'       this is their Monday morning and they have not had it */
export function digestDecision({ nowMs, prof, hour, fallbackTz, sendAll = false, hasRecentRow = false }) {
  if (prof?.notifications_opt_out === true) return 'opted_out';
  if (!sendAll) {
    const { weekday, hour: localH } = localParts(nowMs, prof?.timezone, fallbackTz);
    if (weekday !== DIGEST_WEEKDAY || localH !== hour) return 'waiting';
  }
  if (sentRecently(prof?.digest_last_sent_at, nowMs) || hasRecentRow) return 'deduped';
  return 'send';
}
