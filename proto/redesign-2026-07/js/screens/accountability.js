/* OnStandard — Morning Readiness / Accountability (0138).
   The rollup an athlete and their coach read. SEPARATE from the daily 0–100 score, and the screen
   says so out loud — conflating the two would be the easiest lie in the product.

   Weighting (founder call 2026-07-22): responding is a SMALL signal (10), arriving on time is
   MODERATE (30), completing the commitment is the GREATEST (60). A missed wake-up does not
   cascade; excused and unverified leave the denominator instead of counting as failures. */
import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, errorState } from '../components.js';
import { morningReadiness, commitmentStreak } from '../commitments.js';
import { loadMineRange, todayISO, shiftISO } from '../commitment-data.js';

let RANGE = 30;               // 7 | 30
let ROWS = null;              // cached rows for the current range
let LOADED_FOR = null;
let FAILED = null;            // range:date key of a failed read; cleared by Retry or a range change

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
    if (FAILED === `${RANGE}:${todayISO()}`) {
      return `
      ${backHead('Morning Readiness', 'Verified commitments', 'progress')}
      ${errorState({ title: "Couldn't load your record", body: 'Nothing was lost. Reconnect and it loads right here.', retryId: 'mr-retry' })}`;
    }
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
      </div>
      ${S.coach.hasCoach ? '' : `<div style="height:12px"></div>
      <button class="btn ghost" data-go="connect" style="width:100%">Connect a coach</button>`}`;
    }

    return `
    ${backHead('Morning Readiness', `Last ${RANGE} days`, 'progress')}

    <section class="card pad" style="text-align:center">
      ${/* Neutral ink, not green: green means "done / on standard" and a 38% painted in the
            done hue inflates the one number this feature promises never to inflate. The value
            speaks for itself; the bars below carry the detail. */''}
      <div style="font-size:var(--t-hero);font-weight:800;letter-spacing:var(--num-tight);line-height:1;color:var(--text)">
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

    <h2 class="eyebrow">The three signals</h2>
    <section class="card pad">
      ${bar('Wake responses', m.wake.done, m.wake.total)}
      ${bar('On-time arrivals', m.arrival.done, m.arrival.total)}
      ${bar('Completed sessions', m.completion.done, m.completion.total)}
    </section>

    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">How this is weighted</div>
        <div class="ts">Responding counts a little, arriving on time counts more, finishing the session counts most. Sleeping through a roll call doesn't wreck your day. If you're on the field on time, you keep almost all of it. Anything your phone couldn't verify is left out entirely rather than counted against you.</div>
      </div>
    </div>

    <div class="sidebox" style="margin-top:10px">
      <div class="req-icon g" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div>
        <div class="tt">This is not your daily score</div>
        <div class="ts">Your daily number is still nutrition and recovery. This is a separate record of showing up.</div>
      </div>
    </div>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    const want = `${RANGE}:${todayISO()}`;
    // FAILED gates the refetch: without it a persistent outage would loop
    // fetch -> render -> mount -> fetch forever. Retry clears it deliberately.
    if (LOADED_FOR !== want && FAILED !== want) {
      loadMineRange(shiftISO(todayISO(), -(RANGE - 1)), todayISO()).then((rows) => {
        if (rows === null) { FAILED = want; }
        else { ROWS = rows; LOADED_FOR = want; FAILED = null; }
        if (root.isConnected) window.__render && window.__render();
      });
    }
    const retry = root.querySelector('#mr-retry');
    if (retry) retry.addEventListener('click', () => {
      FAILED = null;
      window.__render && window.__render();
    });
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      RANGE = +b.getAttribute('data-range');
      ROWS = null; LOADED_FOR = null; FAILED = null;
      RT.vcRange = RANGE;
      window.__render && window.__render();
    }));
  },
};
