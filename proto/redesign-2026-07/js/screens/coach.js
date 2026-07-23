import { S, RT, act, fmtClock, nutritionConfigForGoal } from '../state.js';
import { icon } from '../icons.js';
import { backHead, titleHead, esc, composer, sparkline, emptyState, errorState, skeletonRows } from '../components.js';
import { coachSetupState, coachSetupSteps } from './coach-home.js';
import * as roles from '../roles.js';
import { openingMessage, qualityBand, qualityReason, scoreRubric, reactionGroups, threadMessages, privateNotes } from '../meal-intel.js';
import { openImageViewer } from '../image-viewer.js';
import { CD, loadBook, bookKindFor, loadCoachRoster, loadActivity, loadAthleteProfile, entriesFor, localClock, logBookIntervention } from '../coach-data.js';
import { STATUS_META } from '../status.js';
import { CATALOG, PROOF, resolveRequirementSet, catalogFromItems, freqLabel, stdFromItems, fmtMin, planStyleFromItems } from '../requirements.js';
import { STYLE_KEYS, styleLabel, knobsFor, resolveStyleKey } from '../plan-style.js';
import { dayFromHistoryRow, minutesNow, MEAL_KEYS } from '../day.js';
import { explainCategories } from '../breakdown-model.js';
import { seedTemplates, templateLabel } from '../templates.js';
import { canEditStandards, canViewWeight } from '../staff-access.js';
import { categorizeInbox, inboxAlerts } from '../inbox.js';

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
  nav: 'operator', tab: 'create',
  render({ sub } = {}) {
    // deep-link: coach-assign/<athleteId> pre-targets one athlete (from the athlete screen)
    const rows = CD.roster ? CD.roster.rows : [];
    const practice = CD.kind === 'practice';
    if (sub && ASSIGN.scopeKind !== 'athlete') { ASSIGN.scopeKind = 'athlete'; ASSIGN.scopeValue = sub; }
    // A practice roster carries no position (practice_roster hardcodes it null) and
    // assign_practice_requirement refuses position scope outright — so a stale 'position'
    // selection carried over from a coach session must fall back to the whole book.
    if (practice && ASSIGN.scopeKind === 'position') { ASSIGN.scopeKind = 'team'; ASSIGN.scopeValue = null; }
    const positions = practice ? [] : [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))];
    const target = ASSIGN.scopeKind === 'athlete' ? rows.find(r => r.athleteId === ASSIGN.scopeValue) : null;
    const everyone = practice ? 'All clients' : 'Whole team';
    const chip = (on, label, act, arg) =>
      `<span class="chp ${on ? 'on' : ''}" data-assign="${act}${arg != null ? ':' + esc(String(arg)) : ''}">${label}</span>`;
    return `
    ${backHead('Assign', 'Put something on someone’s plate', practice ? 'trainer' : 'coach-home')}

    <div class="eyebrow">Who</div>
    <div class="chip-row" id="as-who">
      ${chip(ASSIGN.scopeKind === 'team', `${everyone}${rows.length ? ` · ${rows.length}` : ''}`, 'team')}
      ${positions.map(p => {
        const n = rows.filter(r => (r.unit || '').trim().toUpperCase() === p).length;
        return chip(ASSIGN.scopeKind === 'position' && ASSIGN.scopeValue === p, `${esc(p)} room · ${n}`, 'position', p);
      }).join('')}
    </div>
    ${rows.length ? `
    <div class="chip-row" id="as-ath" style="margin-top:6px">
      ${rows.slice(0, 12).map(r => chip(ASSIGN.scopeKind === 'athlete' && ASSIGN.scopeValue === r.athleteId, esc(r.name.split(' ')[0] || r.name), 'athlete', r.athleteId)).join('')}
    </div>` : `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:2px 2px 0">${practice ? 'Clients loading… everyone works right away.' : 'Roster loading… team-wide works right away.'}</div>`}

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
    loadBook(false, bookKindFor(RT.authRole));
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
        kind: CD.kind,
      });
      send.disabled = false;
      if (!r.ok) { say(r.error || 'Could not send — try again.', true); return; }
      if (!r.count) { say(`No ${CD.kind === 'practice' ? 'clients' : 'athletes'} matched — check who you picked.`, true); return; }
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
  // Audit G-3: a throw here previously left tgtLoadingId set with no finally, permanently wedging
  // this athlete on "Loading their targets…" for the session. catch → honest offline; finally clears.
  try {
    const [targets, basics, preference] = await Promise.all([
      roles.fetchAthleteTargets(athleteId),
      roles.fetchAthleteBasics(athleteId),
      roles.fetchAthletePlanPreference(athleteId), // 0142 — always readable, even when locked
    ]);
    TGT = { athleteId, targets: targets || {}, basics: basics || null, preference: preference || null };
  } catch { TGT = { athleteId, targets: {}, basics: null, preference: null, offline: true }; }
  finally { tgtLoadingId = null; }
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
  // Reads the CURRENT book's sets — 0136 gave requirement_sets dual-owner columns, so the
  // owner column follows CD.kind rather than always being team_id.
  const bookId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
  if (!bookId || setsLoading) return;
  if (SETS && SETS.bookId === bookId && !force) return;
  setsLoading = true;
  try { SETS = { bookId, rows: await roles.fetchRequirementSets(bookId, CD.kind) }; }
  catch { SETS = { bookId, rows: [] }; }
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

/** The plan style a TEAM STANDARD governs for one athlete, from the ALREADY-loaded SETS
 *  (loadSets — same rows the room/program editors use), resolved with the SAME precedence
 *  (athlete > position > team) and effective-date versioning the server enforces
 *  (athlete_governing_plan_style). Returns null when no standard sets one — the common case,
 *  where the coach's per-athlete assignment (or the shipped default) governs instead. */
function teamGoverningPlanStyle(athleteId, position) {
  if (!SETS || !SETS.rows || !SETS.rows.length) return null;
  const set = resolveRequirementSet(SETS.rows, athleteId, position, roles.todayISO());
  const item = set ? planStyleFromItems(set.items) : null;
  return item ? item.style : null;
}

/* Plan-style assignment + override editor (0142) — the coach/trainer/nutrition-pro side of
   Structured/Guided/Intuitive. Lives on the same per-athlete screen as their nutrition
   targets, because a style is what decides HOW those targets are measured.

   Three states, never fudged into one:
     locked      a TEAM STANDARD already sets a style — a per-athlete override here would be
                 silently ignored by the athlete's own device (resolvePlanStyle: team > pro >
                 self), so the picker is replaced by an honest pointer to the Standards editor.
     assigned    this coach/trainer has set (or is about to set) the athlete's style directly.
     unset       nobody has — shown as exactly that, never a guessed value, since which shipped
                 default applies (grandfathered Structured vs. new-signup Guided) depends on
                 history this screen doesn't have. */
const STYLE_ICON = { structured: 'clipboard', guided: 'target', intuitive: 'heart' };
function planStyleSection(athleteId, who, targets) {
  const teamStyle = teamGoverningPlanStyle(athleteId, TGT.basics && TGT.basics.position);
  const assigned = resolveStyleKey(targets.style);
  const pref = TGT.preference ? resolveStyleKey(TGT.preference) : null;
  const effective = teamStyle || assigned;
  const prefLine = pref && pref !== effective
    ? `<div class="ps-pref">${esc(who.name.split(' ')[0])}'s preference: <b>${esc(styleLabel(pref).name)}</b> — differs from ${effective ? 'what they\'re on' : 'the default'}.</div>`
    : (pref ? `<div class="ps-pref">${esc(who.name.split(' ')[0])}'s preference: <b>${esc(styleLabel(pref).name)}</b> — matches what they're on.</div>` : '');

  if (teamStyle) {
    const l = styleLabel(teamStyle);
    return `
    <section class="card" style="padding:14px 16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div><div style="font-size:12px;font-weight:700;color:var(--text-3);letter-spacing:.02em">PLAN STYLE</div>
        <div style="font-size:17px;font-weight:800;margin-top:2px">${esc(l.name)}</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">Set by your team standard</div></div>
        <button class="btn ghost sm" data-go="coach-plan" style="width:auto;padding:0 14px">Edit standard</button>
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:10px;line-height:1.55">${esc(l.how)}</div>
      ${prefLine}
    </section>
    <div style="height:12px"></div>`;
  }

  const knobs = knobsFor(assigned || 'guided', targets.styleOverrides);
  return `
  <section class="card" style="padding:14px 16px" id="ps-editor">
    <div style="font-size:12px;font-weight:700;color:var(--text-3);letter-spacing:.02em">PLAN STYLE</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${assigned ? `Assigned by you` : 'Not set — pick one to start scoring their nutrition against it'}</div>
    <div style="display:flex;gap:8px;margin-top:12px" id="ps-pick">
      ${STYLE_KEYS.map((k) => {
        const l = styleLabel(k);
        const on = assigned === k;
        return `<div class="choice ${on ? 'on' : ''}" data-ps="${k}" role="button" style="flex:1;padding:12px 8px;text-align:center">
          <div class="cic" style="margin:0 auto 6px;background:var(--blue-surface);color:var(--blue-bright)">${icon(STYLE_ICON[k], 16)}</div>
          <div class="ct" style="font-size:13px">${esc(l.name)}</div>
        </div>`;
      }).join('')}
    </div>
    ${prefLine}
    <div id="ps-detail" style="margin-top:10px">${assigned ? planStyleDetail(assigned, knobs) : ''}</div>
    <div id="ps-status" style="font-size:12px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px"></div>
  </section>
  <div style="height:12px"></div>`;
}

/* Compact per-knob overrides — the pieces that actually change what gets measured. Everything
   else (surface tone, exact part weights) stays at the style's shipped default; a founder who
   wants more granular per-athlete control extends this panel, not the underlying engine. */
function planStyleDetail(style, knobs) {
  const n = knobs.nutrition;
  const CAL_OPTS = [['exact', 'Exact'], ['range', 'Range'], ['adequacy', 'Adequacy']];
  const PRO_OPTS = [['exact', 'Exact'], ['range', 'Range'], ['off', 'Off']];
  const seg = (key, opts, cur) => `<div class="seg" data-psk="${key}" style="width:auto">${opts.map(([v, t]) =>
    `<button class="${cur === v ? 'on' : ''}" data-psv="${v}">${t}</button>`).join('')}</div>`;
  return `
  <div style="border-top:1px solid var(--hairline-soft);padding-top:10px">
    <div class="lrow" style="cursor:default;padding:6px 0"><div class="lm"><div class="lt" style="font-size:12.5px">Calories</div></div>${seg('calorie', CAL_OPTS, n.calorie)}</div>
    <div class="lrow" style="cursor:default;padding:6px 0"><div class="lm"><div class="lt" style="font-size:12.5px">Protein</div></div>${seg('protein', PRO_OPTS, n.protein)}</div>
    <div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:4px;line-height:1.4">${styleLabel(style).name} defaults shown — change either and Save applies it just to this athlete.</div>
  </div>`;
}

const setSummary = (items) => {
  const meals = items.filter(i => i.kind === 'meal').length;
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const bits = [`${meals} meal${meals === 1 ? '' : 's'}`];
  if (lift) bits.push((lift.freq && lift.freq.label) ? `lifts ${lift.freq.label}` : 'lifts');
  if (weigh) bits.push(weigh.freq && weigh.freq.type === 'daily' ? 'weigh daily' : `weigh ${(weigh.freq && weigh.freq.label) || (weigh.freq && Array.isArray(weigh.freq.days) ? weighLabel(weigh.freq.days) : 'MWF')}`);
  return bits.join(' · ');
};

export const coachPlan = {
  nav: 'operator', tab: 'roster',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const noun = CD.kind === 'practice' ? 'trainer' : 'coach';
    const head = backHead('Nutrition targets', `${esc(who.name)} · ${noun} owns the plan`, athleteId ? `coach-athlete/${esc(athleteId)}` : 'coach-plan');
    // The team program home below is room/staff/trust-pass shaped. A practice has none of those
    // (rooms and Trust Pass are team concepts by design — see CAPS), so it gets its own page:
    // the practice-wide standard (real since 0136) plus per-client targets.
    if (!athleteId && CD.kind === 'practice') {
      const rows = CD.roster ? CD.roster.rows : null;
      const sets = SETS && SETS.rows ? SETS.rows : null;
      const practiceSet = sets && sets.find(x => x.scope_kind === 'team');
      if (CD.roster && CD.roster.offline) {
        return `${titleHead('Plan', 'Your standard, client by client')}${errorState({ title: "Can't reach your clients", body: 'Your standard and their targets are safe — reconnect and they load right here.', retryId: 'plan-retry' })}`;
      }
      return `
      ${titleHead('Plan', 'Your standard, client by client')}

      <div class="eyebrow">Standard · what every day asks</div>
      ${sets === null && rows === null ? skeletonRows(2, 'Loading your standard') : `
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-plan-set/team">
          <div class="lic" style="background:var(--surface-3);color:var(--text-2);font-weight:800;font-size:12px">CL</div>
          <div class="lm"><div class="lt">Your Client Standard${rows && rows.length ? ` <small style="color:var(--text-3);font-weight:700">· ${rows.length}</small>` : ''}</div>
          <div class="ls">${practiceSet ? esc(setSummary(practiceSet.items)) : 'Built-in · 3 meals, recovery, weekly check-in'}</div></div>
          ${practiceSet ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
      </section>`}

      <div class="eyebrow">Targets · per client</div>
      ${rows === null ? skeletonRows(3, 'Loading your clients') : rows.length ? `
      <section class="card" style="padding:6px 16px">
        ${rows.slice(0, 12).map(r => `
        <div class="lrow" data-go="coach-plan/${esc(r.athleteId)}">
          <div class="lic">${icon('target', 17)}</div>
          <div class="lm"><div class="lt">${esc(r.name)}</div>
          <div class="ls">Protein · calories · target weight</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`).join('')}
      </section>` : `
      ${emptyState({ icon: 'target', title: 'No clients yet', body: 'Per-client protein, calorie, and target-weight numbers open here the moment someone joins.', action: { label: 'Invite a client', go: 'trainer-profile' } })}`}

      <div style="height:12px"></div>
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
        <div><div class="tt">Built for teams</div>
        <div class="ts">Position rooms and Trust Pass stay team tools — a practice is 1:1, and a Trust Pass is granted through a team link. Everything else here is yours.</div></div>
      </div>
      <div style="height:10px"></div>`;
    }
    if (!athleteId) {
      const rows = CD.roster ? CD.roster.rows : null;
      const positions = rows ? [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))] : [];
      const sets = SETS && SETS.rows ? SETS.rows : null;
      const teamSet = sets && sets.find(s => s.scope_kind === 'team');
      const teamCount = rows ? rows.length : 0;
      // T-18: readiness (ONE source of truth with Home — imported, never re-derived) + scheduled
      // versions (0085 effective_date, read defensively so a pre-0085 DB simply shows none).
      const setup = coachSetupState();
      const setupSteps = coachSetupSteps(setup);
      const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      const upcoming = (sets || []).filter(s => s && s.effective_date && String(s.effective_date) > todayISO)
        .sort((a, b) => String(a.effective_date) < String(b.effective_date) ? -1 : 1);
      const scopeLabelOf = (s) => s.scope_kind === 'team' ? 'Team standard'
        : s.scope_kind === 'position' ? `${esc(String(s.scope_value || '').toUpperCase())} room` : 'Athlete standard';
      const readinessCard = () => {
        const openReq = setupSteps.required.filter(x => !x.done);
        const openOpt = setupSteps.optional.filter(x => !x.done);
        const stepRow = (x, req) => `
          <div class="lrow" ${x.go ? `data-go="${esc(x.go)}" style="cursor:pointer"` : 'style="cursor:default;opacity:0.75"'}>
            <div class="lic" style="${req ? 'background:var(--amber-surface);color:var(--amber-bright)' : 'background:var(--surface-3);color:var(--text-3)'}">${icon(req ? 'bolt' : 'clipboard', 16)}</div>
            <div class="lm"><div class="lt">${esc(x.t)}</div><div class="ls">${esc(x.s)}</div></div>
            ${x.go ? icon('chevron', 17, 'style="color:var(--text-3)"') : `<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-3)">Soon</span>`}
          </div>`;
        const shown = [...openReq.map(x => stepRow(x, true)), ...(setup.ready ? openOpt.slice(0, 2).map(x => stepRow(x, false)) : [])];
        const line = setup.ready
          ? `<div style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:var(--green-bright)">${icon('check', 14)} Required setup complete</div>`
          : `<div style="font-size:12px;font-weight:800;color:var(--amber-bright)">${setup.requiredDone} of ${setup.requiredTotal} required steps done</div>`;
        return `
        <div class="eyebrow">Readiness</div>
        <section class="card" style="padding:${shown.length ? '11px 16px 6px' : '13px 16px'};${setup.ready ? '' : 'background:var(--amber-surface);border-color:var(--amber-border)'}">
          ${line}
          ${shown.length ? `<div style="height:8px"></div>${shown.join('')}` : (setup.ready ? `<div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:3px">Everything's set. Invite athletes and your command center fills in live.</div>` : '')}
        </section>`;
      };
      const roomCard = (pos) => {
        const s = sets && sets.find(x => x.scope_kind === 'position' && String(x.scope_value || '').trim().toUpperCase() === pos);
        const n = rows ? rows.filter(r => (r.unit || '').trim().toUpperCase() === pos).length : 0;
        return `
        <div class="lrow" data-go="coach-plan-set/position/${esc(pos)}">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright);font-weight:800;font-size:12px">${esc(pos.slice(0, 2))}</div>
          <div class="lm"><div class="lt">${esc(pos)} room <small style="color:var(--text-3);font-weight:700">· ${n}</small></div>
          <div class="ls">${s ? esc(setSummary(s.items)) : 'Inherits team standard'}</div></div>
          ${s ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`;
      };
      // GS-2 / audit G-2: a coach who is merely OFFLINE must not be shown the fake "empty team"
      // program page (rooms/targets/trust reading "will appear once your team joins"). Honest error.
      if (CD.roster && CD.roster.offline) {
        return `${titleHead('Plan', 'Your program, room by room')}${errorState({ title: "Can't reach your program", body: 'Your standards, rooms, and targets are safe — reconnect and they load right here.', retryId: 'plan-retry' })}`;
      }
      return `
      ${titleHead('Plan', 'Your program, room by room')}

      ${readinessCard()}

      <div class="eyebrow">Standards · what every day asks</div>
      ${sets === null && rows === null ? skeletonRows(3, 'Loading your program') : `
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-plan-set/team">
          <div class="lic" style="background:var(--surface-3);color:var(--text-2);font-weight:800;font-size:12px">TM</div>
          <div class="lm"><div class="lt">Your Team Standard${teamCount ? ` <small style="color:var(--text-3);font-weight:700">· ${teamCount}</small>` : ''}</div>
          <div class="ls">${teamSet ? esc(setSummary(teamSet.items)) : 'Built-in · 3 meals, recovery, weekly check-in'}</div></div>
          ${teamSet ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        ${positions.map(roomCard).join('')}
      </section>
      ${positions.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.4">Rooms appear as athletes with positions join — the team standard covers everyone until then.${rows && !rows.length ? ` <span data-go="coach-profile/code" style="color:var(--blue-bright);font-weight:800;cursor:pointer">Invite athletes</span>` : ''}</div>` : ''}`}

      <div class="eyebrow">Upcoming changes</div>
      ${sets === null ? skeletonRows(1, 'Loading scheduled changes') : upcoming.length ? `
      <section class="card" style="padding:6px 16px">
        ${upcoming.map(s => `
        <div class="lrow" data-go="coach-plan-set/${s.scope_kind === 'position' ? `position/${esc(String(s.scope_value || '').toUpperCase())}` : 'team'}">
          <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('bolt', 16)}</div>
          <div class="lm"><div class="lt">${scopeLabelOf(s)} <small style="color:var(--text-3);font-weight:700">· ${esc(setSummary(s.items))}</small></div>
          <div class="ls">Takes effect ${esc(String(s.effective_date))} · earlier days stay unchanged</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`).join('')}
      </section>` : `
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 2px;line-height:1.4">No scheduled changes. Publish a standard with a future date and it lists here — today's scoring stays untouched.</div>`}

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
      ${emptyState({ icon: 'target', title: 'No athletes yet', body: 'Per-athlete protein, calorie, and target-weight numbers open here the moment your team joins.', action: { label: 'Invite athletes', go: 'coach-profile/code' } })}`}

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
          <div class="ls">${TP === null ? 'Checking…' : active ? `Active · started ${esc(pass.granted_date)} · ${pass.length_days || 10} days` : `No pass · needs ${(RT.trustPolicy || { eligibility_days: 7 }).eligibility_days} photo-logged days on standard`}</div></div>
          <button class="btn ghost sm" data-tp="${active ? 'end' : 'grant'}:${esc(r.athleteId)}" style="width:auto;padding:0 12px;height:30px;font-size:11px;${active ? 'color:var(--red)' : ''}">${active ? 'End' : 'Grant'}</button>
        </div>`;
        }).join('')}
        <div id="tp-plan-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;padding:2px 2px 8px"></div>
      </section>` : `
      ${emptyState({ icon: 'shield', title: 'No trust passes yet', body: `A pass is earned after ${(RT.trustPolicy || { eligibility_days: 7 }).eligibility_days} photo-logged days on standard. Invite athletes to start the clock.`, action: { label: 'Invite athletes', go: 'coach-profile/code' } })}`}

      <div class="eyebrow">Program</div>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-voice">
          <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 17)}</div>
          <div class="lm"><div class="lt">AI in your voice</div><div class="ls">${RT.coachVoice ? 'Reinforces your rulings, never invents' : 'Set the tone the AI reinforces'}</div></div>
          <span class="status-pill ${RT.coachVoice && RT.coachVoice.enabled !== false ? 'g' : 'muted'}">${RT.coachVoice && RT.coachVoice.enabled !== false ? 'On' : 'Off'}</span>
          ${icon('chevron', 17, 'style="color:var(--text-3);margin-left:8px"')}
        </div>
        <div class="lrow" data-go="trust-pass-policy">
          <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('shield', 17)}</div>
          <div class="lm"><div class="lt">Trust Pass defaults</div><div class="ls">${(RT.trustPolicy || { length_days: 10, eligibility_days: 7 }).length_days}-day pass · earned after ${(RT.trustPolicy || { eligibility_days: 7 }).eligibility_days} photo-logged days</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        <div class="lrow" data-go="week-pattern">
          <div class="lic" style="background:rgba(59,130,246,0.14);color:var(--blue-bright)">${icon('clock', 17)}</div>
          <div class="lm"><div class="lt">Training week</div><div class="ls">${(() => { const p = Array.isArray(RT.weekPattern) ? RT.weekPattern : []; const rest = p.filter((d) => d === 'rest').length; return rest ? `${7 - rest} training · ${rest} rest` : 'Every day training'; })()}</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        <div class="lrow" data-go="coach-rooms">
          <div class="lic" style="background:rgba(59,130,246,0.14);color:var(--blue-bright)">${icon('users', 17)}</div>
          <div class="lm"><div class="lt">Position rooms</div><div class="ls">${(() => { const n = ((CD.extras && CD.extras.rooms) || []).length; return n ? `${n} room${n === 1 ? '' : 's'}` : 'Group your roster by position'; })()}</div></div>
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
      return `${head}${skeletonRows(3, 'Loading their targets')}`;
    }
    if (TGT.offline) {
      return `${head}${errorState({ title: "Couldn't load their targets", body: 'Their plan is safe — reconnect and it loads right here.', retryId: 'tgt-retry' })}`;
    }
    const t = TGT.targets || {};
    const planStyleCard = planStyleSection(athleteId, who, t);
    // Per-field visibility (0103): a role outside [head coach, athletic trainer, S&C] neither
    // sees nor edits weight — the server RPC already strips it, so rendering a "180" here would
    // be a fabricated default, not their real target. Fail CLOSED while the role loads.
    // can_view_weight (0103:56) grants a TRAINER unconditionally — is_trainer_of is checked
    // BEFORE the team_staff role branch, unlike a coach whose visibility depends on their scope.
    const seeWeight = CD.kind === 'practice' || canViewWeight(CD.extras && CD.extras.myRole);
    // Distinguish "no targets set yet" (starter defaults shown as a starting point) from real
    // saved values — a coach shouldn't think targets already exist when they're just placeholders.
    const unset = t.protein == null && t.calories == null && (!seeWeight || t.weight == null);
    const rows = [['Protein', 'tg-protein', t.protein != null ? t.protein : 180, 'g', 5], ['Calories', 'tg-calories', t.calories != null ? t.calories : 2400, '', 50],
      ...(seeWeight ? [['Target weight', 'tg-weight', t.weight != null ? t.weight : 180, ' lb', 1]] : [])];
    return `
    ${head}

    ${planStyleCard}

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
    ${seeWeight ? `
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
    </section>` : `
    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Weight targets are managed by allowed roles</div>
      <div class="ts">Your role sets protein and calorie targets. Body-weight data and the weight target are visible to the head coach, athletic trainer, and S&amp;C coach.</div></div>
    </div>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">${cap(noun)} owns the numbers</div>
      <div class="ts">Saving writes these to their plan (athlete_profiles.targets) via the coach_set_goals RPC. Their nutrition scoring is unaffected — the score is always the four honest components.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="save-targets">${icon('check', 19)} Save targets</button>
    <div id="tg-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    // Standing standards and trust passes are team-owned (0136 gives a practice its own
    // standards; trust passes stay team-only — grant_trust_pass never authorizes is_trainer_of).
    // Skip both fetches on a practice book rather than querying a table that will only ever hand
    // back rows scoped to a team id this book doesn't have.
    loadBook(false, bookKindFor(RT.authRole)).then(() => {
      if (CD.caps.standards) loadSets();
      if (!sub && CD.caps.trustPass) loadTrust();
    });
    // GS-2 offline retry (the program page's honest error state) — refetch and repaint.
    const planRetry = root.querySelector('#plan-retry');
    if (planRetry) planRetry.addEventListener('click', () => { planRetry.disabled = true; loadBook(true, bookKindFor(RT.authRole)).then(() => { if (CD.caps.standards) loadSets(true); window.__render(); }); });

    // Trust pass grant/end on the Plan home (server-enforced eligibility, honest errors)
    root.querySelectorAll('[data-tp]').forEach(b => b.addEventListener('click', async () => {
      const [what, id] = b.getAttribute('data-tp').split(':');
      const status = root.querySelector('#tp-plan-status');
      const say = (msg, isErr) => { if (status) { status.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; status.textContent = msg; } };
      b.disabled = true; say(what === 'grant' ? 'Granting…' : 'Ending…');
      if (what === 'grant') {
        const r = await roles.grantTrustPass(id, (RT.trustPolicy || { length_days: 10 }).length_days);
        if (!r.ok) { b.disabled = false; say(r.error && /standard|photo|eligib/i.test(r.error) ? `Not eligible yet — needs ${(RT.trustPolicy || { eligibility_days: 7 }).eligibility_days} photo-logged days on standard.` : (r.error || 'Could not grant it.'), true); return; }
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
    const tgtRetry = root.querySelector('#tgt-retry');
    if (tgtRetry) tgtRetry.addEventListener('click', () => { tgtRetry.disabled = true; TGT = null; loadTargets(sub); }); // audit G-3 retry: clear the cache then refetch
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
      // 0103: a weight-restricted role's payload carries no weight key at all — the field wasn't
      // rendered, and sending a fabricated default would be dishonest even though the server
      // guard preserves the stored value regardless. Only send what this role actually edited.
      const payload = { protein: num('tg-protein'), calories: num('tg-calories') };
      if (root.querySelector('#tg-weight')) payload.weight = num('tg-weight');
      const ok = await roles.coachSetGoals(sub, payload);
      if (ok) { if (status) status.textContent = 'Saved to their plan.'; TGT = null; setTimeout(() => { location.hash = `#coach-athlete/${sub}`; }, 600); }
      else { save.disabled = false; if (status) status.textContent = 'Could not save — check the connection.'; }
    });

    // Plan style assignment + overrides (0142) — every tap writes immediately (set_athlete_plan_style),
    // the same auto-apply pattern the athlete's own picker uses. Absent entirely when a team
    // standard governs (planStyleSection renders no #ps-editor in that case).
    const psEditor = root.querySelector('#ps-editor');
    if (psEditor) {
      const psStatus = root.querySelector('#ps-status');
      const psSay = (msg, bad) => { if (psStatus) { psStatus.style.color = bad ? 'var(--red)' : 'var(--text-3)'; psStatus.textContent = msg; } };
      const currentOverrides = () => {
        const detail = root.querySelector('#ps-detail');
        const calBtn = detail && detail.querySelector('[data-psk="calorie"] button.on');
        const proBtn = detail && detail.querySelector('[data-psk="protein"] button.on');
        if (!calBtn && !proBtn) return null;
        return { nutrition: { ...(calBtn ? { calorie: calBtn.getAttribute('data-psv') } : {}), ...(proBtn ? { protein: proBtn.getAttribute('data-psv') } : {}) } };
      };
      const saveStyle = async (style, overrides) => {
        psSay('Saving…');
        const ok = await roles.setAthletePlanStyle(sub, style, overrides);
        if (ok) { psSay('Saved to their plan.'); TGT = null; loadTargets(sub); }
        else psSay('Could not save — check the connection.', true);
      };
      const wireDetailToggles = () => {
        root.querySelectorAll('#ps-detail [data-psk] button').forEach((b) => b.addEventListener('click', () => {
          b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          const active = psEditor.querySelector('[data-ps].on');
          if (active) saveStyle(active.getAttribute('data-ps'), currentOverrides());
        }));
      };
      psEditor.querySelectorAll('[data-ps]').forEach((el) => el.addEventListener('click', () => {
        const style = el.getAttribute('data-ps');
        psEditor.querySelectorAll('[data-ps]').forEach((x) => x.classList.toggle('on', x === el));
        const detail = root.querySelector('#ps-detail');
        if (detail) { detail.innerHTML = planStyleDetail(style, knobsFor(style, null)); wireDetailToggles(); }
        saveStyle(style, null); // a freshly-picked style starts from its own defaults, not a stale override
      }));
      wireDetailToggles();
    }
  },
};

/* ---------- Standards editor (WS5.1): one scope's standing requirement set ----------
   Knobs → catalog-shaped items (0055-validated rails: meals 1–6, lifts 0–7) →
   set_team_requirements. A position room can reset to the team default (0058). */
const LIFT_DAYS = { 1: [2], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
// 4-meal day is Breakfast / Lunch / Dinner / Snack (founder call) — so slot 4 (index 3) IS the
// snack, which is what the "snack is optional" toggle marks as a bonus.
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Meal 5', 'Meal 6'];
const MEAL_WINDOWS = [{ open: 420, due: 570 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }, { due: 1290 }, { due: 1320 }, { due: 1350 }];
let KNOB = null; // { key, meals, lifts, weigh, hydration, recovery, checkin }

// Weekday short names by JS getDay() index (0 = Sunday) — the one label source for weigh cadence.
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function weighLabel(days) {
  const d = (Array.isArray(days) ? days : []).filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  if (!d.length) return 'No days set';
  if (d.length === 7) return 'Every day';
  return d.map((x) => DOW_SHORT[x]).join(' / ');
}

export function knobsFromItems(items) {
  const mealItems = items.filter(i => i.kind === 'meal');
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const hyd = items.find(i => i.kind === 'hydration');
  const meals = Math.min(6, Math.max(1, mealItems.length));
  const slice = mealItems.slice(0, meals);
  const weighDaily = !!(weigh && weigh.freq && weigh.freq.type === 'daily');
  return {
    meals,
    lifts: lift ? Math.min(7, (lift.freq && lift.freq.days && lift.freq.days.length) || 3) : 0,
    // Optional coach-programmed session name + free-text description (0135). Empty when the coach
    // left the default "Lift session" — so an untouched standard stays byte-identical.
    liftTitle: (lift && lift.title && lift.title !== 'Lift session') ? lift.title : '',
    liftDesc: (lift && lift.desc) ? lift.desc : '',
    // Weigh cadence: off / daily / custom weekdays. A pre-existing MWF (or any days-based) standard
    // reads back as 'custom' with its exact days selected — same schedule, now editable per-day.
    weigh: weigh ? (weighDaily ? 'daily' : 'custom') : 'off',
    weighDays: (weigh && weigh.freq && Array.isArray(weigh.freq.days)) ? weigh.freq.days.slice() : [1, 3, 5],
    hydration: !!hyd,
    hydrationOz: (hyd && typeof hyd.target === 'number') ? hyd.target
      : (hyd && /(\d+)\s*oz/i.test(hyd.title || '') ? +(hyd.title.match(/(\d+)\s*oz/i)[1]) : 120),
    recovery: items.some(i => i.kind === 'recovery'),
    checkin: items.some(i => i.kind === 'checkin'),
    // Per-meal proof (Tier 2): read each meal's own proof; photoProof stays as the "all photo?"
    // summary the master toggle reads/writes. mealProofs is the authoritative per-meal source.
    photoProof: mealItems.length ? mealItems.every(m => m.proof === 'photo') : true,
    mealProofs: slice.map((m) => (m.proof === 'check' ? 'check' : 'photo')),
    // Per-meal training/rest tagging (Tier 2, 0086 item.dayType). 'any' = every day (the default,
    // byte-identical to an untagged standard). Only bites when a team week pattern exists.
    mealDayTypes: slice.map((m) => (m.dayType === 'training' || m.dayType === 'rest') ? m.dayType : 'any'),
    mealNames: slice.map((m, i) => m.title || MEAL_NAMES[i]),
    mealWins: slice.map((m, i) => (m.window && m.window.due != null) ? { ...m.window } : { ...MEAL_WINDOWS[i] }),
    // Part B rails, read from the first meal (grace/late are still set uniformly across meals).
    grace: typeof (mealItems[0] || {}).grace === 'number' ? mealItems[0].grace : 0,
    latePolicy: ((mealItems[0] || {}).latePolicy === 'full' || (mealItems[0] || {}).latePolicy === 'none') ? mealItems[0].latePolicy : 'half',
    coachReview: !!(mealItems[0] || {}).coachReview,
    // Snack-optional: the meal on the snack slot (index 3 — the 4th meal, Breakfast/Lunch/Dinner/
    // Snack, present only at 4+ meals) is bonus, not required. Read back from that item's flag so
    // the toggle reflects the saved standard. Index 2 is also accepted for BACK-COMPAT: standards
    // saved before the slot fix carry the flag there (which wrongly made Dinner optional), so the
    // toggle still reads ON for them and the next save migrates it onto the real Snack.
    snackOptional: mealItems.length >= 4 && (!!(mealItems[3] || {}).snack || !!(mealItems[2] || {}).snack),
  };
}
// Shared fallback logic for meal names/windows/proof/day-type — render() uses this too, so what's
// shown on screen IS exactly what itemsFromKnobs would save. Per-meal arrays fall back element-wise
// (a saved standard may predate mealProofs/mealDayTypes) so a partial array never drops a meal.
function resolveMeals(k) {
  let names, wins;
  if (Array.isArray(k.mealNames) && k.mealNames.length === k.meals
      && Array.isArray(k.mealWins) && k.mealWins.length === k.meals) {
    names = k.mealNames; wins = k.mealWins;
  } else if (k.meals === 1) { names = ['Daily meal']; wins = [{ open: 720, due: 1230 }]; }
  else if (k.meals === 2) { names = ['Breakfast', 'Dinner']; wins = [MEAL_WINDOWS[0], MEAL_WINDOWS[2]]; }
  else { names = MEAL_NAMES.slice(0, k.meals); wins = MEAL_WINDOWS.slice(0, k.meals); }
  const proofs = Array.from({ length: k.meals }, (_, i) => {
    const p = Array.isArray(k.mealProofs) ? k.mealProofs[i] : (k.photoProof === false ? 'check' : 'photo');
    return p === 'check' ? 'check' : 'photo';
  });
  const dayTypes = Array.from({ length: k.meals }, (_, i) => {
    const d = Array.isArray(k.mealDayTypes) ? k.mealDayTypes[i] : 'any';
    return (d === 'training' || d === 'rest') ? d : 'any';
  });
  return { names, wins, proofs, dayTypes };
}
export function itemsFromKnobs(k) {
  const items = [];
  const { names, wins, proofs, dayTypes } = resolveMeals(k);
  const grace = Math.min(240, Math.max(0, +k.grace || 0));
  const latePolicy = (k.latePolicy === 'full' || k.latePolicy === 'none') ? k.latePolicy : null; // 'half' = default, omit
  names.forEach((t, i) => {
    const meal = {
      id: `meal-${i + 1}`, title: String(t || MEAL_NAMES[i] || `Meal ${i + 1}`).slice(0, 40),
      kind: 'meal', proof: proofs[i], freq: { type: 'daily' }, window: { ...wins[i] },
    };
    // Part B: only write non-default rails so existing standards stay byte-identical.
    if (grace > 0) meal.grace = grace;
    if (latePolicy) meal.latePolicy = latePolicy;
    if (k.coachReview) meal.coachReview = true;
    // dayType: only write when the coach tagged a meal training/rest — an 'any' meal stays
    // untagged, so a standard with no tags is byte-identical to before (parity).
    if (dayTypes[i] === 'training' || dayTypes[i] === 'rest') meal.dayType = dayTypes[i];
    // Snack-optional: mark the snack-slot meal as a bonus. That's index 3 — the 4th meal — because
    // a 4-meal day reads Breakfast / Lunch / Dinner / Snack; marking index 2 made "Dinner" optional.
    if (k.snackOptional && k.meals >= 4 && i === 3) meal.snack = true;
    items.push(meal);
  });
  if (k.lifts > 0) {
    const lift = {
      id: 'lift',
      title: (k.liftTitle && String(k.liftTitle).trim()) ? String(k.liftTitle).trim().slice(0, 80) : `Lift session`,
      kind: 'lift', proof: 'check',
      freq: { type: 'days', days: LIFT_DAYS[k.lifts], label: `${k.lifts}× / week` }, window: { due: 1230, label: 'After training' },
    };
    // Optional free-text program (exercise list) the athlete sees + logs against. Extra key —
    // validate_requirement_items ignores it (only id/title/kind/proof are required).
    if (k.liftDesc && String(k.liftDesc).trim()) lift.desc = String(k.liftDesc).trim().slice(0, 400);
    items.push(lift);
  }
  if (k.weigh !== 'off') {
    const daily = k.weigh === 'daily';
    // Arbitrary weekdays (Tier 2). 'mwf' from an older editor value maps to the same [1,3,5].
    const days = daily ? null : [...new Set((k.weighDays || []).filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b);
    // Custom mode with zero days selected = no weigh-in — honor the coach deselecting every day
    // (the editor tells them to "pick at least one day, or switch to Off"); never silently re-add MWF.
    if (daily || (days && days.length)) items.push({
      id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale',
      freq: daily ? { type: 'daily' } : { type: 'days', days, label: weighLabel(days) }, window: { due: 540 },
    });
  }
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
let SHOW_TPL_MANAGE = false; // Manage mode swaps apply-chips for rename/delete rows (never both at once)
let TPL_RENAMING = null;     // template id whose inline rename input is open, or null
let TPL_BUSY = false;        // guards double-submit on rename/delete
async function loadTemplates(force) {
  // Team-only (0074): a practice book would pass a practice uuid into a team_id column, and the
  // first-open seed below would fire seven doomed inserts against a teams FK.
  if (!CD.caps.templates) return;
  const teamId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
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
  nav: 'operator', tab: 'roster',
  render({ sub }) {
    // Split on the FIRST slash only — a room label can legitimately contain "/" ("DB/S", "WR/TE")
    // and a naive split truncated the scope value to "DB", silently scoping the standard elsewhere.
    const [kind, ...restVal] = (sub || 'team').split('/');
    const rawVal = restVal.length ? restVal.join('/') : undefined;
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const key = `${kind}:${value || ''}`;
    // 'team' scope on a PRACTICE book means "the practice default" — the literal scope_kind is
    // kept as 'team' on purpose so resolveRequirementSet needs no change (0136). Only the label
    // differs. A practice never reaches the room branch: rooms are a team concept.
    const scopeName = kind === 'team'
      ? (CD.kind === 'practice' ? 'Your Client Standard' : 'Your Team Standard')
      : `${value} room`;
    const sets = SETS && SETS.rows ? SETS.rows : [];
    const existing = sets.find(s => s.scope_kind === kind && String(s.scope_value || '').trim().toUpperCase() === (value || '').toUpperCase())
      || (kind === 'team' ? sets.find(s => s.scope_kind === 'team') : null);
    if (!KNOB || KNOB.key !== key) {
      KNOB = existing
        ? { key, ...knobsFromItems(existing.items) }
        : { key, meals: 3, lifts: 0, weigh: 'custom', weighDays: [1, 3, 5], hydration: true, hydrationOz: 120, recovery: true, checkin: true, photoProof: true };
    }
    // Slice F: position coaches and view-only staff SEE the governing standard but don't
    // edit it (founder matrix; 0078's set_team_requirements would bounce the save anyway).
    // Staff roles are a team concept — a trainer owns their practice outright and is never
    // a view-only staffer, so the read-only branch is skipped entirely on a practice book.
    if (CD.kind !== 'practice' && CD.extras && !canEditStandards(CD.extras.myRole)) {
      const preview = previewFromKnobs(KNOB);
      return `
      ${backHead(scopeName, 'View only — standards are set by the head coach', 'coach-plan')}
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('eye', 17)}</div>
        <div><div class="tt">The standard, as your athletes see it</div>
        <div class="ts">Editing standards is for the head coach, coordinators, and the nutritionist. Ask the head coach if your role should change.</div></div>
      </div>
      ${preview ? `
      <section class="card" style="padding:6px 16px">
        ${preview.std.slots.map(slot => {
          const title = preview.std.titles[slot] || cap(slot);
          const due = preview.std.deadlines[slot];
          return `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${esc(title)}</div>
          <div class="ls">${due != null ? `Due by ${fmtMin(due)}` : 'No deadline set'}</div></div>
        </div>`;
        }).join('')}
        <div style="font-size:11.5px;font-weight:600;color:var(--text-3);padding:8px 2px 4px">${preview.std.mealsRequired} meal${preview.std.mealsRequired === 1 ? '' : 's'} make the day's nutrition score.</div>
      </section>` : ''}
      <div style="height:10px"></div>`;
    }
    const chip = (on, label, act, arg) => `<span class="std-chip ${on ? 'on' : ''}" data-knob="${act}:${arg}">${label}</span>`;
    const sw = (on, act) => `<div class="std-switch ${on ? 'on' : ''}" role="switch" tabindex="0" aria-checked="${on ? 'true' : 'false'}" data-knob="${act}:toggle"></div>`;
    const swRow = (title, subLabel, act, on) => `
      <div class="std-switch-row">
        <div class="std-sw-m"><div class="std-sw-t">${title}</div><div class="std-sw-s">${subLabel}</div></div>
        ${sw(on, act)}
      </div>`;
    const modHead = (ic, cls, title, subLabel, val) => `
      <div class="std-mod-head">
        <div class="std-mod-ic ${cls}">${icon(ic, 18)}</div>
        <div class="std-mod-tt"><div class="std-mod-t">${title}</div>${subLabel ? `<div class="std-mod-s">${subLabel}</div>` : ''}</div>
        ${val ? `<div class="std-mod-val">${val}</div>` : ''}
      </div>`;
    const sumChip = (ic, html) => `<span class="std-sum">${icon(ic, 13)}${html}</span>`;
    const toHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const { names, wins, proofs, dayTypes } = resolveMeals(KNOB);
    // Day-type tagging only bites once a training/rest week exists; surface it (with a link to set
    // one up) only then, so the coach is never offered a control that silently does nothing.
    const hasRestPattern = Array.isArray(RT.weekPattern) && RT.weekPattern.some((d) => d === 'rest');
    const PREV_IC = { breakfast: 'utensils', lunch: 'bowl', dinner: 'bowl', snack: 'utensils' };
    return `
    ${backHead(scopeName, kind === 'team'
      ? (CD.kind === 'practice' ? 'The starting standard for clients without an override' : 'The starting standard for athletes without an override')
      : `Overrides your team standard for ${esc(value)}`, 'coach-plan')}
    <div class="std-wrap">

      <div class="std-summary">
        ${sumChip('utensils', `<b>${KNOB.meals}</b> meal${KNOB.meals === 1 ? '' : 's'}`)}
        ${KNOB.photoProof ? sumChip('camera', 'Photo proof') : ''}
        ${KNOB.weigh !== 'off' ? sumChip('scale', KNOB.weigh === 'daily' ? 'Daily weigh' : `${weighLabel(KNOB.weighDays)} weigh`) : ''}
        ${KNOB.recovery ? sumChip('moon', 'Recovery') : ''}
        ${KNOB.hydration ? sumChip('droplet', `<b>${KNOB.hydrationOz}</b> oz`) : ''}
      </div>

      <section class="std-mod">
        ${modHead('utensils', 'std-ic-g', 'Meals', 'The meals that count toward the daily score', `${KNOB.meals}/day`)}
        <div class="std-lbl">Meals per day</div>
        <div class="std-count">${[1, 2, 3, 4, 5, 6].map(n => chip(KNOB.meals === n, String(n), 'meals', n)).join('')}</div>
        <div class="std-lbl mt">Names, windows &amp; proof · these drive due-soon, overdue &amp; reminders</div>
        ${names.map((t, i) => `
        <div class="std-meal-card">
          <div class="std-meal">
            <input class="mname std-name" data-meal="${i}" maxlength="40" value="${esc(t)}" aria-label="Meal ${i + 1} name" />
            <button type="button" class="std-proof-pill ${proofs[i] === 'check' ? 'check' : ''}" data-mealproof="${i}" aria-label="Meal ${i + 1} proof: ${proofs[i] === 'check' ? 'tap to check' : 'photo required'}">${icon(proofs[i] === 'check' ? 'check' : 'camera', 14)} ${proofs[i] === 'check' ? 'Check' : 'Photo'}</button>
          </div>
          <div class="std-meal-times">
            <input type="time" class="mwin std-time" data-meal="${i}" data-edge="open" value="${wins[i].open != null ? toHM(wins[i].open) : ''}" aria-label="Meal ${i + 1} opens" />
            <span class="std-arrow">→</span>
            <input type="time" class="mwin std-time" data-meal="${i}" data-edge="due" value="${toHM(wins[i].due)}" aria-label="Meal ${i + 1} due" />
          </div>
          ${hasRestPattern ? `<div class="std-daytype">
            ${['any', 'training', 'rest'].map(dt => `<span class="std-daychip ${dayTypes[i] === dt ? 'on' : ''}" data-mealday="${i}:${dt}">${dt === 'any' ? 'Every day' : dt === 'training' ? 'Training only' : 'Rest only'}</span>`).join('')}
          </div>` : ''}
        </div>`).join('')}
        <div class="std-switch-row" style="margin-top:8px">
          <div class="std-sw-m"><div class="std-sw-t">Photo proof on every meal</div><div class="std-sw-s">Sets all meals at once — tweak any one above. Off = tap-to-check.</div></div>
          ${sw(proofs.every(p => p === 'photo'), 'photo')}
        </div>
        ${hasRestPattern ? '' : `<div class="std-help" style="margin-top:6px">${icon('info', 12)} Want meals that only apply on training or rest days? <span class="link" data-go="week-pattern">Set your training week</span> first.</div>`}
        ${KNOB.meals >= 4 ? swRow('Snack is optional', 'Loggable for bonus, but never counts against the score', 'snack', KNOB.snackOptional) : ''}
      </section>

      <section class="std-mod">
        ${modHead('clock', 'std-ic-b', 'Timing &amp; late credit', 'How grace and lateness change a meal’s score')}
        <div class="std-lbl">Grace window</div>
        <div class="std-chips">${[0, 15, 30, 60].map(n => chip((KNOB.grace || 0) === n, n === 0 ? 'None' : `${n} min`, 'grace', n)).join('')}</div>
        <div class="std-lbl mt">Late meals earn</div>
        <div class="std-seg accent">
          ${['half', 'full', 'none'].map(p => `<button class="${(KNOB.latePolicy || 'half') === p ? 'on' : ''}" data-knob="late:${p}">${p === 'half' ? 'Half' : p === 'full' ? 'Full' : 'None'}</button>`).join('')}
        </div>
        <div class="std-help">A meal logged within grace counts on time. Past it, the late policy sets the credit.</div>
      </section>

      <section class="std-mod">
        ${modHead('bolt', 'std-ic-a', 'Training &amp; body', 'Lifting cadence and weigh-in schedule')}
        <div class="std-lbl">Lift sessions / week</div>
        <div class="std-chips">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => chip(KNOB.lifts === n, n === 0 ? 'Off' : String(n), 'lifts', n)).join('')}</div>
        ${KNOB.lifts > 0 ? `
        <div class="std-lbl mt">Session name <span style="color:var(--text-3);font-weight:600">· optional</span></div>
        <input class="ob-input lift-title" maxlength="80" placeholder="e.g. Lower Body A" value="${esc(KNOB.liftTitle || '')}" />
        <div class="std-lbl mt">What to do <span style="color:var(--text-3);font-weight:600">· optional</span></div>
        <textarea class="ob-input lift-desc" maxlength="400" rows="2" style="min-height:56px;resize:vertical" placeholder="Squat 3×5, RDL 3×8, lunges, core">${esc(KNOB.liftDesc || '')}</textarea>
        <div class="std-help">Your athletes see this on their training day and log a quick note against it. Tracked, not scored.</div>` : ''}
        <div class="std-lbl mt">Weigh-ins · season trend, tracked not scored</div>
        <div class="std-chips">${chip(KNOB.weigh === 'off', 'Off', 'weigh', 'off')}${chip(KNOB.weigh === 'daily', 'Daily', 'weigh', 'daily')}${chip(KNOB.weigh === 'custom', 'Specific days', 'weigh', 'custom')}</div>
        ${KNOB.weigh === 'custom' ? `<div class="std-weighdays">${[0, 1, 2, 3, 4, 5, 6].map(d => `<span class="std-daychip ${(KNOB.weighDays || []).includes(d) ? 'on' : ''}" data-weighday="${d}" role="button" aria-label="${DOW_SHORT[d]}${(KNOB.weighDays || []).includes(d) ? ' selected' : ''}">${DOW_1[d]}</span>`).join('')}</div>
        <div class="std-help">${(KNOB.weighDays || []).length ? esc(weighLabel(KNOB.weighDays)) : 'Pick at least one day, or switch to Off.'}</div>` : ''}
      </section>

      <section class="std-mod">
        ${modHead('moon', 'std-ic-p', 'Recovery &amp; check-ins', 'Scored pillars and your review preference')}
        ${swRow('Recovery check-in', 'Nightly · 25% of the score', 'recovery', KNOB.recovery)}
        ${swRow('Weekly check-in', 'Sundays · 10% of the score', 'checkin', KNOB.checkin)}
        ${swRow('Coach review on meals', 'Flag each logged meal for your review', 'review', KNOB.coachReview)}
      </section>

      <section class="std-mod">
        ${modHead('droplet', 'std-ic-c', 'Hydration', 'A visible daily focus — tracked, not scored', KNOB.hydration ? `${KNOB.hydrationOz} oz` : 'Off')}
        <div class="std-switch-row" style="padding-top:0">
          <div class="std-sw-m"><div class="std-sw-t">Hydration focus</div><div class="std-sw-s">Shown on Home — tracked, not scored</div></div>
          ${sw(KNOB.hydration, 'hydration')}
        </div>
        ${KNOB.hydration ? `<div class="std-lbl mt">Daily target</div><div class="std-chips">${[80, 100, 120, 150].map(n => chip(KNOB.hydrationOz === n, `${n} oz`, 'hydoz', n)).join('')}</div>` : ''}
      </section>

      ${CD.caps.templates ? `
      <section class="std-mod">
        ${modHead('clipboard', 'std-ic-b', 'Templates', 'Start from a proven draft, or save this one')}
        ${SHOW_TPL_MANAGE ? `
        <div class="std-tpl-manage">
          ${(TPL && TPL.rows ? TPL.rows : []).map(t => TPL_RENAMING === t.id ? `
          <div class="lrow" style="cursor:default;gap:8px;padding-left:0">
            <input class="std-name tpl-rename-input" data-tpl-rename-input="${esc(t.id)}" maxlength="40" value="${esc(t.name)}" style="flex:1" ${TPL_BUSY ? 'disabled' : ''} />
            <button class="btn sm" data-tpl-rename-save="${esc(t.id)}" style="width:auto;padding:0 12px;height:34px" ${TPL_BUSY ? 'disabled' : ''}>Save</button>
            <button class="btn ghost sm" data-tpl-rename-cancel="1" style="width:auto;padding:0 12px;height:34px" ${TPL_BUSY ? 'disabled' : ''}>Cancel</button>
          </div>` : `
          <div class="lrow" style="cursor:default;padding-left:0">
            <div class="lm"><div class="lt">${esc(t.name)}</div><div class="ls">${esc(templateLabel(t.kind))}</div></div>
            <button class="btn ghost sm" data-tpl-rename="${esc(t.id)}" aria-label="Rename template" style="width:34px;padding:0;height:30px;flex:none" ${TPL_BUSY ? 'disabled' : ''}>${icon('edit', 15)}</button>
            <button class="btn ghost sm" data-tpl-del="${esc(t.id)}" style="width:auto;padding:0 10px;height:30px;color:var(--red);margin-left:6px" ${TPL_BUSY ? 'disabled' : ''}>Delete</button>
          </div>`).join('') || `<div class="ls" style="padding:6px 2px">No templates saved yet.</div>`}
        </div>
        <button class="btn ghost sm" data-knob="tplmanage:1" style="width:auto;padding:0 14px;margin-top:10px">Done managing</button>
        ` : `
        <div class="std-chips">
          ${(TPL && TPL.rows ? TPL.rows : []).map(t => `<span class="std-chip" data-knob="tpl:${esc(t.id)}" title="${esc(templateLabel(t.kind))}">${esc(t.name)}</span>`).join('')}
          <span class="std-chip dashed" data-knob="tplsave:1">${icon('plus', 14)} Save current</span>
        </div>
        ${SHOW_TPL_SAVE ? `
        <div style="display:flex;gap:8px;margin-top:12px">
          <input class="std-name" id="tpl-name" maxlength="40" placeholder="Template name" style="flex:1" />
          <button class="btn green sm" id="tpl-save-btn" style="width:auto;padding:0 16px">Save</button>
        </div>` : ''}
        ${(TPL && TPL.rows && TPL.rows.length) ? `<button class="btn ghost sm" data-knob="tplmanage:1" style="width:auto;padding:0 14px;margin-top:10px">Manage templates</button>` : ''}
        `}
      </section>` : ''}

      ${(() => {
        // Complete preview (Tier 2): every pillar the athlete gets, not just meals — built from
        // the SAME itemsFromKnobs()/stdFromItems() the Save button publishes (via previewFromKnobs),
        // so it's true parity, never a parallel description.
        const preview = previewFromKnobs(KNOB);
        if (!preview) return '';
        const { std, items } = preview;
        const KIND_IC = { lift: 'bolt', weigh: 'scale', recovery: 'moon', checkin: 'clipboard', hydration: 'droplet' };
        const scheduleLabel = (freq) => {
          if (!freq) return '';
          if (freq.type === 'daily') return 'Every day';
          if (freq.type === 'weekly') return freq.label || 'Weekly';
          if (freq.type === 'days') return freq.label || (Array.isArray(freq.days) ? weighLabel(freq.days) : '');
          return '';
        };
        const mealItems = items.filter(it => it.kind === 'meal');
        const mealRows = std.slots.map((slot, i) => {
          const it = mealItems[i] || {};
          const title = std.titles[slot] || cap(String(slot).replace('-', ' '));
          const due = std.deadlines[slot];
          const g = std.grace && std.grace[slot];
          const bits = [due != null ? `Due by ${fmtMin(due)}` : 'No deadline set'];
          if (g) bits.push(`${g} min grace`);
          bits.push(it.proof === 'check' ? 'Tap to check' : 'Photo');
          if (it.dayType === 'training') bits.push('Training days');
          else if (it.dayType === 'rest') bits.push('Rest days');
          if ((std.optional || []).includes(slot)) bits.push('Optional');
          return `
          <div class="std-prev-row">
            <div class="std-prev-ic">${icon(PREV_IC[slot] || 'utensils', 15)}</div>
            <div style="flex:1;min-width:0"><div class="std-prev-t">${esc(title)}</div>
            <div class="std-prev-s">${esc(bits.join(' · '))}</div></div>
          </div>`;
        }).join('');
        const otherRows = items.filter(it => it.kind !== 'meal').map(it => {
          const scored = it.kind === 'recovery' || it.kind === 'checkin';
          const sub = [scheduleLabel(it.freq), scored ? 'Scored pillar' : 'Tracked, not scored'].filter(Boolean).join(' · ');
          return `
          <div class="std-prev-row">
            <div class="std-prev-ic">${icon(KIND_IC[it.kind] || 'clipboard', 15)}</div>
            <div style="flex:1;min-width:0"><div class="std-prev-t">${esc(it.title)}</div>
            <div class="std-prev-s">${esc(sub)}</div></div>
          </div>`;
        }).join('');
        return `
        <section class="std-preview">
          <div class="std-prev-h">${icon('eye', 13)} What the athlete sees</div>
          ${mealRows}${otherRows}
          <div class="std-prev-foot"><b>${std.mealsRequired}</b> meal${std.mealsRequired === 1 ? '' : 's'} make the day’s nutrition score.</div>
        </section>`;
      })()}

      <section class="std-mod">
        ${modHead('arrowRight', 'std-ic-b', 'Effective from', 'Applies going forward — today never changes')}
        <div class="std-seg" id="set-effective">
          <button class="${existing ? '' : 'on'}" data-eff="today">Today</button>
          <button class="${existing ? 'on' : ''}" data-eff="tomorrow">Tomorrow</button>
          <button data-eff="date">Pick a date</button>
        </div>
        <input type="date" id="set-eff-date" class="std-time" style="display:none;margin-top:8px;width:auto" min="${(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()}" aria-label="Effective date" />
        <div class="std-help">Today applies it now. Tomorrow keeps today unchanged. Or pick a future date. Past, already-scored days are never rewritten.</div>
      </section>

      <div class="std-save">
        <button class="btn primary" id="set-save">${icon('check', 19)} Save the ${kind === 'team' ? 'team standard' : `${esc(value)} room standard`}</button>
        ${kind !== 'team' && existing ? `<div style="height:9px"></div><button class="btn ghost" id="set-clear">Use the team standard instead</button>` : ''}
        <div class="std-status" id="set-status"></div>
      </div>
    </div>
    `;
  },
  mount(root, { sub }) {
    loadBook(false, bookKindFor(RT.authRole)).then(() => { loadSets(); loadTemplates(); });
    // Split on the FIRST slash only — a room label can legitimately contain "/" ("DB/S", "WR/TE")
    // and a naive split truncated the scope value to "DB", silently scoping the standard elsewhere.
    const [kind, ...restVal] = (sub || 'team').split('/');
    const rawVal = restVal.length ? restVal.join('/') : undefined;
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const say = (msg, isErr) => {
      const el = root.querySelector('#set-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    const fromHM = s => { const [h, mm] = String(s || '').split(':').map(Number); return (Number.isFinite(h) && Number.isFinite(mm)) ? h * 60 + mm : null; };
    // Text/time inputs write straight into KNOB — NEVER window.__render() here, or a
    // full re-render mid-keystroke steals focus (the Slice A roster-search lesson).
    const materializeMeals = () => {
      const need = (arr) => !Array.isArray(arr) || arr.length !== KNOB.meals;
      if (need(KNOB.mealNames) || need(KNOB.mealWins) || need(KNOB.mealProofs) || need(KNOB.mealDayTypes)) {
        const { names, wins, proofs, dayTypes } = resolveMeals(KNOB); // reads existing per-meal values element-wise
        KNOB.mealNames = [...names]; KNOB.mealWins = wins.map(w => ({ ...w }));
        KNOB.mealProofs = [...proofs]; KNOB.mealDayTypes = [...dayTypes];
      }
    };
    root.querySelectorAll('.mname').forEach(el => el.addEventListener('change', () => {
      materializeMeals();
      KNOB.mealNames[+el.getAttribute('data-meal')] = el.value;
    }));
    // Coach-programmed session name + description (0135). `change` (blur), not `input` — a chip
    // re-render never steals in-progress typing (the blur fires its change first).
    root.querySelectorAll('.lift-title').forEach(el => el.addEventListener('change', () => { KNOB.liftTitle = el.value; }));
    root.querySelectorAll('.lift-desc').forEach(el => el.addEventListener('change', () => { KNOB.liftDesc = el.value; }));
    root.querySelectorAll('.mwin').forEach(el => el.addEventListener('change', () => {
      materializeMeals();
      const i = +el.getAttribute('data-meal');
      const edge = el.getAttribute('data-edge');
      const mins = fromHM(el.value);
      if (edge === 'open') { if (mins == null) delete KNOB.mealWins[i].open; else KNOB.mealWins[i].open = mins; }
      else { KNOB.mealWins[i].due = mins; }
    }));
    // Per-meal proof pill: flip THIS meal photo<->check, then repaint (a button, not a text input,
    // so a re-render steals no in-progress typing — a name edit blurs first and its change fires).
    root.querySelectorAll('[data-mealproof]').forEach(el => el.addEventListener('click', () => {
      materializeMeals();
      const i = +el.getAttribute('data-mealproof');
      KNOB.mealProofs[i] = KNOB.mealProofs[i] === 'check' ? 'photo' : 'check';
      KNOB.photoProof = KNOB.mealProofs.every(p => p === 'photo');
      window.__render();
    }));
    // Per-meal training/rest tag (only rendered when a rest week exists).
    root.querySelectorAll('[data-mealday]').forEach(el => el.addEventListener('click', () => {
      materializeMeals();
      const [i, dt] = el.getAttribute('data-mealday').split(':');
      KNOB.mealDayTypes[+i] = (dt === 'training' || dt === 'rest') ? dt : 'any';
      window.__render();
    }));
    // Weigh-in weekday toggle (custom cadence): flip the day in/out of the set.
    root.querySelectorAll('[data-weighday]').forEach(el => el.addEventListener('click', () => {
      const d = +el.getAttribute('data-weighday');
      const set = new Set(Array.isArray(KNOB.weighDays) ? KNOB.weighDays : []);
      if (set.has(d)) set.delete(d); else set.add(d);
      KNOB.weighDays = [...set].sort((a, b) => a - b);
      window.__render();
    }));
    root.querySelectorAll('[data-knob]').forEach(el => el.addEventListener('click', () => {
      const [k, arg] = el.getAttribute('data-knob').split(':');
      if (k === 'meals') { KNOB.meals = +arg; delete KNOB.mealNames; delete KNOB.mealWins; delete KNOB.mealProofs; delete KNOB.mealDayTypes; }
      if (k === 'lifts') KNOB.lifts = +arg;
      // Weigh: off / daily / custom. Entering custom seeds days from the current selection (or M/W/F).
      if (k === 'weigh') { KNOB.weigh = arg; if (arg === 'custom' && !(Array.isArray(KNOB.weighDays) && KNOB.weighDays.length)) KNOB.weighDays = [1, 3, 5]; }
      // Switch rows emit ":toggle" (flip); the legacy ":1"/":0" path is kept for safety.
      const tog = (v) => (arg === 'toggle' ? !v : arg === '1');
      if (k === 'recovery') KNOB.recovery = tog(KNOB.recovery);
      if (k === 'checkin') KNOB.checkin = tog(KNOB.checkin);
      if (k === 'hydration') KNOB.hydration = tog(KNOB.hydration);
      // Master photo switch: set EVERY meal at once (per-meal pills override individually after).
      if (k === 'photo') { materializeMeals(); const allPhoto = KNOB.mealProofs.every(p => p === 'photo'); const nextP = allPhoto ? 'check' : 'photo'; KNOB.mealProofs = KNOB.mealProofs.map(() => nextP); KNOB.photoProof = nextP === 'photo'; }
      if (k === 'review') KNOB.coachReview = tog(KNOB.coachReview);
      if (k === 'snack') KNOB.snackOptional = tog(KNOB.snackOptional);
      if (k === 'hydoz') KNOB.hydrationOz = +arg;
      if (k === 'grace') KNOB.grace = +arg;
      if (k === 'late') KNOB.latePolicy = arg;
      // Applying a template only fills the knobs — it never writes the DB directly. The
      // coach still reviews the preview card and hits the existing Save to publish.
      if (k === 'tpl') {
        const tpl = TPL && TPL.rows && TPL.rows.find(t => String(t.id) === arg);
        if (tpl) KNOB = { key: KNOB.key, ...knobsFromItems(tpl.items) };
      }
      if (k === 'tplsave') SHOW_TPL_SAVE = !SHOW_TPL_SAVE;
      if (k === 'tplmanage') { SHOW_TPL_MANAGE = !SHOW_TPL_MANAGE; TPL_RENAMING = null; }
      window.__render();
    }));
    root.querySelectorAll('[data-tpl-rename]').forEach(el => el.addEventListener('click', () => {
      TPL_RENAMING = el.getAttribute('data-tpl-rename'); window.__render();
    }));
    root.querySelectorAll('[data-tpl-rename-cancel]').forEach(el => el.addEventListener('click', () => { TPL_RENAMING = null; window.__render(); }));
    const submitTplRename = async (id) => {
      const input = root.querySelector(`[data-tpl-rename-input="${id}"]`);
      const clean = ((input && input.value) || '').trim().slice(0, 40);
      if (!clean || TPL_BUSY) { TPL_RENAMING = null; window.__render(); return; }
      TPL_BUSY = true; window.__render();
      const r = await roles.renameRequirementTemplate(id, clean);
      TPL_BUSY = false; TPL_RENAMING = null;
      if (r.ok) await loadTemplates(true); else { say(r.error || 'Could not rename it.', true); window.__render(); }
    };
    root.querySelectorAll('[data-tpl-rename-save]').forEach(el => el.addEventListener('click', () => submitTplRename(el.getAttribute('data-tpl-rename-save'))));
    root.querySelectorAll('[data-tpl-rename-input]').forEach(el => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitTplRename(el.getAttribute('data-tpl-rename-input'));
      else if (e.key === 'Escape') { TPL_RENAMING = null; window.__render(); }
    }));
    root.querySelectorAll('[data-tpl-del]').forEach(el => el.addEventListener('click', async () => {
      if (TPL_BUSY) return;
      const id = el.getAttribute('data-tpl-del');
      TPL_BUSY = true; window.__render();
      const r = await roles.deleteRequirementTemplate(id);
      TPL_BUSY = false;
      if (r.ok) await loadTemplates(true); else { say('Could not delete it.', true); window.__render(); }
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
    // Effective-from toggle: a plain local switch (no re-render — a full render mid-edit would
    // reset the knobs/steal focus). The save handler reads the active choice.
    root.querySelectorAll('#set-effective button').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('#set-effective button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      const dateInput = root.querySelector('#set-eff-date');
      if (dateInput) dateInput.style.display = b.getAttribute('data-eff') === 'date' ? '' : 'none';
    }));
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
      // Prospective effective date (0085): a version dated tomorrow leaves today's scoring
      // untouched; "Today" applies it now. Never null from the editor — null is the creation seed.
      const isoOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      const effBtn = root.querySelector('#set-effective .on');
      const effKind = effBtn ? effBtn.getAttribute('data-eff') : 'tomorrow';
      let effDate;
      if (effKind === 'today') effDate = isoOffset(0);
      else if (effKind === 'date') {
        const dv = ((root.querySelector('#set-eff-date') || {}).value || '').trim();
        if (!dv || dv < isoOffset(0)) { say('Pick a date from today onward.', true); return; }
        effDate = dv;
      } else effDate = isoOffset(1);
      save.disabled = true; say('Saving…');
      const r = await roles.setTeamRequirements(teamId, kind, value, itemsFromKnobs(KNOB), effDate, CD.kind);
      save.disabled = false;
      if (!r.ok) { say(r.error || 'Could not save — try again.', true); return; }
      act.markCoachSetup('standard'); // real "reviewed your standard" signal for the setup checklist
      say(effDate === isoOffset(0) ? 'Saved. This is the standard now.'
        : effDate === isoOffset(1) ? 'Saved. It takes effect tomorrow — today is unchanged.'
        : `Saved. It takes effect ${effDate} — earlier days are unchanged.`);
      await loadSets(true);
    });
    const clear = root.querySelector('#set-clear');
    if (clear) clear.addEventListener('click', async () => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) return;
      clear.disabled = true; say('Resetting…');
      const r = await roles.clearTeamRequirements(teamId, kind, value, CD.kind);
      clear.disabled = false;
      if (!r.ok) { say(r.error || 'Could not reset — try again.', true); return; }
      KNOB = null;
      await loadSets(true);
      location.hash = '#coach-plan';
    });
  },
};

/* ---------- Inbox v2 (Slice D): six real categories over real thread state ----------
   Replaces the Copilot TAB (the copilot screen stays routable for deep links).
   Briefing = deterministic reads over the real roster — never narrated fiction.
   categorizeInbox (js/inbox.js) sorts/buckets the real data into Needs response · Athletes ·
   Meal reviews · Staff · Announcements · Resolved; this screen only fetches, escapes, and
   wires the chip switcher + the existing join-request approve/decline. */

/* Recent-announcements cache for the Inbox (Slice C, 0074). Its own fetch, not shared with
   coach-announce.js's history — that screen may not have mounted yet, and this block only
   ever needs the newest 3. Honest empty state: the category says so, never an empty card
   pretending there's more. */
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

/* Inbox v2 data cache: team meal-comment threads + recent coach interventions (who spoke
   last / what's resolved) + the staff roster, feeding categorizeInbox's needsResponse/
   mealReviews/resolved/staff categories. Same cache-per-team-id + in-flight guard idiom as
   ANN_CACHE/loadAnnouncements above — one fetch per team, repainted via window.__render,
   never refetched on every chip switch. */
let INBOX_DATA = null; // { teamId, comments, interventions, staff }
let inboxLoadingId = null;
async function loadInboxData(teamId, athleteIds, force) {
  if (!teamId) return;
  if (INBOX_DATA && INBOX_DATA.teamId === teamId && !force) return;
  if (inboxLoadingId === teamId) return;
  inboxLoadingId = teamId;
  // A screen may read the real clock (inbox.js's pure functions never do — they always take
  // nowMs/sinceISO from the caller). 7 days is enough runway for a thread to still be "recent".
  const sinceISO = new Date(Date.now() - 7 * 864e5).toISOString();
  try {
    // Meal threads are athlete-scoped (can_view) and work on either book — that's the inbox's
    // core value. Interventions and staff are team-owned tables; a practice book skips them
    // rather than issuing queries that RLS will answer with nothing. Real for practices at 0136.
    const [comments, interventions, staff, staffInvites] = await Promise.all([
      roles.fetchTeamMealComments(athleteIds, sinceISO),
      CD.caps.interventions ? roles.fetchRecentInterventions(teamId, sinceISO) : [],
      CD.caps.staffRoles ? roles.fetchTeamStaff(teamId) : [],
      CD.caps.staffRoles ? roles.fetchOpenStaffInvites(teamId) : [],
    ]);
    INBOX_DATA = { teamId, comments, interventions, staff, staffInvites };
  } finally { inboxLoadingId = null; }
  if (location.hash === '#coach-inbox') window.__render();
}

/* Category switcher state — which of the six buckets is showing. Persisted so a coach who
   was reading "Meal reviews" doesn't get bounced back to "Needs response" on reopen. */
const INBOX_CAT_KEY = 'onstd-inbox-cat-v1';
const ALL_INBOX_CATEGORIES = [
  ['needsResponse', 'Needs response'],
  ['athletes', 'Athletes'],
  ['mealReviews', 'Meal reviews'],
  ['staff', 'Staff'],
  ['announcements', 'Announcements'],
  ['resolved', 'Resolved'],
];
// Staff and Announcements are team-owned (0136/0137 give a practice its own). Their empty-state
// actions route to coach-only screens (coach-profile/staff, coach-announce) — a trainer must
// never be a tap away from a category that's always empty AND dead-ends.
const inboxCategories = () => ALL_INBOX_CATEGORIES.filter(([key]) =>
  (key !== 'staff' || CD.caps.staffRoles) && (key !== 'announcements' || CD.caps.announcements));
let INBOX_CAT = 'needsResponse';
try {
  const savedCat = localStorage.getItem(INBOX_CAT_KEY);
  if (savedCat && ALL_INBOX_CATEGORIES.some(([key]) => key === savedCat)) INBOX_CAT = savedCat;
} catch { /* default stands */ }

/* categorizeInbox's staff param wants {id, name, email?, role, created_at?} — team_staff_list
   (0061) returns {staff_id, role, status, name}. Mapped here rather than reshaping either the
   RPC or the pure categorizer for one caller's field names. */
function staffRowsFor(rawStaff) {
  return (rawStaff || []).map(s => ({ id: s.staff_id, name: s.name, role: s.role }));
}

/* One categorizeInbox call + the inboxAlerts merge, built from whatever's loaded so far — any
   still-loading input degrades to [] inside categorizeInbox, never throws mid-render. The
   entriesFor(team) scope (not the coach's currently-viewed roster scope) is deliberate: Inbox
   alerts are about the whole roster's overdue requirements, regardless of which position room
   the coach happens to be filtered to elsewhere (coach-roster/coach-home). */
function inboxOut() {
  const roster = CD.roster;
  const teamId = roster && roster.teams && roster.teams[0] && roster.teams[0].id;
  const data = INBOX_DATA && INBOX_DATA.teamId === teamId ? INBOX_DATA : null;
  const annRows = ANN_CACHE && ANN_CACHE.teamId === teamId ? ANN_CACHE.rows : [];
  const nowMs = Date.now();
  const out = categorizeInbox({
    meals: CD.act && CD.act.rows ? CD.act.rows : [],
    comments: data ? data.comments : [],
    interventions: data ? data.interventions : [],
    roster: roster ? roster.rows : [],
    pending: roster ? (roster.pending || []) : [],
    staff: staffRowsFor(data ? data.staff : []),
    staffInvites: data ? data.staffInvites : [],
    announcements: annRows,
    seenIds: RT.coachSeenMealIds || [],
    nowMs,
  });
  const entries = entriesFor({ kind: 'team', value: null });
  const alerts = inboxAlerts(entries, nowMs);
  const needsResponse = [...out.needsResponse, ...alerts].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { ...out, needsResponse, counts: { ...out.counts, needsResponse: needsResponse.length } };
}

/* One categorized row → one .lrow, escaped. Meal rows deep-link the thread; announcements open
   the composer; staff/alert rows are honest non-clickable summaries in this first cut. Join
   rows are rendered separately (joinRow below) — the categorized 'join' row loses the
   teamId/athleteId the approve/decline buttons need, so those render straight off the raw
   pending list instead, verbatim from the pre-Slice-D markup. */
function inboxRow(r) {
  if (r.kind === 'meal') {
    return `
    <div class="lrow" data-go="coach-meal/${esc(r.id)}">
      <div class="lic">${icon('utensils', 17)}</div>
      <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc(r.sub || '')}</div></div>
      ${icon('chevron', 17, 'style="color:var(--text-3)"')}
    </div>`;
  }
  if (r.kind === 'announcement') {
    return `
    <div class="lrow" data-go="coach-announce" style="cursor:pointer">
      <div class="lic">${icon('share', 17)}</div>
      <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc(r.sub || '')}</div></div>
    </div>`;
  }
  if (r.kind === 'staff') {
    // Active staff = plain summary; a pending invite carries r.go='coach-profile' → tap to
    // re-share or revoke the code.
    const clickable = !!r.go;
    return `
    <div class="lrow"${clickable ? ` data-go="${esc(r.go)}" style="cursor:pointer"` : ' style="cursor:default"'}>
      <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
      <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc(r.sub || '')}</div></div>
      ${clickable ? icon('chevron', 17, 'style="color:var(--text-3)"') : ''}
    </div>`;
  }
  if (r.kind === 'alert') {
    return `
    <div class="lrow" style="cursor:default">
      <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('bell', 17)}</div>
      <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc(r.sub || '')}</div></div>
    </div>`;
  }
  // resolved meals land here too (kind 'meal') via the branch above; anything unrecognized
  // still renders as an honest, non-clickable summary rather than silently disappearing.
  return `
    <div class="lrow" style="cursor:default">
      <div class="lic">${icon('checkCircle', 17)}</div>
      <div class="lm"><div class="lt">${esc(r.title)}</div><div class="ls">${esc(r.sub || '')}</div></div>
    </div>`;
}
function joinRow(q) {
  return `
    <div class="lrow" style="cursor:default">
      <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
      <div class="lm"><div class="lt">${esc(q.athlete_name || 'Athlete')}${q.position ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(q.position)}</small>` : ''}</div><div class="ls">Wants to join</div></div>
      <button class="btn ghost sm" data-jr="decline" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
      <button class="btn green sm" data-jr="approve" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
    </div>`;
}
const INBOX_EMPTY = {
  needsResponse: 'No threads need you right now.',
  athletes: 'No athlete meal threads yet — logs land here as they come in.',
  mealReviews: "Nothing unopened — you've seen every log so far.",
  staff: 'No other staff on your team yet.',
  announcements: 'No announcements yet — send your first from here.',
  resolved: 'Nothing marked resolved yet.',
};
/* Audit G-1: the categories whose empty state is a real next action, not just a status line —
   so an empty Athletes/Staff/Announcements tab offers a direct route instead of a dead pointer. */
const INBOX_EMPTY_ACTION = {
  athletes: { label: 'Share athlete code', go: 'coach-profile/code' },
  staff: { label: 'Invite staff', go: 'coach-profile/staff' },
  announcements: { label: 'New announcement', go: 'coach-announce' },
};

export const coachInbox = {
  nav: 'operator', tab: 'inbox',
  badge() {
    if (!CD.roster || CD.roster.offline) return 0;
    return inboxOut().counts.needsResponse;
  },
  render() {
    const rows = CD.roster ? CD.roster.rows : null;
    const pending = CD.roster ? (CD.roster.pending || []) : [];

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

    // Honest offline state: one clear message, not a segmented control full of zero-count
    // categories over data we can't actually see.
    if (CD.roster && CD.roster.offline) {
      return `
      ${titleHead('Inbox', "Can't reach your roster")}
      <div class="eyebrow">Daily briefing · from your real roster</div>
      <section class="card pad" style="background:linear-gradient(180deg, rgba(168,85,247,0.10), rgba(168,85,247,0.03));border-color:rgba(168,85,247,0.26)">
        <div style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:10px">${icon('sparkle', 13)} Today's read</div>
        <div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55">${briefing}</div>
      </section>
      <div style="height:10px"></div>`;
    }

    // A device that visited a coach's Staff/Announcements category (or a stale pre-Slice-B
    // value) persists INBOX_CAT_KEY across role switches on the same device — the same class of
    // cross-role bleed the roster scope key had (Slice A). Coerce to a category this book
    // actually offers rather than showing a permanently-empty bucket with a dead-end tap.
    if (!inboxCategories().some(([key]) => key === INBOX_CAT)) INBOX_CAT = 'needsResponse';
    const out = inboxOut();
    const needsMe = out.counts.needsResponse;
    const isNeedsResponse = INBOX_CAT === 'needsResponse';
    const showAddAnnouncement = INBOX_CAT === 'announcements';
    const catRows = out[INBOX_CAT] || [];
    // Join rows aren't renderable from categorizeInbox's own needsResponse output (they've lost
    // teamId/athleteId by the time they're categorized) — rendered from the raw pending list
    // instead (below), so drop the categorized 'join' rows here to avoid showing them twice.
    const genericRows = isNeedsResponse ? catRows.filter(r => r.kind !== 'join') : catRows;

    return `
    ${titleHead('Inbox', needsMe ? `${needsMe} need${needsMe === 1 ? 's' : ''} you` : 'All caught up')}

    ${isNeedsResponse ? `
    <div class="eyebrow">Daily briefing · from your real roster</div>
    <section class="card pad" ${rows && !rows.length ? 'data-go="coach-profile" style="cursor:pointer;' : 'style="'}background:linear-gradient(180deg, rgba(168,85,247,0.10), rgba(168,85,247,0.03));border-color:rgba(168,85,247,0.26)">
      <div style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:10px">${icon('sparkle', 13)} Today's read</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55">${briefing}</div>
      ${rows && !rows.length && RT.team && RT.team.code ? `<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.team.code)}</span><button class="btn green sm" style="width:auto;padding:0 14px">Share code</button></div>` : ''}
    </section>` : ''}

    <div class="co-seg co-scroll" id="inbox-cat-row">
      ${inboxCategories().map(([key, label]) => `<button class="co-chip ${INBOX_CAT === key ? 'on' : ''}" data-icat="${key}">${esc(label)} <span class="cnt">${out.counts[key]}</span></button>`).join('')}
    </div>

    ${isNeedsResponse && pending.length ? `
    <div class="eyebrow">Join requests · ${pending.length}</div>
    <section class="card" style="padding:6px 16px">
      ${pending.map(joinRow).join('')}
    </section>` : ''}

    ${(genericRows.length || showAddAnnouncement) ? `
    <section class="card" style="padding:6px 16px">
      ${genericRows.map(inboxRow).join('')}
      ${showAddAnnouncement ? `
      <div class="lrow" data-go="coach-announce" style="cursor:pointer">
        <div class="lic">${icon('plus', 17)}</div>
        <div class="lm"><div class="lt">New announcement</div></div>
      </div>` : ''}
    </section>` : (isNeedsResponse && pending.length ? '' : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.5">${esc(INBOX_EMPTY[INBOX_CAT])}</div>${INBOX_EMPTY_ACTION[INBOX_CAT] ? `<div style="margin-top:12px"><button class="btn ghost sm" data-go="${esc(INBOX_EMPTY_ACTION[INBOX_CAT].go)}" style="width:auto;padding:0 16px">${esc(INBOX_EMPTY_ACTION[INBOX_CAT].label)}</button></div>` : ''}`)}

    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadBook(false, bookKindFor(RT.authRole)).then(() => {
      loadActivity();
      const bookId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
      if (bookId) {
        // Announcements and coach_interventions are team-owned until 0136 — a practice book
        // skips them rather than reading nothing and calling it an empty inbox.
        if (CD.caps.announcements) loadAnnouncements(bookId);
        const athleteIds = (CD.roster.rows || []).map(r => r.athleteId).filter(Boolean);
        loadInboxData(bookId, athleteIds);
      }
    });
    root.querySelectorAll('[data-jr]').forEach(b => b.addEventListener('click', async () => {
      const bookId = b.getAttribute('data-team'), ath = b.getAttribute('data-ath');
      const approve = b.getAttribute('data-jr') === 'approve';
      const practice = CD.kind === 'practice';
      b.disabled = true; b.textContent = '…';
      if (approve) await (practice ? roles.approveClient(bookId, ath) : roles.approveMember(bookId, ath));
      else await (practice ? roles.declineClient(bookId, ath) : roles.declineMember(bookId, ath));
      await loadBook(true, bookKindFor(RT.authRole));
    }));
    root.querySelectorAll('[data-icat]').forEach(el => el.addEventListener('click', () => {
      INBOX_CAT = el.getAttribute('data-icat');
      try { localStorage.setItem(INBOX_CAT_KEY, INBOX_CAT); } catch { /* in-memory only */ }
      window.__render();
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
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach-home')}${errorState({ title: "Can't reach your roster", body: "Copilot reads only real team data — no numbers are invented while it's down. Reconnect and its reads fill in right here.", retryId: 'copilot-retry' })}`;
    }
    if (rows === null) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach-home')}${skeletonRows(3, 'Loading the roster')}`;
    }
    if (rows.length === 0) {
      // Audit G-1: an actionable empty, not the dead-pointer "Share your team code to get started".
      return `${backHead('Copilot', 'Deterministic reads over your real roster', 'coach-home')}${emptyState({ icon: 'users', title: 'No athletes yet', body: 'Copilot reads your real roster — share your athlete code and its reads fill in as your team logs.', action: { label: 'Share athlete code', go: 'coach-profile/code' } })}`;
    }
    const attention = rows.filter(r => r.flag === 'r');
    const belowBar = rows.filter(r => r.score != null && r.score < 80);
    const notLogged = rows.filter(r => !r.loggedToday);
    const summary = rows.length === 0
      ? 'No athletes on your roster yet. Share your team code to get started.'
      : `${rows.length} athlete${rows.length > 1 ? 's' : ''} on your roster. `
        + (attention.length ? `${attention.length} need attention (no logs or off standard). ` : belowBar.length ? `${belowBar.length} logged below the standard today. ` : 'Everyone who logged is on standard. ')
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
  mount(root) {
    loadBook(false, bookKindFor(RT.authRole));
    const cRetry = root && root.querySelector('#copilot-retry');
    if (cRetry) cRetry.addEventListener('click', () => { cRetry.disabled = true; loadBook(true, bookKindFor(RT.authRole)).then(() => window.__render()); });
  },
};

/* ---------- Coach → athlete review: real day + meals, RLS-scoped; a "seen" receipt on open ---------- */
function rosterName(athleteId) {
  const r = CD.roster && CD.roster.rows.find(x => x.athleteId === athleteId);
  return r ? { name: r.name, unit: r.unit } : { name: 'Athlete', unit: '' };
}
const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];

/* ---------- Coach → athlete profile: six-section shell (Task 5 shipped Overview + Today, Task 6
   adds Activity + Conversation; Requirements/Notes land in Task 7). PSECTION is the active chip;
   PSEC_FOR tracks which athlete it belongs to so opening a DIFFERENT athlete always starts back
   on Overview instead of leaving a stale section showing. Loads ONLY loadAthleteProfile — the
   legacy ATH/loadAthlete double-fetch (the trainer's separate "note to a client" screen that used
   to keep it warm) is gone; coachMeal resolves its own meal standalone via roles.fetchMeal. ---------- */
let PSECTION = 'overview';
let PSEC_FOR = null;
// Day-view receipt de-dupe: markDayViewed only needs to fire once per athlete open, not on every
// chip switch (mount() re-runs on every window.__render()). Track which athlete we've already
// recorded a receipt for; reset naturally happens by comparing against the new athleteId.
let VIEWED_FOR = null;
/* Each section names the book capability it needs (null = works on any book). Requirements and
   Notes read team-owned tables, so on a practice book they'd render permanently empty and the
   Notes composer would fail every save — better to not offer the chip at all until 0136. */
const ALL_PROFILE_SECTIONS = [
  ['overview', 'Overview', null], ['today', 'Today', null], ['score', 'Score', null],
  ['activity', 'Activity', null], ['conversation', 'Conversation', null],
  ['requirements', 'Requirements', 'standards'], ['notes', 'Notes', 'notes'],
];
const profileSections = () => ALL_PROFILE_SECTIONS.filter(([, , cap]) => !cap || CD.caps[cap]);

/* Coach-side score explainability (Tier 2, 2026-07-21): the SAME per-category breakdown the
   athlete sees on their own Score screen — why this athlete's day scores what it does — built
   from the same explainCategories engine. Correctness guard: the athlete's day is reconstructed
   with THEIR OWN standard (resolveRequirementSet → stdFromItems) and THEIR OWN nutrition config
   (nutritionConfigForGoal off athlete_profiles), both passed EXPLICITLY into the scoring engine,
   so a coach's device standard/targets can never leak into another athlete's score. No scoring
   math is defined here; this reads the engine, it doesn't reweigh it. */
const CAT_ROW_STATE = {
  done: { cls: 'g', ic: 'check' }, late: { cls: 'a', ic: 'clock' }, open: { cls: 'b', ic: 'chevron' },
  overdue: { cls: 'r', ic: 'clock' }, flagged: { cls: 'a', ic: 'alert' }, info: { cls: 'muted', ic: 'info' },
};
function coachCatCard(b) {
  const st = (s) => CAT_ROW_STATE[s] || CAT_ROW_STATE.info;
  return `
  <details class="bd-cat" data-cat="${b.id}">
    <summary class="bd-row">
      <div class="bd-top">
        <span class="bd-name">${esc(b.key)} <span class="bd-weight">${b.weightPct}% of score</span></span>
        <span class="bd-val">${b.earned}<small>/${b.possible}</small></span>
      </div>
      <div class="bd-bar"><div class="bd-fill ${b.accent}" style="width:${b.possible ? Math.round(b.earned / b.possible * 100) : 0}%"></div></div>
      <div class="bd-note">${esc(b.note)}</div>
      <span class="bd-chev">${icon('chevron', 14)}</span>
    </summary>
    <div class="bd-detail">
      ${b.rows.map(r => `
        <div class="bd-req">
          <span class="bd-req-dot ${st(r.state).cls}"></span>
          <div class="bd-req-main"><div class="t">${esc(r.label)}</div>${r.sub ? `<div class="s">${esc(r.sub)}</div>` : ''}</div>
          ${r.value ? `<div class="bd-req-val">${esc(r.value)}</div>` : ''}
        </div>`).join('')}
      <div class="bd-remaining-note">${esc(b.remainingNote)}</div>
    </div>
  </details>`;
}
function scoreSection(P, athleteId) {
  const row = P.day; // raw days row (snake_case) or null when they have no day today
  if (!row) return `
  <div class="sidebox" style="margin-top:4px"><div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
  <div><div class="tt">No score to break down yet</div><div class="ts">They haven't logged today. The category breakdown appears here once their day has something in it.</div></div></div>`;
  // Reconstruct the athlete's OWN standard + nutrition config — never this coach device's.
  const set = resolveRequirementSet(CD.extras && CD.extras.sets, athleteId, P.row && P.row.position);
  const std = set ? stdFromItems(set.items) : null;
  const b = P.basics || {};
  const cfg = nutritionConfigForGoal(b.base_goal, b.base_weight, b.targets);
  // Map the snake_case days row into the shape dayFromHistoryRow reads, and score it against the
  // athlete's config (not the device DAY's). checkin/meals default to {} in the schema, so a real
  // row always projects; a null row is handled above.
  const mapped = { date: row.date, meals: row.meals || {}, checkin: row.checkin || {}, quickAdded: row.quick_added || [], hydrationL: row.hydration_l || 0, weight: row.current_weight };
  const day = dayFromHistoryRow(mapped, cfg);
  if (!day) return `
  <div class="sidebox" style="margin-top:4px"><div class="req-icon b" style="width:38px;height:38px">${icon('info', 17)}</div>
  <div><div class="tt">Breakdown unavailable</div><div class="ts">This day was logged before detailed scoring data was captured, so it can't be broken down. Their score still stands.</div></div></div>`;
  const slots = std ? std.slots : MEAL_KEYS;
  // Judge "open/overdue/due" in the ATHLETE's local day (timezone), falling back to coach clock.
  const lc = localClock(P.row && P.row.timezone, Date.now());
  const nowMin = lc ? lc.nowMin : minutesNow();
  const cats = explainCategories(day, {
    slots,
    denom: std ? std.mealsRequired : 4,
    titles: std ? std.titles : {},
    optional: std ? (std.optional || []) : ['snack'],
    nowMin, fmtClock, std,
  });
  const score = row.score != null ? row.score : null;
  const first = ((P.row && P.row.name) || 'This athlete').split(' ')[0];
  return `
  <div class="co-tiles two" style="margin-top:4px">
    <div class="co-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
    <div class="co-stat"><div class="v">${cfg.scoringProfile === 'gain' ? 'Gain' : cfg.scoringProfile === 'general' ? 'General' : 'Athlete'}</div><div class="k">Scoring profile</div></div>
  </div>
  <div class="co-eyebrow" style="margin-top:14px">Why ${esc(first)}'s day scores this</div>
  <section class="card bd-comp" style="padding:2px 16px">
    ${cats.map(coachCatCard).join('')}
  </section>
  <div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.45">Graded against ${esc(first)}'s own standard and ${cfg.proteinTarget}g protein${cfg.scoringProfile !== 'athlete' ? ` / ${cfg.calTarget} kcal` : ''} target — the same numbers they're scored on. Reflects today; past days keep the score they earned.</div>
  <div style="height:10px"></div>`;
}
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
  const future = ms < 0;                       // a due date in the future must not read "just now"
  const m = Math.floor(Math.abs(ms) / 60000);
  const fmt = (v, u) => future ? `in ${v}${u}` : `${v}${u} ago`;
  if (m < 1) return future ? 'soon' : 'just now';
  if (m < 60) return fmt(m, 'm');
  const h = Math.floor(m / 60);
  if (h < 24) return fmt(h, 'h');
  const d = Math.floor(h / 24);
  if (d < 7) return fmt(d, 'd');
  return fmt(Math.floor(d / 7), 'w');
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
// Athlete training logs (0135) for the profile activity timeline — fetched per-athlete in the
// coachAthlete mount, keyed so a re-render never re-fetches or shows the wrong athlete's logs.
let TLOGS = { id: null, rows: [] };

function activitySection(P) {
  const items = [];
  for (const l of (TLOGS.rows || [])) {
    if (!l || !l.log_date) continue;
    let when = l.log_date, ts = 0;
    try { const d = new Date(l.log_date + 'T12:00:00'); ts = d.getTime(); when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { /* keep raw */ }
    const feelW = l.feel ? ['', 'rough', 'tough', 'ok', 'good', 'great'][l.feel] : '';
    const detail = l.note ? `· “${esc(l.note.slice(0, 80))}${l.note.length > 80 ? '…' : ''}”` : (feelW ? `· felt ${feelW}` : '');
    items.push({ ts: isFinite(ts) ? ts : 0, cls: 'i-coach', when, what: `Training: ${esc(l.title || 'Workout')}${detail ? ` <span class="sub">${detail}</span>` : ''}` });
  }
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
  if (!set) return 'Team standard (built-in)';
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
  nav: 'operator', tab: 'roster',
  render({ sub }) {
    const athleteId = sub;
    if (athleteId !== PSEC_FOR) { PSECTION = 'overview'; PSEC_FOR = athleteId; }
    // A section the current book can't serve (a stale chip from a coach session) falls back to
    // Overview rather than rendering a permanently empty panel.
    if (!profileSections().some(([k]) => k === PSECTION)) PSECTION = 'overview';
    const who = rosterName(athleteId);
    const opView = CD.kind === 'practice' ? 'trainer view' : 'coach view';
    const opBack = CD.kind === 'practice' ? 'trainer-roster' : 'coach-roster';
    if (!athleteId) return `${backHead(CD.kind === 'practice' ? 'Client' : 'Athlete', opView, opBack)}<div class="state-demo"><div class="sd-t">No ${CD.kind === 'practice' ? 'client' : 'athlete'} selected</div></div>`;
    const P = CD.profile;
    if (!P || P.athleteId !== athleteId) {
      return `${backHead(who.name, (who.unit ? `${esc(who.unit)} · ` : '') + opView, opBack)}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('user', 17)}</div>
      <div><div class="tt">Loading their profile…</div><div class="ts">Pulling today's real score and logged meals.</div></div></div>`;
    }
    const name = (P.row && P.row.name) || who.name;
    const position = (P.row && P.row.position) || who.unit;
    const head = backHead(name, (position ? `${position} · ` : '') + opView, opBack);
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
      : PSECTION === 'score' ? scoreSection(P, athleteId)
      : PSECTION === 'activity' ? activitySection(P) : PSECTION === 'conversation' ? conversationSection(P)
      : PSECTION === 'requirements' ? requirementsSection(P, athleteId) : notesSection(P);
    return `
    ${head}

    <div class="co-actionbar">
      <button class="co-act" data-anudge="${esc(athleteId)}">${icon('bell', 18)}<span class="lbl">Nudge</span></button>
      <button class="co-act" data-go="coach-assign/${esc(athleteId)}">${icon('clipboard', 18)}<span class="lbl">Assign</span></button>
      <button class="co-act" data-go="coach-plan/${esc(athleteId)}">${icon('edit', 18)}<span class="lbl">Targets</span></button>
      ${CD.caps.trustPass ? `<button class="co-act ${P.trustPass ? 'hero' : ''}" id="tp-btn">${icon('shield', 18)}<span class="lbl">${P.trustPass ? 'End pass' : 'Trust'}</span></button>` : ''}
    </div>
    <div id="tp-status" style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);min-height:0"></div>

    <div class="co-seg co-scroll" id="psec-row">
      ${profileSections().map(([key, label]) => `<button class="co-chip ${PSECTION === key ? 'on' : ''}" data-psec="${key}">${esc(label)}</button>`).join('')}
    </div>

    ${body}
    <div class="co-bottom"></div>
    `;
  },
  mount(root, { sub }) {
    const athleteId = sub;
    loadBook(false, bookKindFor(RT.authRole)); // ensure the name is available
    loadAthleteProfile(athleteId);
    // Training logs (0135) for the Activity timeline — fetch once per athlete open (mount re-runs
    // on every render; the id guard stops a re-fetch loop and clears stale rows on athlete switch).
    if (TLOGS.id !== athleteId) {
      TLOGS = { id: athleteId, rows: [] };
      roles.listTrainingLogs(athleteId).then((rows) => { if (TLOGS.id === athleteId) { TLOGS = { id: athleteId, rows: rows || [] }; if (window.__render) window.__render(); } }).catch(() => { /* best-effort */ });
    }
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
      if (ok) { try { act.markNudged(id); } catch { /* best-effort */ } try { await logBookIntervention({ athleteId: id, kind: 'nudge' }); } catch { /* best-effort */ } }
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
      const r = await roles.postCoachNote(teamId, athleteId, body, CD.kind);
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
        // No length passed: the server resolves the team's trust_pass_policy (0099).
        const pol = RT.trustPolicy || { length_days: 10, eligibility_days: 7 };
        const r = await roles.grantTrustPass(athleteId);
        if (status) status.textContent = r.ok ? `Trust Pass granted · ${pol.length_days} days.` : (r.error && /on.?standard|photo|eligib/i.test(r.error) ? `Not eligible yet — needs ${pol.eligibility_days} photo-logged days.` : 'Could not grant it.');
      }
      setTimeout(() => { if (location.hash.startsWith('#coach-athlete')) loadAthleteProfile(athleteId, true); }, 500);
    });
  },
};

/* ---------- Coach → meal review + comment: the REAL meal_comments thread (slice 5) ---------- */
let MC = null;            // { mealId, comments }
// Resolved meal threads (Slice D, Inbox v2): mealIds known handled. Seeded from the DB on
// thread open (fetchMealResolved) so "Resolved ✓" survives a reload, and added to when the
// coach taps Mark resolved. The real resolved state lives in coach_interventions
// (kind:'handled', reason_key:'meal:'+id) — what the inbox categorizer reads; this Set keeps
// the button honest across re-renders without a refetch.
let RESOLVED_MEALS = new Set();
// Coach message-kind comments on a meal (the "2 per meal" cap). One definition for the draft
// affordance (render) and the composer cap (mount) so they can't drift.
function coachMsgCount(comments) {
  return Array.isArray(comments)
    ? comments.filter(c => c.role === 'coach' && (c.kind || 'message') === 'message').length : 0;
}
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
/* Standalone meal cache (Task 6 Part C): coachMeal resolves its own meal via
   roles.fetchMeal(mealId), signs the photo itself, and keeps a tiny cache keyed by mealId —
   no dependency on any other screen's mount having run first. */
let MEAL = null;           // { id, row }
let mealLoadingId = null;
async function loadMeal(mealId) {
  if (!mealId) return;
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
  return MEAL && MEAL.id === mealId ? MEAL.row : null;
}
/* Suggested replies (Coach OS Slice D, Task 4): AI drafts four stance-labeled candidates, the
   coach taps one to PREFILL the composer, edits, and sends manually — the AI never auto-sends.
   Module state keyed by mealId so switching meals never shows a stale draft for the wrong one. */
let DRAFTS = { mealId: null, items: [], loading: false, error: null };
const STANCE_LABEL = { supportive: 'Supportive', direct: 'Direct', context: 'Ask for context', followup: 'Set a follow-up' };
export const coachMeal = {
  nav: 'operator', tab: 'roster',
  render({ sub }) {
    const mealId = sub;
    const meal = mealById(mealId);
    const title = meal ? cap(meal.type || 'Meal') : 'Meal';
    const backTo = (meal && meal.athlete_id) ? `coach-athlete/${meal.athlete_id}` : (RT.authRole === 'trainer' ? 'trainer' : 'coach-home');
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
    </div>
    ${(() => {
      // Scoring explainability (Tier 2, coach side): the SAME rubric the athlete sees on their
      // own log — pure function of this meal's own macros/fiber/timing, no scoring math added
      // or changed here. Null quality (manual/legacy rows) shows nothing, same as athlete side.
      if (meal.quality == null) return '';
      const band = qualityBand(meal.quality);
      const macros = { protein: meal.protein, carbs: meal.carbs, fat: meal.fat };
      const reason = qualityReason(macros, meal.fiber, meal.detected);
      const rub = scoreRubric({
        // userNote isn't a persisted column (the athlete's review-step note only rides the
        // analysis text) — null here, never a guess; the rubric's "photo submitted" fallback
        // still reads correctly.
        quality: meal.quality, minutesLate: meal.minutes_late, macros, fiber: meal.fiber,
        detected: meal.detected, source: meal.source, userNote: null, photoQ: null,
      });
      const RUB_DOT = { met: 'g', partial: 'a', miss: 'r' };
      return `
      ${band ? `<div class="qual-line ${band.cls}">
        <span class="qv">${meal.quality}<small>/100</small></span>
        <div><div class="ql">Meal quality · ${band.label}</div>${reason ? `<div class="qr">${esc(reason)}</div>` : ''}</div>
      </div>` : ''}
      <details class="rub">
        <summary>${esc(rub.headline)} ${icon('chevron', 13)}</summary>
        <div class="rub-body">
          ${rub.rows.map(r => `
          <div class="rub-row">
            <span class="bd-req-dot ${RUB_DOT[r.state] || 'muted'}"></span>
            <span class="rk">${esc(r.k)}</span>
            <span class="rn">${esc(r.note)}</span>
            <span class="rx-tag">${r.exact ? 'exact' : 'estimated'}</span>
          </div>`).join('')}
          <div class="rub-fine">Exact items are facts (timing, what the athlete submitted). Estimated items come from the photo read.</div>
        </div>
      </details>`;
    })()}` : ''}

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
    <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
      <button class="btn ghost sm" id="cm-resolve">${RESOLVED_MEALS.has(mealId) ? 'Resolved ✓' : 'Mark resolved'}</button>
      <span id="cm-resolve-note" style="font-size:12.5px;font-weight:600;color:var(--text-3)"></span>
    </div>
    ${(() => {
      // Suggested replies (Task 4): only offered while the coach can still send (coachN < 2) —
      // drafting a reply they're capped from sending would be dishonest. Nothing renders past
      // the cap; the existing "2 coach messages per meal" note in mount() already covers it.
      const coachN0 = coachMsgCount(MC && MC.comments);
      if (coachN0 >= 2) return '';
      if (DRAFTS.loading && DRAFTS.mealId === sub) {
        return `<div class="qa-row" style="margin-top:8px"><span style="font-size:12.5px;font-weight:600;color:var(--text-3);padding:6px 2px">Drafting…</span></div>`;
      }
      if (DRAFTS.mealId === sub && DRAFTS.items.length) {
        return `<div class="qa-row" style="margin-top:8px">
          ${DRAFTS.items.map((d, i) => `<button class="qa" data-draft="${i}">${esc(STANCE_LABEL[d.stance] || cap(d.stance || 'Reply'))}</button>`).join('')}
        </div>`;
      }
      const errLine = (DRAFTS.mealId === sub && DRAFTS.error)
        ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:2px 2px 6px">Couldn't draft right now — write your own or try again.</div>` : '';
      return `${errLine}<div class="qa-row" style="margin-top:8px"><button class="qa" id="cm-draft">✍️ Draft a reply</button></div>`;
    })()}
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
    // Seed the resolved flag from the DB so "Resolved ✓" persists across a reload (not just
    // this session). Best-effort; a miss just shows "Mark resolved" until the coach taps it.
    if (sub && !RESOLVED_MEALS.has(sub)) {
      roles.fetchMealResolved(sub).then(done => {
        if (done) { RESOLVED_MEALS.add(sub); if (location.hash === `#coach-meal/${sub}`) window.__render(); }
      }).catch(() => {});
    }
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
    const coachN = coachMsgCount(MC && MC.comments);
    const capNoun = CD.kind === 'practice' ? 'Trainer' : 'Coach';
    if (coachN >= 2) {
      if (input) { input.disabled = true; input.placeholder = `${capNoun} cap reached`; }
      if (send) send.disabled = true;
      if (cmNote) { cmNote.style.color = 'var(--text-3)'; cmNote.textContent = `You’ve made your point — 2 ${capNoun.toLowerCase()} messages per meal. Reactions are always open.`; }
    } else if (coachN === 1 && cmNote) {
      cmNote.style.color = 'var(--text-3)'; cmNote.textContent = `1 of 2 ${capNoun.toLowerCase()} messages used on this meal.`;
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
      // Log the intervention for Inbox v2's categorizer (Slice D): fire-and-forget, never blocks
      // or breaks the send — the coach's message already landed by this point. reason_key MUST
      // be 'meal:'+sub (the exact convention the categorizer keys on). No-ops on a practice book
      // (team-owned table, see logBookIntervention) — the message itself still landed above.
      logBookIntervention({ athleteId, kind: 'message', reasonKey: 'meal:' + sub }).catch(() => {});
      await loadMealComments(sub, true);
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    // Mark resolved (Slice D): logs kind:'handled' so this meal moves to the Resolved category in
    // the coach inbox. Idempotent — a second tap just re-logs (harmless) since the button already
    // reads "Resolved ✓" once it succeeds.
    const resolveBtn = root.querySelector('#cm-resolve');
    const resolveNote = root.querySelector('#cm-resolve-note');
    if (resolveBtn) resolveBtn.addEventListener('click', async () => {
      const meal0 = mealById(sub);
      const athleteId0 = meal0 ? meal0.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!athleteId0 || !teamId) {
        if (resolveNote) resolveNote.textContent = "Couldn't resolve — try again.";
        return;
      }
      const ok = await logBookIntervention({ athleteId: athleteId0, kind: 'handled', reasonKey: 'meal:' + sub });
      if (!ok) {
        if (resolveNote) resolveNote.textContent = "Couldn't resolve — try again.";
        return;
      }
      RESOLVED_MEALS.add(sub);
      resolveBtn.textContent = 'Resolved ✓';
      if (resolveNote) resolveNote.textContent = 'Resolved.';
      setTimeout(() => { location.hash = '#coach-inbox'; }, 800);
    });
    // Draft a reply (Task 4): asks meal-chat's draft mode for four stance-labeled candidates.
    // Context mirrors the coachSupport shape above (meal macros) plus the last few thread
    // messages, so drafts are grounded in what was actually said.
    const draftBtn = root.querySelector('#cm-draft');
    if (draftBtn) draftBtn.addEventListener('click', async () => {
      DRAFTS = { mealId: sub, items: [], loading: true, error: null };
      window.__render();
      const meal0 = mealById(sub);
      const context = {
        meal: meal0 ? { type: meal0.type, protein: meal0.protein, kcal: meal0.kcal, quality: meal0.quality } : {},
        thread: threadMessages(MC && MC.comments).slice(-6).map((c) => ({ role: c.role, text: String(c.text).slice(0, 300) })),
      };
      const r = await roles.draftMealReplies(sub, context);
      if (DRAFTS.mealId !== sub) return; // stale — coach navigated away/on before this resolved
      DRAFTS.loading = false;
      DRAFTS.items = r.ok ? r.drafts : [];
      DRAFTS.error = r.ok ? null : (r.error || 'unavailable');
      window.__render();
    });
    // Chip tap: fills the REAL #cm-input element (never re-renders over it — that would rebuild
    // the DOM and wipe the value just set, same lesson as meal.js's prefill()). The chip row is
    // removed directly from the DOM instead, and DRAFTS.items is cleared so a later legit
    // re-render (e.g. a new comment landing) doesn't resurrect stale chips.
    root.querySelectorAll('[data-draft]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.getAttribute('data-draft');
      const d = DRAFTS.items[i];
      if (!d || !input) return;
      input.value = d.text;
      input.focus();
      const end = input.value.length;
      if (input.setSelectionRange) input.setSelectionRange(end, end);
      DRAFTS.items = [];
      const row = b.closest('.qa-row');
      if (row) row.remove();
    }));
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

/* ---------- Trainer view ----------
   The trainer's Home/Clients/Create/Inbox are now the SAME operator modules the coach renders
   (screens/index.js maps trainer-* → coachHome/coachRoster/coachCreate/coachInbox), reading the
   one shared cache in coach-data.js. The private `let BOOK` second cache that used to live here
   is gone: it fetched a single day with no history, no staleness and no timezones, which is why
   the trainer had no sparklines, no priority queue and no inbox.

   Slice B: the old standalone "note to a client" screen (route trainer-client) is gone too. It
   was a permanent "Recovery trend … no invented bars until then" stub over 3 stat tiles, while
   the real athlete deep-dive (coachAthlete, below) already has a live recovery/activity section,
   a real meal thread, and now a working target editor — all reachable by a trainer via
   coach-athlete/<id>. Nothing in the UI ever linked to trainer-client directly (the roster row
   always routed to coach-athlete/<id> for either book), so the route is retired rather than
   aliased — a stale bookmark now falls through the router's normal unknown-route handling. */

/* ---------- Parent view — the child's scores/streaks via the guardian_* RPCs (migration 0081).
   A guardian reads ONLY score/grade/day here; meal photos, weight, and check-ins are closed
   server-side. Graceful when nothing is linked yet or the RPCs aren't live — renders the
   "no athletes linked" state, never a fabricated score. ---------- */
export const parent = {
  hideTabs: true,
  render() {
    return `
    ${titleHead('Your athletes', 'Daily scores')}

    <div id="par-list"><div class="sd-s" style="text-align:center;padding:28px 10px">Loading…</div></div>

    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What you can see</div>
      <div class="ts">Their daily score and grade, and the date of their latest logged day &mdash; that's the whole view. Meal photos, weight, and check-in answers stay between your athlete and their coach.</div></div>
    </div>

    <div style="height:12px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="parent-link"><div class="lic">${icon('plus', 17)}</div><div class="lm"><div class="lt">Link an athlete</div><div class="ls">Enter the invite code they gave you</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="fund-plan">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Fund a plan</div><div class="ls">Pay for your child’s coaching package</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="funded-plans">
        <div class="lic" style="background:var(--surface-2)">${icon('lock', 17)}</div>
        <div class="lm"><div class="lt">Funded plans</div><div class="ls">What you’re paying for</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const list = root.querySelector('#par-list');
    if (!list) return;
    let kids = [];
    try { kids = await act.guardianChildren(); } catch { kids = []; }
    if (!kids || !kids.length) {
      list.innerHTML = `
      <div class="state-demo">
        <div class="sd-ic">${icon('users', 24)}</div>
        <div class="sd-t">No athletes linked yet</div>
        <div class="sd-s">When your athlete sends you an invite and you accept it, their daily score and grade show up here — never their photos, weight, or check-in answers.</div>
      </div>`;
      return;
    }
    list.innerHTML = kids.map((k) => {
      const score = (k.latest_score == null) ? '—' : String(k.latest_score);
      const grade = k.latest_grade ? esc(String(k.latest_grade)) : '';
      const when = k.latest_day ? esc(String(k.latest_day)) : 'No days logged yet';
      return `
      <section class="card" style="padding:16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="min-width:0"><div class="lt" style="font-size:16px">${esc(k.name || 'Athlete')}</div>
          <div class="ls">Latest day: ${when}</div></div>
          <div style="text-align:right;flex:none"><div style="font-size:30px;font-weight:800;letter-spacing:-0.03em;color:var(--blue-bright)">${score}</div>
          <div class="ls">${grade}</div></div>
        </div>
      </section>`;
    }).join('');
  },
};

/* ---------- Athlete → generate a single-use parent invite code (migration 0081) ---------- */
export const inviteParent = {
  hideTabs: true,
  render() {
    return `
    ${backHead('Invite a parent', 'They see your score & streak')}
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What they'll see</div>
      <div class="ts">Your daily score, streak, and completion — never your meal photos, weight, or check-in answers.</div></div>
    </div>
    <div style="height:16px"></div>
    <div id="inv-out"></div>
    <button id="inv-go" class="btn primary">Generate an invite code</button>
    <div style="height:10px"></div>`;
  },
  mount(root) {
    const btn = root.querySelector('#inv-go');
    const out = root.querySelector('#inv-out');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Generating…';
      const r = await act.createGuardianInvite('parent');
      if (r.ok) {
        out.innerHTML = `
        <section class="card" style="padding:18px;text-align:center;margin-bottom:12px">
          <div class="ls" style="margin-bottom:6px">Give this code to your parent</div>
          <div style="font-size:30px;font-weight:800;letter-spacing:0.12em;color:var(--blue-bright)">${esc(r.token || '')}</div>
          <div class="ls" style="margin-top:8px">They tap “Link an athlete” and enter it. Single use · expires in 14 days.</div>
        </section>`;
        btn.textContent = 'Generate another';
      } else {
        out.innerHTML = `<div class="si-err" style="text-align:center">${esc(r.error || 'Could not create an invite.')}</div>`;
        btn.textContent = 'Try again';
      }
      btn.disabled = false;
    });
  },
};

/* ---------- Parent → redeem an invite code to link an athlete (migration 0081) ---------- */
export const parentLink = {
  hideTabs: true,
  render() {
    return `
    ${backHead('Link an athlete', 'Enter their invite code')}
    <div style="height:8px"></div>
    <input id="pl-code" class="ob-input" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Invite code" aria-label="Invite code" style="text-transform:uppercase;letter-spacing:0.12em">
    <div id="pl-err" class="si-err" style="min-height:18px;margin-top:12px"></div>
    <button id="pl-go" class="btn primary">Link athlete</button>
    <div style="height:10px"></div>`;
  },
  mount(root) {
    const code = root.querySelector('#pl-code');
    const err = root.querySelector('#pl-err');
    const btn = root.querySelector('#pl-go');
    const submit = async () => {
      if (btn.disabled) return;
      err.textContent = '';
      const token = (code.value || '').trim().toUpperCase();
      if (!token) { err.textContent = 'Enter the invite code.'; return; }
      btn.disabled = true; btn.textContent = 'Linking…';
      const r = await act.acceptGuardianInvite(token, 'parent');
      if (r.ok) { window.__go('parent'); }
      else { err.textContent = r.error || 'Could not link — check the code.'; btn.disabled = false; btn.textContent = 'Link athlete'; }
    };
    btn.addEventListener('click', submit);
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};
