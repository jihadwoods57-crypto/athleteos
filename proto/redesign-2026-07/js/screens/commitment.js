import { act } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* Daily Commitment (spec §2.5). Score v2 dropped this component's weight to 0 across every
   profile (PROFILE_WEIGHTS, plan-style.js) — the reflection no longer moves the number, on
   any style or goal. This screen used to print the live weight and a per-choice point value
   ("+15 pts", "Why this is worth 15%"); with the weight permanently 0 that copy would be
   printing "+0 pts" and "worth 0%" everywhere, which reads as broken, not honest. The value
   proposition is now the true one: the coach reads it, the score doesn't move.
   Two honest halves remain:
     1. Set today's personal commitment (a short intention, written in the athlete's words —
        persisted with the day so the coach sees intent, not just outcomes).
     2. Close the day with an end-of-day reflection: did you execute? The answer is recorded
        and shown to the coach — it is never scored. An honest "off day" costs nothing and
        keeps the record true — that honesty is the behavior being trained. */

const VALUE_PROP = 'Your coach sees this. It doesn’t change your score, so answer it straight.';

const CHOICES = [
  { v: 'yes', t: 'I executed my plan', s: 'Meals, recovery, the work: today matched the intent.', cls: 'g' },
  { v: 'partial', t: 'Partially', s: 'Some of it happened. Honest counts more than perfect.', cls: 'a' },
  { v: 'no', t: 'Off day', s: 'It didn’t happen today. Logging it keeps your record real.', cls: 'r' },
];

export default {
  tab: 'home',
  render() {
    const ans = DAY.dailyCommitment;
    const focus = DAY.commitmentFocus || '';
    const chosen = CHOICES.find(c => c.v === ans);
    return `
    ${backHead('Daily Commitment', 'Intent in the morning. Truth at night.')}

    <section class="card" style="margin-top:4px">
      <h2 class="eyebrow" style="margin:0 0 10px">Today's commitment</h2>
      <input id="cmt-focus" class="input" maxlength="80" placeholder="One line, e.g. “No skipped meals, lights out by 10.”"
        value="${esc(focus)}" aria-label="Today's personal commitment" />
      <div class="ts" style="padding-top:8px">Optional, but it sharpens the reflection. Your coach sees what you committed to.</div>
    </section>

    <h2 class="eyebrow">End-of-day reflection</h2>
    <section class="card">
      <div class="ts" style="padding-bottom:10px">Did you execute today's plan? ${esc(VALUE_PROP)}</div>
      ${CHOICES.map(c => `
        <div class="cmt-choice ${ans === c.v ? 'on ' + c.cls : ''}" data-choice="${c.v}" role="button" tabindex="0" aria-pressed="${ans === c.v}">
          <div class="cmt-main">
            <div class="t">${c.t}</div>
            <div class="s">${c.s}</div>
          </div>
        </div>`).join('')}
      ${chosen ? `<div class="cmt-done">${icon('check', 15)} Reflection saved. Your coach can see it. You can change it until midnight.</div>` : ''}
    </section>

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">Why this is worth answering honestly</div>
        <div class="ts">Anyone can log a meal. Closing every day with an honest read on intent vs. execution is the habit coaches actually trust, even though it never touches your Daily Score.</div>
      </div>
    </div>
    <div style="height:8px"></div>`;
  },
  mount(root) {
    const input = root.querySelector('#cmt-focus');
    const saveFocus = () => act.saveDayFocus((input.value || '').trim().slice(0, 80));
    if (input) input.addEventListener('change', saveFocus);
    root.querySelectorAll('[data-choice]').forEach(el => {
      el.addEventListener('click', () => {
        if (input) saveFocus();
        act.setCommitment(el.getAttribute('data-choice'));
        window.__render && window.__render();
      });
    });
  },
};
