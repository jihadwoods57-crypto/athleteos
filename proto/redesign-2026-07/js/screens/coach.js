import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import * as roles from '../roles.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* Coach roster cache: null = not loaded (show loading), else { teams, rows } from real data.
   Fetched once on mount, repainted via window.__render; the athletes' scores are their own real
   numbers (days.score), and a member with no day row today is honestly "No logs today". */
let ROSTER = null;
let rosterLoading = false;
export async function loadCoachRoster(force) {
  if (rosterLoading) return;
  if (ROSTER && !force) return;
  rosterLoading = true;
  ROSTER = await roles.loadCoachRoster();
  rosterLoading = false;
  if (location.hash === '#coach' || location.hash === '#copilot') window.__render();
}
const scoreColor = (s) => s == null ? 'var(--text-3)' : s >= 80 ? 'var(--green-bright)' : s >= 60 ? 'var(--amber-bright)' : 'var(--red)';

function rosterRow(r) {
  return `
  <div class="roster-row" data-go="coach-athlete/${esc(r.athleteId)}">
    <div class="flagdot ${r.flag}"></div>
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s">${esc(r.note)}</div>
    </div>
    <span class="rl">${esc(r.logs)}</span>
    <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
  </div>`;
}

/* ---------- Coach Dashboard — real roster scoped by RLS to the coach's teams ---------- */
export const coach = {
  nav: 'coach', tab: 'team',
  render() {
    const teamName = ROSTER && ROSTER.teams[0] ? ROSTER.teams[0].name : (S.athlete.school || 'Your team');
    const rows = ROSTER ? ROSTER.rows : null;
    const scored = rows ? rows.filter(r => r.score != null) : [];
    const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
    const onStd = rows ? rows.filter(r => r.score != null && r.score >= 80).length : 0;
    const attention = rows ? rows.filter(r => r.flag === 'r') : [];
    return `
    ${backHead('Coach view', `${esc(teamName)} · today`, 'profile')}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v">${avg != null ? avg : '—'}</div><div class="k">Team avg</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${onStd}</div><div class="k">On standard</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--red)">${attention.length}</div><div class="k">Need attention</div></div>
    </div>

    ${rows === null ? `
    <div class="eyebrow">Roster</div>
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
    <div><div class="tt">Loading your roster…</div><div class="ts">Pulling today's real scores for your team.</div></div></div>`
    : rows.length === 0 ? `
    <div class="eyebrow">Roster</div>
    <div class="state-demo"><div class="sd-ic">${icon('users', 24)}</div>
    <div class="sd-t">No athletes yet</div>
    <div class="sd-s">Share your team code so athletes can join. Their live scores show up here — nothing is invented until they log.</div></div>`
    : `
    ${attention.length ? `<div class="eyebrow">Needs attention</div>${attention.map(r => `
    <div class="notif critical" data-go="coach-athlete/${esc(r.athleteId)}" style="cursor:pointer">
      <div class="nic">${icon('bell', 19)}</div>
      <div style="flex:1"><div class="nt">${esc(r.name)}${r.unit ? ` · ${esc(r.unit)}` : ''}</div><div class="nb">${esc(r.note)}</div></div>
      <span class="nw">${r.score != null ? r.score : '—'}</span>
    </div>`).join('')}` : ''}

    <div class="eyebrow">Roster · live scores</div>
    <section class="card" style="padding:2px 0">${rows.map(rosterRow).join('')}</section>`}

    <div class="eyebrow">Coach tools</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="copilot">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 18)}</div>
        <div class="lm"><div class="lt">Copilot</div><div class="ls">Who needs attention? Who's improving? Team summary.</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="team-diet">
        <div class="lic" style="background:var(--red-surface);color:var(--red)">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Team dietary sheet</div><div class="ls">Allergies & restrictions across the roster</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="coach-profile">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:13px">M</div>
        <div class="lm"><div class="lt">Coach profile & team code</div><div class="ls">Identity, share code, team settings</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:6px"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);padding:0 2px">Tap an athlete to review their day and comment. Assignments and leaderboard controls are coming with the next backend slice.</div>
    <div style="height:10px"></div>
    `;
  },
  mount() { loadCoachRoster(); },
};

/* ---------- Coach assign flow: template -> lands on the athlete's Home ---------- */
export const coachAssign = {
  nav: 'coach', tab: 'assign',
  render() {
    const already = (id) => RT.assigned.some(a => a.id === id);
    const T = [
      { id: 'pwm',  icon: 'utensils', t: 'Post-Workout Meal', s: 'Photo proof · within 45 min of lifting' },
      { id: 'supp', icon: 'check',    t: 'Supplement Log', s: 'One-tap confirm · with dinner' },
      { id: 'body', icon: 'camera',   t: 'Body Photo', s: 'Coach-only · same pose, same light' },
      { id: 'sleep',icon: 'moon',     t: 'Sleep Target · 8h', s: 'This week · lights out 10:30' },
    ];
    return `
    ${backHead('Assign to J. Woods', 'It lands on his Home the moment you send it', 'coach')}

    <div class="eyebrow">Templates</div>
    <section class="card" style="padding:6px 16px">
      ${T.map(x => `
        <div class="lrow" ${already(x.id) ? '' : `data-act="assignReq:${x.id}" data-then="coach"`}>
          <div class="lic" style="${already(x.id) ? 'background:var(--green-surface);color:var(--green-bright)' : ''}">${icon(already(x.id) ? 'check' : x.icon, 17)}</div>
          <div class="lm"><div class="lt">${x.t}</div><div class="ls">${already(x.id) ? 'Assigned · on his Home now' : x.s}</div></div>
          ${already(x.id) ? '<span class="status-pill g">Sent</span>' : `<span class="status-pill b">Assign</span>`}
        </div>`).join('')}
    </section>

    <div class="eyebrow">Custom task</div>
    <div class="composer" style="margin-top:2px">
      <input id="custom-task" placeholder="Name it… e.g. Extra water at practice" />
      <div class="send" id="custom-send" style="background:linear-gradient(150deg, var(--green-bright), #16a34a);color:#04140b">${icon('plus', 19)}</div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Tasks don't mint points</div>
      <div class="ts">The score stays four honest components. Assigned tasks are part of the plan his commitment answer covers, and you see completion either way.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const input = root.querySelector('#custom-task');
    const send = root.querySelector('#custom-send');
    const submit = () => { if (input.value.trim()) { window.__act.assignCustom(input.value); location.hash = '#coach'; } };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};

/* ---------- Coach sets an athlete's REAL nutrition targets (coach_set_goals RPC) ---------- */
let TGT = null;           // { athleteId, targets } loaded from athlete_profiles
let tgtLoadingId = null;
async function loadTargets(athleteId) {
  if (!athleteId || tgtLoadingId === athleteId) return;
  tgtLoadingId = athleteId;
  TGT = { athleteId, targets: (await roles.fetchAthleteTargets(athleteId)) || {} };
  tgtLoadingId = null;
  if (location.hash.startsWith('#coach-plan')) window.__render();
}
export const coachPlan = {
  nav: 'coach', tab: 'plan',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const head = backHead('Nutrition targets', `${esc(who.name)} · coach owns the plan`, athleteId ? `coach-athlete/${esc(athleteId)}` : 'coach');
    if (!athleteId) return `${head}<div class="state-demo"><div class="sd-t">Open from an athlete</div><div class="sd-s">Review an athlete, then set their targets.</div></div>`;
    if (!TGT || TGT.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading their targets…</div></div></div>`;
    }
    const t = TGT.targets || {};
    const rows = [['Protein', 'tg-protein', t.protein != null ? t.protein : 180, 'g', 5], ['Calories', 'tg-calories', t.calories != null ? t.calories : 2400, '', 50], ['Target weight', 'tg-weight', t.weight != null ? t.weight : 180, ' lb', 1]];
    return `
    ${head}

    <div class="eyebrow">Targets</div>
    <section class="card" style="padding:6px 16px">
      ${rows.map(([k, id, v, u, step]) => `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${k}</div></div>
          <span class="wb2" data-step="${id}" data-d="-1" data-s="${step}" style="padding:6px 13px">−</span>
          <span id="${id}" data-u="${u}" style="font-size:16px;font-weight:800;width:84px;text-align:center">${v}${u}</span>
          <span class="wb2" data-step="${id}" data-d="1" data-s="${step}" style="padding:6px 13px">+</span>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Coach owns the numbers</div>
      <div class="ts">Saving writes these to the athlete's plan (athlete_profiles.targets) via the coach_set_goals RPC. Their nutrition scoring is unaffected — the score is always the four honest components.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="save-targets">${icon('check', 19)} Save targets</button>
    <div id="tg-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster();
    loadTargets(sub);
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const el = root.querySelector('#' + b.getAttribute('data-step'));
      const u = el.getAttribute('data-u');
      const step = +b.getAttribute('data-s') || 1;
      el.textContent = Math.max(0, parseInt(el.textContent) + step * +b.dataset.d) + u;
    }));
    const save = root.querySelector('#save-targets');
    const status = root.querySelector('#tg-status');
    if (save) save.addEventListener('click', async () => {
      const num = (id) => parseInt(root.querySelector('#' + id).textContent) || 0;
      save.disabled = true; if (status) status.textContent = 'Saving…';
      const ok = await roles.coachSetGoals(sub, { protein: num('tg-protein'), calories: num('tg-calories'), weight: num('tg-weight') });
      if (ok) { if (status) status.textContent = 'Saved to their plan.'; TGT = null; setTimeout(() => { location.hash = `#coach-athlete/${sub}`; }, 600); }
      else { save.disabled = false; if (status) status.textContent = 'Could not save — check the connection.'; }
    });
  },
};

/* ---------- Copilot: deterministic reads over the REAL roster (honest, not narrated fiction) ---------- */
export const copilot = {
  nav: 'coach', tab: 'copilot',
  render() {
    const rows = ROSTER ? ROSTER.rows : null;
    if (rows === null) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('sparkle', 17)}</div>
      <div><div class="tt">Loading the roster…</div><div class="ts">Copilot reads your real team data — no numbers until it loads.</div></div></div>`;
    }
    const attention = rows.filter(r => r.flag === 'r');
    const belowBar = rows.filter(r => r.score != null && r.score < 80);
    const notLogged = rows.filter(r => !r.loggedToday);
    const summary = rows.length === 0
      ? 'No athletes on your roster yet. Share your team code to get started.'
      : `${rows.length} athlete${rows.length > 1 ? 's' : ''} on your roster. `
        + (attention.length ? `${attention.length} need attention (no logs or off standard). ` : 'Everyone who logged is on standard. ')
        + (notLogged.length ? `${notLogged.length} haven't logged today.` : 'Everyone has logged today.');
    return `
    ${backHead('Copilot', 'Deterministic reads over your real roster', 'coach')}

    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">Copilot</div><p>${esc(summary)}</p></div>
    </div>

    ${belowBar.length ? `
    <div class="eyebrow">The numbers behind it</div>
    <section class="card" style="padding:2px 0">
      ${belowBar.map(r => `
        <div class="roster-row" data-go="coach-athlete/${esc(r.athleteId)}">
          <div class="flagdot ${r.flag}"></div>
          <div class="rn"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.note)}</div></div>
          <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
        </div>`).join('')}
    </section>` : `
    <div class="sidebox"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 17)}</div>
    <div><div class="tt">Nobody below the bar</div><div class="ts">Every logged athlete is at 80+. Check back after tonight's logs.</div></div></div>`}
    <div style="height:10px"></div>
    `;
  },
  mount() { loadCoachRoster(); },
};

/* ---------- Coach → athlete review: real day + meals, RLS-scoped; a "seen" receipt on open ---------- */
let ATH = null;           // { athleteId, day, meals } for the athlete being reviewed
let athLoadingId = null;
function rosterName(athleteId) {
  const r = ROSTER && ROSTER.rows.find(x => x.athleteId === athleteId);
  return r ? { name: r.name, unit: r.unit } : { name: 'Athlete', unit: '' };
}
async function loadAthlete(athleteId, viewerId, viewerName) {
  if (!athleteId || athLoadingId === athleteId) return;
  athLoadingId = athleteId;
  const today = roles.todayISO();
  const [day, meals] = await Promise.all([
    roles.fetchDay(athleteId, today),
    roles.fetchRecentMeals(athleteId, roles.daysAgoISO(14)),
  ]);
  for (const m of meals) { if (m.photo_path) m._url = await roles.signedMealPhotoUrl(m.photo_path); }
  const pass = await roles.fetchActiveTrustPass(athleteId);
  ATH = { athleteId, day, meals, pass };
  athLoadingId = null;
  roles.markDayViewed(athleteId, today, viewerId, viewerName); // fire-and-forget "coach saw your day"
  if (location.hash.startsWith('#coach-athlete')) window.__render();
}
const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
export const coachAthlete = {
  nav: 'coach', tab: 'team',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const head = backHead(`${esc(who.name)}${who.unit ? ` · ${esc(who.unit)}` : ''}`, 'Their day · read-only', 'coach');
    if (!athleteId) return `${head}<div class="state-demo"><div class="sd-t">No athlete selected</div></div>`;
    if (!ATH || ATH.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('user', 17)}</div>
      <div><div class="tt">Loading their day…</div><div class="ts">Pulling today's real score and logged meals.</div></div></div>`;
    }
    const day = ATH.day;
    const today = roles.todayISO();
    const todayMeals = ATH.meals.filter(m => m.day_date === today);
    const score = day && day.score != null ? day.score : null;
    const mealsJson = (day && day.meals) || {};
    const ci = (day && day.checkin) || {};
    const openSlots = ['breakfast', 'lunch', 'dinner'].filter(k => !mealsJson[k]);
    return `
    ${head}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${MEAL_SLOTS.filter(k => mealsJson[k]).length}</div><div class="k">Meals logged</div></div>
      <div class="coach-stat"><div class="v" style="color:${ci.submitted ? 'var(--green-bright)' : 'var(--amber-bright)'}">${ci.submitted ? 'In' : 'Open'}</div><div class="k">Recovery</div></div>
    </div>

    ${!day ? `<div class="sidebox" style="margin-top:14px"><div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
    <div><div class="tt">No logs today yet</div><div class="ts">Nothing to review — they haven't logged. Their day appears here as they log it.</div></div></div>`
    : `
    <div class="eyebrow">Today's proof${todayMeals.length ? '' : ' · none yet'}</div>
    ${todayMeals.length ? `<div class="hscroll">
      ${todayMeals.map(m => `
        <div class="act-card" data-go="coach-meal/${esc(m.id)}">
          <div class="act-time">${esc(cap(m.type || 'Meal'))}</div>
          ${m._url
            ? `<div class="act-media"><img src="${esc(m._url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`
            : `<div class="act-media icon" style="background:linear-gradient(150deg, rgba(52,211,153,0.2), rgba(37,99,235,0.1));color:var(--green-bright)">${icon('utensils', 26)}</div>`}
          <div class="act-body"><div class="act-type">${m.quality != null ? 'Meal score' : 'Logged'}</div><div class="act-value ${m.quality != null && m.quality >= 80 ? 'g' : 'b'}">${m.quality != null ? m.quality : '·'}</div></div>
        </div>`).join('')}
    </div>` : `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:-2px 2px 10px">No meal photos logged today.</div>`}

    <div class="eyebrow">What's open</div>
    <section class="card" style="padding:6px 16px">
      ${openSlots.length || !ci.submitted ? `
        ${openSlots.map(k => `
          <div class="lrow" style="cursor:default"><div class="lic" style="color:var(--amber-bright)">${icon('bowl', 17)}</div>
          <div class="lm"><div class="lt">${cap(k)}</div><div class="ls">Not logged yet</div></div><span class="status-pill a">Open</span></div>`).join('')}
        ${!ci.submitted ? `<div class="lrow" style="cursor:default"><div class="lic" style="color:var(--purple-bright)">${icon('moon', 17)}</div>
          <div class="lm"><div class="lt">Recovery check-in</div><div class="ls">Before bed</div></div><span class="status-pill p">Open</span></div>` : ''}`
        : `<div class="lrow" style="cursor:default"><div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
          <div class="lm"><div class="lt">Everything is in</div><div class="ls">Finished day${score != null ? ` · ${score}` : ''}</div></div></div>`}
    </section>`}

    <div class="eyebrow">Coach actions</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="coach-plan/${esc(athleteId)}">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Set nutrition targets</div><div class="ls">Protein · calories · target weight</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">Trust Pass</div><div class="ls">${ATH.pass ? `Active · granted ${esc(ATH.pass.granted_date)}` : 'Camera-free days, earned with photo-logged history'}</div></div>
        <button class="btn ghost sm" id="tp-btn" style="width:auto;padding:0 14px;height:34px">${ATH.pass ? 'End' : 'Grant'}</button>
      </div>
    </section>
    <div id="tp-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:4px;padding:0 2px">Tap a meal photo to review and comment on it.</div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster(); // ensure the name is available
    loadAthlete(sub, RT.userId, S.athlete.name);
    const btn = root.querySelector('#tp-btn');
    const status = root.querySelector('#tp-status');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true; if (status) status.textContent = ATH.pass ? 'Ending…' : 'Granting…';
      if (ATH.pass) {
        const ok = await roles.endTrustPass(sub);
        if (status) status.textContent = ok ? 'Trust Pass ended.' : 'Could not end it.';
      } else {
        const r = await roles.grantTrustPass(sub, 10);
        if (status) status.textContent = r.ok ? 'Trust Pass granted.' : (r.error && /on.?standard|photo|eligib/i.test(r.error) ? 'Not eligible yet — needs 7 photo-logged days.' : 'Could not grant it.');
      }
      ATH = null; // force a refresh of the pass state
      setTimeout(() => { if (location.hash.startsWith('#coach-athlete')) { loadAthlete(sub, RT.userId, S.athlete.name); } }, 500);
    });
  },
};

/* ---------- Coach → meal review + comment: the REAL meal_comments thread (slice 5) ---------- */
let MC = null;            // { mealId, comments }
let mcLoadingId = null;
async function loadMealComments(mealId, force) {
  if (!mealId || (mcLoadingId === mealId && !force)) return;
  mcLoadingId = mealId;
  MC = { mealId, comments: await roles.fetchMealComments(mealId) };
  mcLoadingId = null;
  if (location.hash.startsWith('#coach-meal')) window.__render();
}
function mealById(mealId) { return ATH && ATH.meals.find(m => m.id === mealId); }
export const coachMeal = {
  nav: 'coach', tab: 'team',
  render({ sub }) {
    const mealId = sub;
    const meal = mealById(mealId);
    const title = meal ? cap(meal.type || 'Meal') : 'Meal';
    const head = backHead(title, 'Your comment lands on the athlete’s log', ATH ? `coach-athlete/${ATH.athleteId}` : 'coach');
    if (!MC || MC.mealId !== mealId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('message', 17)}</div>
      <div><div class="tt">Loading the thread…</div><div class="ts">Reading the athlete’s comments on this meal.</div></div></div>`;
    }
    const foods = meal && Array.isArray(meal.detected) ? meal.detected : [];
    return `
    ${head}

    ${meal ? `
    <div class="photo-hero" ${meal._url ? '' : 'style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))"'}>
      ${meal._url ? `<img src="${esc(meal._url)}" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"/>` : ''}
      <div class="ph-grad"></div>
      <div class="ph-meta"><div><div class="ph-t">${esc(title)}</div><div class="ph-s">${meal.protein != null ? `${meal.protein}g protein` : 'Logged'}</div></div>
      ${meal.quality != null ? `<div class="scorechip"><span class="v">${meal.quality}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>` : ''}

    ${foods.length ? `<div class="eyebrow">Detected</div><div class="foodchips">${foods.map(f => `<span class="foodchip"><span class="dot"></span>${esc(f)}</span>`).join('')}</div>` : ''}

    <div class="eyebrow">Conversation</div>
    ${MC.comments.length ? `<div class="thread">
      ${MC.comments.map(c => `
        <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
          ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
          <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
          <div class="bubble">${esc(c.text)}</div></div>
        </div>`).join('')}
    </div>` : `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:2px 2px 8px">No comments yet. Say something — the athlete sees it on the log.</div>`}
    <div class="composer">
      <input id="cm-input" placeholder="Comment on this meal…" />
      <div class="send" id="cm-send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadMealComments(sub);
    const input = root.querySelector('#cm-input');
    const send = root.querySelector('#cm-send');
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) return;
      input.value = '';
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', text);
      if (ok) roles.nudgePush(athleteId, `${S.athlete.name} commented on your ${meal ? cap(meal.type) : 'meal'}`, text);
      await loadMealComments(sub, true);
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};

/* ---------- Trainer view: clients, not a team. Scope = recovery + readiness + nutrition consistency ---------- */
export const trainer = {
  nav: 'trainer', tab: 'clients',
  render() {
    const clients = [
      { name: 'J. Woods', tag: 'WR · lean mass', ready: 84, consist: 87, flag: 'g', you: true },
      { name: 'S. Carter', tag: 'Volleyball · perform', ready: 71, consist: 78, flag: 'y' },
      { name: 'R. Nunez', tag: 'Wrestling · cut', ready: 62, consist: 91, flag: 'y' },
    ];
    return `
    ${backHead('Trainer view', 'Your clients · recovery, readiness, consistency', 'profile')}

    <section class="card" style="padding:2px 0">
      ${clients.map(c => `
        <div class="roster-row" ${c.you ? 'data-go="trainer-client"' : 'style="cursor:default"'}>
          <div class="flagdot ${c.flag}"></div>
          <div class="rn">
            <div class="t">${c.name}${c.you ? ' <span class="status-pill b" style="font-size:9.5px;padding:2px 8px">OPEN</span>' : ''}</div>
            <div class="s">${c.tag}</div>
          </div>
          <span class="rl" title="readiness">${c.ready}</span>
          <span class="rs" style="color:${c.consist >= 80 ? 'var(--green-bright)' : 'var(--amber-bright)'}">${c.consist}%</span>
        </div>`).join('')}
    </section>
    <div style="display:flex;justify-content:space-between;padding:8px 18px 0;font-size:10.5px;font-weight:700;color:var(--text-3);letter-spacing:0.05em">
      <span></span><span>READINESS · CONSISTENCY</span>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Trainer scope</div>
      <div class="ts">You see recovery, readiness, and nutrition consistency. Team scores, coach comments, and body photos stay in the coach lane.</div></div>
    </div>

    <div style="height:12px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="trainer-profile">
        <div class="lic" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff;font-weight:800;font-size:13px">T</div>
        <div class="lm"><div class="lt">Trainer profile & client code</div><div class="ls">Practice, share code, scope</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Trainer -> client detail (Jihad as client) ---------- */
export const trainerClient = {
  nav: 'trainer', tab: 'note',
  render() {
    return `
    ${backHead('J. Woods', 'Client · lean mass phase', 'trainer')}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:var(--blue-bright)">${S.weekly.readiness != null ? S.weekly.readiness : '—'}</div><div class="k">Readiness</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">87%</div><div class="k">Consistency</div></div>
      <div class="coach-stat"><div class="v" style="color:${RT.recoveryDone ? 'var(--green-bright)' : 'var(--amber-bright)'}">${RT.recoveryDone ? 'In' : 'Open'}</div><div class="k">Tonight's recovery</div></div>
    </div>

    <div class="eyebrow">Recovery pattern · this week</div>
    <section class="card pad">
      <div class="consist">
        ${[['Sleep quality', 78, 'b'], ['Soreness load', 64, 'a'], ['Recovery check-ins', 71, 'p'], ['Hydration', 80, 'b']].map(([k, v, a]) => `
          <div class="cons-row">
            <span class="k" style="width:120px">${k}</span>
            <div class="track"><div class="fillb" style="width:${v}%;background:linear-gradient(90deg,${a === 'p' ? '#7e22ce,var(--purple-bright)' : a === 'a' ? '#b45309,var(--amber-bright)' : 'var(--blue-deep),var(--blue-bright)'})"></div></div>
            <span class="v">${v}%</span>
          </div>`).join('')}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:14px">Soreness tracks his two missed recovery nights. Night habits are the coaching point, not effort.</div>
    </section>

    <div class="eyebrow">Note to client</div>
    <div class="thread"></div>
    <div class="composer">
      <input placeholder="Note for Jihad…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireComposer } = await import('./settings.js');
    // REAL in-sim: the note lands in the client's notifications
    wireComposer(root, 'delivery', '', "Delivered · Jihad sees it in his notifications", (text) => window.__act.trainerNote(text));
  },
};

/* ---------- Parent view — simple accountability, not surveillance ---------- */
export const parent = {
  hideTabs: true,
  render() {
    return `
    ${backHead('Parent view', 'Jihad · this week', 'profile')}

    <section class="card pad" style="text-align:center">
      <div style="font-size:13px;font-weight:700;color:var(--text-2)">Today</div>
      <div style="font-size:58px;font-weight:800;letter-spacing:-0.04em;margin-top:4px">${S.score}</div>
      <span class="tier-chip ${S.tier.cls}">${S.tier.name}</span>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:12px">${S.metCount} of ${S.reqTotal} requirements done · ${S.streakDays}-day streak</div>
    </section>

    <div class="eyebrow">This week</div>
    <section class="card pad">
      <div class="bigstat"><span class="n" style="font-size:34px">5 of 7</span><span class="d">days on standard</span></div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:6px">Jihad is showing up. Meals are consistent; night recovery check-ins are the habit still being built.</div>
    </section>

    <div class="eyebrow">Sunday digest · pushed 7 PM</div>
    <section class="card pad">
      <div style="font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px">This week's summary</div>
      <p style="font-size:14.5px;font-weight:600;line-height:1.55">Jihad finished 5 of 7 days on standard, his best week of the phase. Meals are nearly automatic now. The habit still forming: the nightly recovery check-in. If you ask one question this week, ask about sleep.</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline-soft)">
        <span style="font-size:12.5px;font-weight:700;color:var(--text-2)">Delivered Sundays · push + email</span>
        <div class="seg" style="width:104px" data-toggle-group><button class="on">On</button><button>Off</button></div>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What parents see</div>
      <div class="ts">Scores, streaks, and completion only. Meal photos, weight, and check-in answers stay between Jihad and his coach by default.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) { const { wireToggles } = await import('./settings.js'); wireToggles(root); },
};
