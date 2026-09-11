import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningSummary, morningStreak, wakeClock, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC, loadMyMornings } from '../commitment-data.js';

/* Who is up.
 *
 * The social half of the feature, and the only thing a coach's alarm has that the phone's own
 * alarm never will: twenty-two people hear it at the same time. An athlete seeing five names
 * already answered at 5:45 is what actually gets them out of bed; eight points is not.
 *
 * Reads wakeup-morning.js and nothing else, so this and the coach's summary cannot disagree.
 */

export default {
  tab: 'home',
  render() {
    const inst = (VC.board || []).find((i) => i.type === WAKEUP_TYPE) || null;
    const s = morningSummary(inst);
    if (!s.total) {
      return `${backHead('Who is up', '', 'home')}
      <div class="sidebox">
        <div class="req-icon muted s38">${icon('users', 17)}</div>
        <div><div class="tt">Nothing to show yet</div>
        <div class="ts">Your squad's morning appears here once a coach sets a wake-up.</div></div>
      </div>
      <div class="wk-gap"></div>`;
    }
    const rows = s.upRows.map((r, i) => {
      const mine = !!(r.athleteId && r.athleteId === RT.userId);
      return `
      <div class="lrow wk-sq${mine ? ' wk-you' : ''}">
        <span class="wk-rank">${i + 1}</span>
        <span class="lm"><span class="lt">${mine ? 'You' : esc(r.name)}</span></span>
        <span class="wk-at">${esc(wakeClock(r.atMin))}</span>
      </div>`;
    }).join('');
    const left = s.total - s.onTime;
    return `
    ${backHead('Who is up', esc(inst.title || 'Team wake-up'), 'home')}

    <section class="wk-pulse">
      <div class="wk-k">Up so far</div>
      <div class="wk-num"><span class="wk-big">${s.onTime}</span><span class="wk-of">/${s.total}</span></div>
      ${s.firstUp ? `<div class="wk-cap">${esc(s.firstUp.name)} was first, at ${esc(wakeClock(s.firstUp.atMin))}.</div>` : ''}
      <div id="wk-streak-slot"></div>
    </section>

    ${rows ? `<h2 class="eyebrow">In order</h2>
    <section class="card rows">${rows}</section>` : ''}
    ${left > 0 ? `<div class="wk-cap wk-left">${left} still to answer.</div>` : ''}
    <div class="wk-gap"></div>
    `;
  },
  async mount(root) {
    const slot = root.querySelector('#wk-streak-slot');
    if (!slot) return;
    /* Painted async into a slot rather than rendered inline: the range read is a second round
       trip, and the list above must not wait on it. A failed read leaves the slot empty, which
       is the honest outcome — a streak invented from a failed fetch is worse than no streak. */
    const n = morningStreak(await loadMyMornings(30));
    if (!n || !slot.isConnected) return;
    slot.innerHTML = `<div class="wk-streak">${n} straight ${n === 1 ? 'morning' : 'mornings'}</div>`;
  },
};
