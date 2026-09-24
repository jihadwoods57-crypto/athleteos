/* OnStandard: "You’re on roll call" (roll call v3, 2026-09-24; spec section 6).

   Route: rollcall-assigned/<commitment id>. The assignment and change pushes open here
   (supabase/functions/_shared/rollcall-notice.ts NOTICE_ROUTE). It says what the athlete was put on,
   by whom, what it is worth, and whether THIS phone will ring. There is no Set button when the alarm
   is set: the founder's rule is that it is already set when the coach assigns it. Opening it stamps
   the roll call seen, which is the coach's "Seen but not set" step.

   Styles: css/screens.css, the ra- block. */
import { backHead, esc, skeletonRows, emptyState } from '../components.js';
import { icon } from '../icons.js';
import { VC, loadMineAhead, aheadRows } from '../commitment-data.js';
import { WAKEUP_SHIFT } from '../plan-style.js';
import { assignedModel, alarmLine, whenLabel, fixAlarm } from '../rollcall-next.js';
import { markRollcallSeen } from '../rollcall-v3-data.js';
import { wakeAlarmState } from '../wake-alarms.js';

const A = { forId: null, loaded: false, state: null, at: 0 };
/* The phone's alarm state is re-read on a visit after this long, so an alarm fixed from Home (or
   Settings) reads true here too. A repaint right after a read never re-reads, so no loop. */
const STATE_FRESH_MS = 15_000;
const rowsNow = () => [...(VC.mine || []), ...aheadRows()];

function alarmBlock(line, row) {
  if (!line) return '<p class="ra-s">Your phone sets the alarm the next time OnStandard is open on it.</p>';
  if (line.kind === 'set') {
    // "Tomorrow · 4:45 AM" reads as a sentence here: "Alarm set for tomorrow at 4:45 AM".
    const when = whenLabel(row).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase()).replace(' · ', ' at ');
    return `<p class="ra-set">${icon('check', 16)} Alarm set for ${esc(when)}</p>`;
  }
  if (!line.fix) {
    return `<p class="ra-s">${esc(line.kind === 'coach_off'
      ? 'Your coach set this to arrive as a notification, not an alarm.'
      : 'This phone can’t ring a real alarm, so the roll call arrives as a notification.')}</p>`;
  }
  const why = line.fix === 'settings' ? 'Alarms are switched off for OnStandard on this phone. Turn them on in Settings.'
    : line.fix === 'ask' ? 'OnStandard needs your OK once to set alarms on this phone.'
      : 'This phone has not set this alarm yet.';
  return `<p class="ra-s ra-why">${esc(why)}</p>
    <button type="button" class="btn ghost sm" data-rn-fix="${esc(line.fix)}">${esc(line.text)}</button>`;
}

export default {
  render({ sub } = {}) {
    const back = 'home';
    const m = assignedModel(rowsNow(), sub);
    if (!m) {
      if (A.forId !== sub || !A.loaded) return `${backHead('Roll call', 'Loading…', back)}${skeletonRows(3, 'Loading your roll call')}`;
      return `${backHead('Roll call', '', back)}${emptyState({ icon: 'sun', title: 'No roll call ahead', body: 'When your coach puts you on one, it shows here.', action: { go: 'home', label: 'Home' } })}`;
    }
    const pts = Math.round(WAKEUP_SHIFT * 100);   // the most a morning carries (it shares with a Recovery Standard)
    const clock = whenLabel(m.next).split(' · ')[1] || '';
    return `${backHead('Roll call', '', back)}
      <section class="card pad ra-hero">
        <p class="eyebrow">You’re on roll call</p>
        <h1 class="ra-t">${esc(m.title)}</h1>
        <p class="ra-when">${esc([m.days, clock].filter(Boolean).join(' at '))}${m.coach ? ` · ${esc(m.coach)}` : ''}</p>
        <p class="ra-s">Up on time counts up to +${pts} on your day. Late counts half.</p>
        ${m.message ? `<p class="ra-msg">“${esc(m.message)}”</p>` : ''}
      </section>
      <section class="card pad ra-alarm" id="ra-alarm">${alarmBlock(alarmLine(A.state, m.next), m.next)}</section>
      <h2 class="eyebrow">Next mornings</h2>
      <ul class="card rows list ra-list">${m.upcoming.map((r) => `<li class="lrow"><div class="lm"><div class="lt">${esc(whenLabel(r))}</div></div></li>`).join('')}</ul>`;
  },

  mount(root, { sub } = {}) {
    const rerender = () => { if (root.isConnected && window.__render) window.__render(); };
    if (A.forId !== sub || Date.now() - A.at > STATE_FRESH_MS) {
      const fresh = A.forId !== sub;
      if (fresh) { A.forId = sub; A.loaded = false; A.state = null; }
      A.at = Date.now();
      void markRollcallSeen(sub || null);   // once per id per session (rollcall-v3-data.js)
      const id = sub;
      Promise.all([fresh ? loadMineAhead(true) : null, wakeAlarmState()])
        .then(([, st]) => {
          if (A.forId !== id) return;
          const same = A.loaded && JSON.stringify(A.state) === JSON.stringify(st);
          A.loaded = true; A.state = st; A.at = Date.now();
          if (!fresh && same) return;   // nothing new to show: no repaint
          rerender();
        },
          () => { if (A.forId !== id) return; A.loaded = true; A.at = Date.now(); rerender(); });
    }
    const fix = root.querySelector('[data-rn-fix]');
    if (fix) fix.addEventListener('click', () => {
      void fixAlarm(fix.getAttribute('data-rn-fix'), {
        host: root.querySelector('#ra-alarm'), rows: rowsNow(),
        after: async () => { A.state = await wakeAlarmState(); rerender(); },
      });
    });
  },
};
