import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { dobFromParts, ageOn, standardForGoal, weightDirection, weightContradictsGoal, showConfirmPending } from '../ob-helpers.js';
import { esc } from '../components.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { accountBody, wireAccount } from './ob-account.js';
import { track, EVENTS } from '../analytics.js';

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
      ${opts.skip ? `<div class="ob-textlink" style="padding-top:14px" data-go="${opts.skip}">Skip for now</div>` : ''}
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
      <input id="ob-dob-y" class="ob-input" type="number" inputmode="numeric" placeholder="YYYY" />
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
    if (j) {
      // Kind-agnostic display: a team join carries coachName/teamName, a practice (trainer)
      // join carries trainerName/practiceName — never render a literal "undefined".
      const title = j.coachName || j.trainerName || j.teamName || j.practiceName || 'Connected';
      const subLine = j.kind === 'practice'
        ? (j.practiceName || 'Trainer connection')
        : `${j.teamName || ''}${j.school ? ' · ' + j.school : ''}`;
      return frame(2, j.kind === 'practice' ? 'Trainer connected' : 'Coach connected', 'Your logs will count toward their board from day one.', `
      <section class="card team-preview">
        <div class="tp-av" style="background:linear-gradient(150deg,var(--green-bright),#0d9459);color:#04150c">${esc(title[0])}</div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:800">${esc(title)}</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(subLine)}</div>
        </div>
        <span class="status-pill g">Connected</span>
      </section>
      <div style="height:12px"></div>
      <div class="ob-textlink" style="font-size:13px" data-act="clearJoin">Remove connection</div>`,
      'Continue', 'onboarding/3');
    }
    return frame(2, 'Your school', 'Find your school, then your coach. Their code is the handshake.', `
      <input id="sc-q" class="ob-input" placeholder="Search your school" autocorrect="off" spellcheck="false" />
      <div id="sc-out" style="margin-top:14px"></div>
      <div style="height:10px"></div>
      <div id="sc-alt" class="ob-textlink g">I have a coach code</div>`,
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
      <div class="choice" data-val="performance"><div class="cic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('bolt', 19)}</div>
        <div class="ct">Perform</div><div class="cs">Fuel training · recover hard</div></div>
    </div>`, 'Next', 'onboarding/5'),

  5: () => frame(5, 'Where are you now?', 'Weight is a season trend here, never a daily judgment.', `
    <div class="bignum-pair">
      <div class="bignum"><input id="ob-cur" type="number" inputmode="decimal" placeholder="—" style="${numInput}" /><div class="bk">Current lb</div></div>
      <div class="bignum" style="border-color:var(--green-border)"><input id="ob-tgt" type="number" inputmode="decimal" placeholder="—" style="${numInput};color:var(--green-bright)" /><div class="bk">Target lb</div></div>
    </div>
    <div id="ob-wt-hint" style="font-size:12.5px;font-weight:700;margin:10px 2px 0;min-height:17px;line-height:1.4"></div>
    <div style="height:8px"></div>
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

  6: () => {
    const ob = RT.ob || {};
    const join = ob.join && ob.join.kind === 'team' ? ob.join : null;
    const std = standardForGoal(ob.goal, ob.standard && ob.standard.mealsPerDay);
    const committed = !!ob.committedAt;
    const coachLast = join && join.coachName ? esc(join.coachName.trim().split(/\s+/).slice(-1)[0]) : null;
    // Position-room framing (0055): a coach-joined athlete commits to THEIR room's standard —
    // the coach's position-room set governs once they're on the roster (athlete > room > team).
    const pos = join && ob.position ? esc(String(ob.position).trim().toUpperCase()) : null;
    const title = join
      ? (pos ? `The ${pos} room standard` : `Coach ${coachLast || ''}’s Standard`.replace(/\s+’/, '’'))
      : 'Your Standard';
    const sub = join
      ? `${pos && coachLast ? `Coach ${coachLast} sets it for your room. ` : ''}The deal on ${esc(join.teamName || 'the team')}. Your score is built on it — hold to commit.`
      : 'Built from your goal. When you connect a coach, their standard takes over.';
    const rows = std.rows.map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--surface-2)">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        </div>`).join('');
    const knobs = join ? '' : `
      <div class="eyebrow" style="margin:14px 2px 10px">Meals per day</div>
      <div class="chip-row" id="ob-meals">${[2, 3, 4].map((m) => `<span class="chp ${m === std.meals ? 'on' : ''}">${m}</span>`).join('')}</div>`;
    return frame(6, title, sub, `
      <section class="card" style="padding:6px 16px">${rows}</section>
      <div style="height:10px"></div>
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div>
        <div><div class="tt">Your edge</div><div class="ts">${std.focus}</div></div>
      </div>
      ${knobs}
      <div class="eyebrow" style="margin:14px 2px 10px">Reminder pressure</div>
      <div class="chip-row" id="ob-pressure" style="justify-content:center">
        <span class="chp ${ob.pressure === 'Remind me gently' ? 'on' : ''}">Remind me gently</span><span class="chp ${!ob.pressure || ob.pressure === 'Hold me accountable' ? 'on' : ''}">Hold me accountable</span><span class="chp ${ob.pressure === 'Max pressure' ? 'on' : ''}">Max pressure</span>
      </div>
      <div style="height:16px"></div>
      ${commitButton(committed)}`,
      'Next', 'onboarding/7', { disabled: !committed });
  },

  7: () => `
  <div class="ob">
    <div class="ob-nav"><div class="ob-back" data-go="onboarding/6" aria-label="Back">${icon('chevron', 18)}</div>${progress(7)}</div>
    <div class="standard-set" style="padding-bottom:6px">
      <div class="halo"><div class="core">${icon('check', 38)}</div></div>
      <div class="ob-title" style="margin-top:18px">Your Standard is set.</div>
      <div class="ob-sub" style="padding:0 10px">Create your account to save it — your score, meals, and coach connection sync across devices.</div>
    </div>
    <div style="height:16px"></div>
    ${accountBody({ terms: 'ob' })}
    <div class="ob-foot" style="margin-top:auto">
      <button id="su-go" class="btn green" disabled>Create account &amp; Start</button>
    </div>
  </div>`,
};

export default {
  hideTabs: true,
  render({ sub }) {
    if (sub === 'blocked') { track(EVENTS.AGE_BLOCKED); return steps.blocked(); }
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
      // Bind per option, not on the group: wireToggles' per-chip handler stopPropagation()s,
      // so a group-level listener never sees the click. Same-element listeners run in attach
      // order — wireToggles ran first, so sync always reads the fresh .on state.
      g.querySelectorAll('.chp, .choice, button').forEach(el => el.addEventListener('click', sync));
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
        const under13 = dob != null && ageOn(dob, todayISO()) < 13;
        // COPPA: never persist a blocked minor's identity to localStorage — capture nulls
        // instead. A corrected DOB re-captures on the next keystroke.
        if (under13) cap({ firstName: '', lastName: '', name: '', dob: null });
        else cap({ firstName: f, lastName: l, name: `${f} ${l}`.trim(), dob });
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
      let gen = 0; // bumped whenever `out` is repainted; async callbacks bail if stale
      const codeEntry = (ctx) => {
        gen++; // repainting out — invalidate any in-flight search/teams/code responses
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
          const myGen = gen; // capture before await; bail below if repainted or edited since
          try {
            const { match } = await dir.previewCode(code);
            if (myGen !== gen || codeEl.value.trim().toUpperCase() !== code) return; // stale: repainted or user typed on
            if (!match) { codeErr.textContent = "That code didn't match. Check with your coach."; return; }
            cap({ join: match.kind === 'team'
              ? { kind: 'team', code, teamId: match.id, teamName: match.name, coachName: match.coach_name, school: match.school }
              : { kind: 'practice', code, practiceId: match.id, practiceName: match.name, trainerName: match.trainer_name } });
            window.__render();
          } catch {
            if (myGen !== gen) return; // stale: don't clobber whatever's on screen now
            codeErr.textContent = 'Could not check that code — you can also skip and connect later.';
          }
        }, 350));
        codeEl.focus();
      };
      const showTeams = async (org) => {
        gen++; // repainting out — invalidate any in-flight search/code responses
        const myGen = gen;
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Loading coaches…</div>`;
        try {
          const { teams } = await dir.teams(org.id);
          if (myGen !== gen) return; // stale: user navigated away before this resolved
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
        } catch {
          if (myGen !== gen) return; // stale
          codeEntry({ title: 'Directory unavailable', sub: 'Enter your coach code directly, or skip and connect later.' });
        }
      };
      scQ.addEventListener('input', debounce(async () => {
        gen++; // repainting out on every debounced keystroke — invalidate prior in-flight lookups
        const myGen = gen;
        const q = scQ.value.trim();
        if (q.length < 2) { out.innerHTML = ''; return; }
        out.innerHTML = `<div class="micro" style="color:var(--text-3);font-weight:700;padding:6px 2px">Searching…</div>`;
        try {
          const { orgs } = await dir.search(q);
          if (myGen !== gen || scQ.value.trim() !== q) return; // stale: repainted or query changed since
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
          if (myGen !== gen) return; // stale
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
    const goalGrid = grab('#ob-goal');
    wireGroup('#ob-goal', 'goal', () => { const on = grab('#ob-goal .on'); return on ? on.getAttribute('data-val') : null; });
    if (goalGrid) goalGrid.addEventListener('click', (e) => {
      const c = e.target && e.target.closest ? e.target.closest('.choice[data-val]') : null;
      if (c) track(EVENTS.GOAL_SELECTED, { goal: c.getAttribute('data-val') });
    });

    // ---- Step 5: weights + allergies (none selected by default) ----
    const cur = grab('#ob-cur');
    const tgt = grab('#ob-tgt');
    const hint = grab('#ob-wt-hint');
    // Direction check: a target that contradicts the chosen goal (e.g. Lose fat with a target
    // ABOVE current) silently feeds a nonsensical plan. Warn honestly and confirm intent rather
    // than accept it blind. Weight is aspirational (not required, coaches adjust), so we surface
    // the contradiction loudly but don't hard-block — the athlete stays in control.
    const checkDir = () => {
      if (!hint) return;
      const g = (RT.ob && RT.ob.goal) || null;
      const c = parseFloat(cur && cur.value), t = parseFloat(tgt && tgt.value);
      const dir = weightDirection(g);
      if (!dir || !isFinite(c) || !isFinite(t) || c <= 0 || t <= 0) { hint.textContent = ''; return; }
      if (weightContradictsGoal(g, c, t)) {
        const verb = dir === 'down' ? 'lose fat' : 'gain weight';
        const dirWord = dir === 'down' ? 'below' : 'above';
        hint.style.color = 'var(--amber-bright)';
        hint.textContent = `You picked ${verb}, but your target is ${dir === 'down' ? 'at or above' : 'at or below'} your current weight. Set a target ${dirWord} ${Math.round(c)} lb — or change your goal.`;
      } else {
        const delta = Math.abs(Math.round(c - t));
        hint.style.color = 'var(--green-bright)';
        hint.textContent = delta ? `${delta} lb to ${dir === 'down' ? 'lose' : 'gain'} — a season trend, not a deadline.` : '';
      }
    };
    if (cur) cur.addEventListener('input', () => { cap({ currentWeight: parseFloat(cur.value) || null }); checkDir(); });
    if (tgt) tgt.addEventListener('input', () => { cap({ targetWeight: parseFloat(tgt.value) || null }); checkDir(); });
    if (cur && RT.ob && RT.ob.currentWeight) cur.value = RT.ob.currentWeight;
    if (tgt && RT.ob && RT.ob.targetWeight) tgt.value = RT.ob.targetWeight;
    checkDir();
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

    // ---- Step 6: meals/day knob re-renders the rows; hold-to-commit stamps the contract ----
    const mealsRow = grab('#ob-meals');
    // Per-chip binding (not a row-level delegate): #ob-meals is a data-toggle-group, and
    // wireToggles' chip handler stopPropagation()s — a row-level listener never fires.
    if (mealsRow) mealsRow.querySelectorAll('.chp').forEach((chp) => chp.addEventListener('click', () => {
      cap({ standard: { ...((RT.ob || {}).standard || {}), mealsPerDay: +chp.textContent.trim() } });
      window.__render();
    }));
    if (grab('#ob-commit')) wireCommit(root, () => {
      const ob = RT.ob || {};
      cap({
        committedAt: new Date().toISOString(),
        standard: { mealsPerDay: (ob.standard && ob.standard.mealsPerDay) || 3, pressure: ob.pressure || 'Hold me accountable' },
      });
      window.__render();
    });

    // ---- Step 7: shared account component; connection + stamps persist post-signup ----
    if (root.querySelector('#su-go')) {
      wireAccount(root, {
        role: 'athlete',
        onSession: async (live) => {
          await act.persistOnboarding();
          if (live) {
            act.startDay0();
            let bio = false;
            try { bio = window.OnStandardNative && window.OnStandardNative.biometrics ? await window.OnStandardNative.biometrics.available() : false; } catch { /* unavailable */ }
            window.__go(bio ? 'bio-optin' : 'home');
            return;
          }
          showConfirmPending(root, { email: RT.email });
        },
      });
    }
  },
};
