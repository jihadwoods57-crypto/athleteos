/* OnStandard: one chat correction, from Nia's tool call to the words she files about it.
 *
 * Shared by the two athlete surfaces that can correct today's plate (the meal thread in meal.js and
 * the full chat in nutrition-chat.js), which used to carry two copies of this and drifted: both
 * answered a correction that failed with an amber line under the message box, after meal-chat had
 * already told the athlete in the thread that their numbers were updating (2026-09-24, "double
 * chicken"). Now the order is the only honest one:
 *
 *   1. resolve the correction against the plate: the model's parts, refined by the athlete's own
 *      words (plate-edits.js)
 *   2. apply what is unambiguous (act.correctMeal: the one deterministic engine)
 *   3. tell meal-chat what happened, with the signed token its reply came back with: which parts
 *      landed, and whether they are exactly what the model described. It files Nia's ack and the
 *      receipt when the numbers moved (her own words only if they are still true, otherwise a
 *      sentence composed from what landed), or her precise question when they did not
 *
 * THE REPORT CANNOT BE LOST (review 2026-09-24). It was two tries in a row and then silence: the
 * numbers had moved and the thread said nothing about it. It is now a job in the small-writes
 * outbox (sync-queue.js), written before the first try and retried on the outbox's own backoff for
 * as long as the token is good (15 minutes). If it still has not landed by then, the device files
 * the plain receipt instead (unsigned, not in Nia's voice, exactly the pre-token receipt), so a
 * change to the numbers is ALWAYS recorded in the thread.
 *
 * Nothing about a correction is ever said under the box again. The only thing this returns for the
 * screen to show there is the rare case of an older meal-chat that files its ack itself and sends
 * no token: the thread already holds that ack, so a correction that then fails gets one calm line.
 *
 * Lazy: imported the moment a correction arrives (or an outbox job needs it), never at boot. */
import { resolveChatCorrection, correctionOutcome } from './plate-edits.js';
import * as SQ from './sync-queue.js';

/** The line for the legacy path only (no token): Nia's ack is already in the thread. */
export const LEGACY_MISS = "Your numbers didn't change. Tell Nia which food you mean and how much.";

const TOKEN_TTL_MS = 15 * 60 * 1000;

/** The token's nonce, read off its (signed, not secret) body, and when to stop trying it. The
 *  clock is this device's own, from the moment the token arrived (it was issued a moment ago), so
 *  a phone whose clock is off does not give up on a good token; the server's 403 is the backstop. */
export function tokenInfo(token, now = Date.now()) {
  const expiresAt = now + TOKEN_TTL_MS - 60000;
  try {
    const b = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return { nonce: String(JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))).n || ''), expiresAt };
  } catch { return { nonce: '', expiresAt }; }
}

/**
 * Deliver one queued outcome. true = done (filed, already filed, or nothing is owed); false = try
 * again later. Past the token's life, the plain receipt is filed in its place.
 */
export async function sendOutcome(job, sb, now = Date.now()) {
  if (!sb || !job) return false;
  if (!job.fallback && now < job.expiresAt) {
    try {
      const { error } = await sb.functions.invoke('meal-chat', { body: job.body });
      if (!error) return true;
      // 403 is the server refusing the token (spent or out of date): no retry will change that.
      const status = error.context && error.context.status;
      if (status !== 403) return false;
    } catch { return false; }
  }
  if (!job.fallback) {
    // From here the job is the fallback, with its own fresh tries (the outbox caps at 5).
    job.fallback = true; job.tries = 0;
    SQ.patchJob(SQ.keyOf(job), { fallback: true, tries: 0 });
  }
  try {
    // A reply that did land, with the response lost on the way back, is already in the thread.
    if (job.ct) {
      const { data, error } = await sb.from('meal_comments').select('id').eq('meal_id', job.mealId).eq('meta->>ct', job.ct).limit(1);
      if (error) return false;
      if (Array.isArray(data) && data.length) return true;
    }
    // Nothing moved: nothing is owed in the thread.
    if (!Array.isArray(job.receipt) || !job.receipt.length) return true;
    const { error } = await sb.functions.invoke('meal-chat', { body: { mealId: job.mealId, correctionReceipt: job.receipt } });
    return !error;
  } catch { return false; }
}

/**
 * @param {object} o
 * @param {object} o.act       state.js act (correctMeal, _correctionReceiptRows, _scheduleSyncDrain)
 * @param {object} o.sb        the Supabase client (functions.invoke)
 * @param {string} o.uid       the signed-in athlete (the outbox is user-scoped)
 * @param {string} o.slot      today's slot key
 * @param {string} o.mealId
 * @param {object} o.meta      the live slot meta (detectedRich, quantities)
 * @param {object} o.data      meal-chat's response: { reply, correction, pending? }
 * @param {string} o.said      the athlete's message, verbatim
 * @param {number} [o.minutesLate]
 * @returns {Promise<{ applied: boolean, note: string }>} note is '' unless the legacy path failed
 */
export async function runChatCorrection({ act, sb, uid, slot, mealId, meta, data, said, minutesLate }) {
  const correction = (data && data.correction) || {};
  const { parts, asks, exact } = resolveChatCorrection(meta, correction, said, { minutesLate });
  // With a token, meal-chat files the receipt alongside Nia's words, in that order; the reducer's
  // own fire-and-forget receipt would land first, or twice.
  const token = data && typeof data.pending === 'string' ? data.pending : '';
  const applied = parts.length ? await act.correctMeal(slot, parts, { skipAiUpdate: true, noReceipt: !!token }) : null;
  const outcome = correctionOutcome({ applied, asks, correction, exact, parts });
  if (!token) return { applied: outcome.applied, note: outcome.applied ? '' : LEGACY_MISS };
  const rows = outcome.applied && applied && applied.before
    ? act._correctionReceiptRows(applied.before, {
      protein: applied.meta.protein, carbs: applied.meta.carbs, fat: applied.meta.fat,
      kcal: applied.meta.kcal, quality: applied.meta.quality,
    })
    : [];
  // `correction` rides back verbatim: the token is bound to it, and it is the only place the server
  // takes a food's name from (with the meal's own detected list).
  const body = { mealId, correctionOutcome: { token, correction, ...outcome }, ...(rows.length ? { correctionReceipt: rows } : {}) };
  const { nonce, expiresAt } = tokenInfo(token);
  const job = { uid, kind: 'correction-outcome', ref: nonce || token.slice(-24), ct: nonce, mealId, body, receipt: rows, expiresAt, queuedAt: Date.now() };
  // Durable before the first try: a killed app still owes the thread this.
  if (uid) SQ.putJob(job);
  const ok = await sendOutcome(job, sb);
  if (uid) {
    if (ok) SQ.removeJob(SQ.keyOf(job));
    else { SQ.patchJob(SQ.keyOf(job), { tries: (job.tries || 0) + 1, lastTryAt: Date.now() }); if (act._scheduleSyncDrain) act._scheduleSyncDrain(); }
  }
  return { applied: outcome.applied, note: '' };
}
