// OnStandard: connected-standards-tick's push gate, as a plain module so node:test can pin it.
//
// The tick writes every reminder and miss as an in-app notification row first (the durable
// record; a standard that closed is a fact the athlete must be able to find) and only then
// pushes to devices. This module decides WHO gets the device push:
//   - not an athlete who opted out (master switch 0067, or the team-standard switch 0221)
//   - not an athlete inside their synced quiet window, in their own timezone
//   - nobody at all when the profiles read failed, because with no rows every opt-out and every
//     quiet window reads as "send", which is the fetcher-lies bug server-side (the 1c02b610 rule
//     weekly-digest already follows). The bell rows still land; the next tick does not re-serve
//     the claim, so the push for that period is lost rather than mis-sent. That is the right
//     failure: a quiet window exists precisely so a push does NOT arrive.
//
// A skipped reminder is not deferred. Deadlines are fixed and the claim RPC has already marked
// the reminder served; deferring to the window's end would often mean a reminder after the
// deadline, which is worse than none. The bell row carries the fact either way.

import { pushSkipReason } from '../_shared/quiet-hours.mjs';

/** Split candidate push recipients into those who may be pushed now and counts of why not.
 *  `profOf` is a Map of user id -> profiles row (timezone, opt-outs, quiet window); an athlete
 *  with no row at all has no window and no opt-out, so they are pushed (a missing profile is
 *  not an opt-out; a FAILED read is handled by the caller passing `profilesUnreadable`). */
export function splitPushRecipients(ids, profOf, nowMs, fallbackTz, { profilesUnreadable = false } = {}) {
  const out = { allowed: [], quiet: 0, optedOut: 0, unreadable: 0 };
  for (const id of ids) {
    if (profilesUnreadable) { out.unreadable++; continue; }
    const why = pushSkipReason(profOf.get(id), nowMs, fallbackTz);
    if (why === 'quiet') out.quiet++;
    else if (why === 'opted_out') out.optedOut++;
    else out.allowed.push(id);
  }
  return out;
}
