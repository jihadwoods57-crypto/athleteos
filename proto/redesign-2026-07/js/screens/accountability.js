/* OnStandard — Morning Readiness / Accountability (0138).
   The rollup an athlete and their coach read. SEPARATE from the daily 0–100 score, and the screen
   says so out loud — conflating the two would be the easiest lie in the product.

   Weighting (founder call 2026-07-22): responding is a SMALL signal (10), arriving on time is
   MODERATE (30), completing the commitment is the GREATEST (60). A missed wake-up does not
   cascade; excused and unverified leave the denominator instead of counting as failures. */
import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { morningReadiness, commitmentStreak } from '../commitments.js';
import { loadMineRange, todayISO, shiftISO } from '../commitment-data.js';

let RANGE = 30;               // 7 | 30
let ROWS = null;              // cached rows for the current range
let LOADED_FOR = null;

function bar(label, done, total) {
  const pct = total ? Math.round((done / total) * 100) : null;
  return `
  <div class="vc-mr">
    <div class="vc-mr-top"><span class="vc-mr-l">${esc(label)}</span>
      <span class="vc-mr-n">${total ? `${done}/${total}` : '—'}</span></div>
    <div class="vc-mr-track"><div class="vc-mr-fill" style="width:${pct == null ? 0 : pct}%"></div></div>
  </div>`;
}

export default {
  tab: 'progress',
  render() {
    const rows = ROWS || [];
    const m = morningReadiness(rows);
    const streak = commitmentStreak(rows, todayISO());
    const loading = ROWS === null;

    if (!loading && !rows.length) {
      return `
      ${backHead('Morning Readiness', 'Verified commitments', 'progress')}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('clock', 17)}</div>
        <div><div class="tt">Nothing to show yet</div>
        <div class="ts">${S.coach.hasCoach
          ? `When your ${esc(S.coach.noun)} schedules a roll call, a lift, or a study hall`
          : 'When a roll call, a lift, or a study hall is scheduled for you'}, your responses and arrivals build this record. It's separate from your daily score.</div></div>
      </div>`;
    }

    return `
    ${backHead('Morning Readiness', `Last ${RANGE} days`, 'progress')}

    <section class="card pad" style="text-align:center">
      <div style="font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--green-bright)">
        ${loading ? '—' : (m.pct == null ? '—' : `${m.pct}%`)}</div>
      <div class="ts" style="padding-top:8px">Accountability across every commitment ${S.coach.hasCoach ? `your ${esc(S.coach.noun)} scheduled` : 'scheduled for you'}</div>
      ${streak ? `<div style="height:12px"></div>
      <span class="xpill green">${streak} day${streak === 1 ? '' : 's'} clean</span>` : ''}
    </section>

    <div style="height:12px"></div>
    <div style="display:flex;gap:6px">
      <button class="chip ${RANGE === 7 ? 'on' : ''}" data-range="7" style="flex:1">Last 7 days</button>
      <button class="chip ${RANGE === 30 ? 'on' : ''}" data-range="30" style="flex:1">Last 30 days</button>
    </div>

    <div class="eyebrow">The three signals</div>
    <section class="card pad">
      ${bar('Wake responses', m.wake.done, m.wake.total)}
      ${bar('On-time arrivals', m.arrival.done, m.arrival.total)}
      ${bar('Completed sessions', m.completion.done, m.completion.total)}
    </section>

    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">How this is weighted</div>
        <div class="ts">Responding counts a little, arriving on time counts more, finishing the session counts most. Sleeping through a roll call doesn't wreck your day — if you're on the field on time, you keep almost all of it. Anything your phone couldn't verify is left out entirely rather than counted against you.</div>
      </div>
    </div>

    <div class="sidebox" style="margin-top:10px">
      <div class="req-icon g" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div>
        <div class="tt">This is not your daily score</div>
        <div class="ts">Your daily number is still nutrition, recovery, commitment and the weekly check-in. This is a separate record of showing up.</div>
      </div>
    </div>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    const want = `${RANGE}:${todayISO()}`;
    if (LOADED_FOR !== want) {
      loadMineRange(shiftISO(todayISO(), -(RANGE - 1)), todayISO()).then((rows) => {
        ROWS = rows; LOADED_FOR = want;
        if (root.isConnected) window.__render && window.__render();
      });
    }
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      RANGE = +b.getAttribute('data-range');
      ROWS = null; LOADED_FOR = null;
      RT.vcRange = RANGE;
      window.__render && window.__render();
    }));
  },
};
