/* OnStandard: one chat correction, from Nia's tool call to the words she files about it.
 *
 * Shared by the two athlete surfaces that can correct today's plate (the meal thread in meal.js and
 * the full chat in nutrition-chat.js), which used to carry two copies of this and drifted: both
 * answered a correction that failed with an amber line under the message box, after meal-chat had
 * already told the athlete in the thread that their numbers were updating (2026-09-24, "double
 * chicken"). Now the order is the only honest one:
 *
 *   1. resolve the correction against the plate, the athlete's own words first (plate-edits.js)
 *   2. apply what is unambiguous (act.correctMeal: the one deterministic engine)
 *   3. tell meal-chat what happened, with the signed token its reply came back with; it files Nia's
 *      ack and the receipt when the numbers moved, or her precise question when they did not
 *
 * Nothing about a correction is ever said under the box again. The only thing this returns for the
 * screen to show there is the rare case of an older meal-chat that files its ack itself and sends
 * no token: the thread already holds that ack, so a correction that then fails gets one calm line.
 *
 * Lazy: imported the moment a correction arrives, never at boot. */
import { resolveChatCorrection, correctionOutcome } from './plate-edits.js';

/** The line for the legacy path only (no token): Nia's ack is already in the thread. */
export const LEGACY_MISS = "Your numbers didn't change. Tell Nia which food you mean and how much.";

/**
 * @param {object} o
 * @param {object} o.act       state.js act (correctMeal, _correctionReceiptRows)
 * @param {object} o.sb        the Supabase client (functions.invoke)
 * @param {string} o.slot      today's slot key
 * @param {string} o.mealId
 * @param {object} o.meta      the live slot meta (detectedRich, quantities)
 * @param {object} o.data      meal-chat's response: { reply, correction, pending? }
 * @param {string} o.said      the athlete's message, verbatim
 * @param {number} [o.minutesLate]
 * @returns {Promise<{ applied: boolean, note: string }>} note is '' unless the legacy path failed
 */
export async function runChatCorrection({ act, sb, slot, mealId, meta, data, said, minutesLate }) {
  const correction = (data && data.correction) || {};
  const { parts, asks } = resolveChatCorrection(meta, correction, said, { minutesLate });
  // With a token, meal-chat files the receipt alongside Nia's words, in that order; the reducer's
  // own fire-and-forget receipt would land first, or twice.
  const token = data && typeof data.pending === 'string' ? data.pending : '';
  const applied = parts.length ? await act.correctMeal(slot, parts, { skipAiUpdate: true, noReceipt: !!token }) : null;
  const outcome = correctionOutcome({ applied, asks, correction });
  if (!token) return { applied: outcome.applied, note: outcome.applied ? '' : LEGACY_MISS };
  const rows = outcome.applied && applied && applied.before
    ? act._correctionReceiptRows(applied.before, {
      protein: applied.meta.protein, carbs: applied.meta.carbs, fat: applied.meta.fat,
      kcal: applied.meta.kcal, quality: applied.meta.quality,
    })
    : [];
  const body = { mealId, correctionOutcome: { token, ...outcome }, ...(rows.length ? { correctionReceipt: rows } : {}) };
  // One retry: a dropped connection here would leave the athlete's message unanswered, and the
  // server refuses a token twice, so a second attempt can never file Nia's words twice.
  for (let i = 0; i < 2; i++) {
    try {
      const { error } = await sb.functions.invoke('meal-chat', { body });
      if (!error) break;
    } catch { /* retried once, then the thread simply has no reply */ }
  }
  return { applied: outcome.applied, note: '' };
}
