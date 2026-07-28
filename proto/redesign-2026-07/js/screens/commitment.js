import { act } from '../state.js';
import { DAY, weightsForDay } from '../day.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* Daily Commitment (spec §2.5) — the substance behind the commitment slice of the score
   (10–15%, set by the plan style x goal profile; the screen prints the real number).
   Two honest halves:
     1. Set today's personal commitment (a short intention, written in the athlete's words —
        persisted with the day so the coach sees intent, not just outcomes).
     2. Close the day with an end-of-day reflection: did you execute? The ANSWER sets the
        points (engine: yes=100, partial=60, no=0 → × the commitment weight). An honest "off day" earns 0 and
        keeps the record true — that honesty is the behavior being trained.
   One implementation, engine-scored — never a decorative tap. */

const CHOICES = [
  // No `pts` here on purpose — the points are derived from the live weight in render (ptsFor).
  { v: 'yes', t: 'I executed my plan', s: 'Meals, recovery, the work — today matched the intent.', cls: 'g' },
  { v: 'partial', t: 'Partially', s: 'Some of it happened. Honest counts more than perfect.', cls: 'a' },
  { v: 'no', t: 'Off day', s: 'It didn’t happen today. Logging it keeps your record real.', cls: 'r' },
];

export default {
  tab: 'home',
  render() {
    const ans = DAY.dailyCommitment;
    const focus = DAY.commitmentFocus || '';
    const chosen = CHOICES.find(c => c.v === ans);
    // Commitment weight depends on BOTH the plan style and the goal profile (e.g. guided+gain is
    // 12%, structured+gain 10%, most rows 15%) — read the engine's own mix, never a constant and
    // never a profile-only lookup, which lied to Guided athletes as well as gain-goal ones.
    const cmtPct = Math.round(weightsForDay(DAY).commitment * 100);
    const ptsFor = (v) => v === 'yes' ? cmtPct : v === 'partial' ? Math.round(cmtPct * 0.6) : 0;
    return `
    ${backHead('Daily Commitment', `Intent in the morning. Truth at night. ${cmtPct}% of your score.`)}

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
          <span class="cmt-pts ${c.cls}">${ptsFor(c.v) ? `+${ptsFor(c.v)}` : '0'} pts</span>
        </div>`).join('')}
      ${chosen ? `<div class="cmt-done">${icon('check', 15)} Reflection saved — ${ptsFor(chosen.v) ? `+${ptsFor(chosen.v)} points earned` : 'an honest zero, and your record stays true'}. You can change it until midnight.</div>` : ''}
    </section>

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('target', 19)}</div>
      <div>
        <div class="tt">Why this is worth ${cmtPct}%</div>
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
