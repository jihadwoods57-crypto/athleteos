import { act } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* Daily Commitment (spec §2.5) — the substance behind 15% of the score.
   Two honest halves:
     1. Set today's personal commitment (a short intention, written in the athlete's words —
        persisted with the day so the coach sees intent, not just outcomes).
     2. Close the day with an end-of-day reflection: did you execute? The ANSWER sets the
        points (engine: yes=100, partial=60, no=0 → ×15%). An honest "off day" earns 0 and
        keeps the record true — that honesty is the behavior being trained.
   One implementation, engine-scored — never a decorative tap. */

const CHOICES = [
  { v: 'yes', t: 'I executed my plan', s: 'Meals, recovery, the work — today matched the intent.', pts: 15, cls: 'g' },
  { v: 'partial', t: 'Partially', s: 'Some of it happened. Honest counts more than perfect.', pts: 9, cls: 'a' },
  { v: 'no', t: 'Off day', s: 'It didn’t happen today. Logging it keeps your record real.', pts: 0, cls: 'r' },
];

export default {
  tab: 'home',
  render() {
    const ans = DAY.dailyCommitment;
    const focus = DAY.commitmentFocus || '';
    const chosen = CHOICES.find(c => c.v === ans);
    return `
    ${backHead('Daily Commitment', 'Intent in the morning. Truth at night. 15% of your score.')}

    <section class="card" style="margin-top:4px">
      <div class="eyebrow" style="margin:0 0 10px">Today's commitment</div>
      <input id="cmt-focus" class="input" maxlength="80" placeholder="One line — e.g. “No skipped meals, lights out by 10.”"
        value="${esc(focus)}" aria-label="Today's personal commitment" />
      <div class="ts" style="padding-top:8px">Optional, but it sharpens the reflection. Your coach sees what you committed to.</div>
    </section>

    <div class="eyebrow">End-of-day reflection</div>
    <section class="card">
      <div class="ts" style="padding-bottom:10px">Did you execute today's plan? Your honest answer sets the points — and your coach sees the answer, not a spun version.</div>
      ${CHOICES.map(c => `
        <div class="cmt-choice ${ans === c.v ? 'on ' + c.cls : ''}" data-choice="${c.v}" role="button" aria-pressed="${ans === c.v}">
          <div class="cmt-main">
            <div class="t">${c.t}</div>
            <div class="s">${c.s}</div>
          </div>
          <span class="cmt-pts ${c.cls}">${c.pts ? `+${c.pts}` : '0'} pts</span>
        </div>`).join('')}
      ${chosen ? `<div class="cmt-done">${icon('check', 15)} Reflection saved — ${chosen.pts ? `+${chosen.pts} points earned` : 'an honest zero, and your record stays true'}. You can change it until midnight.</div>` : ''}
    </section>

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">Why this is worth 15%</div>
        <div class="ts">Anyone can log a meal. Closing every day with an honest read on intent vs. execution is the habit coaches actually trust — and the one that compounds.</div>
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
