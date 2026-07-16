import { S, act, checkinProjection } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* Weekly Check-In (spec §16). Engine truth: the check-in component is earned by a real
   check-in inside the trailing 7 days (day.js checkinReal) — the Sunday ritual is a full
   six-question check-in submitted through the SAME engine (daySubmitCheckin), so nothing
   here is decorative. Closed state (not Sunday) is a compact summary, never a disabled
   form. Every 1–5 scale carries worded anchors; soreness scores in the correct direction
   (5 = severe → engine inverts). */

const WEEKLY_FIELDS = [
  { key: 'energy', k: 'Energy this week', lo: '1 · Very low', hi: '5 · Excellent' },
  { key: 'recovery', k: 'Recovery', lo: '1 · Poor', hi: '5 · Excellent' },
  { key: 'sleep', k: 'Sleep', lo: '1 · Poor', hi: '5 · Excellent' },
  { key: 'confidence', k: 'Confidence', lo: '1 · Very low', hi: '5 · Very high' },
  { key: 'soreness', k: 'Soreness', lo: '1 · None', hi: '5 · Severe' },
  { key: 'motivation', k: 'Motivation', lo: '1 · Very low', hi: '5 · Very high' },
];

export default {
  tab: 'home',
  render() {
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const daysToSunday = (7 - now.getDay()) % 7 || 7;
    const sunday = new Date(now); sunday.setDate(now.getDate() + (isSunday ? 0 : daysToSunday));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Already submitted a check-in today → the week is covered; show the receipt.
    if (DAY.ciSubmitted) {
      return `
      ${backHead('Weekly Check-In', 'This week is covered')}
      <div class="state-demo" style="border-style:solid;border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">Checked in</div>
        <div class="sd-s">Today's check-in holds your weekly points (10 of 100) for the next 7 days. Your readiness summary lives on your Recovery screen.</div>
      </div>
      <div style="height:10px"></div>`;
    }

    // ---- Closed state (not Sunday): compact summary, no disabled form (spec §16.1) ----
    if (!isSunday) {
      return `
      ${backHead('Weekly Check-In', 'A five-minute read on your week')}
      <section class="card pad" style="text-align:center">
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em">Opens Sunday</div>
        <div style="font-size:13px;font-weight:700;color:var(--text-2);margin-top:4px">${MON[sunday.getMonth()]} ${sunday.getDate()} · in ${daysToSunday} day${daysToSunday === 1 ? '' : 's'}</div>
        <div style="height:14px"></div>
        <div style="display:flex;justify-content:center;gap:24px">
          <div><div style="font-size:20px;font-weight:800;color:var(--green-bright)">10</div><div style="font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)">Points</div></div>
          <div><div style="font-size:20px;font-weight:800">6</div><div style="font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)">Questions</div></div>
          <div><div style="font-size:20px;font-weight:800">~1</div><div style="font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)">Minute</div></div>
        </div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:14px;line-height:1.5">Covers energy, recovery, sleep, confidence, soreness, and motivation.</div>
      </section>
      <div class="sidebox" style="margin-top:12px">
        <div class="req-icon p" style="width:38px;height:38px">${icon('moon', 17)}</div>
        <div><div class="tt">Your nightly check-in also counts</div>
        <div class="ts">Any check-in inside the last 7 days holds these points — tonight's recovery check-in covers the week too.</div></div>
      </div>
      <div style="height:10px"></div>`;
    }

    // ---- Open state (Sunday): the real form, engine-scored (spec §16.2/§16.3) ----
    const P = checkinProjection();
    return `
    ${backHead('Weekly Check-In', 'Open today · worth 10 of your 100')}
    <section class="card" style="padding:4px 18px 8px" id="wk-form">
      ${WEEKLY_FIELDS.map(f => `
        <div class="rec-field" data-ci-key="${f.key}">
          <div class="rec-top"><span class="rec-name">${f.k}</span><span class="rec-ends">${f.lo} → ${f.hi}</span></div>
          <div class="chips5" role="radiogroup" aria-label="${f.k}">
            ${[1, 2, 3, 4, 5].map(n => `<div class="c5" data-n="${n}" role="radio" aria-checked="false" aria-label="${f.k}: ${n} of 5">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:8px;padding:0 2px;line-height:1.5">Self-reported and scored as answered — soreness counts in the right direction (low soreness scores higher). Honest answers are the whole point.</div>
    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt" id="wk-gain">${P.gain > 0 ? `Worth up to +${P.gain} today` : 'Holds your weekly points for 7 days'}</div>
      <div class="ts">Your readiness summary will appear after you complete this week's check-in.</div></div>
    </div>
    <div style="height:14px"></div>
    <div id="wk-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;text-align:center"></div>
    <button class="btn primary" id="wk-submit">${icon('check', 19)} Submit Check-In</button>
    <div style="height:10px"></div>`;
  },
  mount(root) {
    const form = root.querySelector('#wk-form');
    if (!form) return; // closed / receipt states have no wiring
    const answers = {};
    form.querySelectorAll('[data-ci-key]').forEach(field => {
      const key = field.getAttribute('data-ci-key');
      const chips = field.querySelectorAll('.c5');
      chips.forEach(ch => ch.addEventListener('click', () => {
        chips.forEach(x => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        ch.classList.add('on');
        ch.setAttribute('aria-checked', 'true');
        answers[key] = (+ch.getAttribute('data-n')) * 2; // 1–5 → the engine's 0–10 scale
      }));
    });
    const btn = root.querySelector('#wk-submit');
    const err = root.querySelector('#wk-err');
    btn.addEventListener('click', () => {
      if (Object.keys(answers).length < WEEKLY_FIELDS.length) {
        err.textContent = 'Answer all six — it takes under a minute.';
        return;
      }
      act.submitRecovery(answers); // the ONE check-in engine: recovery + weekly both update
      window.__go('recovery-confirm');
    });
  },
};
