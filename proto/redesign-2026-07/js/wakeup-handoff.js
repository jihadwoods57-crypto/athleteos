/* The morning's receipt on Home, and the handoff it implies.
 *
 * The founder's rule: getting up is not the goal, eating is. So the answer to a wake-up is not a
 * screen that congratulates the athlete, it is a line on Home saying the morning is banked, with
 * the next meal already sitting under it as the NOW card.
 *
 * Pure and dependency-free so it can be tested without booting Home. home.js passes its own esc,
 * which keeps this module free of the component graph.
 */
import { morningSummary, wakeClock, WAKEUP_TYPE } from './wakeup-morning.js';

/**
 * What this athlete did with this morning.
 * @param {object|null} instance a commitment_board instance for the wake-up
 * @param {string|null} userId the athlete's own id
 * @returns {{answered:boolean, atMin:number|null, late:boolean, placed:number|null}}
 */
export function wakeupReceipt(instance, userId) {
  const none = { answered: false, atMin: null, late: false, placed: null };
  if (!instance || instance.type !== WAKEUP_TYPE || !userId) return none;
  /* TWO SHAPES REACH HERE, and only one of them has a squad in it.
     A coach's board instance (commitment_board) carries every athlete's `rows`, so placement is
     real. The athlete's OWN instance (my_commitments) carries no `rows` key at all: 55 keys, none
     of them a squad, and no RPC anywhere offers one. Home used to pass the board, which an athlete
     never fills, so morningSummary saw an empty squad, nobody matched, and every athlete's receipt
     was `none` forever. The row simply never appeared on Home. */
  if (Array.isArray(instance.rows)) {
    const s = morningSummary(instance);
    const i = s.upRows.findIndex((r) => r.athleteId === userId);
    if (i >= 0) return { answered: true, atMin: s.upRows[i].atMin, late: false, placed: i + 1 };
    const lateRow = s.needsYou.find((r) => r.athleteId === userId && r.verdict === 'late');
    if (lateRow) return { answered: true, atMin: lateRow.atMin, late: true, placed: null };
    return none;
  }
  /* The athlete's own row. Answered, when, and late are all knowable from it. Placement is not,
     and `placed: null` is what makes receiptHtml say "Answered." instead of inventing a rank. */
  if (!instance.acknowledged_at) return none;
  const at = new Date(instance.acknowledged_at);
  if (!Number.isFinite(at.getTime())) return none;
  return {
    answered: true,
    atMin: at.getHours() * 60 + at.getMinutes(),
    late: instance.verdict === 'late',
    placed: null,
    // The athlete's own row knows its instance, so the receipt can be the door to the detail
    // screen (verdict, provenance, dispute). It replaced the collapsed card that used to sit under
    // it saying the same thing.
    instanceId: instance.instance_id ? String(instance.instance_id) : null,
  };
}

/**
 * The Home row. Empty string when there is nothing honest to say, so Home can interpolate it
 * unconditionally without a branch of its own.
 * @param {object|null} receipt from wakeupReceipt
 * @param {(s:string)=>string} esc home.js's own escaper
 */
export function receiptHtml(receipt, esc, points) {
  if (!receipt || !receipt.answered) return '';
  const t = esc(wakeClock(receipt.atMin));
  /* The morning is part of the daily score (8 of 100 on a day it is assigned; late is half), and
     the receipt is where the athlete learns that it landed. `points` is what the day's own weights
     say the morning is worth, handed in by Home so this module stays free of the scoring graph;
     a caller that passes nothing gets the plain receipt. A late answer prints its half. */
  const pts = Number(points) > 0 ? Math.round(receipt.late ? Number(points) / 2 : Number(points)) : 0;
  const banked = pts ? ` +${pts} on today's score.` : '';
  const tail = receipt.late
    ? `Answered late.${banked}`
    : (receipt.placed ? `${receipt.placed} of the squad up.${banked}` : `Answered.${banked}`);
  /* A door only when there is something behind it. The morning's team board (roll call rebuilt,
     2026-09-23) is where the squad lives now, for every athlete, so an instance id opens it
     straight (roll-call/<id> would only hand over to it). #wakeup-squad reads the coach's board,
     which an athlete never has; it is kept only for a receipt with placement and no id. */
  const door = receipt.instanceId ? ` data-go="rollcall-board/${esc(receipt.instanceId)}" role="button" tabindex="0"`
    : receipt.placed ? ' data-go="wakeup-squad" role="button" tabindex="0"' : '';
  return `<div class="wk-receipt${receipt.late ? ' late' : ''}"${door}>
    <span class="wk-rc-t">Up at ${t}</span>
    <span class="wk-rc-s">${esc(tail)}</span>
  </div>`;
}
