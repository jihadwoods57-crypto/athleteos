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
  const s = morningSummary(instance);
  const i = s.upRows.findIndex((r) => r.athleteId === userId);
  if (i >= 0) return { answered: true, atMin: s.upRows[i].atMin, late: false, placed: i + 1 };
  const lateRow = s.needsYou.find((r) => r.athleteId === userId && r.verdict === 'late');
  if (lateRow) return { answered: true, atMin: lateRow.atMin, late: true, placed: null };
  return none;
}

/**
 * The Home row. Empty string when there is nothing honest to say, so Home can interpolate it
 * unconditionally without a branch of its own.
 * @param {object|null} receipt from wakeupReceipt
 * @param {(s:string)=>string} esc home.js's own escaper
 */
export function receiptHtml(receipt, esc) {
  if (!receipt || !receipt.answered) return '';
  const t = esc(wakeClock(receipt.atMin));
  const tail = receipt.late
    ? 'Answered late.'
    : (receipt.placed ? `${receipt.placed} of the squad up.` : 'Answered.');
  return `<div class="wk-receipt${receipt.late ? ' late' : ''}" data-go="wakeup-squad" role="button" tabindex="0">
    <span class="wk-rc-t">Up at ${t}</span>
    <span class="wk-rc-s">${esc(tail)}</span>
  </div>`;
}
