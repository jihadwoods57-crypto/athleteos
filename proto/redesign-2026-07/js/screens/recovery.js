import { S, RT, act, tier, checkinProjection } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

export const recoveryConfirm = {
  tab: 'home',
  hideTabs: true,
  render() {
    const mv = RT.lastMove || { from: S.score, to: S.score, gain: 0 };
    const toTier = tier(mv.to);
    const promoted = tier(mv.from).name !== toTier.name;
    return `
    <div class="confirm-wrap">
      <div class="big-check"><div class="core" style="background:linear-gradient(155deg, var(--purple-bright), #7e22ce); color:#fff; box-shadow: 0 0 44px rgba(168,85,247,0.55), 0 10px 34px rgba(0,0,0,0.4)">${icon('moon', 32)}</div></div>
      <div class="confirm-title">Check-In Submitted</div>
      <div class="confirm-sub">Recovery refreshed · ${S.coach.name} can see your readiness</div>

      <div class="score-move">
        <span class="from" data-anim-from>${mv.from}</span>
        <span class="arr">${icon('arrowRight', 26)}</span>
        <span class="to" data-anim-to>${mv.to}</span>
      </div>
      <div class="confirm-sub" style="margin-top:0">OnStandard Score · +${mv.gain} pts</div>
      ${promoted ? `<span class="tier-chip ${toTier.cls}" style="margin-top:16px; font-size:12.5px; padding:7px 18px">${toTier.name}</span>
      ${S.streakDays > 0 ? `<div class="confirm-sub" style="margin-top:10px">You finished the day on standard. Day ${S.streakDays} locks at midnight.</div>` : ''}` : ''}

      ${S.nextMove ? '' : `
      <div style="height:20px"></div>
      <div class="day-done" style="width:100%; text-align:left">
        <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
        <div><div class="tt">Every requirement is in.</div>
        <div class="ts">This is what OnStandard looks like. Same again tomorrow.</div></div>
      </div>`}
    </div>
    <div style="height:22px"></div>
    <button class="btn primary" data-go="home">Back Home</button>
    <div style="height:10px"></div>
    <button class="btn ghost sm" data-go="progress">See the week</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const to = root.querySelector('[data-anim-to]');
    if (to) {
      const target = +to.textContent; const t0 = performance.now(); const from = +root.querySelector('[data-anim-from]').textContent;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 900);
        to.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  },
};

export default {
  tab: 'home',
  render() {
    if (RT.recoveryDone) {
      return `
      ${backHead('Recovery Check-In', 'Done for tonight')}
      <div class="state-demo" style="border-style:solid; border-color:var(--green-border)">
        <div class="sd-ic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 24)}</div>
        <div class="sd-t">Submitted tonight</div>
        <div class="sd-s">Recovery counted · scored ${S.components.now.recovery}. ${S.coach.name} can see your readiness before tomorrow's practice.</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="home">Back Home</button></div>
      </div>`;
    }
    const R = S.recovery;
    const P = checkinProjection();
    return `
    ${backHead('Recovery Check-In', 'Before bed · Refreshes Recovery (25% of score)')}

    <section class="card" style="padding: 4px 18px 8px">
      ${R.fields.map(f => `
        <div class="rec-field" data-ci-key="${f.key}">
          <div class="rec-top">
            <span class="rec-name">${f.k}</span>
            <span class="rec-ends">${f.lo} → ${f.hi}</span>
          </div>
          <div class="chips5" data-toggle-group>
            ${[1,2,3,4,5].map(n => `<div class="c5 ${n === f.val ? 'on' : ''}" data-n="${n}">${n}</div>`).join('')}
          </div>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:8px;padding:0 2px;line-height:1.5">Answers are self-reported. What you enter here becomes your Recovery score, so keep it honest.</div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon p" style="width:38px;height:38px">${icon('moon', 18)}</div>
      <div><div class="tt" id="rec-gain">${P.gain > 0 ? `Worth +${P.gain} tonight → ${P.to}` : 'Refreshes Recovery (25% of your score)'}</div>
      <div class="ts">Takes 20 seconds. ${S.coach.name} sees your readiness before tomorrow's practice.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn primary" id="rec-submit" style="background:linear-gradient(150deg, var(--purple-bright), #7e22ce); box-shadow: 0 10px 30px rgba(168,85,247,0.35)">
      ${icon('check', 19)} Submit Check-In
    </button>
    <div style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);margin-top:12px">Coach can see your update</div>
    <div style="height:8px"></div>
    `;
  },
  mount(root) {
    // The chips are the real scoring inputs: 1–5 selection maps to the engine's 0–10 scale
    // as n*2. Selections update live; submit sends the ACTUAL answers to the engine.
    const answers = {};
    root.querySelectorAll('[data-ci-key]').forEach(field => {
      const key = field.getAttribute('data-ci-key');
      const chips = field.querySelectorAll('.c5');
      chips.forEach(ch => {
        const n = +ch.getAttribute('data-n');
        if (ch.classList.contains('on')) answers[key] = n * 2;
        ch.addEventListener('click', () => {
          chips.forEach(x => x.classList.remove('on'));
          ch.classList.add('on');
          answers[key] = n * 2;
          const g = root.querySelector('#rec-gain');
          if (g) {
            const p = checkinProjection(answers);
            g.textContent = p.gain > 0 ? `Worth +${p.gain} tonight → ${p.to}` : 'Refreshes Recovery (25% of your score)';
          }
        });
      });
    });
    const submit = root.querySelector('#rec-submit');
    if (submit) submit.addEventListener('click', () => {
      act.submitRecovery(answers);
      window.__go('recovery-confirm');
    });
  },
};
