import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, titleHead, esc, composer, sparkline } from '../components.js';
import * as roles from '../roles.js';
import { openingMessage, qualityBand, reactionGroups, threadMessages, privateNotes } from '../meal-intel.js';
import { openImageViewer } from '../image-viewer.js';
import { CD, loadCoachRoster, loadActivity, actTime, loadAthleteProfile } from '../coach-data.js';
import { STATUS_META } from '../status.js';
import { CATALOG, PROOF, resolveRequirementSet, catalogFromItems, freqLabel, stdFromItems, fmtMin } from '../requirements.js';
import { seedTemplates, templateLabel } from '../templates.js';
import { audienceLabel } from './coach-announce.js';
import { fmtWhen } from '../notif-feed.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Back-compat re-export: loadCoachRoster now lives in coach-data.js (shared across every coach
// screen), but keeps this exact name/signature so any existing importer keeps working untouched.
export { loadCoachRoster };

const scoreColor = (s) => s == null ? 'var(--text-3)' : s >= 80 ? 'var(--green-bright)' : s >= 60 ? 'var(--amber-bright)' : 'var(--red)';

/* ---------- Coach assign flow — the + button (0055 requirements engine) ----------
   Who (team / position room / one athlete) → what (title) → proof → due → note → send.
   The assign_requirement RPC fans out one row per athlete and notifies each; failures
   (offline, migration not yet applied to live) surface the server's message honestly. */
const ASSIGN = { scopeKind: 'team', scopeValue: null, proof: 'check', due: 'tonight' };
const DUE_CHOICES = {
  tonight:  { label: 'Tonight · 9 PM',   at: () => { const d = new Date(); d.setHours(21, 0, 0, 0); return d; } },
  tomorrow: { label: 'Tomorrow · 9 PM',  at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(21, 0, 0, 0); return d; } },
  none:     { label: 'No deadline',      at: () => null },
};
const PROOF_CHOICES = [
  ['photo', 'camera', 'Photo'], ['check', 'check', 'Check'], ['scale', 'scale', 'Scale'], ['form', 'clipboard', 'Form'],
];

export const coachAssign = {
  nav: 'coach', tab: 'create',
  render({ sub } = {}) {
    // deep-link: coach-assign/<athleteId> pre-targets one athlete (from the athlete screen)
    const rows = CD.roster ? CD.roster.rows : [];
    if (sub && ASSIGN.scopeKind !== 'athlete') { ASSIGN.scopeKind = 'athlete'; ASSIGN.scopeValue = sub; }
    const positions = [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))];
    const target = ASSIGN.scopeKind === 'athlete' ? rows.find(r => r.athleteId === ASSIGN.scopeValue) : null;
    const chip = (on, label, act, arg) =>
      `<span class="chp ${on ? 'on' : ''}" data-assign="${act}${arg != null ? ':' + esc(String(arg)) : ''}">${label}</span>`;
    return `
    ${backHead('Assign', 'Put something on someone’s plate', 'coach-home')}

    <div class="eyebrow">Who</div>
    <div class="chip-row" id="as-who">
      ${chip(ASSIGN.scopeKind === 'team', `Whole team${rows.length ? ` · ${rows.length}` : ''}`, 'team')}
      ${positions.map(p => {
        const n = rows.filter(r => (r.unit || '').trim().toUpperCase() === p).length;
        return chip(ASSIGN.scopeKind === 'position' && ASSIGN.scopeValue === p, `${esc(p)} room · ${n}`, 'position', p);
      }).join('')}
    </div>
    ${rows.length ? `
    <div class="chip-row" id="as-ath" style="margin-top:6px">
      ${rows.slice(0, 12).map(r => chip(ASSIGN.scopeKind === 'athlete' && ASSIGN.scopeValue === r.athleteId, esc(r.name.split(' ')[0] || r.name), 'athlete', r.athleteId)).join('')}
    </div>` : `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:2px 2px 0">Roster loading… team-wide works right away.</div>`}

    <div class="eyebrow">What</div>
    <input id="as-title" class="ob-input" maxlength="80" placeholder="e.g. Extra shake after lift" value="${esc(ASSIGN.title || '')}" />

    <div class="eyebrow">Proof</div>
    <div class="chip-row" id="as-proof">
      ${PROOF_CHOICES.map(([id, ic, label]) => chip(ASSIGN.proof === id, `${icon(ic, 13)} ${label}`, 'proof', id)).join('')}
    </div>

    <div class="eyebrow">Due</div>
    <div class="chip-row" id="as-due">
      ${Object.entries(DUE_CHOICES).map(([id, d]) => chip(ASSIGN.due === id, d.label, 'due', id)).join('')}
    </div>

    <div class="eyebrow">Note · optional</div>
    <input id="as-note" class="ob-input" maxlength="280" placeholder="Why it matters (they see this)" value="${esc(ASSIGN.note || '')}" />

    <div style="height:16px"></div>
    <button class="btn" id="as-send">${icon('plus', 18)} ${target ? `Send to ${esc(target.name)}` : ASSIGN.scopeKind === 'position' ? `Send to the ${esc(ASSIGN.scopeValue || '')} room` : 'Send to the whole team'}</button>
    <div id="as-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:8px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster();
    const say = (msg, isErr) => {
      const el = root.querySelector('#as-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    const keep = () => {
      ASSIGN.title = (root.querySelector('#as-title') || {}).value || '';
      ASSIGN.note = (root.querySelector('#as-note') || {}).value || '';
    };
    root.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('click', () => {
      keep();
      const [act, arg] = el.getAttribute('data-assign').split(':');
      if (act === 'team') { ASSIGN.scopeKind = 'team'; ASSIGN.scopeValue = null; }
      if (act === 'position') { ASSIGN.scopeKind = 'position'; ASSIGN.scopeValue = arg; }
      if (act === 'athlete') { ASSIGN.scopeKind = 'athlete'; ASSIGN.scopeValue = arg; }
      if (act === 'proof') ASSIGN.proof = arg;
      if (act === 'due') ASSIGN.due = arg;
      window.__render();
    }));
    const send = root.querySelector('#as-send');
    if (send) send.addEventListener('click', async () => {
      keep();
      const title = ASSIGN.title.trim();
      if (title.length < 2) { say('Give it a name first — what are they doing?', true); return; }
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) { say('Your roster hasn’t loaded yet — give it a second and try again.', true); return; }
      const due = DUE_CHOICES[ASSIGN.due];
      const dueAt = due.at();
      send.disabled = true; say('Sending…');
      const r = await roles.assignRequirement({
        teamId, scopeKind: ASSIGN.scopeKind, scopeValue: ASSIGN.scopeValue,
        title, proof: ASSIGN.proof,
        dueAt: dueAt ? dueAt.toISOString() : null,
        dueLabel: dueAt ? due.label.replace(' · ', ' ') : null,
        note: ASSIGN.note.trim() || null,
      });
      send.disabled = false;
      if (!r.ok) { say(r.error || 'Could not send — try again.', true); return; }
      if (!r.count) { say('No athletes matched — check who you picked.', true); return; }
      ASSIGN.title = ''; ASSIGN.note = '';
      say(r.count === 1 ? 'Sent — it’s on their list now.' : `Sent — it’s on ${r.count} lists now.`);
    });
  },
};

/* ---------- Coach sets an athlete's REAL nutrition targets (coach_set_goals RPC) ---------- */
let TGT = null;           // { athleteId, targets } loaded from athlete_profiles
let tgtLoadingId = null;
async function loadTargets(athleteId) {
  if (!athleteId || tgtLoadingId === athleteId) return;
  if (TGT && TGT.athleteId === athleteId) return; // loaded — repaints must not refetch-loop
  tgtLoadingId = athleteId;
  const [targets, basics] = await Promise.all([
    roles.fetchAthleteTargets(athleteId),
    roles.fetchAthleteBasics(athleteId),
  ]);
  TGT = { athleteId, targets: targets || {}, basics: basics || null };
  tgtLoadingId = null;
  if (location.hash.startsWith('#coach-plan')) window.__render();
}
/* Deterministic target suggestion — sports-nutrition rules of thumb, computed in the open
   (never an AI black box; the coach's Save is the only thing that writes). Direction comes
   from target vs current weight: bulk / cut / hold. */
function suggestTargets(targetWeight, baseWeight) {
  const tw = +targetWeight || 0;
  if (tw < 80 || tw > 450) return null;
  const bw = +baseWeight || tw;
  const mode = tw > bw + 5 ? 'bulk' : tw < bw - 5 ? 'cut' : 'hold';
  const protein = Math.round((tw * (mode === 'cut' ? 1.2 : mode === 'bulk' ? 1.1 : 0.9)) / 5) * 5;
  const calories = Math.round((tw * (mode === 'bulk' ? 17 : mode === 'cut' ? 13 : 15)) / 50) * 50;
  const why = mode === 'bulk' ? `building to ${tw} lb — surplus + 1.1g/lb protein`
    : mode === 'cut' ? `cutting to ${tw} lb — deficit + 1.2g/lb to hold muscle`
    : `holding ${tw} lb — maintenance + 0.9g/lb`;
  return { protein, calories, mode, why };
}
/* ---------- Plan tab = Coach Control Center (WS5.1) ----------
   No athlete id → the program home: per-room standing standards (0055 requirement_sets)
   + targets entry points. With an athlete id → the existing per-athlete targets editor. */
let SETS = null;            // team's requirement_sets, or null (loading) / {offline:true}
let setsLoading = false;
async function loadSets(force) {
  const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
  if (!teamId || setsLoading) return;
  if (SETS && !force) return;
  setsLoading = true;
  try { SETS = { rows: await roles.fetchRequirementSets(teamId) }; }
  catch { SETS = { rows: [] }; }
  finally { setsLoading = false; }
  if (location.hash.startsWith('#coach-plan')) window.__render();
}
/* Trust passes across the roster (0033/0039 — earned camera-free reward, server-enforced). */
let TP = null;
let tpLoading = false;
async function loadTrust(force) {
  if (tpLoading) return;
  if (TP && !force) return;
  const rows = CD.roster ? CD.roster.rows.slice(0, 12) : [];
  tpLoading = true;
  try {
    const map = {};
    await Promise.all(rows.map(async (r) => { map[r.athleteId] = await roles.fetchActiveTrustPass(r.athleteId); }));
    TP = { map };
  } catch { TP = { map: {} }; }
  finally { tpLoading = false; }
  if (location.hash.startsWith('#coach-plan')) window.__render();
}

const setSummary = (items) => {
  const meals = items.filter(i => i.kind === 'meal').length;
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const bits = [`${meals} meal${meals === 1 ? '' : 's'}`];
  if (lift) bits.push((lift.freq && lift.freq.label) ? `lifts ${lift.freq.label}` : 'lifts');
  if (weigh) bits.push(weigh.freq && weigh.freq.type === 'daily' ? 'weigh daily' : 'weigh MWF');
  return bits.join(' · ');
};

export const coachPlan = {
  nav: 'coach', tab: 'roster',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const head = backHead('Nutrition targets', `${esc(who.name)} · coach owns the plan`, athleteId ? `coach-athlete/${esc(athleteId)}` : 'coach-plan');
    if (!athleteId) {
      const rows = CD.roster ? CD.roster.rows : null;
      const positions = rows ? [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))] : [];
      const sets = SETS && SETS.rows ? SETS.rows : null;
      const teamSet = sets && sets.find(s => s.scope_kind === 'team');
      const roomCard = (pos) => {
        const s = sets && sets.find(x => x.scope_kind === 'position' && String(x.scope_value || '').trim().toUpperCase() === pos);
        const n = rows ? rows.filter(r => (r.unit || '').trim().toUpperCase() === pos).length : 0;
        return `
        <div class="lrow" data-go="coach-plan-set/position/${esc(pos)}">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright);font-weight:800;font-size:12px">${esc(pos.slice(0, 2))}</div>
          <div class="lm"><div class="lt">${esc(pos)} room <small style="color:var(--text-3);font-weight:700">· ${n}</small></div>
          <div class="ls">${s ? esc(setSummary(s.items)) : 'Team default'}</div></div>
          ${s ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`;
      };
      return `
      ${titleHead('Plan', 'Your program, room by room')}

      <div class="eyebrow">Standards · what every day asks</div>
      ${sets === null && rows === null ? `
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading your program…</div><div class="ts">Pulling your rooms and standards.</div></div></div>` : `
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-plan-set/team">
          <div class="lic" style="background:var(--surface-3);color:var(--text-2);font-weight:800;font-size:12px">TM</div>
          <div class="lm"><div class="lt">Team default</div>
          <div class="ls">${teamSet ? esc(setSummary(teamSet.items)) : 'Built-in · 3 meals, recovery, weekly check-in'}</div></div>
          ${teamSet ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        ${positions.map(roomCard).join('')}
      </section>
      ${positions.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.4">Rooms appear as athletes with positions join. The team default covers everyone until then.</div>` : ''}`}

      <div class="eyebrow">Targets · per athlete</div>
      ${rows && rows.length ? `
      <section class="card" style="padding:6px 16px">
        ${rows.slice(0, 6).map(r => `
        <div class="lrow" data-go="coach-plan/${esc(r.athleteId)}">
          <div class="lic">${icon('target', 17)}</div>
          <div class="lm"><div class="lt">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
          <div class="ls">Protein · calories · target weight</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`).join('')}
      </section>` : `
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.4">Athlete targets open from the roster once your team joins.</div>`}

      <div class="eyebrow">Trust passes · earned camera-free days</div>
      ${rows && rows.length ? `
      <section class="card" style="padding:6px 16px">
        ${rows.slice(0, 6).map(r => {
          const pass = TP && TP.map ? TP.map[r.athleteId] : undefined;
          const active = pass && pass.granted_date;
          return `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="${active ? 'background:var(--green-surface);color:var(--green-bright)' : ''}">${icon('shield', 17)}</div>
          <div class="lm"><div class="lt">${esc(r.name)}</div>
          <div class="ls">${TP === null ? 'Checking…' : active ? `Active · started ${esc(pass.granted_date)} · ${pass.length_days || 10} days` : 'No pass · needs 7 photo-logged days on standard'}</div></div>
          <button class="btn ghost sm" data-tp="${active ? 'end' : 'grant'}:${esc(r.athleteId)}" style="width:auto;padding:0 12px;height:30px;font-size:11px;${active ? 'color:var(--red)' : ''}">${active ? 'End' : 'Grant'}</button>
        </div>`;
        }).join('')}
        <div id="tp-plan-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;padding:2px 2px 8px"></div>
      </section>` : `
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.4">Trust passes unlock once athletes are on the roster — earned with 7 straight photo-logged days on standard.</div>`}

      <div class="eyebrow">Program controls</div>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-voice">
          <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 17)}</div>
          <div class="lm"><div class="lt">AI in your voice</div><div class="ls">It reinforces your rulings, never invents</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        <div class="lrow" data-go="team-diet">
          <div class="lic" style="background:var(--red-surface);color:var(--red)">${icon('bell', 17)}</div>
          <div class="lm"><div class="lt">Team dietary sheet</div><div class="ls">Allergies &amp; restrictions across the roster</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
      </section>
      <div style="height:10px"></div>
      `;
    }
    if (!TGT || TGT.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading their targets…</div></div></div>`;
    }
    const t = TGT.targets || {};
    // Distinguish "no targets set yet" (starter defaults shown as a starting point) from real
    // saved values — a coach shouldn't think targets already exist when they're just placeholders.
    const unset = t.protein == null && t.calories == null && t.weight == null;
    const rows = [['Protein', 'tg-protein', t.protein != null ? t.protein : 180, 'g', 5], ['Calories', 'tg-calories', t.calories != null ? t.calories : 2400, '', 50], ['Target weight', 'tg-weight', t.weight != null ? t.weight : 180, ' lb', 1]];
    return `
    ${head}

    <div class="eyebrow">Targets${unset ? ' · not set yet' : ''}</div>
    ${unset ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:-4px 2px 8px;line-height:1.4">Starting points, not saved. Adjust and Save to set ${esc(who.name.split(' ')[0])}'s real targets.</div>` : ''}
    <section class="card" style="padding:6px 16px">
      ${rows.map(([k, id, v, u, step]) => `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${k}</div></div>
          <span class="wb2" data-step="${id}" data-d="-1" data-s="${step}" style="padding:6px 13px">−</span>
          <span id="${id}" data-u="${u}" style="font-size:16px;font-weight:800;width:84px;text-align:center">${v}${u}</span>
          <span class="wb2" data-step="${id}" data-d="1" data-s="${step}" style="padding:6px 13px">+</span>
        </div>`).join('')}
    </section>

    <div style="height:12px"></div>
    <section class="card" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="req-icon b" style="width:34px;height:34px;flex:none">${icon('target', 16)}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:800">Suggested from the target weight</div>
        <div id="sg-why" style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:1px">Set the target weight above, then tap Suggest.</div></div>
        <button class="btn ghost sm" id="sg-btn" style="width:auto;padding:0 14px;height:32px">Suggest</button>
      </div>
      <div id="sg-out" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--hairline-soft)">
        <div style="display:flex;align-items:baseline;gap:14px">
          <div><span id="sg-protein" style="font-size:19px;font-weight:800;font-variant-numeric:tabular-nums">—</span><span style="font-size:11px;font-weight:700;color:var(--text-3)"> g protein</span></div>
          <div><span id="sg-calories" style="font-size:19px;font-weight:800;font-variant-numeric:tabular-nums">—</span><span style="font-size:11px;font-weight:700;color:var(--text-3)"> kcal</span></div>
          <button class="btn green sm" id="sg-use" style="width:auto;padding:0 16px;height:32px;margin-left:auto">Use these</button>
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:6px">Open math, not a black box — you approve, then Save writes it.</div>
      </div>
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
    loadCoachRoster().then(() => { loadSets(); if (!sub) loadTrust(); });
    // Trust pass grant/end on the Plan home (server-enforced eligibility, honest errors)
    root.querySelectorAll('[data-tp]').forEach(b => b.addEventListener('click', async () => {
      const [what, id] = b.getAttribute('data-tp').split(':');
      const status = root.querySelector('#tp-plan-status');
      const say = (msg, isErr) => { if (status) { status.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; status.textContent = msg; } };
      b.disabled = true; say(what === 'grant' ? 'Granting…' : 'Ending…');
      if (what === 'grant') {
        const r = await roles.grantTrustPass(id, 10);
        if (!r.ok) { b.disabled = false; say(r.error && /standard|photo|eligib/i.test(r.error) ? 'Not eligible yet — needs 7 photo-logged days on standard.' : (r.error || 'Could not grant it.'), true); return; }
        say('Granted — camera-free days start now.');
      } else {
        const ok = await roles.endTrustPass(id);
        if (!ok) { b.disabled = false; say('Could not end it — try again.', true); return; }
        say('Ended.');
      }
      await loadTrust(true);
    }));
    if (!sub) return;
    loadTargets(sub);
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const el = root.querySelector('#' + b.getAttribute('data-step'));
      const u = el.getAttribute('data-u');
      const step = +b.getAttribute('data-s') || 1;
      el.textContent = Math.max(0, parseInt(el.textContent) + step * +b.dataset.d) + u;
    }));
    // Suggested targets: reads the CURRENT target-weight stepper, fills protein/calories.
    const sgBtn = root.querySelector('#sg-btn');
    if (sgBtn) {
      let sg = null;
      sgBtn.addEventListener('click', () => {
        const tw = parseInt((root.querySelector('#tg-weight') || {}).textContent) || 0;
        const bw = TGT && TGT.basics && TGT.basics.base_weight;
        sg = suggestTargets(tw, bw);
        const why = root.querySelector('#sg-why'), out = root.querySelector('#sg-out');
        if (!sg) { if (why) why.textContent = 'Set a real target weight first (80–450 lb).'; return; }
        if (why) why.textContent = `${sg.why}${bw ? ` · current ${Math.round(bw)} lb` : ''}`;
        if (out) out.style.display = '';
        const p = root.querySelector('#sg-protein'), k = root.querySelector('#sg-calories');
        if (p) p.textContent = sg.protein; if (k) k.textContent = sg.calories;
      });
      const use = root.querySelector('#sg-use');
      if (use) use.addEventListener('click', () => {
        if (!sg) return;
        const pEl = root.querySelector('#tg-protein'), kEl = root.querySelector('#tg-calories');
        if (pEl) pEl.textContent = `${sg.protein}${pEl.getAttribute('data-u') || ''}`;
        if (kEl) kEl.textContent = `${sg.calories}${kEl.getAttribute('data-u') || ''}`;
      });
    }
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

/* ---------- Standards editor (WS5.1): one scope's standing requirement set ----------
   Knobs → catalog-shaped items (0055-validated rails: meals 1–6, lifts 0–7) →
   set_team_requirements. A position room can reset to the team default (0058). */
const LIFT_DAYS = { 1: [2], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Meal 4', 'Meal 5', 'Meal 6'];
const MEAL_WINDOWS = [{ open: 420, due: 570 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }, { due: 1290 }, { due: 1320 }, { due: 1350 }];
let KNOB = null; // { key, meals, lifts, weigh, hydration, recovery, checkin }

export function knobsFromItems(items) {
  const mealItems = items.filter(i => i.kind === 'meal');
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const hyd = items.find(i => i.kind === 'hydration');
  const meals = Math.min(6, Math.max(1, mealItems.length));
  return {
    meals,
    lifts: lift ? Math.min(7, (lift.freq && lift.freq.days && lift.freq.days.length) || 3) : 0,
    weigh: weigh ? ((weigh.freq && weigh.freq.type === 'daily') ? 'daily' : 'mwf') : 'off',
    hydration: !!hyd,
    hydrationOz: (hyd && typeof hyd.target === 'number') ? hyd.target
      : (hyd && /(\d+)\s*oz/i.test(hyd.title || '') ? +(hyd.title.match(/(\d+)\s*oz/i)[1]) : 120),
    recovery: items.some(i => i.kind === 'recovery'),
    checkin: items.some(i => i.kind === 'checkin'),
    photoProof: mealItems.length ? mealItems.every(m => m.proof === 'photo') : true,
    mealNames: mealItems.slice(0, meals).map((m, i) => m.title || MEAL_NAMES[i]),
    mealWins: mealItems.slice(0, meals).map((m, i) => (m.window && m.window.due != null) ? { ...m.window } : { ...MEAL_WINDOWS[i] }),
  };
}
// Shared fallback logic for meal names/windows — render() uses this too, so what's shown
// on screen IS exactly what itemsFromKnobs would save.
function resolveMeals(k) {
  if (Array.isArray(k.mealNames) && k.mealNames.length === k.meals
      && Array.isArray(k.mealWins) && k.mealWins.length === k.meals) {
    return { names: k.mealNames, wins: k.mealWins };
  }
  if (k.meals === 1) return { names: ['Daily meal'], wins: [{ open: 720, due: 1230 }] };
  if (k.meals === 2) return { names: ['Breakfast', 'Dinner'], wins: [MEAL_WINDOWS[0], MEAL_WINDOWS[2]] };
  return { names: MEAL_NAMES.slice(0, k.meals), wins: MEAL_WINDOWS.slice(0, k.meals) };
}
export function itemsFromKnobs(k) {
  const items = [];
  const { names, wins } = resolveMeals(k);
  const proof = k.photoProof === false ? 'check' : 'photo';
  names.forEach((t, i) => items.push({
    id: `meal-${i + 1}`, title: String(t || MEAL_NAMES[i] || `Meal ${i + 1}`).slice(0, 40),
    kind: 'meal', proof, freq: { type: 'daily' }, window: { ...wins[i] },
  }));
  if (k.lifts > 0) items.push({
    id: 'lift', title: `Lift session`, kind: 'lift', proof: 'check',
    freq: { type: 'days', days: LIFT_DAYS[k.lifts], label: `${k.lifts}× / week` }, window: { due: 1230, label: 'After training' },
  });
  if (k.weigh !== 'off') items.push({
    id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale',
    freq: k.weigh === 'daily' ? { type: 'daily' } : { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' }, window: { due: 540 },
  });
  if (k.hydration) {
    const oz = Math.min(999, Math.max(1, +k.hydrationOz || 120));
    items.push({ id: 'hydration', title: `Hydration · ${oz} oz`, kind: 'hydration', proof: 'counter',
                 freq: { type: 'daily' }, window: { due: 1290 }, required: false, target: oz });
  }
  if (k.recovery) items.push({ id: 'recovery', title: 'Recovery Check-In', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } });
  if (k.checkin) items.push({ id: 'weekly', title: 'Weekly Check-In', kind: 'checkin', proof: 'form', freq: { type: 'weekly', day: 0, label: 'Sundays' }, window: { due: 1260 } });
  return items;
}

/* "What the athlete sees": the DRAFT preview card renders from this — same itemsFromKnobs()
   the Save button publishes, then stdFromItems() (the exact function state.js uses live) so
   the coach previews through the identical code path the athlete's Home day-card uses. Never
   a parallel std-building logic — if stdFromItems can't build a standard (no meal items), the
   preview is honestly null rather than fabricated. */
export function previewFromKnobs(k) {
  const items = itemsFromKnobs(k);
  const std = stdFromItems(items);
  return std ? { std, items } : null;
}

/* ---------- Requirement templates (Slice C, 0074): team-scoped named drafts ----------
   TPL is a module cache — { teamId, rows } — separate from SETS (the live standing sets)
   because templates are drafts a coach browses, not anything that's ever live on its own. */
let TPL = null;          // { teamId, rows } | null (not yet loaded)
let tplLoading = false;
let SHOW_TPL_SAVE = false;
async function loadTemplates(force) {
  const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
  if (!teamId || tplLoading) return;
  if (TPL && TPL.teamId === teamId && !force) return;
  tplLoading = true;
  try {
    const rows = await roles.fetchRequirementTemplates(teamId);
    // Seed on first open: an empty result from a SUCCESSFUL fetch (not an offline/'no client'
    // short-circuit) with a real teamId means this team has never had templates — plant the
    // seven seeds once. fetchRequirementTemplates has no way to distinguish "really empty"
    // from "offline" (both return [] — see roles.js), so an offline athlete/coach opening this
    // screen for the first time WILL attempt a seed insert here; each insert independently
    // no-ops (saveRequirementTemplate resolves { ok:false } with no client) rather than
    // throwing, so it's inert offline, not just "harmless" — no junk rows are ever created
    // without a live connection. The unique (team_id, lower(name)) index also makes a
    // concurrent double-seed from two tabs/agents harmless: the losing inserts come back as
    // duplicate-name errors, which we ignore.
    if (rows.length === 0 && teamId) {
      for (const s of seedTemplates()) {
        await roles.saveRequirementTemplate(teamId, s.name, s.kind, s.items);
      }
      TPL = { teamId, rows: await roles.fetchRequirementTemplates(teamId) };
    } else {
      TPL = { teamId, rows };
    }
  } catch { TPL = { teamId, rows: [] }; }
  finally { tplLoading = false; }
  if (location.hash.startsWith('#coach-plan')) window.__render();
}

export const coachPlanSet = {
  nav: 'coach', tab: 'roster',
  render({ sub }) {
    const [kind, rawVal] = (sub || 'team').split('/');
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const key = `${kind}:${value || ''}`;
    const scopeName = kind === 'team' ? 'Team default' : `${value} room`;
    const sets = SETS && SETS.rows ? SETS.rows : [];
    const existing = sets.find(s => s.scope_kind === kind && String(s.scope_value || '').trim().toUpperCase() === (value || '').toUpperCase())
      || (kind === 'team' ? sets.find(s => s.scope_kind === 'team') : null);
    if (!KNOB || KNOB.key !== key) {
      KNOB = existing
        ? { key, ...knobsFromItems(existing.items) }
        : { key, meals: 3, lifts: 0, weigh: 'mwf', hydration: true, hydrationOz: 120, recovery: true, checkin: true, photoProof: true };
    }
    const chip = (on, label, act, arg) => `<span class="chp ${on ? 'on' : ''}" data-knob="${act}:${arg}">${label}</span>`;
    const seg = (label, subLabel, act, on) => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${label}</div><div class="ls">${subLabel}</div></div>
        <div class="seg" style="width:104px">
          <button class="${on ? 'on' : ''}" data-knob="${act}:1">On</button><button class="${on ? '' : 'on'}" data-knob="${act}:0">Off</button>
        </div>
      </div>`;
    const toHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const { names, wins } = resolveMeals(KNOB);
    return `
    ${backHead(scopeName, kind === 'team' ? 'Every athlete starts here' : 'Overrides the team default for this room', 'coach-plan')}

    <div class="eyebrow">Meals per day · photo proof</div>
    <div class="chip-row">${[1, 2, 3, 4, 5, 6].map(n => chip(KNOB.meals === n, String(n), 'meals', n)).join('')}</div>

    <div class="eyebrow">Meal names & windows · windows drive due-soon, overdue, and reminders</div>
    <section class="card" style="padding:10px 16px">
      ${names.map((t, i) => `
        <div class="lrow" style="cursor:default;gap:8px">
          <input class="mname" data-meal="${i}" maxlength="40" value="${esc(t)}"
                 style="flex:1;min-width:0;background:transparent;border:1px solid var(--line);border-radius:8px;padding:7px 10px;color:var(--text-1);font-size:13.5px;font-weight:600">
          <input type="time" class="mwin" data-meal="${i}" data-edge="open" value="${wins[i].open != null ? toHM(wins[i].open) : ''}">
          <span style="color:var(--text-3);font-size:12px">→</span>
          <input type="time" class="mwin" data-meal="${i}" data-edge="due" value="${toHM(wins[i].due)}">
        </div>`).join('')}
    </section>

    <div class="eyebrow">Lift sessions per week</div>
    <div class="chip-row">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => chip(KNOB.lifts === n, n === 0 ? 'Off' : String(n), 'lifts', n)).join('')}</div>

    <div class="eyebrow">Weigh-ins · season trend, never scored</div>
    <div class="chip-row">
      ${chip(KNOB.weigh === 'off', 'Off', 'weigh', 'off')}${chip(KNOB.weigh === 'mwf', 'Mon / Wed / Fri', 'weigh', 'mwf')}${chip(KNOB.weigh === 'daily', 'Daily', 'weigh', 'daily')}
    </div>

    <div class="eyebrow">Always-on pieces</div>
    <section class="card" style="padding:6px 16px">
      ${seg('Recovery check-in', 'Nightly · 25% of the score', 'recovery', KNOB.recovery)}
      ${seg('Weekly check-in', 'Sundays · 10% of the score', 'checkin', KNOB.checkin)}
      ${seg('Hydration focus', 'Visible, never scored', 'hydration', KNOB.hydration)}
      ${seg('Photo proof on meals', 'Off = tap-to-check, no photo required', 'photo', KNOB.photoProof)}
    </section>
    ${KNOB.hydration ? `
    <div class="eyebrow">Hydration target</div>
    <div class="chip-row">${[80, 100, 120, 150].map(n => chip(KNOB.hydrationOz === n, `${n} oz`, 'hydoz', n)).join('')}</div>` : ''}

    <div class="eyebrow">Templates</div>
    <div class="chip-row">
      ${(TPL && TPL.rows ? TPL.rows : []).map(t => `<span class="chp" data-knob="tpl:${esc(t.id)}" title="${esc(templateLabel(t.kind))}">${esc(t.name)}</span>`).join('')}
      <span class="chp" style="border:1px dashed var(--line)" data-knob="tplsave:1">+ Save as template</span>
    </div>
    ${SHOW_TPL_SAVE ? `
    <section class="card" style="padding:10px 16px">
      <div style="display:flex;gap:7px">
        <input class="ob-input" id="tpl-name" maxlength="40" placeholder="Template name" style="flex:1;height:36px" />
        <button class="btn green sm" id="tpl-save-btn" style="width:auto;padding:0 12px;height:36px">Save</button>
      </div>
    </section>` : ''}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Stored live, rails enforced server-side</div>
      <div class="ts">Meals 1–6, lifts 0–7 — the database rejects anything outside the rails. Athlete day lists AND scoring follow this standard on their next sync: the meal count is the denominator.</div></div>
    </div>

    ${(() => {
      const preview = previewFromKnobs(KNOB);
      if (!preview) return '';
      const { std } = preview;
      return `
      <div class="eyebrow">What the athlete sees</div>
      <section class="card" style="padding:6px 16px">
        ${std.slots.map(slot => {
          const title = std.titles[slot] || cap(slot);
          const due = std.deadlines[slot];
          return `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${esc(title)}</div>
          <div class="ls">${due != null ? `Due by ${fmtMin(due)}` : 'No deadline set'}</div></div>
        </div>`;
        }).join('')}
        <div style="font-size:11.5px;font-weight:600;color:var(--text-3);padding:8px 2px 4px">${std.mealsRequired} meal${std.mealsRequired === 1 ? '' : 's'} make the day's nutrition score.</div>
      </section>`;
    })()}

    <div style="height:16px"></div>
    <button class="btn primary" id="set-save">${icon('check', 19)} Save the ${kind === 'team' ? 'team standard' : `${esc(value)} room standard`}</button>
    ${kind !== 'team' && existing ? `<div style="height:8px"></div><button class="btn ghost" id="set-clear">Use team default instead</button>` : ''}
    <div id="set-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster().then(() => { loadSets(); loadTemplates(); });
    const [kind, rawVal] = (sub || 'team').split('/');
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const say = (msg, isErr) => {
      const el = root.querySelector('#set-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    const fromHM = s => { const [h, mm] = String(s || '').split(':').map(Number); return (Number.isFinite(h) && Number.isFinite(mm)) ? h * 60 + mm : null; };
    // Text/time inputs write straight into KNOB — NEVER window.__render() here, or a
    // full re-render mid-keystroke steals focus (the Slice A roster-search lesson).
    const materializeMeals = () => {
      if (!Array.isArray(KNOB.mealNames) || KNOB.mealNames.length !== KNOB.meals
          || !Array.isArray(KNOB.mealWins) || KNOB.mealWins.length !== KNOB.meals) {
        const { names, wins } = resolveMeals(KNOB);
        KNOB.mealNames = [...names]; KNOB.mealWins = wins.map(w => ({ ...w }));
      }
    };
    root.querySelectorAll('.mname').forEach(el => el.addEventListener('change', () => {
      materializeMeals();
      KNOB.mealNames[+el.getAttribute('data-meal')] = el.value;
    }));
    root.querySelectorAll('.mwin').forEach(el => el.addEventListener('change', () => {
      materializeMeals();
      const i = +el.getAttribute('data-meal');
      const edge = el.getAttribute('data-edge');
      const mins = fromHM(el.value);
      if (edge === 'open') { if (mins == null) delete KNOB.mealWins[i].open; else KNOB.mealWins[i].open = mins; }
      else { KNOB.mealWins[i].due = mins; }
    }));
    root.querySelectorAll('[data-knob]').forEach(el => el.addEventListener('click', () => {
      const [k, arg] = el.getAttribute('data-knob').split(':');
      if (k === 'meals') { KNOB.meals = +arg; delete KNOB.mealNames; delete KNOB.mealWins; }
      if (k === 'lifts') KNOB.lifts = +arg;
      if (k === 'weigh') KNOB.weigh = arg;
      if (k === 'recovery') KNOB.recovery = arg === '1';
      if (k === 'checkin') KNOB.checkin = arg === '1';
      if (k === 'hydration') KNOB.hydration = arg === '1';
      if (k === 'photo') KNOB.photoProof = arg === '1';
      if (k === 'hydoz') KNOB.hydrationOz = +arg;
      // Applying a template only fills the knobs — it never writes the DB directly. The
      // coach still reviews the preview card and hits the existing Save to publish.
      if (k === 'tpl') {
        const tpl = TPL && TPL.rows && TPL.rows.find(t => String(t.id) === arg);
        if (tpl) KNOB = { key: KNOB.key, ...knobsFromItems(tpl.items) };
      }
      if (k === 'tplsave') SHOW_TPL_SAVE = !SHOW_TPL_SAVE;
      window.__render();
    }));
    const tplSaveBtn = root.querySelector('#tpl-save-btn');
    if (tplSaveBtn) tplSaveBtn.addEventListener('click', async () => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      const name = ((root.querySelector('#tpl-name') || {}).value || '').trim();
      if (!name) { say('Name the template first.', true); return; }
      if (!teamId) { say('Your team hasn’t loaded yet — give it a second.', true); return; }
      tplSaveBtn.disabled = true; say('Saving template…');
      const r = await roles.saveRequirementTemplate(teamId, name, 'custom', itemsFromKnobs(KNOB));
      tplSaveBtn.disabled = false;
      if (!r.ok) { say(r.error || 'Could not save the template.', true); return; }
      SHOW_TPL_SAVE = false;
      say('Template saved.');
      await loadTemplates(true);
    });
    const save = root.querySelector('#set-save');
    if (save) save.addEventListener('click', async () => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) { say('Your team hasn’t loaded yet — give it a second.', true); return; }
      const { wins } = resolveMeals(KNOB);
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i];
        if (w.due == null) { say(`Meal ${i + 1}'s window closes before it opens — fix the times.`, true); return; }
        if (w.open != null && !(w.open < w.due)) { say(`Meal ${i + 1}'s window closes before it opens — fix the times.`, true); return; }
      }
      save.disabled = true; say('Saving…');
      const r = await roles.setTeamRequirements(teamId, kind, value, itemsFromKnobs(KNOB));
      save.disabled = false;
      if (!r.ok) { say(r.error || 'Could not save — try again.', true); return; }
      say('Saved. This is the standard now.');
      await loadSets(true);
    });
    const clear = root.querySelector('#set-clear');
    if (clear) clear.addEventListener('click', async () => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) return;
      clear.disabled = true; say('Resetting…');
      const r = await roles.clearTeamRequirements(teamId, kind, value);
      clear.disabled = false;
      if (!r.ok) { say(r.error || 'Could not reset — try again.', true); return; }
      KNOB = null;
      await loadSets(true);
      location.hash = '#coach-plan';
    });
  },
};

/* ---------- Inbox (WS5.2): what needs the coach right now ----------
   Replaces the Copilot TAB (the copilot screen stays routable for deep links).
   Briefing = deterministic reads over the real roster — never narrated fiction.
   Then: join requests (act here), unopened logs (the feed's unseen dots as a list). */

/* Recent-announcements cache for the compact Inbox block below (Slice C, 0074). Its own
   fetch, not shared with coach-announce.js's history — that screen may not have mounted
   yet, and this block only ever needs the newest 3. Honest empty state: the section is
   absent entirely with zero announcements (Slice D turns this into a real category). */
let ANN_CACHE = null; // { teamId, rows }
let annLoadingId = null;
async function loadAnnouncements(teamId) {
  if (!teamId) return;
  if (ANN_CACHE && ANN_CACHE.teamId === teamId) return;
  if (annLoadingId === teamId) return;
  annLoadingId = teamId;
  try { ANN_CACHE = { teamId, rows: await roles.fetchAnnouncements(teamId, 3) }; }
  finally { annLoadingId = null; }
  if (location.hash === '#coach-inbox') window.__render();
}

export const coachInbox = {
  nav: 'coach', tab: 'inbox',
  badge() {
    const pending = CD.roster ? (CD.roster.pending || []).length : 0;
    const seen = new Set(RT.coachSeenMealIds || []);
    const unseen = CD.act && CD.act.rows ? CD.act.rows.filter(m => !seen.has(m.id)).length : 0;
    return pending + unseen;
  },
  render() {
    const rows = CD.roster ? CD.roster.rows : null;
    const pending = CD.roster ? (CD.roster.pending || []) : [];
    const act = CD.act && CD.act.rows ? CD.act.rows : [];
    const seen = new Set(RT.coachSeenMealIds || []);
    const unseen = act.filter(m => !seen.has(m.id));
    const names = {}; (rows || []).forEach(r => { names[r.athleteId] = r; });
    const needsMe = pending.length + unseen.length;

    let briefing = '';
    if (rows === null) briefing = 'Reading your roster…';
    else if (CD.roster && CD.roster.offline) briefing = "Can't reach your roster — reopen to retry. Nothing is invented while it's down.";
    else if (!rows.length) briefing = 'No athletes yet. Share your team code and this becomes your morning read.';
    else {
      const notLogged = rows.filter(r => !r.loggedToday);
      const below = rows.filter(r => r.score != null && r.score < 80);
      const top = rows.filter(r => r.score != null && r.score >= 80).sort((a, b) => b.score - a.score)[0];
      const lines = [];
      if (notLogged.length) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--red);flex:none;margin-top:5px"></span><span><b>${notLogged.length} not logged yet</b> — ${esc(notLogged.slice(0, 3).map(r => r.name.split(' ')[0]).join(', '))}${notLogged.length > 3 ? '…' : ''}.</span></div>`);
      if (below.length) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--amber-bright);flex:none;margin-top:5px"></span><span><b>${below.length} below the bar</b> today (under 80).</span></div>`);
      if (top) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--green-bright);flex:none;margin-top:5px"></span><span><b>${esc(top.name)}</b> leads the day at ${top.score}.</span></div>`);
      briefing = lines.join('<div style="height:7px"></div>') || 'Quiet so far — logs land here as they come in.';
    }

    return `
    ${titleHead('Inbox', needsMe ? `${needsMe} need${needsMe === 1 ? 's' : ''} you` : 'All caught up')}

    <div class="eyebrow">Daily briefing · from your real roster</div>
    <section class="card pad" ${rows && !rows.length && !(CD.roster && CD.roster.offline) ? 'data-go="coach-profile" style="cursor:pointer;' : 'style="'}background:linear-gradient(180deg, rgba(168,85,247,0.10), rgba(168,85,247,0.03));border-color:rgba(168,85,247,0.26)">
      <div style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:10px">${icon('sparkle', 13)} Today's read</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55">${briefing}</div>
      ${rows && !rows.length && !(CD.roster && CD.roster.offline) && RT.team && RT.team.code ? `<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.team.code)}</span><button class="btn green sm" style="width:auto;padding:0 14px">Share code</button></div>` : ''}
    </section>

    ${pending.length ? `
    <div class="eyebrow">Join requests · ${pending.length}</div>
    <section class="card" style="padding:6px 16px">
      ${pending.map(q => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
          <div class="lm"><div class="lt">${esc(q.athlete_name || 'Athlete')}${q.position ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(q.position)}</small>` : ''}</div><div class="ls">Wants to join</div></div>
          <button class="btn ghost sm" data-jr="decline" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
          <button class="btn green sm" data-jr="approve" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
        </div>`).join('')}
    </section>` : ''}

    <div class="eyebrow">Unopened logs${unseen.length ? ` · ${unseen.length}` : ''}</div>
    ${unseen.length ? `
    <section class="card" style="padding:6px 16px">
      ${unseen.slice(0, 10).map(m => {
        const who = names[m.athlete_id] || {};
        return `
        <div class="lrow" data-go="coach-meal/${esc(m.id)}">
          <div class="lic" style="position:relative">${icon('utensils', 17)}<span style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--blue-bright)"></span></div>
          <div class="lm"><div class="lt">${esc((who.name || 'Athlete'))}${who.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(who.unit)}</small>` : ''}</div>
          <div class="ls">${esc(cap(m.type || 'Meal'))} · ${esc(actTime(m.logged_at))}${m.protein != null ? ` · ${Math.round(m.protein)}g` : ''}</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`;
      }).join('')}
    </section>` : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.5">You've opened everything the roster has logged. New meals land here with a dot.</div>`}

    ${(() => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      const annRows = ANN_CACHE && ANN_CACHE.teamId === teamId ? ANN_CACHE.rows : [];
      // Honest empty state: no section at all with zero announcements, not an empty card.
      if (!annRows.length) return '';
      const groups = (CD.extras && CD.extras.groups) || [];
      return `
    <div class="eyebrow">Announcements</div>
    <section class="card" style="padding:6px 16px">
      ${annRows.map(a => `
      <div class="lrow" data-go="coach-announce" style="cursor:pointer">
        <div class="lic">${icon('share', 17)}</div>
        <div class="lm"><div class="lt">${esc(a.title)}</div><div class="ls">${esc(audienceLabel(a.scope_kind, a.scope_value, groups))} · ${esc(fmtWhen(a.created_at, Date.now()))}</div></div>
      </div>`).join('')}
      <div class="lrow" data-go="coach-announce" style="cursor:pointer">
        <div class="lic">${icon('plus', 17)}</div>
        <div class="lm"><div class="lt">New announcement</div></div>
      </div>
    </section>`;
    })()}

    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster().then(() => {
      loadActivity();
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (teamId) loadAnnouncements(teamId);
    });
    root.querySelectorAll('[data-jr]').forEach(b => b.addEventListener('click', async () => {
      const team = b.getAttribute('data-team'), ath = b.getAttribute('data-ath');
      b.disabled = true; b.textContent = '…';
      if (b.getAttribute('data-jr') === 'approve') await roles.approveMember(team, ath);
      else await roles.declineMember(team, ath);
      await loadCoachRoster(true);
    }));
  },
};

/* ---------- Copilot: deterministic reads over the REAL roster (honest, not narrated fiction) ---------- */
export const copilot = {
  nav: 'coach', tab: 'copilot',
  render() {
    const rows = CD.roster ? CD.roster.rows : null;
    // Offline must read as offline, not as a stuck "loading" (F-C1) or a false "no athletes":
    // when the roster fetch failed, CD.roster.rows is [] with offline=true, which would otherwise
    // fall through to the empty-roster summary. Mirror the Coach/Trainer tabs' honest offline card.
    if (CD.roster && CD.roster.offline) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach-home')}
      <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
      <div class="sd-t">Can't reach your roster</div>
      <div class="sd-s">Copilot reads your real team data, and we couldn't load today's scores. Reopen this tab to retry — no numbers are invented while it's down.</div></div>`;
    }
    if (rows === null) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach-home')}
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
    ${backHead('Copilot', 'Deterministic reads over your real roster', 'coach-home')}

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
  const r = CD.roster && CD.roster.rows.find(x => x.athleteId === athleteId);
  return r ? { name: r.name, unit: r.unit } : { name: 'Athlete', unit: '' };
}
let athGen = 0;            // navigation generation: a stale fetch must never clobber the screen
async function loadAthlete(athleteId, viewerId, viewerName) {
  if (!athleteId) return;
  // Already showing this athlete: do nothing. Without this guard every repaint re-fetched,
  // which re-rendered, which re-fetched — an infinite refetch/repaint loop (photos re-signing,
  // flicker, scroll jumps). This WAS the "super buggy" athlete page.
  if (ATH && ATH.athleteId === athleteId) return;
  if (athLoadingId === athleteId) return; // this athlete's fetch is already in flight
  const myGen = ++athGen;
  athLoadingId = athleteId;
  try {
    const today = roles.todayISO();
    const [day, meals, pass] = await Promise.all([
      roles.fetchDay(athleteId, today),
      roles.fetchRecentMeals(athleteId, roles.daysAgoISO(14)),
      roles.fetchActiveTrustPass(athleteId),
    ]);
    // Sign photo URLs in PARALLEL, and only the most recent handful the screen shows —
    // the old serial loop signed every meal in 14 days one round-trip at a time.
    await Promise.all(meals.filter(m => m.photo_path).slice(0, 10)
      .map(async (m) => { m._url = await roles.signedMealPhotoUrl(m.photo_path); }));
    if (myGen !== athGen) return; // coach tapped another athlete mid-flight — drop this result
    ATH = { athleteId, day, meals, pass };
    roles.markDayViewed(athleteId, today, viewerId, viewerName); // fire-and-forget "coach saw your day"
  } finally {
    if (myGen === athGen) athLoadingId = null;
  }
  // Repaint whichever detail screen is waiting on this fetch — trainer-client shares this
  // loader, and matching only #coach-athlete left the trainer's client page stuck on
  // "Loading their day…" forever (role walkthrough 2026-07-15).
  if (location.hash.startsWith('#coach-athlete') || location.hash.startsWith('#trainer-client')) window.__render();
}
const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];

/* ---------- Coach → athlete profile: six-section shell (Task 5 shipped Overview + Today, Task 6
   adds Activity + Conversation; Requirements/Notes land in Task 7). PSECTION is the active chip;
   PSEC_FOR tracks which athlete it belongs to so opening a DIFFERENT athlete always starts back
   on Overview instead of leaving a stale section showing. Loads ONLY loadAthleteProfile — the
   legacy ATH/loadAthlete double-fetch is gone (Task 6 Part C): coachMeal now resolves its own
   meal standalone via roles.fetchMeal, so this screen no longer needs to keep ATH warm. ---------- */
let PSECTION = 'overview';
let PSEC_FOR = null;
// Day-view receipt de-dupe: markDayViewed only needs to fire once per athlete open, not on every
// chip switch (mount() re-runs on every window.__render()). Track which athlete we've already
// recorded a receipt for; reset naturally happens by comparing against the new athleteId.
let VIEWED_FOR = null;
const PROFILE_SECTIONS = [
  ['overview', 'Overview'], ['today', 'Today'], ['activity', 'Activity'],
  ['conversation', 'Conversation'], ['requirements', 'Requirements'], ['notes', 'Notes'],
];
function lastActivityLabel(iso) {
  if (!iso) return null;
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'Active just now';
  if (h < 24) return `Active ${h}h ago`;
  return `Active ${Math.floor(h / 24)}d ago`;
}
/* A real, legible 7-day trend — a filled sparkline that fills its card with min/max context,
   not a lost squiggle. Honest empty until two logged days exist. */
function coTrend(hist) {
  const pts = (hist || []).filter(h => h && h.score != null);
  if (pts.length < 2) {
    return `<div class="co-trend"><div class="co-trend-top"><span class="lbl">Last logged days</span><span class="rng">—</span></div>
      <div style="font-size:12px;font-weight:600;color:var(--text-3);padding:4px 0 2px">Two or more logged days unlock the trend.</div></div>`;
  }
  const w = 360, h = 60, scores = pts.map(p => p.score);
  const min = Math.min(...scores), max = Math.max(...scores), span = Math.max(1, max - min);
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * w, (h - 7) - ((p.score - min) / span) * (h - 14)]);
  const line = xy.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `M0,${h} L${xy.map(c => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' L')} L${w},${h} Z`;
  const up = pts[pts.length - 1].score >= pts[0].score;
  const stroke = up ? 'var(--green-bright)' : '#FF9B9B';
  const lp = xy[xy.length - 1];
  return `<div class="co-trend">
    <div class="co-trend-top"><span class="lbl">Last ${pts.length} logged days</span><span class="rng">${min}–${max}</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="cotrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity="0.26"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#cotrend)"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="3.5" fill="${stroke}"/>
    </svg>
    <div class="co-trend-x"><span>then</span><span>now</span></div>
  </div>`;
}
function overviewSection(P) {
  const st = P.status, meta = st ? STATUS_META[st.key] : null;
  const day = P.day;
  const tasks = (day && day.tasks) || [];
  const totalN = tasks.length, doneN = tasks.filter(t => t && t.done).length;
  const crit = st && (st.key === 'overdue' || st.key === 'no_activity');
  const last = lastActivityLabel(P.row && P.row.lastMealAt);
  const subtitle = (st && st.detail) || last || 'On track';
  const alerts = (P.exceptions || []).map(e => e.reason ? `Excused · ${e.reason}` : 'Excused');
  return `
  <section class="card" style="padding:var(--s4);display:flex;align-items:center;justify-content:space-between;gap:var(--s3)">
    <div style="min-width:0">
      <div class="co-status ${crit ? 'crit' : ''}"><span class="dot" style="background:${meta ? meta.color : 'var(--text-3)'}"></span><span class="lbl" style="font-size:14px;font-weight:800">${meta ? esc(meta.label) : '—'}</span></div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:5px;line-height:1.4">${esc(subtitle)}</div>
    </div>
    ${last && st && st.detail ? `<div style="font-size:11.5px;font-weight:700;color:var(--text-3);white-space:nowrap;flex:none">${esc(last)}</div>` : ''}
  </section>

  <div class="co-tiles two" style="margin-top:var(--s3)">
    <div class="co-stat"><div class="v" style="color:${scoreColor(day && day.score)}">${day && day.score != null ? day.score : '—'}</div><div class="k">Score today</div></div>
    <div class="co-stat"><div class="v">${totalN ? `${doneN}<small>&thinsp;/&thinsp;${totalN}</small>` : '—'}</div><div class="k">Completion</div></div>
  </div>

  <div class="co-eyebrow">7-day trend</div>
  ${coTrend((P.row && P.row.scoreHistory) || [])}

  ${alerts.length ? `<div class="co-eyebrow">Active alerts</div>
  <section class="card" style="padding:var(--s1) var(--s4)">
    ${alerts.map(a => `<div class="lrow" style="cursor:default"><div class="lic" style="color:var(--amber-bright)">${icon('bell', 17)}</div><div class="lm"><div class="lt">${esc(a)}</div></div></div>`).join('')}
  </section>` : ''}
  `;
}
function todaySection(P) {
  const day = P.day;
  const today = roles.todayISO();
  const todayMeals = (P.meals || []).filter(m => m.day_date === today);
  const score = day && day.score != null ? day.score : null;
  const mealsJson = (day && day.meals) || {};
  const ci = (day && day.checkin) || {};
  const openSlots = ['breakfast', 'lunch', 'dinner'].filter(k => !mealsJson[k]);
  return `
    <div class="co-tiles">
      <div class="co-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
      <div class="co-stat"><div class="v g">${MEAL_SLOTS.filter(k => mealsJson[k]).length}</div><div class="k">Meals logged</div></div>
      <div class="co-stat"><div class="v ${ci.submitted ? 'g' : 'a'}">${ci.submitted ? 'In' : 'Open'}</div><div class="k">Recovery</div></div>
    </div>

    ${!day ? `<div class="sidebox" style="margin-top:14px"><div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
    <div><div class="tt">No logs today yet</div><div class="ts">Nothing to review — they haven't logged. Their day appears here as they log it.</div></div></div>`
    : `
    <div class="eyebrow">Today's proof${todayMeals.length ? '' : ' · none yet'}</div>
    ${todayMeals.length ? `<div class="hscroll">
      ${todayMeals.map(m => `
        <div class="act-card" data-go="coach-meal/${esc(m.id)}">
          <div class="act-time">${esc(cap(m.type || 'Meal'))}</div>
          ${P.photos[m.id]
            ? `<div class="act-media"><img src="${esc(P.photos[m.id])}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`
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
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:4px;padding:0 2px">Tap a meal photo to review and comment on it.</div>
    <div style="height:10px"></div>
  `;
}
/* Generic "X ago" for real timestamps only — used by Activity + Conversation (the two sections
   that render a merged/chronological list, unlike lastActivityLabel's single "Active …" line). */
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/* ---------- Activity pane (Task 6): a merged, reverse-chronological timeline built ONLY from
   real rows already on P — nothing here is invented or guessed.
     - meal logs: P.meals (30-day window), each with its real logged_at
     - today's weigh-in / recovery check-in: P.day is the ONLY day this profile fetches, so these
       can only ever show today's entry (if any) — dated by the day row's own updated_at, never
       a fabricated time
     - coach actions: P.interventions, but only kind 'nudge'/'handled' — kind 'assign' is just a
       bookkeeping twin of the row already sitting in P.assignments (which carries the real
       requirement TITLE), so assignments render from there instead of the technical reason_key */
function activitySection(P) {
  const items = [];
  for (const m of (P.meals || [])) {
    if (!m || !m.id || !m.logged_at) continue;
    items.push({ ts: new Date(m.logged_at).getTime(), cls: 'i-meal', go: `coach-meal/${m.id}`,
      when: relTime(m.logged_at), what: `${esc(cap(m.type || 'Meal'))} logged${m.quality != null ? ` <span class="sub">· quality ${m.quality}</span>` : ''}` });
  }
  const day = P.day;
  if (day && day.updated_at) {
    const t = new Date(day.updated_at).getTime();
    if (isFinite(t)) {
      if (day.current_weight != null) items.push({ ts: t, cls: 'i-weight', when: relTime(day.updated_at), what: `Weighed in <span class="sub">· ${esc(String(day.current_weight))} lb</span>` });
      if (day.checkin && day.checkin.submitted) items.push({ ts: t, cls: 'i-weight', when: relTime(day.updated_at), what: 'Recovery check-in submitted' });
    }
  }
  for (const iv of (P.interventions || [])) {
    if (!iv || !iv.created_at || (iv.kind !== 'nudge' && iv.kind !== 'handled')) continue;
    items.push({ ts: new Date(iv.created_at).getTime(), cls: 'i-coach', when: relTime(iv.created_at), what: iv.kind === 'nudge' ? 'You nudged them' : 'You marked this handled' });
  }
  for (const a of (P.assignments || [])) {
    if (!a || !a.created_at) continue;
    items.push({ ts: new Date(a.created_at).getTime(), cls: 'i-coach', when: relTime(a.created_at), what: `Assigned <span class="sub">· ${esc(a.title || 'Requirement')}</span>` });
  }
  items.sort((x, y) => y.ts - x.ts);
  if (!items.length) return `
  <div class="co-empty"><div class="ic">${icon('clock', 24)}</div>
  <div class="tt">No activity in the last 30 days</div>
  <div class="ts">Meal logs, weigh-ins, check-ins, and your own actions land here as they happen.</div></div>`;
  return `
  <div class="co-eyebrow">Last 30 days</div>
  <div class="co-tl">
    ${items.map(i => `<div class="co-tl-item ${i.cls}"${i.go ? ` data-go="${esc(i.go)}" style="cursor:pointer"` : ''}><div class="co-tl-when">${esc(i.when)}</div><div class="co-tl-what">${i.what}</div></div>`).join('')}
  </div>
  <div class="co-note">Weigh-ins and check-ins are shown for today; meal history spans 30 days.</div>`;
}

/* Date label for a meal row in Conversation: "Jul 15 · 2d ago" from its real logged_at
   (falling back to day_date if logged_at is somehow missing — never a made-up time). */
function mealDateLabel(m) {
  const d = m.logged_at ? new Date(m.logged_at) : (m.day_date ? new Date(`${m.day_date}T00:00:00`) : null);
  if (!d || isNaN(d)) return '';
  const rel = relTime(m.logged_at || m.day_date);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${rel ? ` · ${rel}` : ''}`;
}

/* ---------- Conversation pane (Task 6): a DIRECTORY into existing meal threads — deliberately
   NOT a second composer. The real thread (the AI Nutritionist's read, coach comments, athlete
   replies, reactions, private notes) already lives entirely in coachMeal and is reused as-is;
   this list is pure navigation into it, newest meal first. */
function conversationSection(P) {
  const meals = [...(P.meals || [])].filter(m => m && m.id)
    .sort((a, b) => new Date(b.logged_at || b.day_date || 0) - new Date(a.logged_at || a.day_date || 0));
  if (!meals.length) return `
  <div class="state-demo"><div class="sd-ic">${icon('message', 24)}</div>
  <div class="sd-t">No meal conversations yet</div>
  <div class="sd-s">Once they log a meal, you can react or comment on it here.</div></div>
  <div style="height:10px"></div>`;
  return `
  <div class="eyebrow">Meal threads</div>
  <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 8px">Tap any meal to open its full thread — the AI's read, your comments, and theirs.</div>
  <section class="card" style="padding:2px 16px">
  ${meals.slice(0, 30).map(m => `
    <div class="lrow" data-go="coach-meal/${esc(m.id)}">
      <div class="lic" style="overflow:hidden;padding:0">
        ${P.photos[m.id] ? `<img src="${esc(P.photos[m.id])}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/>` : icon('message', 17)}
      </div>
      <div class="lm"><div class="lt">${esc(cap(m.type || 'Meal'))}${m.quality != null ? ` · ${m.quality}` : ''}</div>
      <div class="ls">${esc(mealDateLabel(m))}</div></div>
      <span class="btn ghost sm" style="width:auto;padding:0 12px;height:30px;pointer-events:none">View thread</span>
    </div>`).join('')}
  </section>
  <div style="height:10px"></div>`;
}

/* Human label for the requirement source, mirroring resolveRequirementSet's own precedence
   (athlete > position > team > built-in CATALOG) so the coach always knows WHOSE standard
   they're looking at — never left to guess whether this is the team default or an override. */
function requirementSourceLabel(set) {
  if (!set) return 'Team default (built-in)';
  if (set.scope_kind === 'athlete') return 'Individual';
  if (set.scope_kind === 'position') return `${String(set.scope_value || '').trim().toUpperCase() || 'Position'} room`;
  return 'Team standard';
}
/* ---------- Requirements pane (Task 7): the athlete's GOVERNING standard, resolved with the
   same precedence entriesFor/loadAthleteProfile already use — never a second, drifting copy of
   the logic. Also surfaces active exceptions and the real assignment history; nothing here is
   invented, and an empty list says so honestly. */
function requirementsSection(P, athleteId) {
  const set = resolveRequirementSet(CD.extras && CD.extras.sets, athleteId, P.row && P.row.position);
  const reqs = set ? catalogFromItems(set.items) : CATALOG;
  const source = requirementSourceLabel(set);
  const exceptions = P.exceptions || [];
  const assignments = P.assignments || [];
  return `
  <div class="eyebrow">Governing standard <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· ${esc(source)}</span></div>
  <section class="card" style="padding:2px 16px">
    ${reqs.length ? reqs.map(r => `
    <div class="lrow" style="cursor:default"><div class="lic" style="color:var(--${r.accent === 'g' ? 'green' : r.accent === 'a' ? 'amber' : r.accent === 'p' ? 'purple' : 'blue'}-bright)">${icon(r.icon || 'clipboard', 17)}</div>
    <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc((PROOF[r.proof] && PROOF[r.proof].label) || 'Proof')} · ${esc(freqLabel(r.freq))}</div></div></div>`).join('')
    : `<div class="lrow" style="cursor:default"><div class="lm"><div class="ls">No requirements set.</div></div></div>`}
  </section>
  <div class="lrow" data-go="coach-plan/${esc(athleteId)}" style="margin:2px 2px 0">
    <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('edit', 17)}</div>
    <div class="lm"><div class="lt">Edit their standard</div><div class="ls">Open Plan · Schedule</div></div>
    ${icon('chevron', 17, 'style="color:var(--text-3)"')}
  </div>

  <div class="eyebrow" style="margin-top:14px">Active exceptions${exceptions.length ? '' : ' · none'}</div>
  ${exceptions.length ? `
  <section class="card" style="padding:6px 16px">
    ${exceptions.map(e => `
    <div class="lrow" style="cursor:default"><div class="lic" style="color:var(--amber-bright)">${icon('bell', 17)}</div>
    <div class="lm"><div class="lt">${esc(e.reason || 'Excused')}</div><div class="ls">${esc(e.starts_on || '')}${e.ends_on ? ` – ${esc(e.ends_on)}` : ''}</div></div></div>`).join('')}
  </section>` : `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px">No active exceptions.</div>`}

  <div class="eyebrow" style="margin-top:14px">Assignment history${assignments.length ? '' : ' · none'}</div>
  ${assignments.length ? `
  <section class="card" style="padding:2px 16px">
    ${assignments.map(a => `
    <div class="lrow" style="cursor:default"><div class="lic">${icon('clipboard', 17)}</div>
    <div class="lm"><div class="lt">${esc(a.title || 'Requirement')}</div>
    <div class="ls">${esc((PROOF[a.proof] && PROOF[a.proof].label) || a.proof || 'Proof')} · ${esc(cap(a.status || 'open'))} · ${esc(relTime(a.due_at || a.created_at))}${a.note ? ` · ${esc(a.note)}` : ''}</div></div></div>`).join('')}
  </section>` : `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px">No assignments yet.</div>`}
  <div style="height:10px"></div>`;
}

/* ---------- Notes pane (Task 7): coach-only margin notes on the athlete — separate table from
   meal-comment "private notes" above, RLS-scoped to team staff only. The composer keeps typed
   text on a failed save (never silently eats it), and delete ALWAYS refreshes from the server
   rather than optimistically splicing — deleteCoachNote returns true even on an RLS no-op
   (deleting a note you don't own deletes 0 rows but still resolves true), so only the refreshed
   P.notes can honestly say whether it's gone. */
function notesSection(P) {
  const notes = P.notes || [];
  return `
  <div class="co-notebanner"><span class="ic">${icon('lock', 16)}</span><span>Private to your staff — <b>the athlete never sees these.</b></span></div>

  <div class="co-eyebrow">Notes${notes.length ? ` <span class="n">${notes.length}</span>` : ' · none yet'}</div>
  ${notes.length ? `
  <section class="card" style="padding:0 var(--s4)">
    ${notes.map(n => `
    <div class="co-note-row">
      <div style="flex:1;min-width:0">
        <div><span class="who">${n.author_id === RT.userId ? 'You' : 'Staff'}</span> <span class="when">· ${esc(relTime(n.created_at))}</span></div>
        <div class="body">${esc(n.body)}</div>
      </div>
      <button class="co-abtn" data-del-note="${esc(n.id)}" style="flex:none;width:36px;height:36px;padding:0" aria-label="Delete note">${icon('x', 15)}</button>
    </div>`).join('')}
  </section>` : `<div class="co-note">No notes on this athlete yet — jot the first below.</div>`}

  <div class="co-eyebrow">Add a note</div>
  <section class="card" style="padding:var(--s3) var(--s4)">
    <textarea id="cn-input" rows="3" maxlength="1000" placeholder="Something worth remembering about this athlete…"
      style="display:block;width:100%;box-sizing:border-box;border-radius:var(--r-chip);background:var(--surface-2);border:1.5px solid var(--hairline);color:var(--text);font-family:var(--font);font-size:14px;font-weight:600;line-height:1.5;padding:11px 13px;outline:none;resize:none"></textarea>
    <div id="cn-err" style="font-size:12px;font-weight:700;color:var(--amber-bright);min-height:0;margin:6px 0"></div>
    <button class="btn green sm" id="cn-save">Save note</button>
  </section>`;
}

export const coachAthlete = {
  nav: 'coach', tab: 'roster',
  render({ sub }) {
    const athleteId = sub;
    if (athleteId !== PSEC_FOR) { PSECTION = 'overview'; PSEC_FOR = athleteId; }
    const who = rosterName(athleteId);
    if (!athleteId) return `${backHead('Athlete', 'coach view', 'coach-roster')}<div class="state-demo"><div class="sd-t">No athlete selected</div></div>`;
    const P = CD.profile;
    if (!P || P.athleteId !== athleteId) {
      return `${backHead(who.name, (who.unit ? `${esc(who.unit)} · ` : '') + 'coach view', 'coach-roster')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('user', 17)}</div>
      <div><div class="tt">Loading their profile…</div><div class="ts">Pulling today's real score and logged meals.</div></div></div>`;
    }
    const name = (P.row && P.row.name) || who.name;
    const position = (P.row && P.row.position) || who.unit;
    const head = backHead(name, (position ? `${position} · ` : '') + 'coach view', 'coach-roster');
    if (P.offline) {
      return `${head}
      <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
      <div class="sd-t">Can't reach their profile</div>
      <div class="sd-s">Reopen this page to retry — nothing is invented while it's down.</div></div>`;
    }
    // Dead/stale-link guard: once the roster is loaded, an id that isn't a member and has no data
    // is a bad link, not a real athlete with an empty day — say so instead of a blank review. Only
    // fires when the roster is definitively loaded, so a real athlete is never misflagged mid-load.
    const rosterLoaded = !!(CD.roster && CD.roster.rows);
    const onRoster = rosterLoaded && CD.roster.rows.some(r => r.athleteId === athleteId);
    if (rosterLoaded && !onRoster && !P.day && !(P.meals || []).length) {
      return `${head}
      <div class="state-demo"><div class="sd-ic">${icon('user', 24)}</div>
      <div class="sd-t">Athlete not found</div>
      <div class="sd-s">This athlete isn't on your roster — the link may be old, or they left your team. Head back and pick someone from your roster.</div>
      <div class="sd-cta"><button class="btn ghost sm" data-go="coach-roster">Back to roster</button></div></div>
      <div style="height:10px"></div>`;
    }
    const body = PSECTION === 'overview' ? overviewSection(P) : PSECTION === 'today' ? todaySection(P)
      : PSECTION === 'activity' ? activitySection(P) : PSECTION === 'conversation' ? conversationSection(P)
      : PSECTION === 'requirements' ? requirementsSection(P, athleteId) : notesSection(P);
    return `
    ${head}

    <div class="co-actionbar">
      <button class="co-act" data-anudge="${esc(athleteId)}">${icon('bell', 18)}<span class="lbl">Nudge</span></button>
      <button class="co-act" data-go="coach-assign/${esc(athleteId)}">${icon('clipboard', 18)}<span class="lbl">Assign</span></button>
      <button class="co-act" data-go="coach-plan/${esc(athleteId)}">${icon('edit', 18)}<span class="lbl">Targets</span></button>
      <button class="co-act ${P.trustPass ? 'hero' : ''}" id="tp-btn">${icon('shield', 18)}<span class="lbl">${P.trustPass ? 'End pass' : 'Trust'}</span></button>
    </div>
    <div id="tp-status" style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);min-height:0"></div>

    <div class="co-seg co-scroll" id="psec-row">
      ${PROFILE_SECTIONS.map(([key, label]) => `<button class="co-chip ${PSECTION === key ? 'on' : ''}" data-psec="${key}">${esc(label)}</button>`).join('')}
    </div>

    ${body}
    <div class="co-bottom"></div>
    `;
  },
  mount(root, { sub }) {
    const athleteId = sub;
    loadCoachRoster(); // ensure the name is available
    loadAthleteProfile(athleteId);
    // coachMeal now resolves its own meal via roles.fetchMeal (Task 6 Part C) — it no longer
    // depends on this screen keeping the legacy ATH cache warm, so the double-fetch is gone.
    // Day-view receipt: written HERE, not the loader — this is where a real viewer id (RT.userId)
    // is actually available. Fire-and-forget, never blocks or throws. Gated to fire exactly once
    // per athlete open — mount() re-runs on every window.__render() (e.g. every chip switch), and
    // without this guard the receipt call would re-fire on each of those instead of once.
    if (VIEWED_FOR !== athleteId) {
      VIEWED_FOR = athleteId;
      try { roles.markDayViewed(athleteId, roles.todayISO(), RT.userId, S.coachIdentity.handle); } catch { /* best-effort */ }
    }
    root.querySelectorAll('[data-psec]').forEach(el => el.addEventListener('click', () => {
      PSECTION = el.getAttribute('data-psec'); window.__render();
    }));
    // Nudge from the action bar — one-tap push, honest inline status, never double-fires.
    root.querySelectorAll('[data-anudge]').forEach(el => el.addEventListener('click', async () => {
      if (el.disabled) return;
      const id = el.getAttribute('data-anudge');
      const status = root.querySelector('#tp-status');
      el.disabled = true; if (status) { status.style.color = 'var(--text-3)'; status.textContent = 'Sending nudge…'; }
      const ok = await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
      if (ok) { try { act.markNudged(id); } catch { /* best-effort */ } try { const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id; await roles.logIntervention({ teamId, athleteId: id, kind: 'nudge' }); } catch { /* best-effort */ } }
      el.disabled = false;
      if (status) { status.style.color = ok ? 'var(--green-bright)' : 'var(--red)'; status.textContent = ok ? 'Nudge sent — it lands on their phone.' : "Couldn't send it — check your connection."; }
    }));
    // Private notes composer + delete (Task 7). Save keeps the typed text on failure — never
    // silently eats it — and both save and delete refresh from the server rather than
    // optimistically mutating the list (deleteCoachNote resolves true even on an RLS no-op).
    const cnInput = root.querySelector('#cn-input');
    const cnErr = root.querySelector('#cn-err');
    const cnSave = root.querySelector('#cn-save');
    if (cnSave && cnInput) cnSave.addEventListener('click', async () => {
      const body = (cnInput.value || '').trim();
      if (cnErr) cnErr.textContent = '';
      if (!body) { if (cnErr) cnErr.textContent = 'Write something first.'; return; }
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) { if (cnErr) cnErr.textContent = "Couldn't save — no team found."; return; }
      cnSave.disabled = true;
      const r = await roles.postCoachNote(teamId, athleteId, body);
      cnSave.disabled = false;
      if (!r.ok) { if (cnErr) cnErr.textContent = r.error || "Couldn't save — try again."; return; }
      cnInput.value = '';
      loadAthleteProfile(athleteId, true);
    });
    root.querySelectorAll('[data-del-note]').forEach(el => el.addEventListener('click', async () => {
      const id = el.getAttribute('data-del-note');
      el.disabled = true;
      await roles.deleteCoachNote(id);
      loadAthleteProfile(athleteId, true); // ALWAYS refresh — a bare true can be an RLS no-op
    }));
    const btn = root.querySelector('#tp-btn');
    const status = root.querySelector('#tp-status');
    if (btn) btn.addEventListener('click', async () => {
      const P = CD.profile;
      const hasPass = P && P.trustPass;
      btn.disabled = true; if (status) status.textContent = hasPass ? 'Ending…' : 'Granting…';
      if (hasPass) {
        const ok = await roles.endTrustPass(athleteId);
        if (status) status.textContent = ok ? 'Trust Pass ended.' : 'Could not end it.';
      } else {
        const r = await roles.grantTrustPass(athleteId, 10);
        if (status) status.textContent = r.ok ? 'Trust Pass granted.' : (r.error && /on.?standard|photo|eligib/i.test(r.error) ? 'Not eligible yet — needs 7 photo-logged days.' : 'Could not grant it.');
      }
      setTimeout(() => { if (location.hash.startsWith('#coach-athlete')) loadAthleteProfile(athleteId, true); }, 500);
    });
  },
};

/* ---------- Coach → meal review + comment: the REAL meal_comments thread (slice 5) ---------- */
let MC = null;            // { mealId, comments }
let mcLoadingId = null;
async function loadMealComments(mealId, force) {
  if (!mealId || (mcLoadingId === mealId && !force)) return;
  // Router mount() re-runs on every render (router.js:121); without this guard a re-render of an
  // already-loaded meal silently refetches every time — and would let the offline {error}
  // sentinel loop on repaint. Force (post-comment / retry) always bypasses it.
  if (!force && MC && MC.mealId === mealId) return;
  mcLoadingId = mealId;
  MC = { mealId, comments: await roles.fetchMealComments(mealId) };
  mcLoadingId = null;
  if (location.hash.startsWith('#coach-meal')) window.__render();
}
/* Standalone meal cache (Task 6 Part C): coachMeal no longer DEPENDS on the shared ATH cache
   being pre-populated by some other screen's mount — it resolves its own meal via
   roles.fetchMeal(mealId) (added Task 2), signs the photo itself, and keeps a tiny cache keyed
   by mealId. Fast path: if ATH already happens to have this meal (trainerClient still warms it
   for its own screen, and a coach could open a meal moments after that), reuse it instantly with
   no extra round-trip — same behavior as before, just no longer the ONLY path. */
let MEAL = null;           // { id, row }
let mealLoadingId = null;
async function loadMeal(mealId) {
  if (!mealId) return;
  const fast = ATH && ATH.meals.find(m => m.id === mealId);
  if (fast) { MEAL = { id: mealId, row: fast }; return; }
  if (MEAL && MEAL.id === mealId) return;
  if (mealLoadingId === mealId) return;
  mealLoadingId = mealId;
  const row = await roles.fetchMeal(mealId);
  if (row && row.photo_path) row._url = await roles.signedMealPhotoUrl(row.photo_path);
  if (mealLoadingId === mealId) mealLoadingId = null;
  // Never cache a null/undefined row: a fetch failure looks identical to "meal doesn't exist",
  // and caching it here would permanently block retries via the `MEAL.id === mealId` guard above
  // for the rest of the session. Leaving MEAL unset means the guard is skipped on the next mount,
  // so a real remount naturally retries. This can't loop: mount() calls loadMeal() exactly once
  // per navigation — render() never re-triggers it — so a failed fetch just falls back to the
  // existing "meal not found / thread only" render state until the athlete/coach navigates again.
  if (row) MEAL = { id: mealId, row };
  else if (MEAL && MEAL.id === mealId) MEAL = null;
  if (location.hash.startsWith('#coach-meal')) window.__render();
}
function mealById(mealId) {
  if (MEAL && MEAL.id === mealId) return MEAL.row;
  return ATH && ATH.meals.find(m => m.id === mealId);
}
export const coachMeal = {
  nav: 'coach', tab: 'roster',
  render({ sub }) {
    const mealId = sub;
    const meal = mealById(mealId);
    const title = meal ? cap(meal.type || 'Meal') : 'Meal';
    const backTo = (meal && meal.athlete_id) ? `coach-athlete/${meal.athlete_id}` : (ATH ? `coach-athlete/${ATH.athleteId}` : 'coach-home');
    const head = backHead(title, 'Your comment lands on the athlete’s log', backTo);
    if (!MC || MC.mealId !== mealId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('message', 17)}</div>
      <div><div class="tt">Loading the thread…</div><div class="ts">Reading the athlete’s comments on this meal.</div></div></div>`;
    }
    const foods = meal && Array.isArray(meal.detected) ? meal.detected : [];
    return `
    ${head}

    ${meal ? `
    <div class="photo-hero" id="cm-hero" ${meal._url ? 'style="cursor:zoom-in"' : 'style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))"'}>
      ${meal._url ? `<img src="${esc(meal._url)}" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"/>` : ''}
      <div class="ph-grad"></div>
      <div class="ph-meta"><div><div class="ph-t">${esc(title)}</div><div class="ph-s">${meal.protein != null ? `${meal.protein}g protein` : 'Logged'}${meal.source === 'gallery' ? ' · from gallery' : ''}${meal.source === 'manual' || meal.source === 'label' ? ' · no photo' : ''}</div></div>
      ${meal.quality != null ? `<div class="scorechip ${(qualityBand(meal.quality) || {}).cls || ''}"><span class="v">${meal.quality}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>` : ''}

    ${foods.length ? `<div class="eyebrow">Detected</div><div class="foodchips">${foods.map(f => `<span class="foodchip"><span class="dot"></span>${esc(typeof f === 'string' ? f : f.name)}</span>`).join('')}</div>` : ''}

    <div class="eyebrow">Conversation</div>
    ${MC.comments && MC.comments.error ? `
    <div style="text-align:center;padding:14px 12px;border-radius:var(--r-tile);background:var(--surface-1);border:1px solid var(--hairline)">
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.4">Couldn't load the discussion — try again.</div>
      <button class="btn ghost sm" id="coach-thread-retry" style="margin-top:10px">${icon('wifiOff', 15)} Retry</button>
    </div>` : (() => {
      const rx = reactionGroups(MC.comments);
      const msgs = threadMessages(MC.comments);
      // Timing parity (0062): the CLIENT wrote minutes_late on the meals row at log time (the
      // athlete's own clock — the only honest source), so the coach now sees the exact same
      // on-time/late accountability sentence the athlete saw. Pre-0062 rows carry no
      // minutes_late → late: null keeps the honest omission (never guess from UTC logged_at).
      const mlate = meal && typeof meal.minutes_late === 'number' ? meal.minutes_late : null;
      const opening = meal ? openingMessage({
        name: title, quality: meal.quality, note: meal.note, analysis: meal.analysis || '',
        goal: null, coachTargets: null,
        late: mlate == null ? null : mlate > 0, minutesLate: mlate,
      }) : '';
      return `
      ${rx.length ? `<div class="rx-strip">${rx.map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('')}</div>` : ''}
      <div class="thread">
        ${opening ? `
        <div class="msg">
          <div class="av">${icon('sparkle', 15)}</div>
          <div><div class="who">AI Nutritionist · what the athlete was told</div>
          <div class="bubble">${esc(opening)}</div></div>
        </div>` : ''}
        ${msgs.map((c) => `
          <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
            ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
            <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'AI Nutritionist' : 'Coach'}</div>` : ''}
            <div class="bubble">${esc(c.text)}</div></div>
          </div>`).join('')}
        ${!msgs.length ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:2px 2px 8px">No comments yet. React or say something — the athlete sees it on the log.</div>` : ''}
      </div>`;
    })()}
    <div class="rx-strip" id="rx-bar" style="margin-top:4px">
      ${['🔥', '💪', '👏', '👍'].map((e2) => `<span class="rx" data-rx="${e2}" style="cursor:pointer;font-size:16px;padding:6px 14px">${e2}</span>`).join('')}
    </div>
    <div id="rx-note" style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px"></div>
    <div class="qa-row" style="margin-top:8px">
      <button class="qa" id="cm-ask-photo">Request another photo</button>
      <button class="qa" id="cm-note-toggle">Private note</button>
    </div>
    ${composer({ inputId: 'cm-input', sendId: 'cm-send', placeholder: 'Comment on this meal…', sendLabel: 'Send comment' })}
    <div id="cm-note" style="font-size:12.5px;font-weight:600;color:#f87171;margin:6px 2px 0;min-height:16px"></div>

    ${(() => {
      // Private notes (0068): coach-only margin notes the athlete NEVER sees (RLS-enforced).
      const notes = Array.isArray(MC.comments) ? privateNotes(MC.comments) : [];
      return `
      <div id="cm-notes-wrap"${notes.length ? '' : ' hidden'}>
        <div class="eyebrow" style="margin-top:14px">Private notes <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· only you and staff see these</span></div>
        <section class="card" style="padding:6px 16px" id="cm-notes">
          ${notes.map((n2) => `<div class="lrow" style="cursor:default"><div class="lic" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('lock', 15)}</div><div class="lm"><div class="ls" style="white-space:normal;line-height:1.45;color:var(--text-2)">${esc(n2.text)}</div></div></div>`).join('')}
        </section>
      </div>
      <div id="cm-note-box" hidden style="margin-top:8px">
        ${composer({ inputId: 'cm-note-input', sendId: 'cm-note-send', placeholder: 'Private note — the athlete never sees this…', sendLabel: 'Save note', sendIcon: 'lock', sendStyle: 'background:linear-gradient(150deg, var(--purple-bright), #7e22ce)' })}
      </div>`;
    })()}
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadMeal(sub);
    loadMealComments(sub);
    act.markMealSeen(sub); // clears this meal's unseen dot in the team activity feed
    const threadRetry = root.querySelector('#coach-thread-retry');
    if (threadRetry) threadRetry.addEventListener('click', () => loadMealComments(sub, true));
    // Full-screen zoom on the meal photo (same viewer as the athlete side).
    const hero = root.querySelector('#cm-hero');
    const heroImg = hero && hero.querySelector('img');
    if (hero && heroImg && heroImg.src) hero.addEventListener('click', () => openImageViewer(heroImg.src, 'Meal photo'));
    // Request another photo: a templated coach message (counts as one of the 2) + push.
    const askPhoto = root.querySelector('#cm-ask-photo');
    if (askPhoto) askPhoto.addEventListener('click', () => {
      const input0 = root.querySelector('#cm-input');
      if (input0) {
        input0.value = 'Can you send another photo of this one? I want to see the whole plate.';
        input0.focus();
      }
    });
    // Private note composer (0068): kind='note' — never visible to the athlete, no push.
    const noteToggle = root.querySelector('#cm-note-toggle');
    const noteBox = root.querySelector('#cm-note-box');
    if (noteToggle && noteBox) noteToggle.addEventListener('click', () => {
      noteBox.hidden = !noteBox.hidden;
      if (!noteBox.hidden) { const ni = root.querySelector('#cm-note-input'); if (ni) ni.focus(); }
    });
    const noteSend = root.querySelector('#cm-note-send');
    const noteInput = root.querySelector('#cm-note-input');
    let noteBusy = false;
    const saveNote = async () => {
      const text = (noteInput && noteInput.value || '').trim();
      if (!text || noteBusy) return;
      noteBusy = true;
      const meal0 = mealById(sub);
      const athleteId0 = meal0 ? meal0.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId0) { noteBusy = false; return; }
      const ok = await roles.postMealComment(sub, athleteId0, RT.userId, 'coach', text, 'note');
      if (ok) { if (noteInput) noteInput.value = ''; await loadMealComments(sub, true); }
      noteBusy = false;
    };
    if (noteSend) noteSend.addEventListener('click', saveNote);
    if (noteInput) noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNote(); });
    const input = root.querySelector('#cm-input');
    const send = root.querySelector('#cm-send');
    const cmNote = root.querySelector('#cm-note');
    // Thread caps (0059, founder-ratified): coach 2 / athlete 3 messages per meal. The DB
    // trigger is the real wall; this is the honest UI for it.
    const coachN = Array.isArray(MC && MC.comments)
      ? MC.comments.filter(c => c.role === 'coach' && (c.kind || 'message') === 'message').length : 0;
    if (coachN >= 2) {
      if (input) { input.disabled = true; input.placeholder = 'Coach cap reached'; }
      if (send) send.disabled = true;
      if (cmNote) { cmNote.style.color = 'var(--text-3)'; cmNote.textContent = 'You’ve made your point — 2 coach messages per meal. Reactions are always open.'; }
    } else if (coachN === 1 && cmNote) {
      cmNote.style.color = 'var(--text-3)'; cmNote.textContent = '1 of 2 coach messages used on this meal.';
    }
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) return;
      if (cmNote) cmNote.textContent = '';
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', text);
      if (!ok) {
        // Post failed (returns false, never throws): keep the typed text so it isn't lost, tell
        // the coach, let them retry. The old code cleared the input BEFORE the await — a failed
        // send silently ate the comment. Mirrors the reaction handler's honest failure path.
        if (cmNote) cmNote.textContent = "Couldn't send — try again.";
        return;
      }
      input.value = '';
      roles.nudgePush(athleteId, `${S.athlete.name} commented on your ${meal ? cap(meal.type) : 'meal'}`, text);
      // AI's one supporting message (2/3/1): best-effort, selective server-side — it only
      // fires on a substantive coach point, at most once per meal, and never blocks the post.
      try {
        await window.sb.functions.invoke('meal-chat', { body: {
          mealId: sub, coachSupport: true, coachText: text,
          context: meal ? { meal: { type: meal.type, protein: meal.protein, kcal: meal.kcal, quality: meal.quality } } : { meal: {} },
        } });
      } catch { /* skipped or unavailable — the coach's message already landed */ }
      await loadMealComments(sub, true);
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    // One shared lock across all four emoji: a burst of taps lands exactly one reaction.
    const rxNote = root.querySelector('#rx-note');
    let rxBusy = false;
    root.querySelectorAll('#rx-bar [data-rx]').forEach((btn) => btn.addEventListener('click', async () => {
      if (rxBusy) return;
      rxBusy = true;
      if (rxNote) rxNote.textContent = '';
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) { rxBusy = false; return; }
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', btn.getAttribute('data-rx'), 'reaction');
      if (!ok) {
        // Post failed (returns false, never throws): quiet note, no push, no reload — tapping again IS the retry.
        if (rxNote) rxNote.textContent = "Couldn't send — try again.";
        rxBusy = false;
        return;
      }
      roles.nudgePush(athleteId, `Coach reacted to your ${meal ? cap(meal.type) : 'meal'}`, btn.getAttribute('data-rx'));
      await loadMealComments(sub, true);
      rxBusy = false;
    }));
  },
};

/* ---------- Trainer view: real client book (practice_roster), scoped by RLS to owned practices ---------- */
let BOOK = null;
let bookLoading = false;
export async function loadTrainerBook(force) {
  if (bookLoading) return;
  if (BOOK && !force) return;
  bookLoading = true;
  try {
    const r = await roles.loadTrainerBook();
    const pending = [];
    for (const p of r.practices) {
      const reqs = await roles.pendingPracticeRequests(p.id);
      for (const q of reqs) pending.push({ practiceId: p.id, clientId: q.client_id, clientName: q.client_name });
    }
    r.pending = pending;
    r.offline = false;
    BOOK = r;
  } catch {
    // Same honest-offline pattern as loadCoachRoster: a thrown fetch must never read as
    // "No clients yet" — a trainer with a full book, merely offline, was told they had zero.
    BOOK = { practices: [], rows: [], pending: [], offline: true };
  } finally {
    bookLoading = false; // always clear so a retry can re-run
  }
  // trainer-client deep links resolve their header name from this book — repaint it too,
  // or a cold open shows "Client" forever (role walkthrough 2026-07-15).
  if (location.hash === '#trainer' || location.hash.startsWith('#trainer-client')) window.__render();
}
function bookName(athleteId) {
  const r = BOOK && BOOK.rows.find(x => x.athleteId === athleteId);
  return r ? r.name : 'Client';
}
export const trainer = {
  nav: 'trainer', tab: 'clients',
  render() {
    const rows = BOOK ? BOOK.rows : null;
    return `
    ${titleHead('Trainer view', 'Your clients · recovery & nutrition consistency')}

    ${BOOK && BOOK.pending && BOOK.pending.length ? `
    <div class="eyebrow">Client requests</div>
    <section class="card" style="padding:6px 16px">
      ${BOOK.pending.map(q => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
          <div class="lm"><div class="lt">${esc(q.clientName || 'Client')}</div><div class="ls">Wants to join your practice</div></div>
          <button class="btn ghost sm" data-cr="decline" data-p="${esc(q.practiceId)}" data-c="${esc(q.clientId)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
          <button class="btn green sm" data-cr="approve" data-p="${esc(q.practiceId)}" data-c="${esc(q.clientId)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
        </div>`).join('')}
    </section>` : ''}

    ${rows === null ? `
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
    <div><div class="tt">Loading your clients…</div></div></div>`
    : (BOOK && BOOK.offline) ? `
    <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your clients</div>
    <div class="sd-s">We couldn't load today's scores — check your connection. Reopen this tab to retry; nothing is lost.</div></div>`
    : rows.length === 0 ? `
    <div class="state-demo" data-go="trainer-profile" style="cursor:pointer"><div class="sd-ic">${icon('heart', 24)}</div>
    <div class="sd-t">No clients yet</div><div class="sd-s">Share your practice code so athletes can connect. Their real scores show up here.</div>
    ${RT.practice && RT.practice.code ? `<div class="sd-cta" style="display:flex;gap:8px;justify-content:center;align-items:center"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.practice.code)}</span><button class="btn green sm" style="width:auto;padding:0 14px">Share code</button></div>`
      : `<div class="sd-cta"><button class="btn green sm" style="width:auto;padding:0 14px">Get your code</button></div>`}</div>`
    : `<section class="card" style="padding:2px 0">${rows.map(r => `
      <div class="roster-row" data-go="trainer-client/${esc(r.athleteId)}">
        <div class="flagdot ${r.flag}"></div>
        <div class="rn"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.note)}</div></div>
        <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
      </div>`).join('')}</section>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Trainer scope</div>
      <div class="ts">You see your clients' day score, recovery, and nutrition — the same can_view data a coach sees. Team leaderboards and coach-only notes stay in the coach lane.</div></div>
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
  mount(root) {
    loadTrainerBook();
    root.querySelectorAll('[data-cr]').forEach(b => b.addEventListener('click', async () => {
      const p = b.getAttribute('data-p'), c = b.getAttribute('data-c');
      b.disabled = true; b.textContent = '…';
      if (b.getAttribute('data-cr') === 'approve') await roles.approveClient(p, c);
      else await roles.declineClient(p, c);
      await loadTrainerBook(true);
    }));
  },
};

/* ---------- Trainer → client detail: real day (RLS can_view); a note is a real push ---------- */
export const trainerClient = {
  nav: 'trainer', tab: 'note',
  render({ sub }) {
    const athleteId = sub;
    const name = bookName(athleteId);
    const head = backHead(esc(name), 'Client · recovery & nutrition', 'trainer');
    if (!athleteId) {
      // The tab-bar FAB lands here with no client — a picker, never a dead end (role
      // walkthrough 2026-07-15). Same honest loading/offline/empty states as the client list.
      const rows = BOOK ? BOOK.rows : null;
      const body = rows === null ? `
        <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
        <div><div class="tt">Loading your clients…</div></div></div>`
        : (BOOK && BOOK.offline) ? `
        <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
        <div class="sd-t">Can't reach your clients</div>
        <div class="sd-s">We couldn't load your book — check your connection. Reopen this tab to retry; nothing is lost.</div></div>`
        : rows.length === 0 ? `
        <div class="state-demo" data-go="trainer-profile" style="cursor:pointer"><div class="sd-ic">${icon('heart', 24)}</div>
        <div class="sd-t">No clients yet</div><div class="sd-s">Share your practice code first — once a client joins, you can send them a note from here.</div>
        ${RT.practice && RT.practice.code ? `<div class="sd-cta" style="display:flex;gap:8px;justify-content:center;align-items:center"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.practice.code)}</span><button class="btn green sm" style="width:auto;padding:0 14px">Share code</button></div>` : ''}</div>`
        : `<div class="eyebrow">Pick a client</div>
        <section class="card" style="padding:2px 0">${rows.map(r => `
          <div class="roster-row" data-go="trainer-client/${esc(r.athleteId)}">
            <div class="flagdot ${r.flag}"></div>
            <div class="rn"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.note)}</div></div>
            <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
          </div>`).join('')}</section>`;
      return `${backHead('Send a note', 'Pick a client · it lands as a real push', 'trainer')}${body}`;
    }
    if (!ATH || ATH.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
      <div><div class="tt">Loading their day…</div></div></div>`;
    }
    const day = ATH.day;
    const ci = (day && day.checkin) || {};
    const score = day && day.score != null ? day.score : null;
    const readiness = ci.submitted && ci.recovery != null ? Math.round(ci.recovery) : null;
    return `
    ${head}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--blue-bright)">${readiness != null ? readiness : '—'}</div><div class="k">Readiness</div></div>
      <div class="coach-stat"><div class="v" style="color:${ci.submitted ? 'var(--green-bright)' : 'var(--amber-bright)'}">${ci.submitted ? 'In' : 'Open'}</div><div class="k">Recovery</div></div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Recovery trend</div>
      <div class="ts">Per-client recovery patterns show up here once there's enough real check-in history — no invented bars until then.</div></div>
    </div>

    <div class="eyebrow">Note to client</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px 8px">Sends a real push to their notifications.</div>
    ${composer({ inputId: 'tn-input', sendId: 'tn-send', placeholder: `Note for ${name}…`, sendLabel: 'Send note' })}
    <div id="tn-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadTrainerBook();
    if (!sub) return; // picker mode — nothing below applies without a client
    loadAthlete(sub, RT.userId, S.athlete.name);
    const input = root.querySelector('#tn-input');
    const send = root.querySelector('#tn-send');
    const status = root.querySelector('#tn-status');
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      const ok = await roles.nudgePush(sub, `Note from ${S.athlete.name}`, text);
      if (status) status.textContent = ok ? 'Sent to their notifications.' : 'Could not send — check the connection.';
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};

/* ---------- Parent view — honest pending state (no parent→child data path yet) ---------- */
export const parent = {
  hideTabs: true,
  render() {
    // A real guardian has NO server data path in v1 (guardianship + minor-consent verification
    // aren't wired). So we show an honest pending state — never a fabricated child's score/digest.
    return `
    ${titleHead('Parent view', 'Setting up access')}

    <div class="state-demo">
      <div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">Parent access is being set up</div>
      <div class="sd-s">Once your athlete confirms the link (and, for a minor, consent is verified), their score, streak, and weekly digest show up here. Until then there's nothing to show — we won't invent it.</div>
    </div>

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What parents will see</div>
      <div class="ts">Scores, streaks, and completion only. Meal photos, weight, and check-in answers stay between your athlete and their coach by default.</div></div>
    </div>

    <div style="height:14px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};
