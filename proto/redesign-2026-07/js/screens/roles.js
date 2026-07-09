import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, logoMark, esc } from '../components.js';
import { accountBody, wireAccount } from './ob-account.js';

/* ============================================================
   Role picker + onboarding for every role, not just athletes.
   Client scoring honesty: the shipped engine has a 'general'
   scoring profile (calorie window 45 / protein 25 / meals 30
   inside Nutrition) — the client flow states that, truthfully.
   ============================================================ */

function dots(n, total) {
  return `<div class="ob-dots">${Array.from({ length: total }, (_, i) =>
    `<div class="d ${i + 1 <= n ? 'on' : ''}"></div>`).join('')}</div>`;
}
function progressOf(n, total) {
  return `<div class="ob-prog" role="progressbar" aria-label="Step ${n} of ${total}" aria-valuenow="${n}" aria-valuemax="${total}">${
    Array.from({ length: total }, (_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}
function frame(n, total, title, sub, body, cta, next, opts = {}) {
  return `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="${opts.back || 'role'}" aria-label="Back">${icon('chevron', 18)}</div>${progressOf(n, total)}</div>
    <div class="ob-title">${title}</div>
    <div class="ob-sub">${sub}</div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      <button class="btn ${opts.green ? 'green' : 'primary'}" ${opts.id ? `id="${opts.id}"` : ''} data-go="${next}">${cta}</button>
      ${opts.skip ? `<div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="${opts.skip}">Skip for now</div>` : ''}
    </div>
  </div>`;
}
async function toggles(root) {
  const { wireToggles } = await import('./settings.js');
  root.querySelectorAll('.chip-row:not([data-multi]), .choice-grid, .seg').forEach(g => g.setAttribute('data-toggle-group', ''));
  wireToggles(root);
  root.querySelectorAll('[data-multi] .chp').forEach(ch =>
    ch.addEventListener('click', () => ch.classList.toggle('on')));
}

/* ---------- Sign-in role select: every role lands on ITS dashboard ---------- */
export const signin = {
  hideTabs: true,
  render() {
    const row = (go, ic, cls, t, s) => `
      <div class="lrow" data-go="${go}">
        <div class="lic" style="${cls}">${icon(ic, 18)}</div>
        <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>`;
    return `
    ${backHead('Sign in as', 'Every role gets its own dashboard', 'welcome')}
    <section class="card" style="padding:6px 16px">
      ${row('home', 'bolt', 'background:rgba(52,211,153,0.18);color:var(--green-bright)', 'Jihad Woods · Athlete', 'Home, plan, camera, progress')}
      ${row('coach', 'users', 'background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204', 'Coach Mark · Coach', 'Team board, assign, plan, Copilot')}
      ${row('trainer', 'heart', 'background:rgba(168,85,247,0.18);color:var(--purple-bright)', 'Tracy Boone · Trainer', 'Clients, readiness, notes')}
      ${row('parent', 'lock', 'background:var(--blue-surface);color:var(--blue-bright)', 'Parent of Jihad', 'Score and streaks, privacy-scoped')}
    </section>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">One account, one role</div>
      <div class="ts">In the real app your login knows who you are. This picker stands in for that.</div></div>
    </div>`;
  },
};

/* ---------- Role picker ---------- */
export const role = {
  hideTabs: true,
  render() {
    const card = (go, ic, cls, t, s) => `
      <div class="choice" data-go="${go}" style="cursor:pointer">
        <div class="cic" style="${cls}">${icon(ic, 19)}</div>
        <div class="ct">${t}</div><div class="cs">${s}</div>
      </div>`;
    return `
    <div class="ob">
      <div style="width:56px;height:56px;margin:6px auto 18px">${logoMark(56, 'role')}</div>
      <div class="ob-title" style="text-align:center">Who are you?</div>
      <div class="ob-sub" style="text-align:center">Each role gets its own view. Nothing shared that shouldn't be.</div>
      <div class="ob-body">
        <div class="choice-grid">
          ${card('onboarding/1', 'bolt', 'background:rgba(52,211,153,0.18);color:var(--green-bright)', 'Athlete', 'Execute your coach’s standard')}
          ${card('client-ob/1', 'user', 'background:var(--blue-surface);color:var(--blue-bright)', 'Client', 'Train with a coach or trainer, no team')}
          ${card('coach-ob/1', 'users', 'background:rgba(245,165,36,0.18);color:var(--amber-bright)', 'Coach', 'Set the standard, see who executes')}
          ${card('trainer-ob/1', 'heart', 'background:rgba(168,85,247,0.18);color:var(--purple-bright)', 'Trainer', 'Clients, readiness, consistency')}
        </div>
        <div style="height:16px"></div>
        <div class="sidebox">
          <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
          <div><div class="tt">Parents</div>
          <div class="ts">Parents join from their athlete's invite, not here. They see scores and streaks, never photos or weight.</div></div>
        </div>
      </div>
      <div class="ob-foot">
        <div style="text-align:center;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="welcome">Back</div>
      </div>
    </div>`;
  },
};

/* ============ COACH ONBOARDING (5 steps + code screen) ============ */
const coachSteps = {
  1: () => frame(1, 5, 'You, coach.', 'Your athletes see this name on every standard you set.', `
    <input id="co-first" class="ob-input" placeholder="First name" autocapitalize="words" />
    <div style="height:12px"></div>
    <input id="co-last" class="ob-input" placeholder="Last name" autocapitalize="words" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Your role</div>
    <div class="chip-row" id="co-role">
      <span class="chp on">Head Coach</span><span class="chp">Assistant</span><span class="chp">S&amp;C</span><span class="chp">Nutrition</span>
    </div>`, 'Next', 'coach-ob/2', { back: 'role' }),

  2: () => {
    const c = (RT.ob || {}).coach || {};
    return frame(2, 5, 'Your school.', 'Athletes find you by school. Same-name schools split by city.', c.schoolName ? `
      <section class="card team-preview">
        <div class="tp-av">${esc(c.schoolName[0])}</div>
        <div style="flex:1"><div style="font-size:16px;font-weight:800">${esc(c.schoolName)}</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc([c.city, c.state].filter(Boolean).join(', ') || '—')}</div></div>
        <span class="status-pill g">Set</span>
      </section>
      <div style="height:12px"></div>
      <div style="text-align:center;font-size:13px;font-weight:700;color:var(--text-3);cursor:pointer" id="co-school-clear">Change school</div>` : `
      <input id="co-q" class="ob-input" placeholder="Search your school" autocorrect="off" spellcheck="false" />
      <div id="co-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="co-add" style="text-align:center;font-size:14px;font-weight:700;color:var(--amber-bright);cursor:pointer">My school isn't listed — add it</div>`,
      'Next', 'coach-ob/3', { back: 'coach-ob/1' });
  },

  3: () => frame(3, 5, 'Build the team.', 'Athletes join it with one code. You can run more than one group.', `
    <input id="co-team" class="ob-input" placeholder="Team name (e.g. Varsity Football)" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Sport</div>
    <div class="chip-row" id="co-sport">
      <span class="chp on">Football</span><span class="chp">Basketball</span><span class="chp">Baseball</span><span class="chp">Track</span><span class="chp">Other</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Level</div>
    <div class="chip-row" id="co-level">
      <span class="chp">Youth</span><span class="chp on">High School</span><span class="chp">College</span><span class="chp">Pro</span>
    </div>
    <div style="height:16px"></div>
    <div class="lrow" style="cursor:default;padding:0 2px">
      <div class="lm"><div class="lt">Listed in school search</div><div class="ls">Athletes at your school can find this team. The code is still required to join.</div></div>
      <div class="seg" style="width:104px" id="co-disc"><button class="on">On</button><button>Off</button></div>
    </div>`, 'Next', 'coach-ob/4', { back: 'coach-ob/2' }),

  4: () => frame(4, 5, 'Set the team standard.', 'Every athlete starts with these. Adjust per athlete anytime.', `
    <section class="card" style="padding:6px 16px">
      ${[
        ['utensils', 'g', 'Three meals · photo proof', 'Nutrition · 50% of score', true],
        ['moon', 'p', 'Recovery check-in · nightly', 'Recovery · 25%', true],
        ['clipboard', 'g', 'Weekly check-in · Sundays', 'Check-in · 10%', true],
        ['scale', 'a', 'Weight · Mon / Wed / Fri', 'Season trend · not scored', true],
        ['droplet', 'b', 'Hydration · 120 oz', 'Focus item · optional', false],
      ].map(([ic, cl, t, s, on]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="color:var(--${cl === 'g' ? 'green-bright' : cl === 'p' ? 'purple-bright' : cl === 'b' ? 'cyan' : 'amber-bright'})">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
          <div class="seg" style="width:104px">
            <button class="${on ? 'on' : ''}">On</button><button class="${on ? '' : 'on'}">Off</button>
          </div>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:10px">The score model itself doesn't bend: four honest components, weight never scored daily.</div>`,
    'Next', 'coach-ob/5', { back: 'coach-ob/3' }),

  5: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="coach-ob/4">${icon('chevron', 18)}</div>${progressOf(5, 5)}</div>
    <div class="ob-title">Create your account.</div>
    <div class="ob-sub">Your team, code, and roster live on it.</div>
    <div style="height:8px"></div>
    ${accountBody({ terms: 'cob' })}
    <div class="ob-foot" style="margin-top:auto"><button id="su-go" class="btn primary" disabled>Create account &amp; Get my code</button></div>
  </div>`,

  6: () => {
    const code = (RT.ob || {}).teamCode || '';
    return `
  <div class="ob">
    <div class="standard-set">
      <div class="halo"><div class="core" style="background:linear-gradient(155deg,#f59e0b,#d97706)">${icon('users', 34)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your team code.</div>
      <div class="ob-sub" style="padding:0 8px">Send it to the group chat. Athletes enter it once and their work starts counting toward your board.</div>
      <div style="height:22px"></div>
      ${code ? `<div class="code-boxes">${code.split('').map((c) => `<div class="cb filled" style="border-color:var(--amber-border);background:rgba(245,165,36,0.08)">${c}</div>`).join('')}</div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:0 auto">${icon('clipboard', 16)} Copy code</button>` :
      `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
        <div><div class="tt">Code pending</div><div class="ts">We couldn't mint your code yet (connection or pending email confirmation). It generates automatically on your next sign-in — check Profile → Team code.</div></div></div>`}
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn primary" data-go="coach">Open Coach Dashboard</button>
    </div>
  </div>`;
  },
};

export const coachOb = {
  hideTabs: true,
  render({ sub }) {
    const n = Math.min(6, Math.max(1, +(sub || 1)));
    return coachSteps[n]();
  },
  async mount(root) {
    await toggles(root);
    const cap = (patch) => act.captureOb({ coach: { ...((RT.ob || {}).coach || {}), ...patch } });
    const $ = (s) => root.querySelector(s);
    // step 1: names + role chips
    const f = $('#co-first');
    if (f) {
      const l = $('#co-last'), roleRow = $('#co-role');
      const nextBtn = root.querySelector('.ob-foot .btn');
      const c = (RT.ob || {}).coach || {};
      if (c.name) { const [cf, ...cl] = c.name.split(' '); f.value = cf; l.value = cl.join(' '); }
      const sync = () => {
        const name = `${f.value.trim()} ${l.value.trim()}`.trim();
        const on = roleRow.querySelector('.on');
        cap({ name, staffRole: on ? on.textContent.trim() : 'Head Coach' });
        act.captureOb({ name }); // account step + profiles.full_name read RT.ob.name
        nextBtn.disabled = !(f.value.trim() && l.value.trim());
      };
      [f, l].forEach((el) => el.addEventListener('input', sync));
      roleRow.addEventListener('click', sync);
      sync();
    }
    // step 2: school search / add-your-school (anon directory — no session yet)
    const q = $('#co-q');
    if (q) {
      const { dir, debounce } = await import('../ob-directory.js');
      const out = $('#co-out');
      let gen = 0; // bumped whenever `out` is repainted; async search responses bail if stale
      q.addEventListener('input', debounce(async () => {
        gen++;
        const myGen = gen;
        const v = q.value.trim();
        if (v.length < 2) { out.innerHTML = ''; return; }
        try {
          const { orgs } = await dir.search(v);
          if (myGen !== gen || q.value.trim() !== v) return; // stale: repainted or query changed since
          out.innerHTML = orgs.length ? `<section class="card" style="padding:6px 16px">${orgs.map((o, i) => `
            <div class="lrow" data-org="${i}"><div class="lic">${icon('shield', 17)}</div>
            <div class="lm"><div class="lt">${esc(o.name)}</div><div class="ls">${esc([o.city, o.state].filter(Boolean).join(', ') || '—')}</div></div></div>`).join('')}</section>`
            : `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Nothing yet — add your school below.</div>`;
          out.querySelectorAll('[data-org]').forEach((el) => el.addEventListener('click', () => {
            const o = orgs[+el.getAttribute('data-org')];
            cap({ orgId: o.id, schoolName: o.name, city: o.city, state: o.state });
            window.__render();
          }));
        } catch {
          if (myGen !== gen) return; // stale: don't clobber whatever's on screen now
          out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Directory unreachable — add your school below.</div>`;
        }
      }, 300));
      $('#co-add').addEventListener('click', () => {
        gen++; // repainting out — invalidate any in-flight search
        out.innerHTML = `
          <input id="co-add-name" class="ob-input" placeholder="School / organization name" />
          <div style="height:10px"></div>
          <div class="dob-row">
            <input id="co-add-city" class="ob-input" placeholder="City" style="flex:2" />
            <input id="co-add-state" class="ob-input" placeholder="ST" maxlength="2" autocapitalize="characters" />
          </div>
          <div style="height:10px"></div>
          <button class="btn ghost sm" id="co-add-go" style="width:auto;padding:0 22px;margin:0 auto;display:block">Use this school</button>`;
        out.querySelector('#co-add-go').addEventListener('click', () => {
          const name = out.querySelector('#co-add-name').value.trim();
          if (!name) return;
          cap({ orgId: null, schoolName: name, city: out.querySelector('#co-add-city').value.trim(), state: out.querySelector('#co-add-state').value.trim().toUpperCase() });
          window.__render();
        });
      });
    }
    const clear = $('#co-school-clear');
    if (clear) clear.addEventListener('click', () => { cap({ orgId: null, schoolName: '', city: '', state: '' }); window.__render(); });
    // step 3: team fields (restore + capture; discoverable defaults On)
    const team = $('#co-team');
    if (team) {
      const c = (RT.ob || {}).coach || {};
      if (c.teamName) team.value = c.teamName;
      const sync = () => {
        const sp = $('#co-sport .on'), lv = $('#co-level .on'), disc = $('#co-disc .on');
        cap({ teamName: team.value.trim(), sport: sp ? sp.textContent.trim() : null,
              level: lv ? lv.textContent.trim() : null, discoverable: !disc || disc.textContent.trim() === 'On' });
      };
      team.addEventListener('input', sync);
      ['#co-sport', '#co-level', '#co-disc'].forEach((sel) => { const el = $(sel); if (el) el.addEventListener('click', sync); });
      sync();
    }
    // step 5: shared account → mint org/team → code screen
    if ($('#su-go')) {
      wireAccount(root, {
        role: 'coach',
        onSession: async (live) => {
          if (live) { await act.persistCoachOnboarding(); window.__go('coach-ob/6'); return; }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in. Your team and code mint automatically.';
        },
      });
    }
    // step 6: copy the REAL code
    const copy = $('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText((RT.ob || {}).teamCode || ''); } catch { /* label still confirms intent */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};

/* ============ TRAINER ONBOARDING (3 steps) ============ */
const trainerSteps = {
  1: () => frame(1, 3, 'Your practice.', 'Clients see this on every note you send.', `
    <input class="ob-input" value="Tracy Boone Performance" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Who you train</div>
    <div class="chip-row">
      <span class="chp">Athletes</span><span class="chp">General clients</span><span class="chp on">Both</span>
    </div>`, 'Next', 'trainer-ob/2'),

  2: () => frame(2, 3, 'Default client standard.', 'What every new client starts with. Tune it per client after.', `
    <section class="card" style="padding:6px 16px">
      ${[
        ['utensils', 'Three meals · photo proof', 'Nutrition, scored to their goal', true],
        ['moon', 'Recovery check-in · nightly', 'Sleep, soreness, stress', true],
        ['scale', 'Weight · weekly', 'Trend only, never a daily judgment', true],
        ['clipboard', 'Weekly check-in', 'The honest week in one form', true],
      ].map(([ic, t, s, on]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
          <div class="seg" style="width:104px"><button class="${on ? 'on' : ''}">On</button><button class="${on ? '' : 'on'}">Off</button></div>
        </div>`).join('')}
    </section>`, 'Next', 'trainer-ob/3'),

  3: () => `
  <div class="ob">
    ${dots(3, 3)}
    <div class="standard-set">
      <div class="halo"><div class="core" style="background:linear-gradient(155deg,var(--purple-bright),#7e22ce);color:#fff">${icon('heart', 32)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your client code.</div>
      <div class="ob-sub" style="padding:0 8px">Clients enter it once. You see recovery, readiness, and consistency — scoped to your lane.</div>
      <div style="height:22px"></div>
      <div class="code-boxes">
        ${['T', 'R', '4', 'C', '3'].map(c => `<div class="cb filled" style="border-color:var(--purple-border);background:rgba(168,85,247,0.08)">${c}</div>`).join('')}
      </div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:0 auto">${icon('clipboard', 16)} Copy code</button>
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn primary" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);box-shadow:0 10px 30px rgba(168,85,247,0.35)" data-go="trainer">Open Trainer View</button>
    </div>
  </div>`,
};

export const trainerOb = {
  hideTabs: true,
  render({ sub }) { return trainerSteps[Math.min(3, Math.max(1, +(sub || 1)))](); },
  async mount(root) {
    await toggles(root);
    const copy = root.querySelector('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText('TR4C3'); } catch { /* no-op */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};

/* ============ CLIENT (non-athlete) ONBOARDING (5 steps) ============ */
const clientSteps = {
  1: () => frame(1, 5, 'What are we fixing?', 'This picks how your nutrition gets scored. Honest either way.', `
    <div class="choice-grid">
      <div class="choice on"><div class="cic" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('target', 19)}</div>
        <div class="ct">Lose fat</div><div class="cs">Calorie window · protein held high</div></div>
      <div class="choice"><div class="cic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 19)}</div>
        <div class="ct">Maintain</div><div class="cs">Consistency over everything</div></div>
      <div class="choice"><div class="cic" style="background:rgba(52,211,153,0.18);color:var(--green-bright)">${icon('arrowUp', 19)}</div>
        <div class="ct">Build</div><div class="cs">Calorie floor · never under-fueled</div></div>
      <div class="choice"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('heart', 19)}</div>
        <div class="ct">Health</div><div class="cs">Energy, sleep, habits that hold</div></div>
    </div>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">How client scoring works</div>
      <div class="ts">Same four components as athletes. Inside Nutrition, your goal changes the mix: for fat loss it's calorie window 45, protein 25, meals logged 30.</div></div>
    </div>`, 'Next', 'client-ob/2'),

  2: () => frame(2, 5, 'Who are you?', 'Your trainer sees this next to every log.', `
    <input class="ob-input" value="Sam Carter" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Life, honestly</div>
    <div class="chip-row">
      <span class="chp">Desk job</span><span class="chp on">On my feet</span><span class="chp">Shift work</span><span class="chp">Travel a lot</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Training days per week</div>
    <div class="chip-row">
      <span class="chp">2</span><span class="chp on">3</span><span class="chp">4</span><span class="chp">5+</span>
    </div>`, 'Next', 'client-ob/3'),

  3: () => frame(3, 5, 'Where are you now?', 'Weight is a weekly trend here. One heavy morning proves nothing.', `
    <div class="bignum-pair">
      <div class="bignum"><div class="bv">198.5</div><div class="bk">Current lb</div></div>
      <div class="bignum" style="border-color:var(--amber-border)"><div class="bv" style="color:var(--amber-bright)">185</div><div class="bk">Target lb</div></div>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Allergies & restrictions · checked on every scan</div>
    <div class="chip-row" data-multi>
      <span class="chp">Peanuts</span><span class="chp">Tree nuts</span><span class="chp on">Dairy</span>
      <span class="chp">Gluten</span><span class="chp">Shellfish</span><span class="chp">Vegetarian</span>
    </div>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">No shame mechanics</div>
      <div class="ts">The daily score measures what you did today: meals, recovery, honesty. The scale is tracked weekly and never moves the daily number.</div></div>
    </div>`, 'Next', 'client-ob/4'),

  4: () => frame(4, 5, 'Connect your trainer.', 'Accountability needs a witness. Enter the code they gave you.', `
    <div class="code-boxes">
      <div class="cb filled">T</div><div class="cb filled">R</div><div class="cb filled">4</div>
      <div class="cb filled">C</div><div class="cb filled">3</div><div class="cb cursor"></div>
    </div>
    <div style="height:14px"></div>
    <section class="card team-preview">
      <div class="tp-av" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff">T</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">Tracy Boone Performance</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">Trainer · 14 clients</div>
      </div>
      <span class="status-pill p">Match</span>
    </section>`, 'Join', 'client-ob/5', { skip: 'client-ob/5' }),

  5: () => `
  <div class="ob">
    ${dots(5, 5)}
    <div class="standard-set">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Three meals with photos, a nightly recovery check-in, weight once a week, one honest weekly form. Tracy sees whether you show up.</div>
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

export const clientOb = {
  hideTabs: true,
  render({ sub }) { return clientSteps[Math.min(5, Math.max(1, +(sub || 1)))](); },
  async mount(root) { await toggles(root); },
};

/* ============ COACH & TRAINER PROFILES ============ */
export const coachProfile = {
  nav: 'coach', tab: 'profile',
  render() {
    return `
    ${backHead('Coach Profile', 'You, your team, your code', 'coach')}

    <section class="card id-card">
      <div class="big-av" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204">M</div>
      <div style="flex:1">
        <div class="nm">${S.coach.name}</div>
        <div class="meta">${S.coach.role} · ${S.coach.team}</div>
        <div class="meta" style="margin-top:1px">24 athletes · 2 groups</div>
      </div>
    </section>

    <div class="eyebrow">Team code · share it</div>
    <section class="card pad" style="text-align:center">
      <div class="code-boxes" style="padding:0 0 4px">
        ${['M', '4', 'R', 'K', '7'].map(c => `<div class="cb filled" style="border-color:var(--amber-border)">${c}</div>`).join('')}
      </div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:8px auto 0">${icon('clipboard', 16)} Copy code</button>
    </section>

    <div class="eyebrow">Team settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="coach-plan"><div class="lic">${icon('clipboard', 17)}</div><div class="lm"><div class="lt">Game plan defaults</div><div class="ls">Targets, focus, publish updates</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="coach-assign"><div class="lic">${icon('plus', 17)}</div><div class="lm"><div class="lt">Requirement templates</div><div class="ls">What you assign most</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="coach-voice"><div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 17)}</div><div class="lm"><div class="lt">AI in your voice</div><div class="ls">It reinforces your rulings, never invents</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="privacy"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Visibility rules</div><div class="ls">What parents and trainers can see</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="billing"><div class="lic">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Team plan & billing</div><div class="ls">Priced per roster</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const copy = root.querySelector('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText('M4RK7'); } catch { /* no-op */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};

export const trainerProfile = {
  nav: 'trainer', tab: 'profile',
  render() {
    return `
    ${backHead('Trainer Profile', 'Your practice and client code', 'trainer')}

    <section class="card id-card">
      <div class="big-av" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce)">T</div>
      <div style="flex:1">
        <div class="nm">Tracy Boone</div>
        <div class="meta">Tracy Boone Performance</div>
        <div class="meta" style="margin-top:1px">14 clients · athletes + general</div>
      </div>
    </section>

    <div class="eyebrow">Client code · share it</div>
    <section class="card pad" style="text-align:center">
      <div class="code-boxes" style="padding:0 0 4px">
        ${['T', 'R', '4', 'C', '3'].map(c => `<div class="cb filled" style="border-color:var(--purple-border)">${c}</div>`).join('')}
      </div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:8px auto 0">${icon('clipboard', 16)} Copy code</button>
    </section>

    <div class="eyebrow">Practice settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default"><div class="lic">${icon('clipboard', 17)}</div><div class="lm"><div class="lt">Default client standard</div><div class="ls">Meals, recovery, weekly weight</div></div><span class="status-pill g">Set</span></div>
      <div class="lrow" data-go="privacy"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Your visibility scope</div><div class="ls">Recovery, readiness, consistency only</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="billing"><div class="lic">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Trainer plan & billing</div><div class="ls">Priced per client</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const copy = root.querySelector('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText('TR4C3'); } catch { /* no-op */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};
