import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';

/* 6-step onboarding: builds the athlete's Standard, not a survey.
   Steps: 1 about-you · 2 goal · 3 weights · 4 coach connect · 5 your standard · 6 set.
   Every selection is the REAL user's — captured into RT.ob as they go (DOM is wiped between
   routes) and written to the account on step 6. Nothing here fabricates an identity. */

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
const numInput = 'width:100%;background:transparent;border:none;outline:none;text-align:center;font-size:34px;font-weight:800;color:inherit;font-family:inherit;padding:0';

const steps = {
  1: () => frame(1, 'Who are you?', 'Your coach sees this next to every log.', `
    <input id="ob-name" class="ob-input" placeholder="Your name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:14px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Sport</div>
    <div class="chip-row" id="ob-sport">
      <span class="chp on">Football</span><span class="chp">Basketball</span><span class="chp">Baseball</span>
      <span class="chp">Soccer</span><span class="chp">Track</span><span class="chp">Other</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Position</div>
    <div class="chip-row" id="ob-pos">
      <span class="chp">QB</span><span class="chp">RB</span><span class="chp on">WR</span><span class="chp">TE</span>
      <span class="chp">OL</span><span class="chp">DL</span><span class="chp">LB</span><span class="chp">DB</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Level</div>
    <div class="chip-row" id="ob-level">
      <span class="chp">Youth</span><span class="chp on">High School</span><span class="chp">College</span><span class="chp">Pro</span>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:16px;line-height:1.5">You must be 13 or older. Under 13 requires a parent or guardian on the account, and parents of minors can request data access or deletion anytime.</div>`, 'Next', 'onboarding/2'),

  2: () => frame(2, 'What are we building?', 'This decides how your nutrition gets scored. Your coach can adjust it.', `
    <div class="choice-grid" id="ob-goal">
      <div class="choice on" data-val="gain"><div class="cic" style="background:rgba(52,211,153,0.18);color:var(--green-bright)">${icon('arrowUp', 19)}</div>
        <div class="ct">Gain weight</div><div class="cs">Calorie floor · protein heavy</div></div>
      <div class="choice" data-val="lose"><div class="cic" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('target', 19)}</div>
        <div class="ct">Lose fat</div><div class="cs">Calorie window · keep protein</div></div>
      <div class="choice" data-val="maintain"><div class="cic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 19)}</div>
        <div class="ct">Maintain</div><div class="cs">Consistency over everything</div></div>
      <div class="choice" data-val="perform"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('bolt', 19)}</div>
        <div class="ct">Perform</div><div class="cs">Fuel training · recover hard</div></div>
    </div>`, 'Next', 'onboarding/3'),

  3: () => frame(3, 'Where are you now?', 'Weight is a season trend here, never a daily judgment.', `
    <div class="bignum-pair">
      <div class="bignum"><input id="ob-cur" type="number" inputmode="decimal" placeholder="—" style="${numInput}" /><div class="bk">Current lb</div></div>
      <div class="bignum" style="border-color:var(--green-border)"><input id="ob-tgt" type="number" inputmode="decimal" placeholder="—" style="${numInput};color:var(--green-bright)" /><div class="bk">Target lb</div></div>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Allergies & restrictions · enforced on every scan</div>
    <div class="chip-row" data-multi>
      <span class="chp">Peanuts · severe</span><span class="chp">Tree nuts</span><span class="chp">Dairy</span>
      <span class="chp">Gluten</span><span class="chp">Shellfish</span><span class="chp">Vegetarian</span><span class="chp">Halal</span>
    </div>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">How weight works in OnStandard</div>
      <div class="ts">You log it on your coach's schedule. It never moves your daily score, so one heavy morning can't wreck a perfect day.</div></div>
    </div>`, 'Next', 'onboarding/4'),

  4: () => frame(4, 'Connect your coach', 'A coach code links your logs to someone who holds you accountable.', `
    <input id="ob-code" class="ob-input" placeholder="Coach code (optional)" autocapitalize="characters" autocorrect="off" spellcheck="false" />
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 18)}</div>
      <div><div class="tt">No code yet? Skip it.</div>
      <div class="ts">Your Standard works solo from day one. When a coach shares a code, add it any time from Profile → Enter coach code.</div></div>
    </div>`, 'Continue', 'onboarding/5', { skip: 'onboarding/5' }),

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
    <div class="chip-row" id="ob-pressure" style="justify-content:center">
      <span class="chp">Remind me gently</span><span class="chp on">Hold me accountable</span><span class="chp">Max pressure</span>
    </div>`, 'Set My Standard', 'onboarding/6'),

  6: () => `
  <div class="ob">
    ${dots(6)}
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:18px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Create your account to save it — your score, meals, and coach connection sync across devices.</div>
    </div>
    <div style="height:16px"></div>
    <input id="su-email" class="ob-input" type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Email" />
    <div style="height:12px"></div>
    <input id="su-pass" class="ob-input" type="password" placeholder="Create a password (6+ characters)" />
    <div id="su-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;margin-top:12px;text-align:center"></div>
    <div class="ob-foot" style="margin-top:auto">
      <button id="su-go" class="btn green">Create account &amp; Start</button>
    </div>
  </div>`,
};

export default {
  hideTabs: true,
  render({ sub }) {
    const n = Math.min(6, Math.max(1, +(sub || 1)));
    return steps[n]();
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    // single-select groups everywhere EXCEPT [data-multi] (allergies toggle independently)
    root.querySelectorAll('.chip-row:not([data-multi]), .choice-grid').forEach(g => g.setAttribute('data-toggle-group', ''));
    wireToggles(root);
    root.querySelectorAll('[data-multi] .chp').forEach(ch =>
      ch.addEventListener('click', () => ch.classList.toggle('on')));

    const grab = (s) => root.querySelector(s);
    const cap = (patch) => act.captureOb(patch);
    // Persist the selected chip of a single-select group into RT.ob[key] on every change,
    // and once up front so the accepted default is captured even if the user never taps.
    const wireGroup = (sel, key, read) => {
      const g = grab(sel); if (!g) return;
      const val = read || (() => { const on = g.querySelector('.on'); return on ? on.textContent.trim() : null; });
      const sync = () => { const v = val(); if (v != null) cap({ [key]: v }); };
      g.addEventListener('click', sync);
      sync();
    };

    // ---- Step 1: name is REQUIRED (gates Next) + sport / position / level ----
    const nameEl = grab('#ob-name');
    if (nameEl) {
      const nextBtn = root.querySelector('.ob-foot .btn');
      const sync = () => { cap({ name: nameEl.value.trim() }); if (nextBtn) nextBtn.disabled = !nameEl.value.trim(); };
      nameEl.addEventListener('input', sync);
      sync(); // starts empty → Next disabled until a real name is typed
    }
    wireGroup('#ob-sport', 'sport');
    wireGroup('#ob-pos', 'position');
    wireGroup('#ob-level', 'level');

    // ---- Step 2: goal (slug from data-val) ----
    wireGroup('#ob-goal', 'goal', () => { const on = grab('#ob-goal .on'); return on ? on.getAttribute('data-val') : null; });

    // ---- Step 3: weights + allergies (none selected by default) ----
    const cur = grab('#ob-cur'); if (cur) cur.addEventListener('input', () => cap({ currentWeight: parseFloat(cur.value) || null }));
    const tgt = grab('#ob-tgt'); if (tgt) tgt.addEventListener('input', () => cap({ targetWeight: parseFloat(tgt.value) || null }));
    const alg = grab('[data-multi]');
    if (alg) { const readA = () => cap({ allergies: [...alg.querySelectorAll('.chp.on')].map(c => c.textContent.trim()) }); alg.addEventListener('click', readA); readA(); }

    // ---- Step 4: coach code (captured for the later real-join phase; no fabricated "match") ----
    const code = grab('#ob-code'); if (code) code.addEventListener('input', () => cap({ coachCode: code.value.trim() }));

    // ---- Step 5: reminder pressure ----
    wireGroup('#ob-pressure', 'pressure');

    // ---- Step 6: real account creation from the captured Standard ----
    const btn = root.querySelector('#su-go');
    if (btn) {
      const err = root.querySelector('#su-err');
      const emailEl = root.querySelector('#su-email');
      const passEl = root.querySelector('#su-pass');
      const submit = async () => {
        err.textContent = '';
        const ob = RT.ob || {};
        const name = (ob.name || '').trim();
        const email = (emailEl.value || '').trim();
        const password = passEl.value || '';
        if (!name) { err.textContent = 'Add your name in step 1 before creating your account.'; return; }
        if (!email || !password) { err.textContent = 'Enter an email and a password.'; return; }
        if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
        btn.disabled = true;
        btn.textContent = 'Creating your account…';
        const r = await act.signUp(email, password, name, 'athlete');
        if (r.ok) {
          act.startDay0();
          // Reflect the athlete's REAL identity locally so Home shows who they are immediately.
          act.saveProfile({ name, sport: ob.sport || '', position: ob.position || '', level: ob.level || '' });
          act.saveAllergies(ob.allergies || []);
          // Best-effort server profile — real columns only (0001_schema.sql athlete_profiles).
          const fields = {};
          if (ob.sport) fields.sport = ob.sport;
          if (ob.position) fields.position = ob.position;
          if (ob.level) fields.level = ob.level;
          if (ob.goal) fields.base_goal = ob.goal;
          if (ob.currentWeight) fields.base_weight = Math.round(ob.currentWeight);
          if (ob.currentWeight || ob.targetWeight) fields.season_goal = { start: ob.currentWeight || null, target: ob.targetWeight || null };
          act.saveAthleteProfile(fields);
          window.__go('home');
        } else {
          err.textContent = r.error || 'Could not create your account.';
          btn.disabled = false;
          btn.textContent = 'Create account & Start';
        }
      };
      btn.addEventListener('click', submit);
      passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
  },
};
