import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { dobFromParts, ageOn } from '../ob-helpers.js';

/* 7-step onboarding: identity → belonging → sport → goal → baseline → the contract → account.
   Back arrow + segmented progress on every step. Every selection is captured into RT.ob as
   they go (DOM is wiped between routes) and written to the account on step 7. */

const STEPS = 7;
function progress(n) {
  return `<div class="ob-prog" role="progressbar" aria-label="Step ${n} of ${STEPS}" aria-valuenow="${n}" aria-valuemax="${STEPS}">${
    Array.from({ length: STEPS }, (_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>`;
}
function frame(n, title, sub, body, cta, next, opts = {}) {
  const back = opts.back || (n === 1 ? 'role' : `onboarding/${n - 1}`);
  return `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="${back}" aria-label="Back">${icon('chevron', 18)}</div>${progress(n)}</div>
    <div class="ob-title">${title}</div>
    <div class="ob-sub">${sub}</div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">
      ${cta ? `<button class="btn ${opts.green ? 'green' : 'primary'}" ${opts.disabled ? 'disabled' : ''} ${opts.act ? `data-act="${opts.act}"` : ''} data-${opts.act ? 'then' : 'go'}="${next}">${cta}</button>` : ''}
      ${opts.skip ? `<div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="${opts.skip}">Skip for now</div>` : ''}
    </div>
  </div>`;
}
const numInput = 'width:100%;background:transparent;border:none;outline:none;text-align:center;font-size:34px;font-weight:800;color:inherit;font-family:inherit;padding:0';

const steps = {
  1: () => frame(1, 'Who are you?', 'Your coach sees this next to every log.', `
    <input id="ob-first" class="ob-input" placeholder="First name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:12px"></div>
    <input id="ob-last" class="ob-input" placeholder="Last name" autocapitalize="words" autocorrect="off" spellcheck="false" />
    <div style="height:16px"></div>
    <div class="eyebrow" style="margin:8px 2px 10px">Date of birth</div>
    <div class="dob-row">
      <input id="ob-dob-m" class="ob-input" type="number" inputmode="numeric" placeholder="MM" />
      <input id="ob-dob-d" class="ob-input" type="number" inputmode="numeric" placeholder="DD" />
      <input id="ob-dob-y" class="ob-input" type="number" inputmode="numeric" placeholder="YYYY" style="flex:1.4" />
    </div>
    <div id="ob-age-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:6px;line-height:1.5">You must be 13 or older to use OnStandard.</div>`,
    'Next', 'onboarding/2'),

  blocked: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="onboarding/1" aria-label="Back">${icon('chevron', 18)}</div></div>
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core" style="background:var(--surface-2);color:var(--text-2)">${icon('lock', 32)}</div></div>
      <div class="ob-title" style="margin-top:18px">Not yet — but soon.</div>
      <div class="ob-sub" style="padding:0 8px">OnStandard is for athletes 13 and older — that's the law for apps like this, and we take it seriously. Come back on your 13th birthday. The Standard will be waiting.</div>
    </div>
    <div class="ob-foot" style="margin-top:auto">
      <button class="btn ghost" data-go="welcome">Back to start</button>
    </div>
  </div>`,

  2: () => {
    const j = (RT.ob || {}).join;
    if (j) return frame(2, 'Coach connected', 'Your logs will count toward their board from day one.', `
      <section class="card team-preview">
        <div class="tp-av" style="background:linear-gradient(150deg,var(--green-bright),#0d9459);color:#04150c">${(j.coachName || j.teamName || '?')[0]}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${j.coachName || j.teamName}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${j.teamName || ''}${j.school ? ' · ' + j.school : ''}</div>
        </div>
        <span class="status-pill g">Connected</span>
      </section>
      <div style="height:12px"></div>
      <div style="text-align:center;font-size:13px;font-weight:700;color:var(--text-3);cursor:pointer" data-act="clearJoin">Remove connection</div>`,
      'Continue', 'onboarding/3');
    return frame(2, 'Your school', 'Find your school, then your coach. Their code is the handshake.', `
      <input id="sc-q" class="ob-input" placeholder="Search your school" autocorrect="off" spellcheck="false" />
      <div id="sc-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="sc-alt" style="text-align:center;font-size:14px;font-weight:700;color:var(--green-bright);cursor:pointer">I have a coach code</div>`,
      'Continue', 'onboarding/3', { skip: 'onboarding/3' });
  },

  3: () => frame(3, 'Your sport', 'Position and level shape your plan.', `
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
    </div>`, 'Next', 'onboarding/4'),

  4: () => frame(4, 'What are we building?', 'This decides how your nutrition gets scored. Your coach can adjust it.', `
    <div class="choice-grid" id="ob-goal">
      <div class="choice on" data-val="gain"><div class="cic" style="background:rgba(52,211,153,0.18);color:var(--green-bright)">${icon('arrowUp', 19)}</div>
        <div class="ct">Gain weight</div><div class="cs">Calorie floor · protein heavy</div></div>
      <div class="choice" data-val="lose"><div class="cic" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('target', 19)}</div>
        <div class="ct">Lose fat</div><div class="cs">Calorie window · keep protein</div></div>
      <div class="choice" data-val="maintain"><div class="cic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 19)}</div>
        <div class="ct">Maintain</div><div class="cs">Consistency over everything</div></div>
      <div class="choice" data-val="perform"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('bolt', 19)}</div>
        <div class="ct">Perform</div><div class="cs">Fuel training · recover hard</div></div>
    </div>`, 'Next', 'onboarding/5'),

  5: () => frame(5, 'Where are you now?', 'Weight is a season trend here, never a daily judgment.', `
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
    </div>`, 'Next', 'onboarding/6'),

  6: () => frame(6, 'Your Standard', 'These are the daily requirements your score is built on. Coach Mark can add more.', `
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
    </div>`, 'Set My Standard', 'onboarding/7'),

  7: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="onboarding/6" aria-label="Back">${icon('chevron', 18)}</div>${progress(7)}</div>
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
    if (sub === 'blocked') return steps.blocked();
    const n = Math.min(STEPS, Math.max(1, +(sub || 1)));
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
      // Restore the saved selection BEFORE the initial sync, so re-entering a step
      // reflects the athlete's real choice instead of re-capturing the template default.
      const saved = (RT.ob || {})[key];
      if (saved != null) {
        const items = [...g.querySelectorAll('.chp, .choice')];
        const match = items.find(el => (el.getAttribute('data-val') || el.textContent.trim()) === saved);
        if (match) { items.forEach(el => el.classList.remove('on')); match.classList.add('on'); }
      }
      const val = read || (() => { const on = g.querySelector('.on'); return on ? on.textContent.trim() : null; });
      const sync = () => { const v = val(); if (v != null) cap({ [key]: v }); };
      g.addEventListener('click', sync);
      sync();
    };

    // ---- Step 1: first + last name REQUIRED, DOB validated, under-13 → block screen ----
    const first = grab('#ob-first');
    if (first) {
      const last = grab('#ob-last'), dm = grab('#ob-dob-m'), dd = grab('#ob-dob-d'), dy = grab('#ob-dob-y');
      const errEl = grab('#ob-age-err');
      const nextBtn = root.querySelector('.ob-foot .btn');
      // restore captured values so Back never loses work
      const ob = RT.ob || {};
      if (ob.firstName) first.value = ob.firstName;
      if (ob.lastName) last.value = ob.lastName;
      if (ob.dob) { const [y, m, d] = ob.dob.split('-'); dm.value = +m; dd.value = +d; dy.value = y; }
      const todayISO = () => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      };
      const sync = () => {
        const f = first.value.trim(), l = last.value.trim();
        const dob = dobFromParts(dm.value, dd.value, dy.value);
        cap({ firstName: f, lastName: l, name: `${f} ${l}`.trim(), dob });
        const under13 = dob != null && ageOn(dob, todayISO()) < 13;
        if (under13) {
          errEl.textContent = 'OnStandard is for ages 13 and up.';
          nextBtn.setAttribute('data-go', 'onboarding/blocked');
          nextBtn.disabled = false;
        } else {
          errEl.textContent = '';
          nextBtn.setAttribute('data-go', 'onboarding/2');
          nextBtn.disabled = !(f && l && dob);
        }
      };
      [first, last, dm, dd, dy].forEach(el => el.addEventListener('input', sync));
      dm.addEventListener('input', () => { if (dm.value.length >= 2) dd.focus(); });
      dd.addEventListener('input', () => { if (dd.value.length >= 2) dy.focus(); });
      sync();
    }

    // ---- Step 2: school → coach → code (validated preview; real join happens post-signup) ----
    const scQ = grab('#sc-q');
    if (scQ) {
      const { dir, debounce, CODE_RE } = await import('../ob-directory.js');
      const out = grab('#sc-out'), alt = grab('#sc-alt');
      const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const codeEntry = (ctx) => {
        out.innerHTML = `
          ${ctx ? `<div class="sidebox" style="margin-bottom:12px"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
            <div><div class="tt">${esc(ctx.title)}</div><div class="ts">${esc(ctx.sub)}</div></div></div>` : ''}
          <input id="sc-code" class="ob-input" placeholder="Coach code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" />
          <div id="sc-code-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>`;
        const codeEl = out.querySelector('#sc-code'), codeErr = out.querySelector('#sc-code-err');
        codeEl.addEventListener('input', debounce(async () => {
          const code = codeEl.value.trim().toUpperCase();
          codeErr.textContent = '';
          if (!CODE_RE.test(code)) return;
          try {
            const { match } = await dir.previewCode(code);
            if (!match) { codeErr.textContent = "That code didn't match. Check with your coach."; return; }
            cap({ join: match.kind === 'team'
              ? { kind: 'team', code, teamId: match.id, teamName: match.name, coachName: match.coach_name, school: match.school }
              : { kind: 'practice', code, practiceId: match.id, practiceName: match.name, trainerName: match.trainer_name } });
            window.__render();
          } catch { codeErr.textContent = 'Could not check that code — you can also skip and connect later.'; }
        }, 350));
        codeEl.focus();
      };
      const showTeams = async (org) => {
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Loading coaches…</div>`;
        try {
          const { teams } = await dir.teams(org.id);
          if (!teams.length) { codeEntry({ title: `${org.name}`, sub: 'No coaches listed here yet. Have a code? Enter it below.' }); return; }
          out.innerHTML = `<section class="card" style="padding:6px 16px">${teams.map((t, i) => `
            <div class="lrow" data-team="${i}">
              <div class="lic">${icon('users', 17)}</div>
              <div class="lm"><div class="lt">${esc(t.coach_name || t.name)}</div><div class="ls">${esc(t.name)}${t.sport ? ' · ' + esc(t.sport) : ''}</div></div>
              ${icon('chevron', 17, 'style="color:var(--text-3)"')}
            </div>`).join('')}</section>`;
          out.querySelectorAll('[data-team]').forEach((el) => el.addEventListener('click', () => {
            const t = teams[+el.getAttribute('data-team')];
            codeEntry({ title: `Ask ${t.coach_name || 'your coach'} for the team code`, sub: `${t.name} · the code is the handshake — only your coach hands it out.` });
          }));
        } catch { codeEntry({ title: 'Directory unavailable', sub: 'Enter your coach code directly, or skip and connect later.' }); }
      };
      scQ.addEventListener('input', debounce(async () => {
        const q = scQ.value.trim();
        if (q.length < 2) { out.innerHTML = ''; return; }
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Searching…</div>`;
        try {
          const { orgs } = await dir.search(q);
          if (!orgs.length) {
            out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
              <div><div class="tt">Not listed yet</div><div class="ts">No school by that name is on OnStandard yet. Enter your coach's code below, or skip — you can connect anytime from Profile.</div></div></div>`;
            return;
          }
          out.innerHTML = `<section class="card" style="padding:6px 16px">${orgs.map((o, i) => `
            <div class="lrow" data-org="${i}">
              <div class="lic">${icon('shield', 17)}</div>
              <div class="lm"><div class="lt">${esc(o.name)}</div><div class="ls">${esc([o.city, o.state].filter(Boolean).join(', ') || '—')}${o.teams ? ` · ${o.teams} coach${o.teams > 1 ? 'es' : ''}` : ''}</div></div>
              ${icon('chevron', 17, 'style="color:var(--text-3)"')}
            </div>`).join('')}</section>`;
          out.querySelectorAll('[data-org]').forEach((el) => el.addEventListener('click', () => showTeams(orgs[+el.getAttribute('data-org')])));
        } catch {
          out.innerHTML = `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
            <div><div class="tt">Can't reach the directory</div><div class="ts">Check your connection, enter a coach code directly, or skip for now.</div></div></div>`;
        }
      }, 300));
      alt.addEventListener('click', () => codeEntry(null));
    }

    // ---- Step 3: sport / position / level ----
    wireGroup('#ob-sport', 'sport');
    wireGroup('#ob-pos', 'position');
    wireGroup('#ob-level', 'level');

    // ---- Step 4: goal (slug from data-val) ----
    wireGroup('#ob-goal', 'goal', () => { const on = grab('#ob-goal .on'); return on ? on.getAttribute('data-val') : null; });

    // ---- Step 5: weights + allergies (none selected by default) ----
    const cur = grab('#ob-cur'); if (cur) cur.addEventListener('input', () => cap({ currentWeight: parseFloat(cur.value) || null }));
    const tgt = grab('#ob-tgt'); if (tgt) tgt.addEventListener('input', () => cap({ targetWeight: parseFloat(tgt.value) || null }));
    if (cur && RT.ob && RT.ob.currentWeight) cur.value = RT.ob.currentWeight;
    if (tgt && RT.ob && RT.ob.targetWeight) tgt.value = RT.ob.targetWeight;
    const alg = grab('[data-multi]');
    if (alg) {
      const savedA = (RT.ob && RT.ob.allergies) || [];
      if (savedA.length) [...alg.querySelectorAll('.chp')].forEach(c => c.classList.toggle('on', savedA.includes(c.textContent.trim())));
      const readA = () => cap({ allergies: [...alg.querySelectorAll('.chp.on')].map(c => c.textContent.trim()) });
      alg.addEventListener('click', readA);
      readA();
    }

    // ---- Step 6: reminder pressure ----
    wireGroup('#ob-pressure', 'pressure');

    // ---- Step 7: real account creation from the captured Standard ----
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
          // Persist the athlete's real identity locally + to the server (awaited). RT.ob is kept,
          // so if this signup had no session yet (email confirmation on), the server write is
          // re-attempted automatically on the next sign-in.
          await act.persistOnboarding();
          if (r.session) {
            act.startDay0();
            window.__go('home');
          } else {
            // No session (email confirmation required): don't drop the athlete on an empty Home
            // where nothing they do can save. Send them to confirm + sign in; their onboarding is
            // safe in RT.ob and back-fills on sign-in.
            err.style.color = 'var(--text-2)';
            err.textContent = 'Account created — confirm your email, then sign in to start.';
            btn.textContent = 'Confirm your email to continue';
          }
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
