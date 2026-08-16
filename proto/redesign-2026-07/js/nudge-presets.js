/* OnStandard — nudge presets + delivery-truth copy (pure: no DOM, no fetch, no clock).
   One vocabulary for every operator nudge surface. Before this module the same five string
   literals were retyped across coach-home, the athlete detail page and the roster bulk bar,
   and only coach-home matched the message to the athlete's actual tier; the other two sent
   "Time to get your log in." to athletes who HAD logged. Presets and result copy live here
   so the three surfaces cannot drift apart again.

   Delivery truth: send-push reports what actually happened ({pushed, deduped, suppressed,
   devices}). nudgeResultCopy turns that into the one line the operator reads. The old UI
   asserted "It lands on their phone" for deliveries the server had just told it never
   happened (no device token, pushes off, deduped). */

/** tier → the message body a coach starts from. Editable before send on every surface. */
export function nudgePreset(tier) {
  if (tier === 'below') return "You're below standard today. Close the gap.";
  if (tier === 'due_soon') return 'Your next log is due soon. Stay ahead of it.';
  if (tier === 'critical' || tier === 'overdue') return 'Your log is overdue. Get it in.';
  return 'Time to get your log in.';
}

/** status.key (status.js vocabulary) → preset tier. Null-safe: unknown/absent keys get the
    neutral body, never an accusation ("overdue" to an athlete who logged on time is a lie). */
export function tierForStatus(statusKey) {
  if (statusKey === 'below_standard' || statusKey === 'needs_review') return 'below';
  if (statusKey === 'due_soon') return 'due_soon';
  if (statusKey === 'overdue' || statusKey === 'no_activity') return 'critical';
  return null;
}

/** Convenience: status.key → message body. */
export function presetForStatus(statusKey) {
  return nudgePreset(tierForStatus(statusKey));
}

/** send-push result ({ok, pushed, deduped, suppressed, devices, rateLimited}) → what the
    operator reads. tone: 'ok' (green, it pushed) | 'warn' (amber, delivered somewhere
    quieter than promised) | 'fail' (red, nothing happened). Every branch tells the truth. */
export function nudgeResultCopy(r) {
  if (!r || !r.ok) {
    return r && r.rateLimited
      ? { ok: false, tone: 'fail', msg: 'Hit the send limit. Wait a minute and try again.' }
      : { ok: false, tone: 'fail', msg: "Couldn't send it. Check your connection and try again." };
  }
  if (r.deduped) return { ok: true, tone: 'warn', msg: 'They were just pinged. Give it a minute before nudging again.' };
  if (r.suppressed) return { ok: true, tone: 'warn', msg: 'Saved to their in-app inbox. They have pushes turned off.' };
  if ((r.pushed || 0) > 0) return { ok: true, tone: 'ok', msg: 'Sent. It lands on their phone.' };
  return { ok: true, tone: 'warn', msg: "Sent to their in-app inbox. Their phone isn't set up for pushes." };
}

/** True when a server intervention row says this athlete was nudged on the caller's LOCAL
    day `todayISO` (YYYY-MM-DD). This is what makes "Nudged today" hold across a coach's
    devices and across staff on the same book; RT.coachNudged is only the local fast path. */
export function nudgedTodayFromInterventions(rows, todayISO) {
  if (!todayISO) return false;
  return (Array.isArray(rows) ? rows : []).some((r) => {
    if (!r || r.kind !== 'nudge' || !r.created_at) return false;
    const d = new Date(r.created_at);
    if (isNaN(d.getTime())) return false;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return iso === todayISO;
  });
}
