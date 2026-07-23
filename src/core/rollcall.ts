// OnStandard — lock-screen roll call, pure half. Category id derivation (kept in sync with the
// reminder edge fn) and the offline ack-retry queue reducer. No RN imports.
const MAX_QUEUE = 50;

/** Stable notification-category id for a coach action label. MUST match categoryIdFor in
 *  supabase/functions/commitment-reminders/index.ts. */
export function rollCallCategoryId(label: string | null): string {
  const slug = (label ?? 'Im Up').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return 'RC::' + slug;
}

export type QueuedAck = { code: string; queuedAt: number };

export function enqueueAck(q: QueuedAck[], code: string, now: number): QueuedAck[] {
  if (!code || q.some((x) => x.code === code)) return q;
  return [...q, { code, queuedAt: now }].slice(-MAX_QUEUE);
}

export function dropAck(q: QueuedAck[], code: string): QueuedAck[] {
  return q.filter((x) => x.code !== code);
}

/** Merge a coach action-label into the persisted set: dedupe, drop empties, keep the most recent `cap`. */
export function mergeLabels(existing: string[], label: string, cap = 20): string[] {
  if (!label || existing.includes(label)) return existing;
  return [...existing, label].slice(-cap);
}
