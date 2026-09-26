/* The coach's half of phase B (goals and eating plan, 2026-09-26): the season control on Home and
 * its sheet, and the suggested target changes waiting for a decision.
 *
 * Painted into two slots on operator Home (#sp-slot, #tsc-slot) by dynamic import, the same
 * async-slot seam the roll-call and standards boards use, so nothing here is in the boot graph and
 * a slow read never delays the priority queue.
 *
 * THE SEASON CONTROL renders only for staff who edit the team's standard (season-phase.js
 * canSetSeason, mirrored by 0252 can_set_team_phase) on a team book whose plan is live. It fails
 * CLOSED while the role loads: view-only staff never see it, not even for a frame.
 *
 * A SUGGESTION is approved in ONE server call: decide_target_suggestion re-checks it against the
 * athlete's live targets and applies it through the same gated coach_set_goals door, atomically
 * (0253/0254). The device first refuses a row whose numbers are no longer the athlete's live
 * targets and closes it. Declining marks it and buys 14 quiet days.
 */
import * as roles from './roles.js';
import { CD, bookId, loadBook } from './coach-data.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { overlayOpen } from './overlay-guard.js';
import { PHASES, phaseLabel, canSetSeason, confirmLine } from './season-phase.js';
import { changeHeadline, composeReason, liveMatches, isLive } from './target-suggest-model.js';
import { nutritionConfigForGoal } from './state.js';

const TTL = 60000;
let SEASON = { teamId: null, phase: undefined, at: 0, err: false };
let SUGG = { key: null, rows: null, at: 0, busy: {}, note: {} };

const todayISO = () => roles.todayISO();
const firstName = (athleteId) => {
  const r = CD.roster && CD.roster.rows ? CD.roster.rows.find((x) => x.athleteId === athleteId) : null;
  return r && r.name ? String(r.name).split(' ')[0] : null;
};

/* ---------------------------------------------------------------- the season */

/** Whether this operator gets the control at all. */
export function showSeasonControl() {
  if (CD.kind !== 'team' || !CD.roster || !bookId()) return false;
  if (!CD.caps || !CD.caps.standards) return false;           // a lapsed plan loses the writes (0223)
  return !!(CD.extras && canSetSeason(CD.extras.myRole));     // fail closed while the role loads
}

async function readSeason(teamId, force) {
  if (!force && SEASON.teamId === teamId && SEASON.phase !== undefined && Date.now() - SEASON.at < TTL) return false;
  const sb = window.sb;
  if (!sb) return false;
  try {
    const { data, error } = await sb.from('teams').select('season_phase').eq('id', teamId).maybeSingle();
    if (error) { SEASON = { ...SEASON, err: true }; return false; }
    const phase = (data && data.season_phase) || null;
    const changed = SEASON.teamId !== teamId || SEASON.phase !== phase;
    SEASON = { teamId, phase, at: Date.now(), err: false };
    return changed;
  } catch { return false; }
}

export function seasonControlHtml() {
  if (!showSeasonControl()) return '';
  const known = SEASON.teamId === bookId() && SEASON.phase !== undefined;
  if (!known) return '';
  const label = phaseLabel(SEASON.phase);
  return `<button type="button" class="sp-ctl" id="sp-open" aria-haspopup="dialog">
    <span class="sp-ic">${icon('rotate', 18)}</span>
    <span class="sp-tx"><span class="sp-k">Season</span><span class="sp-v${label ? '' : ' unset'}">${esc(label || 'Not set')}</span></span>
    <span class="sp-go">${label ? 'Change' : 'Set it'}${icon('chevron', 13)}</span>
  </button>`;
}

function sheetListHtml() {
  const cur = SEASON.phase || null;
  return `<div class="grab"></div>
    <div class="sh-title" id="sp-t">Season</div>
    <div class="sh-sub">Sets goal-based calories for the whole team. Numbers you set never move.</div>
    ${PHASES.map((p) => `<button type="button" class="sheet-row${cur === p.key ? ' on' : ''}" data-sp-pick="${esc(p.key)}">
      <span class="si">${esc(p.short)}</span>
      <span class="st"><span class="t">${esc(p.label)}</span><span class="s">${esc(p.meaning)}</span></span>
      ${cur === p.key ? '<span class="sp-now">Now</span>' : icon('chevron', 16)}
    </button>`).join('')}
    ${cur ? `<button type="button" class="sheet-row" data-sp-pick=""><span class="si">${icon('x', 16)}</span><span class="st"><span class="t">Clear the season</span><span class="s">Goal-based targets go back to their base plan.</span></span>${icon('chevron', 16)}</button>` : ''}
    <button type="button" class="cancel" data-sp-close>Close</button>`;
}

function sheetConfirmHtml(pick) {
  const label = phaseLabel(pick);
  return `<div class="grab"></div>
    <div class="sh-title" id="sp-t">${esc(label ? `Set ${label}?` : 'Clear the season?')}</div>
    <div class="sp-confirm">
      <p>${esc(confirmLine(pick || null))}</p>
      <button type="button" class="btn primary" id="sp-yes">${esc(label ? `Set ${label}` : 'Clear it')}</button>
      <div class="sp-err" id="sp-err" role="status"></div>
    </div>
    <button type="button" class="cancel" data-sp-back>Back</button>`;
}

function closeSheet(focusBack) {
  document.querySelectorAll('.sp-scrim, .sheet.sp-sheet').forEach((n) => n.remove());
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('hashchange', closeQuiet);
  if (focusBack && typeof focusBack.focus === 'function') { try { focusBack.focus(); } catch { /* gone */ } }
}
function closeQuiet() { closeSheet(null); }
function onKey(e) { if (e.key === 'Escape') closeSheet(document.getElementById('sp-open')); }

function openSheet(root, opener) {
  if (overlayOpen()) return;
  const host = root.querySelector('.screen') || root;
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim sp-scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet sp-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'sp-t');
  host.appendChild(scrim); host.appendChild(sheet);
  const list = () => { sheet.innerHTML = sheetListHtml(); };
  list();
  scrim.addEventListener('click', () => closeSheet(opener));
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', closeQuiet);
  sheet.addEventListener('click', async (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-sp-close]')) { closeSheet(opener); return; }
    if (t.closest('[data-sp-back]')) { list(); return; }
    const pick = t.closest('[data-sp-pick]');
    if (pick) {
      const k = pick.dataset.spPick || null;
      if (k === (SEASON.phase || null)) { closeSheet(opener); return; }
      sheet.innerHTML = sheetConfirmHtml(k);
      sheet.dataset.pick = k || '';
      const yes = sheet.querySelector('#sp-yes'); if (yes) yes.focus();
      return;
    }
    const yes = t.closest('#sp-yes');
    if (yes) {
      yes.disabled = true;
      const k = sheet.dataset.pick || null;
      const ok = await setTeamSeason(bookId(), k);
      if (!ok) {
        yes.disabled = false;
        const err = sheet.querySelector('#sp-err');
        if (err) err.textContent = "Couldn't save the season. Check your connection and try again.";
        return;
      }
      closeSheet(opener);
      if (window.__render) window.__render();
    }
  });
}

/** Set the team's phase. true when the server took it. */
export async function setTeamSeason(teamId, phase, sb = window.sb) {
  if (!sb || !teamId) return false;
  try {
    const { error } = await sb.rpc('set_team_season_phase', { p_team: teamId, p_phase: phase || null });
    if (error) return false;
    SEASON = { teamId, phase: phase || null, at: Date.now(), err: false };
    return true;
  } catch { return false; }
}

export function paintSeason(root) {
  const slot = root.querySelector('#sp-slot');
  if (!slot) return;
  const paint = () => {
    if (!slot.isConnected) return;
    slot.innerHTML = seasonControlHtml();
    const b = slot.querySelector('#sp-open');
    if (b) b.addEventListener('click', () => openSheet(root, b));
  };
  paint();
  // The staff role arrives with the book's extras, a beat after the roster. Wait for the same load
  // (loadBook dedupes to the one in flight) rather than deciding on a half-loaded book.
  const go = () => { if (showSeasonControl()) void readSeason(bookId(), false).then(paint); };
  if (CD.kind === 'team' && !CD.extras) void Promise.resolve(loadBook(false, 'team')).then(go);
  else go();
}

/* ---------------------------------------------------------------- suggestions */

const COLS = 'id,athlete_id,team_id,status,created_at,current_protein,current_kcal,proposed_protein,proposed_kcal,pace_lb_wk,plan_lb_wk';

async function readSuggestions(force) {
  const key = `${CD.kind}|${bookId()}`;
  if (!force && SUGG.key === key && SUGG.rows && Date.now() - SUGG.at < TTL) return false;
  const sb = window.sb;
  if (!sb || !bookId()) return false;
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  try {
    // Scoped to THIS book, not just to whatever RLS lets the operator see: a coach on two teams (or
    // a trainer with a team too) reads the loaded book's rows only. A practice suggestion has no
    // team, so the practice book filters by its own clients.
    let q = sb.from('target_suggestions').select(COLS).eq('status', 'pending').gte('created_at', since);
    if (CD.kind === 'team') q = q.eq('team_id', bookId());
    else {
      const ids = (CD.roster && CD.roster.rows ? CD.roster.rows : []).map((r) => r.athleteId).filter(Boolean);
      if (!ids.length) { SUGG = { ...SUGG, key, rows: [], at: Date.now() }; return false; }
      q = q.in('athlete_id', ids.slice(0, 200));
    }
    const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
    if (error) return false;
    const before = JSON.stringify(SUGG.rows);
    SUGG = { ...SUGG, key, rows: Array.isArray(data) ? data : [], at: Date.now() };
    return JSON.stringify(SUGG.rows) !== before;
  } catch { return false; }
}

/** The live suggestions for athletes on THIS book, newest first. */
export function liveSuggestions() {
  const rows = SUGG.key === `${CD.kind}|${bookId()}` && SUGG.rows ? SUGG.rows : [];
  return rows.filter((r) => isLive(r, todayISO()) && firstName(r.athlete_id));
}

export function suggestionCardsHtml() {
  // Live rows, plus a row this visit just closed (stale / expired), so its note is read once.
  const all = SUGG.key === `${CD.kind}|${bookId()}` && SUGG.rows ? SUGG.rows : [];
  const rows = all.filter((r) => firstName(r.athlete_id) && (isLive(r, todayISO()) || (r.status === 'closed' && SUGG.note[r.id])));
  if (!rows.length) return '';
  return rows.slice(0, 3).map((r) => {
    const busy = !!SUGG.busy[r.id];
    const note = SUGG.note[r.id] || '';
    const why = composeReason(r);
    return `<section class="tsc" data-tsc="${esc(r.id)}" aria-label="Suggested change">
      <div class="tsc-t">${esc(`Suggested change for ${firstName(r.athlete_id)}: ${changeHeadline(r)}`)}</div>
      ${why ? `<p class="tsc-why">${esc(why)}</p>` : ''}
      ${r.status === 'closed' ? '' : `<div class="tsc-acts">
        <button type="button" class="btn ghost" data-tsc-no="${esc(r.id)}"${busy ? ' disabled' : ''}>Decline</button>
        <button type="button" class="btn primary" data-tsc-yes="${esc(r.id)}"${busy ? ' disabled' : ''}>Approve</button>
      </div>`}
      ${note ? `<div class="tsc-st err" role="status">${esc(note)}</div>` : ''}
    </section>`;
  }).join('');
}

/** The athlete's live targets as far as this operator can know them: every stored (coach-set) figure,
 *  and the goal-derived ones through the SAME function the athlete grades with, but only when the
 *  bodyweight is visible to this role (a weight-restricted role would derive from the default weight
 *  and call every goal-derived row stale). What stays unknown is re-checked by the server. */
export async function liveTargetsFor(athleteId, r = roles) {
  let b = null;
  try { b = await r.fetchAthleteBasics(athleteId); } catch { b = null; }
  if (!b) return {};
  const t = b.targets && typeof b.targets === 'object' ? b.targets : {};
  const live = {};
  if (Number(t.protein) > 0) live.protein = Number(t.protein);
  if (Number(t.calories) > 0) live.kcal = Number(t.calories);
  if (b.base_goal && b.base_weight != null && (live.protein == null || live.kcal == null)) {
    const cfg = nutritionConfigForGoal(b.base_goal, b.base_weight, t, b.season_phase || null);
    if (live.protein == null) live.protein = cfg.proteinTarget;
    if (live.kcal == null) live.kcal = cfg.calTarget;
  }
  return live;
}

/** Approve: ONE server call. decide_target_suggestion re-checks the row against the athlete's live
 *  stored targets and applies the numbers itself through coach_set_goals, in one transaction, so
 *  the targets and the row can never disagree. Before asking, the device refuses a row whose current
 *  numbers are no longer the athlete's live targets and closes it (status 'stale').
 *  Returns { ok, status } with status 'approved' | 'stale' | 'expired', or { ok:false, error }. */
export async function approveSuggestion(row, deps = {}) {
  const sb = deps.sb || window.sb;
  if (!row || !sb) return { ok: false, error: 'offline' };
  const live = deps.live || await liveTargetsFor(row.athlete_id, deps.roles || roles);
  if (!liveMatches(row, live)) {
    await decide(row, 'expire', sb);
    return { ok: false, status: 'stale' };
  }
  const res = await decide(row, 'approved', sb);
  if (!res.error && res.status !== 'approved') return { ok: false, status: res.status };
  return res;
}

export async function declineSuggestion(row, deps = {}) {
  const sb = deps.sb || window.sb;
  if (!row || !sb) return { ok: false, error: 'offline' };
  return decide(row, 'declined', sb);
}

async function decide(row, decision, sb) {
  try {
    const { data, error } = await sb.rpc('decide_target_suggestion', { p_id: row.id, p_decision: decision });
    if (error) return { ok: false, error: 'decide' };
    return { ok: true, status: data };
  } catch { return { ok: false, error: 'decide' }; }
}

/** What the card says after a tap that did not go through. Always the true state. */
export function outcomeNote(approving, res) {
  if (res.status === 'stale') return 'Their targets changed since this was suggested, so nothing was applied. It is closed.';
  if (res.status === 'expired') return 'This suggestion ran out after 14 days. Nothing was applied.';
  return approving ? "Couldn't approve it. Their targets are unchanged. Try again." : "Couldn't save that. Try again.";
}

export function paintSuggestions(root) {
  const slot = root.querySelector('#tsc-slot');
  if (!slot) return;
  const paint = () => {
    if (!slot.isConnected) return;
    slot.innerHTML = suggestionCardsHtml();
  };
  paint();
  if (!slot.dataset.wired) {
    slot.dataset.wired = '1';
    slot.addEventListener('click', async (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      const yes = t && t.closest('[data-tsc-yes]');
      const no = t && t.closest('[data-tsc-no]');
      const id = yes ? yes.dataset.tscYes : no ? no.dataset.tscNo : null;
      if (!id || SUGG.busy[id]) return;
      const row = (SUGG.rows || []).find((x) => x.id === id);
      if (!row) return;
      SUGG.busy[id] = true; delete SUGG.note[id]; paint();
      const res = yes ? await approveSuggestion(row) : await declineSuggestion(row);
      SUGG.busy[id] = false;
      if (res.ok) {
        SUGG.rows = (SUGG.rows || []).filter((x) => x.id !== id);
      } else {
        SUGG.note[id] = outcomeNote(!!yes, res);
        // A closed row (stale or expired) stays on screen for this visit only, so the note is read;
        // it cannot be tapped again: the buttons go with it on the next read.
        if (res.status) SUGG.rows = (SUGG.rows || []).map((x) => (x.id === id ? { ...x, status: 'closed' } : x));
      }
      paint();
    });
  }
  void readSuggestions(false).then((changed) => { if (changed) paint(); });
}

/* Tests only. */
export function _reset() { SEASON = { teamId: null, phase: undefined, at: 0, err: false }; SUGG = { key: null, rows: null, at: 0, busy: {}, note: {} }; }
export function _seed({ season, suggestions } = {}) {
  if (season) SEASON = { teamId: season.teamId, phase: season.phase ?? null, at: Date.now(), err: false };
  if (suggestions) SUGG = { key: `${CD.kind}|${bookId()}`, rows: suggestions, at: Date.now(), busy: {}, note: {} };
}
