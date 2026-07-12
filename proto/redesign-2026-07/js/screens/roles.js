import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, logoMark, esc } from '../components.js';
import { accountBody, wireAccount } from './ob-account.js';
import { standardForGoal } from '../ob-helpers.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { track, EVENTS } from '../analytics.js';
import { encodeQR, addQuietZone, qrSvg } from '../qr.js';

/* Practice HQ invite link + share text — mirrors src/core/practiceIdentity.ts (the tested
   oracle) inline, the same way state.js mirrors src/core logic in plain JS rather than
   importing compiled TS into the WebView. Empty code -> empty string: never link/share a
   dead code before it's real. */
function inviteLink(code) {
  const c = (code || '').trim().toUpperCase();
  return c ? `https://onstandard.app/join?code=${c}` : '';
}
function inviteShareText(code, practiceName) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const name = (practiceName && practiceName.trim()) || 'my practice';
  return `Join ${name} on OnStandard. Use code ${c} or open ${inviteLink(c)}`;
}

/* ============================================================
   Role picker + onboarding for every role, not just athletes.
   Client scoring honesty: the shipped engine has a 'general'
   scoring profile (calorie window 45 / protein 25 / meals 30
   inside Nutrition) — the client flow states that, truthfully.
   ============================================================ */

function progressOf(n, total) {
  return `<div class="ob-prog" role="progressbar" aria-label="Step ${n} of ${total}" aria-valuenow="${n}" aria-valuemax="${total}">${
    Array.from({ length: total }, (_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}
function frame(n, total, title, sub, body, cta, next, opts = {}) {
  return `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="${opts.back || 'role'}" aria-label="Back">${icon('chevron', 18)}</div>${progressOf(n, total)}</div>
    <div class="ob-title">${esc(title)}</div>
    <div class="ob-sub">${esc(sub)}</div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      <button class="btn ${opts.green ? 'green' : 'primary'}" ${opts.id ? `id="${opts.id}"` : ''} ${opts.disabled ? 'disabled' : ''} data-go="${next}">${cta}</button>
      ${opts.skip ? `<div class="ob-textlink" style="padding-top:14px" data-go="${opts.skip}">Skip for now</div>` : ''}
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
  mount(root) {
    // Funnel: which role a fresh user picks (the choice, not yet an account). Anonymous.
    const ROLE_BY_GO = { 'onboarding/1': 'athlete', 'client-ob/1': 'client', 'coach-ob/1': 'coach', 'trainer-ob/1': 'trainer' };
    root.querySelectorAll('.choice[data-go]').forEach((c) => c.addEventListener('click', () => {
      const r = ROLE_BY_GO[c.getAttribute('data-go')];
      if (r) track(EVENTS.ONBOARDING_ROLE, { role: r });
    }));
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
    // Restore a saved single-select into the DOM BEFORE the initial sync, so re-entering a
    // step reflects the coach's real choice instead of re-capturing (and clobbering it with)
    // the template default — same match-by-trimmed-text pattern as onboarding.js wireGroup.
    const restore = (sel, saved) => {
      const g = $(sel);
      if (!g || saved == null) return;
      const items = [...g.querySelectorAll('.chp, button')];
      const match = items.find((el) => el.textContent.trim() === String(saved));
      if (match) { items.forEach((el) => el.classList.remove('on')); match.classList.add('on'); }
    };
    // step 1: names + role chips
    const f = $('#co-first');
    if (f) {
      const l = $('#co-last'), roleRow = $('#co-role');
      const nextBtn = root.querySelector('.ob-foot .btn');
      const c = (RT.ob || {}).coach || {};
      if (c.name) { const [cf, ...cl] = c.name.split(' '); f.value = cf; l.value = cl.join(' '); }
      restore('#co-role', c.staffRole);
      const sync = () => {
        const name = `${f.value.trim()} ${l.value.trim()}`.trim();
        const on = roleRow.querySelector('.on');
        cap({ name, staffRole: on ? on.textContent.trim() : 'Head Coach' });
        act.captureOb({ name }); // account step + profiles.full_name read RT.ob.name
        nextBtn.disabled = !(f.value.trim() && l.value.trim());
      };
      [f, l].forEach((el) => el.addEventListener('input', sync));
      // Per-chip binding: wireToggles' chip handler stopPropagation()s, so a group-level
      // listener never fires. Attach order guarantees sync reads the fresh .on state.
      roleRow.querySelectorAll('.chp').forEach((el) => el.addEventListener('click', sync));
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
      restore('#co-sport', c.sport);
      restore('#co-level', c.level);
      if (c.discoverable != null) restore('#co-disc', c.discoverable !== false ? 'On' : 'Off');
      const sync = () => {
        const sp = $('#co-sport .on'), lv = $('#co-level .on'), disc = $('#co-disc .on');
        cap({ teamName: team.value.trim(), sport: sp ? sp.textContent.trim() : null,
              level: lv ? lv.textContent.trim() : null, discoverable: !disc || disc.textContent.trim() === 'On' });
      };
      team.addEventListener('input', sync);
      // Per-option binding (chips AND seg buttons stopPropagation via wireToggles).
      ['#co-sport', '#co-level', '#co-disc'].forEach((sel) => {
        const el = $(sel);
        if (el) el.querySelectorAll('.chp, button').forEach((it) => it.addEventListener('click', sync));
      });
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

/* ============ TRAINER ONBOARDING (4 steps + code screen) ============ */
const trainerSteps = {
  1: () => frame(1, 4, 'You, trainer.', 'Clients see this name on every note you send.', `
    <input id="tr-first" class="ob-input" placeholder="First name" autocapitalize="words" />
    <div style="height:12px"></div>
    <input id="tr-last" class="ob-input" placeholder="Last name" autocapitalize="words" />
    <div style="height:16px"></div>
    <input id="tr-practice" class="ob-input" placeholder="Practice name (e.g. Boone Performance)" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Who you train</div>
    <div class="chip-row" id="tr-audience">
      <span class="chp">Athletes</span><span class="chp">General clients</span><span class="chp on">Both</span>
    </div>`, 'Next', 'trainer-ob/2', { back: 'role' }),

  2: () => frame(2, 4, 'Default client standard.', 'What every new client starts with. Tune it per client after.', `
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
    </section>`, 'Next', 'trainer-ob/3', { back: 'trainer-ob/1' }),

  3: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="trainer-ob/2">${icon('chevron', 18)}</div>${progressOf(3, 4)}</div>
    <div class="ob-title">Create your account.</div>
    <div class="ob-sub">Your practice and client code live on it.</div>
    <div style="height:8px"></div>
    ${accountBody({ terms: 'tob' })}
    <div class="ob-foot" style="margin-top:auto"><button id="su-go" class="btn primary" disabled>Create account &amp; Get my code</button></div>
  </div>`,

  4: () => {
    const code = (RT.ob || {}).practiceCode || '';
    return `
  <div class="ob">
    <div class="standard-set">
      <div class="halo"><div class="core" style="background:linear-gradient(155deg,var(--purple-bright),#7e22ce);color:#fff">${icon('heart', 34)}</div></div>
      <div class="ob-title" style="margin-top:22px">Your client code.</div>
      <div class="ob-sub" style="padding:0 8px">Send it to your clients. They enter it once and their work starts counting toward your view.</div>
      <div style="height:22px"></div>
      ${code ? `<div class="code-boxes">${code.split('').map((c) => `<div class="cb filled" style="border-color:var(--purple-border);background:rgba(168,85,247,0.08)">${c}</div>`).join('')}</div>
      <div style="height:12px"></div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:0 auto">${icon('clipboard', 16)} Copy code</button>` :
      `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
        <div><div class="tt">Code pending</div><div class="ts">We couldn't mint your code yet (connection or pending email confirmation). It generates automatically on your next sign-in — check Profile → Client code.</div></div></div>`}
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn primary" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);box-shadow:0 10px 30px rgba(168,85,247,0.35)" data-go="trainer">Open Trainer View</button>
    </div>
  </div>`;
  },
};

export const trainerOb = {
  hideTabs: true,
  render({ sub }) {
    const n = Math.min(4, Math.max(1, +(sub || 1)));
    return trainerSteps[n]();
  },
  async mount(root) {
    await toggles(root);
    const cap = (patch) => act.captureOb({ trainer: { ...((RT.ob || {}).trainer || {}), ...patch } });
    const $ = (s) => root.querySelector(s);
    // Restore a saved single-select into the DOM BEFORE the initial sync, so re-entering a
    // step reflects the trainer's real choice instead of re-capturing (and clobbering it with)
    // the template default — same match-by-trimmed-text pattern as coach onboarding.
    const restore = (sel, saved) => {
      const g = $(sel);
      if (!g || saved == null) return;
      const items = [...g.querySelectorAll('.chp, button')];
      const match = items.find((el) => el.textContent.trim() === String(saved));
      if (match) { items.forEach((el) => el.classList.remove('on')); match.classList.add('on'); }
    };
    // step 1: names + practice name + audience chips
    const f = $('#tr-first');
    if (f) {
      const l = $('#tr-last'), practice = $('#tr-practice'), audRow = $('#tr-audience');
      const nextBtn = root.querySelector('.ob-foot .btn');
      const t = (RT.ob || {}).trainer || {};
      if (RT.ob && RT.ob.name) { const [tf, ...tl] = RT.ob.name.split(' '); f.value = tf; l.value = tl.join(' '); }
      if (t.practiceName) practice.value = t.practiceName;
      restore('#tr-audience', t.audience);
      const sync = () => {
        const name = `${f.value.trim()} ${l.value.trim()}`.trim();
        const on = audRow.querySelector('.on');
        cap({ practiceName: practice.value.trim(), audience: on ? on.textContent.trim() : 'Both' });
        act.captureOb({ name }); // account step + profiles.full_name read RT.ob.name
        nextBtn.disabled = !(f.value.trim() && l.value.trim());
      };
      [f, l, practice].forEach((el) => el.addEventListener('input', sync));
      // Per-chip binding: wireToggles' chip handler stopPropagation()s, so a group-level
      // listener never fires. Attach order guarantees sync reads the fresh .on state.
      audRow.querySelectorAll('.chp').forEach((el) => el.addEventListener('click', sync));
      sync();
    }
    // step 3: shared account → mint practice → code screen
    if ($('#su-go')) {
      wireAccount(root, {
        role: 'trainer',
        onSession: async (live) => {
          if (live) { await act.persistTrainerOnboarding(); window.__go('trainer-ob/4'); return; }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in. Your code mints automatically.';
        },
      });
    }
    // step 4: copy the REAL code
    const copy = $('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText((RT.ob || {}).practiceCode || ''); } catch { /* label still confirms intent */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
    });
  },
};

/* ============ CLIENT (non-athlete) ONBOARDING (6 steps) ============
   Clients sign up as role 'athlete' (general scoring profile) — same RT.ob shape as the
   athlete flow (goal, firstName/lastName/name, currentWeight/targetWeight/allergies, join,
   committedAt, standard), so act.persistOnboarding() needs no client-specific branch. */
const numInputCl = 'width:100%;background:transparent;border:none;outline:none;text-align:center;font-size:34px;font-weight:800;color:inherit;font-family:inherit;padding:0';

const clientSteps = {
  1: () => frame(1, 6, 'What are we fixing?', 'This picks how your nutrition gets scored. Honest either way.', `
    <div class="choice-grid" id="cl-goal">
      <div class="choice on" data-val="lose"><div class="cic" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('target', 19)}</div>
        <div class="ct">Lose fat</div><div class="cs">Calorie window · protein held high</div></div>
      <div class="choice" data-val="maintain"><div class="cic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 19)}</div>
        <div class="ct">Maintain</div><div class="cs">Consistency over everything</div></div>
      <div class="choice" data-val="build"><div class="cic" style="background:rgba(52,211,153,0.18);color:var(--green-bright)">${icon('arrowUp', 19)}</div>
        <div class="ct">Build</div><div class="cs">Calorie floor · never under-fueled</div></div>
      <div class="choice" data-val="health"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('heart', 19)}</div>
        <div class="ct">Health</div><div class="cs">Energy, sleep, habits that hold</div></div>
    </div>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">How client scoring works</div>
      <div class="ts">Same four components as athletes. Inside Nutrition, your goal changes the mix: for fat loss it's calorie window 45, protein 25, meals logged 30.</div></div>
    </div>`, 'Next', 'client-ob/2'),

  2: () => frame(2, 6, 'Who are you?', 'Your trainer sees this next to every log.', `
    <input id="cl-first" class="ob-input" placeholder="First name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:12px"></div>
    <input id="cl-last" class="ob-input" placeholder="Last name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Life, honestly</div>
    <div class="chip-row" id="cl-life">
      <span class="chp">Desk job</span><span class="chp on">On my feet</span><span class="chp">Shift work</span><span class="chp">Travel a lot</span>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Training days per week</div>
    <div class="chip-row" id="cl-days">
      <span class="chp">2</span><span class="chp on">3</span><span class="chp">4</span><span class="chp">5+</span>
    </div>`, 'Next', 'client-ob/3', { back: 'client-ob/1' }),

  3: () => frame(3, 6, 'Where are you now?', 'Weight is a weekly trend here. One heavy morning proves nothing.', `
    <div class="bignum-pair">
      <div class="bignum"><input id="cl-cur" type="number" inputmode="decimal" placeholder="—" style="${numInputCl}" /><div class="bk">Current lb</div></div>
      <div class="bignum" style="border-color:var(--green-border)"><input id="cl-tgt" type="number" inputmode="decimal" placeholder="—" style="${numInputCl};color:var(--green-bright)" /><div class="bk">Target lb</div></div>
    </div>
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Allergies & restrictions · checked on every scan</div>
    <div class="chip-row" data-multi>
      <span class="chp">Peanuts</span><span class="chp">Tree nuts</span><span class="chp">Dairy</span>
      <span class="chp">Gluten</span><span class="chp">Shellfish</span><span class="chp">Vegetarian</span>
    </div>
    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">No shame mechanics</div>
      <div class="ts">The daily score measures what you did today: meals, recovery, honesty. The scale is tracked weekly and never moves the daily number.</div></div>
    </div>`, 'Next', 'client-ob/4', { back: 'client-ob/2' }),

  4: () => {
    const j = (RT.ob || {}).join;
    if (j && j.kind === 'practice') {
      const title = j.trainerName || j.practiceName || 'Connected';
      return frame(4, 6, 'Trainer connected', 'Your logs will count toward their board from day one.', `
      <section class="card team-preview">
        <div class="tp-av" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff">${esc(title[0])}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${esc(title)}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(j.practiceName || 'Trainer connection')}</div>
        </div>
        <span class="status-pill g">Connected</span>
      </section>
      <div style="height:12px"></div>
      <div class="ob-textlink" style="font-size:13px" data-act="clearJoin">Remove connection</div>`,
      'Continue', 'client-ob/5', { back: 'client-ob/3' });
    }
    return frame(4, 6, 'Connect your trainer.', 'Accountability needs a witness. Search for them, then enter the code they gave you.', `
      <input id="cl-q" class="ob-input" placeholder="Search your trainer" autocorrect="off" spellcheck="false" />
      <div id="cl-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="cl-alt" style="text-align:center;font-size:14px;font-weight:700;color:var(--purple-bright);cursor:pointer">My gym isn't listed</div>`,
      'Continue', 'client-ob/5', { back: 'client-ob/3', skip: 'client-ob/5' });
  },

  5: () => {
    const ob = RT.ob || {};
    const join = ob.join && ob.join.kind === 'practice' ? ob.join : null;
    const std = standardForGoal(ob.goal, ob.standard && ob.standard.mealsPerDay, 'general');
    const committed = !!ob.committedAt;
    // Plain text here — frame() escapes title/sub wholesale (no inner esc, or it double-escapes).
    const trainerFirst = join && join.trainerName ? join.trainerName.trim().split(/\s+/)[0] : null;
    const title = join ? `${trainerFirst || 'Your trainer'}’s Standard` : 'Your Standard';
    const sub = join
      ? `The deal with ${join.practiceName || 'your trainer'}. Your score is built on it — hold to commit.`
      : 'Built from your goal. When you connect a trainer, their standard takes over.';
    const rows = std.rows.map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--surface-2)">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        </div>`).join('');
    const knobs = join ? '' : `
      <div class="eyebrow" style="margin:14px 2px 10px">Meals per day</div>
      <div class="chip-row" id="cl-meals">${[2, 3, 4].map((m) => `<span class="chp ${m === std.meals ? 'on' : ''}">${m}</span>`).join('')}</div>`;
    return frame(5, 6, title, sub, `
      <section class="card" style="padding:6px 16px">${rows}</section>
      <div style="height:10px"></div>
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div>
        <div><div class="tt">Your edge</div><div class="ts">${std.focus}</div></div>
      </div>
      ${knobs}
      <div style="height:16px"></div>
      ${commitButton(committed)}`,
      'Next', 'client-ob/6', { back: 'client-ob/4', disabled: !committed });
  },

  6: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="client-ob/5" aria-label="Back">${icon('chevron', 18)}</div>${progressOf(6, 6)}</div>
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:18px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Create your account to save it — your score, meals, and trainer connection sync across devices.</div>
    </div>
    <div style="height:16px"></div>
    ${accountBody({ terms: 'clob' })}
    <div class="ob-foot" style="margin-top:auto">
      <button id="su-go" class="btn green" disabled>Create account &amp; Start</button>
    </div>
  </div>`,
};

export const clientOb = {
  hideTabs: true,
  render({ sub }) { return clientSteps[Math.min(6, Math.max(1, +(sub || 1)))](); },
  async mount(root) {
    await toggles(root);
    const $ = (s) => root.querySelector(s);
    const cap = (patch) => act.captureOb(patch);
    // Restore a saved single-select into the DOM BEFORE the initial sync (same pattern as
    // onboarding.js's wireGroup / coachOb's restore), then bind capture directly to each
    // option element rather than the group ancestor: wireToggles' per-chip click handler
    // calls e.stopPropagation(), so a group-level listener would never see the click.
    const captureGroup = (sel, key, read) => {
      const g = $(sel); if (!g) return;
      const saved = (RT.ob || {})[key];
      if (saved != null) {
        const items = [...g.querySelectorAll('.chp, .choice')];
        const match = items.find((el) => (el.getAttribute('data-val') || el.textContent.trim()) === saved);
        if (match) { items.forEach((el) => el.classList.remove('on')); match.classList.add('on'); }
      }
      const val = read || (() => { const on = g.querySelector('.on'); return on ? on.textContent.trim() : null; });
      const sync = () => { const v = val(); if (v != null) cap({ [key]: v }); };
      g.querySelectorAll('.chp, .choice').forEach((el) => el.addEventListener('click', sync));
      sync();
    };

    // ---- Step 1: goal (slug from data-val) ----
    captureGroup('#cl-goal', 'goal', () => { const on = $('#cl-goal .on'); return on ? on.getAttribute('data-val') : null; });

    // ---- Step 2: first + last name REQUIRED, restore; life / training-days chips ----
    const first = $('#cl-first');
    if (first) {
      const last = $('#cl-last');
      const nextBtn = root.querySelector('.ob-foot .btn');
      const ob = RT.ob || {};
      if (ob.firstName) first.value = ob.firstName;
      if (ob.lastName) last.value = ob.lastName;
      const syncName = () => {
        const f = first.value.trim(), l = last.value.trim();
        cap({ firstName: f, lastName: l, name: `${f} ${l}`.trim() });
        nextBtn.disabled = !(f && l);
      };
      [first, last].forEach((el) => el.addEventListener('input', syncName));
      syncName();
    }
    captureGroup('#cl-life', 'life');
    captureGroup('#cl-days', 'trainingDays');

    // ---- Step 3: weights + allergies (restore; none selected by default) ----
    const cur = $('#cl-cur'); if (cur) cur.addEventListener('input', () => cap({ currentWeight: parseFloat(cur.value) || null }));
    const tgt = $('#cl-tgt'); if (tgt) tgt.addEventListener('input', () => cap({ targetWeight: parseFloat(tgt.value) || null }));
    if (cur && RT.ob && RT.ob.currentWeight) cur.value = RT.ob.currentWeight;
    if (tgt && RT.ob && RT.ob.targetWeight) tgt.value = RT.ob.targetWeight;
    const alg = $('[data-multi]');
    if (alg) {
      const savedA = (RT.ob && RT.ob.allergies) || [];
      if (savedA.length) [...alg.querySelectorAll('.chp')].forEach((c) => c.classList.toggle('on', savedA.includes(c.textContent.trim())));
      const readA = () => cap({ allergies: [...alg.querySelectorAll('.chp.on')].map((c) => c.textContent.trim()) });
      alg.addEventListener('click', readA);
      readA();
    }

    // ---- Step 4: connect trainer — practice search / code entry (anon directory, no session yet) ----
    const q = $('#cl-q');
    if (q) {
      const { dir, debounce, CODE_RE } = await import('../ob-directory.js');
      const out = $('#cl-out'), alt = $('#cl-alt');
      let gen = 0; // bumped whenever `out` is repainted; async responses bail if stale
      const codeEntry = (ctx) => {
        gen++; // repainting out — invalidate any in-flight search/code responses
        out.innerHTML = `
          ${ctx ? `<div class="sidebox" style="margin-bottom:12px"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
            <div><div class="tt">${esc(ctx.title)}</div><div class="ts">${esc(ctx.sub)}</div></div></div>` : ''}
          <input id="cl-code" class="ob-input" placeholder="Client code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" />
          <div id="cl-code-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>`;
        const codeEl = out.querySelector('#cl-code'), codeErr = out.querySelector('#cl-code-err');
        codeEl.addEventListener('input', debounce(async () => {
          const code = codeEl.value.trim().toUpperCase();
          codeErr.textContent = '';
          if (!CODE_RE.test(code)) return;
          const myGen = gen; // capture before await; bail below if repainted or edited since
          try {
            const { match } = await dir.previewCode(code);
            if (myGen !== gen || codeEl.value.trim().toUpperCase() !== code) return; // stale
            if (!match || match.kind !== 'practice') { codeErr.textContent = "That code didn't match. Check with your trainer."; return; }
            cap({ join: { kind: 'practice', code, practiceId: match.id, practiceName: match.name, trainerName: match.trainer_name } });
            window.__render();
          } catch {
            if (myGen !== gen) return; // stale
            codeErr.textContent = 'Could not check that code — you can also skip and connect later.';
          }
        }, 350));
        codeEl.focus();
      };
      q.addEventListener('input', debounce(async () => {
        gen++; // repainting out on every debounced keystroke — invalidate prior in-flight lookups
        const myGen = gen;
        const v = q.value.trim();
        if (v.length < 2) { out.innerHTML = ''; return; }
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Searching…</div>`;
        try {
          const { practices } = await dir.practices(v);
          if (myGen !== gen || q.value.trim() !== v) return; // stale
          if (!practices.length) {
            out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
              <div><div class="tt">Not listed yet</div><div class="ts">No trainer by that name is on OnStandard yet. Enter your client code below, or skip — you can connect anytime from Profile.</div></div></div>`;
            return;
          }
          out.innerHTML = `<section class="card" style="padding:6px 16px">${practices.map((p, i) => `
            <div class="lrow" data-prac="${i}">
              <div class="lic">${icon('heart', 17)}</div>
              <div class="lm"><div class="lt">${esc(p.name)}</div><div class="ls">${esc(p.trainer_name || '—')}${p.handle ? ` · @${esc(p.handle)}` : ''}</div></div>
              ${icon('chevron', 17, 'style="color:var(--text-3)"')}
            </div>`).join('')}</section>`;
          out.querySelectorAll('[data-prac]').forEach((el) => el.addEventListener('click', () => {
            const p = practices[+el.getAttribute('data-prac')];
            codeEntry({ title: `Ask ${p.trainer_name || 'your trainer'} for your client code`, sub: `${p.name} · the code is the handshake — only your trainer hands it out.` });
          }));
        } catch {
          if (myGen !== gen) return; // stale
          out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
            <div><div class="tt">Can't reach the directory</div><div class="ts">Check your connection, enter a client code directly, or skip for now.</div></div></div>`;
        }
      }, 300));
      alt.addEventListener('click', () => codeEntry(null));
    }

    // ---- Step 5: meals/day knob re-renders the rows; hold-to-commit stamps the contract ----
    const mealsRow = $('#cl-meals');
    if (mealsRow) mealsRow.querySelectorAll('.chp').forEach((chp) => chp.addEventListener('click', () => {
      cap({ standard: { ...((RT.ob || {}).standard || {}), mealsPerDay: +chp.textContent.trim() } });
      window.__render();
    }));
    if ($('#ob-commit')) wireCommit(root, () => {
      const ob = RT.ob || {};
      cap({
        committedAt: new Date().toISOString(),
        standard: { ...(ob.standard || {}), mealsPerDay: (ob.standard && ob.standard.mealsPerDay) || 3 },
      });
      window.__render();
    });

    // ---- Step 6: shared account component; role 'athlete' (general-profile client) ----
    if ($('#su-go')) {
      wireAccount(root, {
        role: 'athlete',
        onSession: async (live) => {
          await act.persistOnboarding(); // writes profile + redeems join_practice + stamps
          if (live) {
            act.startDay0();
            let bio = false;
            try { bio = window.OnStandardNative && window.OnStandardNative.biometrics ? await window.OnStandardNative.biometrics.available() : false; } catch { /* unavailable */ }
            window.__go(bio ? 'bio-optin' : 'home');
            return;
          }
          const err = $('#su-err');
          err.style.color = 'var(--text-2)';
          err.textContent = 'Account created — confirm your email, then sign in to start.';
        },
      });
    }
  },
};

/* ============ COACH & TRAINER PROFILES ============ */
export const coachProfile = {
  nav: 'coach', tab: 'profile',
  render() {
    // Server-confirmed identity first (S.coachIdentity: profiles.full_name + the real team row
    // with its real join code) — the onboarding scratch is only a fallback for a just-onboarded
    // coach whose team fetch hasn't landed yet. Never a fabricated persona.
    const ci = S.coachIdentity;
    const ob = (RT.ob && RT.ob.coach) || {};
    const name = ci.name !== 'Coach' ? ci.name : (ob.name || 'Coach');
    const teamBits = ci.hasIdentity
      ? [ci.teamName]
      : [ob.teamName, ob.schoolName].filter(Boolean);
    const metaLine = teamBits.filter(Boolean).map(esc).join(' · ') || 'Your team';
    const code = ci.code || (RT.ob || {}).teamCode || '';
    return `
    ${backHead('Coach Profile', 'You, your team, your code', 'coach')}

    <section class="card id-card">
      <div class="big-av" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204">${esc((name[0] || 'C').toUpperCase())}</div>
      <div style="flex:1">
        <div class="nm">${esc(name)}</div>
        <div class="meta">${metaLine}</div>
      </div>
    </section>

    <div class="eyebrow">Team code · share it</div>
    ${code ? `
    <section class="card pad" style="text-align:center">
      <div class="code-boxes" style="padding:0 0 4px">
        ${code.split('').map(ch => `<div class="cb filled" style="border-color:var(--amber-border)">${esc(ch)}</div>`).join('')}
      </div>
      <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 26px;margin:8px auto 0">${icon('clipboard', 16)} Copy code</button>
    </section>` : ci.state === 'loading' ? `
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading your team…</div><div class="ts">Checking your team and code.</div></div>
    </div>` : ci.state === 'offline' ? `
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Can't reach the server</div><div class="ts">Your code is safe — reconnect and it shows right here.</div></div>
    </div>` : `
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">No code yet</div><div class="ts">It mints when your team is created, automatically on your next sign-in.</div></div>
    </div>`}

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
      // Copy the code the screen DISPLAYS (server identity first) — RT.ob is onboarding
      // scratch and is empty on a fresh-device sign-in, which silently copied ''.
      // Same source order as render and the trainerProfile pattern.
      try { await navigator.clipboard.writeText(S.coachIdentity.code || (RT.ob || {}).teamCode || ''); } catch { /* no-op */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
      setTimeout(() => { copy.innerHTML = `${icon('clipboard', 16)} Copy code`; }, 1600);
    });
  },
};

/* Practice HQ — the trainer's real business identity + invite loop. Replaces the old static
   settings page (fabricated "Tracy Boone" persona, dead "No code yet" copy, a "Set" pill with
   no destination). Driven entirely by S.trainerIdentity (state.js), which is honest about four
   real states: loading (RT hydrating), minting (practice exists server-side but no code has
   landed yet — never shown as broken), offline (either a last-known cached identity with Share
   disabled, or — on a fetch failure with nothing cached — no identity to show at all, never
   misreported as still-minting), live (real name + real business + real code, QR, Copy, Share). */
export const trainerProfile = {
  nav: 'trainer', tab: 'profile',
  render() {
    const ti = S.trainerIdentity;
    const loading = ti.state === 'loading';
    const minting = ti.state === 'minting';
    const offline = ti.state === 'offline';
    const offlineNoCode = offline && !ti.code; // fetch failed, nothing cached — no invite card to show
    const sub = offline ? (ti.code ? 'Offline · showing your saved details' : 'Offline · reconnecting') : 'Manage your practice';

    const header = loading ? `
    <section class="card id-card">
      <div class="sk" style="width:62px;height:62px;border-radius:50%"></div>
      <div style="flex:1">
        <div class="sk" style="height:19px;width:65%"></div>
        <div class="sk" style="height:12px;width:45%;margin-top:9px"></div>
      </div>
    </section>` : `
    <section class="card id-card">
      <div class="big-av" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce)">${esc(ti.initials || 'T')}</div>
      <div style="flex:1">
        <div class="nm">${esc(ti.name)}</div>
        <div class="meta">${esc(ti.practiceName)}</div>
        <div style="margin-top:9px">${offline ? `<span class="status-pill a">Reconnecting</span>` : minting ? `<span class="status-pill p">Setting up</span>` : `<span class="status-pill g">Live</span>`}</div>
      </div>
    </section>`;

    let invite;
    if (loading) {
      invite = `
      <div class="eyebrow">Invite a client</div>
      <section class="card" style="padding:18px">
        <div class="hq-invite-top">
          <div style="flex:1">
            <div class="sk" style="height:11px;width:40%"></div>
            <div class="sk" style="height:56px;width:100%;margin-top:10px;border-radius:13px"></div>
          </div>
          <div class="sk" style="width:104px;height:104px;border-radius:14px"></div>
        </div>
      </section>`;
    } else if (minting) {
      invite = `
      <div class="eyebrow">Invite a client</div>
      <div class="sidebox">
        <div class="req-icon p" style="width:38px;height:38px"><span class="hq-spin"></span></div>
        <div><div class="tt">Your client code is being created</div>
        <div class="ts">It mints the moment your practice is set up on the server, usually a few seconds. Nothing shows until it's real, so a client never gets a dead code.</div></div>
      </div>`;
    } else if (offlineNoCode) {
      // Fetch failed (network/RLS) and nothing is cached yet — honestly offline, not minting.
      // No code exists to show, so there's no invite card to render here.
      invite = `
      <div class="eyebrow">Invite a client</div>
      <div class="sidebox">
        <div class="req-icon a" style="width:38px;height:38px">${icon('wifiOff', 17)}</div>
        <div><div class="tt">Can't reach the server</div>
        <div class="ts">We couldn't load your client code. Check your connection — this picks back up on its own once you're back online.</div></div>
      </div>`;
    } else {
      const link = inviteLink(ti.code);
      const svg = qrSvg(addQuietZone(encodeQR(link, 'M')), 96, '#0B0D12', `QR code to join ${esc(ti.practiceName)}`);
      invite = `
      <div class="eyebrow">Invite a client</div>
      <section class="card" style="padding:18px">
        <div class="hq-invite-top">
          <div style="flex:1;min-width:0">
            <div class="eyebrow" style="margin:0 0 8px">Client code</div>
            <div class="code-boxes" style="justify-content:flex-start;padding:0">
              ${ti.code.split('').map((ch) => `<div class="cb filled" style="border-color:var(--purple-border);background:rgba(168,85,247,0.08)">${esc(ch)}</div>`).join('')}
            </div>
            <div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:10px;line-height:1.4">
              ${offline ? 'Showing your saved code. Reconnect to share a fresh invite.' : 'They scan the code or enter it to request to join your practice.'}
            </div>
          </div>
          <div>
            <div class="hq-qr">${svg}</div>
            <div class="hq-qcap">SCAN TO JOIN</div>
          </div>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn ghost sm" id="copy-code">${icon('clipboard', 16)} Copy code</button>
          <button class="btn sm" id="share-invite" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff"${offline ? ' disabled' : ''}>${icon('share', 16)} Share invite</button>
        </div>
      </section>`;
    }

    return `
    ${backHead('Practice HQ', sub, 'trainer')}
    ${header}
    ${invite}

    <div class="eyebrow">Practice settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="manage-standard">
        <div class="lic">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Default client standard</div><div class="ls">3 meals · nightly recovery check-in · weekly weigh-in — applied to every client</div></div>
        <span class="status-pill p" id="manage-pill" style="cursor:pointer">Manage</span>
      </div>
      <div class="lrow" data-go="privacy"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Your visibility scope</div><div class="ls">Recovery, readiness, consistency only</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="billing"><div class="lic">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Trainer plan & billing</div><div class="ls">Priced per client</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>

    <div class="eyebrow">Coming to Practice HQ</div>
    <section class="card" style="padding:16px 18px">
      <div style="font-size:13px;font-weight:800;display:flex;align-items:center;gap:8px">${icon('lock', 15)} Founder-gated sections</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin:5px 0 13px;line-height:1.45">Built and reviewed one slice at a time. Shown honestly as locked until they're real.</div>
      <div class="hq-roadmap-grid">
        ${['Business health', 'Client health', 'AI assistant', 'Analytics', 'Branding', 'Integrations'].map((t) => `<div class="hq-ritem">${icon('lock', 14)}<span>${t}</span></div>`).join('')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const ti = S.trainerIdentity;
    const copy = root.querySelector('#copy-code');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ti.code || ''); } catch { /* no-op */ }
      copy.innerHTML = `${icon('check', 16)} Copied`;
      setTimeout(() => { copy.innerHTML = `${icon('clipboard', 16)} Copy code`; }, 1600);
    });
    const share = root.querySelector('#share-invite');
    if (share && !share.disabled) share.addEventListener('click', async () => {
      const url = inviteLink(ti.code);
      const text = inviteShareText(ti.code, ti.practiceName);
      try {
        if (window.OnStandardNative && window.OnStandardNative.share) {
          window.OnStandardNative.share({ title: `Join ${ti.practiceName}`, message: text, url });
        } else if (navigator.share) {
          await navigator.share({ title: `Join ${ti.practiceName}`, text, url });
        } else {
          await navigator.clipboard.writeText(text);
          share.innerHTML = `${icon('check', 16)} Copied invite`;
          setTimeout(() => { share.innerHTML = `${icon('share', 16)} Share invite`; }, 1600);
        }
      } catch { /* share sheet dismissed — no-op */ }
    });
    const managePill = root.querySelector('#manage-pill');
    if (managePill) managePill.addEventListener('click', () => {
      managePill.textContent = 'Coming soon';
      setTimeout(() => { managePill.textContent = 'Manage'; }, 1600);
    });
  },
};
