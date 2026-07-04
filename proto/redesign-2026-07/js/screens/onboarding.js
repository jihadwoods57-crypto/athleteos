import { S } from '../state.js';
import { icon } from '../icons.js';

/* 6-step onboarding: builds the athlete's Standard, not a survey.
   Steps: 1 about-you · 2 goal · 3 weights · 4 coach connect · 5 your standard · 6 set. */

const STEPS = 6;
function dots(n) {
  return `<div class="ob-dots">${Array.from({ length: STEPS }, (_, i) =>
    `<div class="d ${i + 1 <= n ? 'on' : ''}"></div>`).join('')}</div>`;
}
function frame(n, title, sub, body, cta, next, opts = {}) {
  return `
  <div class="ob">
    ${dots(n)}
    <div class="ob-title">${title}</div>
    <div class="ob-sub">${sub}</div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      <button class="btn ${opts.green ? 'green' : 'primary'}" ${opts.act ? `data-act="${opts.act}"` : ''} data-${opts.act ? 'then' : 'go'}="${next}">${cta}</button>
      ${opts.skip ? `<div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="${opts.skip}">Skip for now</div>` : ''}
    </div>
  </div>`;
}

const steps = {
  1: () => frame(1, 'Who are you?', 'Your coach sees this next to every log.', `
    <input class="ob-input" value="Jihad Woods" readonly />
    <div style="height:14px"></div>
    <div class="chip-row">
      <span class="chp on">Football</span><span class="chp">Basketball</span><span class="chp">Baseball</span>
      <span class="chp">Soccer</span><span class="chp">Track</span><span class="chp">Other</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Position</div>
    <div class="chip-row">
      <span class="chp">QB</span><span class="chp">RB</span><span class="chp on">WR</span><span class="chp">TE</span>
      <span class="chp">OL</span><span class="chp">DL</span><span class="chp">LB</span><span class="chp">DB</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Level</div>
    <div class="chip-row">
      <span class="chp">Youth</span><span class="chp on">High School</span><span class="chp">College</span><span class="chp">Pro</span>
    </div>`, 'Next', 'onboarding/2'),

  2: () => frame(2, 'What are we building?', 'This decides how your nutrition gets scored. Your coach can adjust it.', `
    <div class="choice-grid">
      <div class="choice on"><div class="cic" style="background:rgba(52,211,153,0.18);color:var(--green-bright)">${icon('arrowUp', 19)}</div>
        <div class="ct">Gain weight</div><div class="cs">Calorie floor · protein heavy</div></div>
      <div class="choice"><div class="cic" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('target', 19)}</div>
        <div class="ct">Lose fat</div><div class="cs">Calorie window · keep protein</div></div>
      <div class="choice"><div class="cic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 19)}</div>
        <div class="ct">Maintain</div><div class="cs">Consistency over everything</div></div>
      <div class="choice"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('bolt', 19)}</div>
        <div class="ct">Perform</div><div class="cs">Fuel training · recover hard</div></div>
    </div>`, 'Next', 'onboarding/3'),

  3: () => frame(3, 'Where are you now?', 'Weight is a season trend here, never a daily judgment.', `
    <div class="bignum-pair">
      <div class="bignum"><div class="bv">183.8</div><div class="bk">Current lb</div></div>
      <div class="bignum" style="border-color:var(--green-border)"><div class="bv" style="color:var(--green-bright)">188</div><div class="bk">Target lb</div></div>
    </div>
    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">How weight works in OnStandard</div>
      <div class="ts">You log it on your coach's schedule. It never moves your daily score, so one heavy morning can't wreck a perfect day.</div></div>
    </div>`, 'Next', 'onboarding/4'),

  4: () => frame(4, 'Connect your coach', 'Your work only counts as accountability when someone you respect can see it.', `
    <div class="code-boxes">
      <div class="cb filled">M</div><div class="cb filled">4</div><div class="cb filled">R</div>
      <div class="cb filled">K</div><div class="cb filled">7</div><div class="cb cursor"></div>
    </div>
    <div style="height:14px"></div>
    <section class="card team-preview">
      <div class="tp-av">M</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">${S.coach.name}'s Group</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${S.coach.team} · 24 athletes</div>
      </div>
      <span class="status-pill b">Match</span>
    </section>`, 'Join the Group', 'onboarding/5', { skip: 'onboarding/5' }),

  5: () => frame(5, 'Your Standard', 'These are the daily requirements your score is built on. Coach Mark can add more.', `
    <section class="card" style="padding:6px 16px">
      ${[
        ['utensils', 'g', 'Three meals, photo proof', 'Nutrition · 50% of your score'],
        ['moon', 'p', 'Recovery check-in before bed', 'Recovery · 25%'],
        ['check', 'b', 'One honest commitment tap', 'Commitment · 15%'],
        ['clipboard', 'g', 'Weekly check-in on Sundays', 'Check-in · 10%'],
        ['scale', 'a', 'Weight Mon / Wed / Fri', 'Season trend · not scored'],
      ].map(([ic, cl, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--surface-2)">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        </div>`).join('')}
    </section>
    <div style="height:12px"></div>
    <div class="chip-row" style="justify-content:center">
      <span class="chp">Remind me gently</span><span class="chp on">Hold me accountable</span><span class="chp">Max pressure</span>
    </div>`, 'Set My Standard', 'onboarding/6'),

  6: () => `
  <div class="ob">
    ${dots(6)}
    <div class="standard-set">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Starting now, your execution score is built from your meals, requirements, and check-ins. ${S.coach.name} can see whether you show up.</div>
      <div style="height:26px"></div>
      <div class="tiles2" style="text-align:left">
        <div class="tile"><div class="k">Score to beat</div><div class="v">80</div></div>
        <div class="tile"><div class="k">That tier</div><div class="v" style="color:var(--green-bright)">OnStandard</div></div>
      </div>
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn green" data-act="startDay0" data-then="home">Start Day 1</button>
    </div>
  </div>`,
};

export default {
  hideTabs: true,
  render({ sub }) {
    const n = Math.min(6, Math.max(1, +(sub || 1)));
    return steps[n]();
  },
};
