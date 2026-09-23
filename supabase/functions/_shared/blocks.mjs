// OnStandard: Block, on the push side (0244, review pass 2026-09-23, G-R3, Guideline 1.2).
//
// A person who blocked someone gets no push, nudge, bell row or announcement from them. Every
// function that sends on a person's behalf (send-push, meal-chat's coach flag, roll-call-coach's
// nudge and schedule notice) asks this module which recipients blocked the sender and drops them
// before anything is written or sent.
//
// Plain ES module (the quiet-hours.mjs precedent): Deno imports it, node:test pins it.
//
// FAILS OPEN, like the notification opt-out it sits beside: a read error sends as before. The
// thread itself fails closed (the database's restrictive read policy hides a blocked author's
// messages no matter what this module does), so a hiccup here can cost at most one push.

/** The recipients (a Set of ids) who blocked `senderId`, read with a service-role client. */
export async function blockersOf(svc, senderId, recipientIds) {
  const ids = [...new Set((Array.isArray(recipientIds) ? recipientIds : []).filter(Boolean).map(String))];
  if (!svc || !senderId || !ids.length) return new Set();
  try {
    const { data, error } = await svc.rpc('blocked_recipients', { p_sender: senderId, p_recipients: ids });
    if (error || !Array.isArray(data)) return new Set();
    return new Set(data.map((r) => String(typeof r === 'object' && r !== null ? (r.blocked_recipients ?? r.blocker_id ?? Object.values(r)[0]) : r)));
  } catch {
    return new Set();
  }
}

/** `ids` without the ones in `blockers`, order kept. Pure. */
export function withoutBlockers(ids, blockers) {
  const b = blockers instanceof Set ? blockers : new Set(blockers || []);
  return (Array.isArray(ids) ? ids : []).filter((id) => !b.has(String(id)));
}
