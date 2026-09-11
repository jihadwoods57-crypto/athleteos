import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningSummary, morningStreak, wakeClock, WAKEUP_TYPE } from '../wakeup-morning.js';
import { VC, loadMyMornings } from '../commitment-data.js';
import { wakeAlarmState, alarmButtonLabel } from '../wake-alarms.js';

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

    ${/* The alarm, and whether this phone will actually ring. Painted async in mount(): asking
          native is a round trip, and the answer is different on every device. An empty slot is
          the honest outcome when there is no bridge at all (a browser, an older build). */''}
    <div id="wk-alarm-slot"></div>
    <div class="wk-gap"></div>
    `;
  },
  async mount(root) {
    void paintAlarm(root);
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

/* What this phone will actually do at the wake-up time, and the one action that can change it.
 *
 * Deliberately says nothing on a device with no alarm support: an athlete on an older iPhone
 * cannot act on "your phone cannot do this", and a row that only ever reports a limitation is
 * noise on the screen they check to see who is up. */
async function paintAlarm(root) {
  const slot = root && root.querySelector('#wk-alarm-slot');
  if (!slot) return;
  const st = await wakeAlarmState();
  if (!st || !st.supported || !slot.isConnected) return;

  const inst = VC.mine && VC.mine.find((r) => r && r.type === WAKEUP_TYPE);
  const label = alarmButtonLabel(inst);
  const denied = st.authorization === 'denied';
  const armed = Number(st.armed) || 0;

  const body = denied
    ? `<div class="lt">Alarms are turned off</div><div class="ls">Your coach's wake-up will only show as a notification, which a Sleep Focus can silence. Turn alarms on for OnStandard in Settings.</div>`
    : armed > 0
      ? `<div class="lt">${armed} ${armed === 1 ? 'morning' : 'mornings'} set to ring</div><div class="ls">It goes off through Do Not Disturb and silent mode. Tap "${esc(label)}" and the morning counts.</div>`
      : `<div class="lt">Nothing set to ring</div><div class="ls">Your coach has not put an alarm on the next wake-up. It will arrive as a notification.</div>`;

  slot.innerHTML = `
    <h2 class="eyebrow">Your alarm</h2>
    <section class="card rows">
      <div class="lrow wk-alarm ${denied ? 'off' : armed > 0 ? 'on' : ''}" role="listitem">
        <div class="lic">${icon(denied ? 'alert' : 'sun', 17)}</div>
        <div class="lm">${body}</div>
      </div>
    </section>`;
}
