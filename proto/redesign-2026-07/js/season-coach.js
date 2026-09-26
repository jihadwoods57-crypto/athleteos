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
 * A SUGGESTION is approved through the existing coach_set_goals door (roles.coachSetGoals), with
 * the athlete's current targets kept whole, and only then marked approved (0253 refuses the mark
 * otherwise). Declining marks it and buys 14 quiet days.
 */
import * as roles from './roles.js';
import { CD, bookId, loadBook } from './coach-data.js';
import { icon } from './icons.js';
import { esc } from './components.js';
import { overlayOpen } from './overlay-guard.js';
import { PHASES, phaseLabel, canSetSeason, confirmLine } from './season-phase.js';
import { changeHeadline, approvedTargets, isLive } from './target-suggest-model.js';

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

const COLS = 'id,athlete_id,status,created_at,current_protein,current_kcal,proposed_protein,proposed_kcal,reason';

async function readSuggestions(force) {
  const key = `${CD.kind}|${bookId()}`;
  if (!force && SUGG.key === key && SUGG.rows && Date.now() - SUGG.at < TTL) return false;
  const sb = window.sb;
  if (!sb || !bookId()) return false;
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  try {
    const { data, error } = await sb.from('target_suggestions').select(COLS)
      .eq('status', 'pending').gte('created_at', since).order('created_at', { ascending: false }).limit(20);
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
  const rows = liveSuggestions();
  if (!rows.length) return '';
  return rows.slice(0, 3).map((r) => {
    const busy = !!SUGG.busy[r.id];
    const note = SUGG.note[r.id] || '';
    return `<section class="tsc" data-tsc="${esc(r.id)}" aria-label="Suggested change">
      <div class="tsc-t">${esc(`Suggested change for ${firstName(r.athlete_id)}: ${changeHeadline(r)}`)}</div>
      <p class="tsc-why">${esc(r.reason)}</p>
      <div class="tsc-acts">
        <button type="button" class="btn ghost" data-tsc-no="${esc(r.id)}"${busy ? ' disabled' : ''}>Decline</button>
        <button type="button" class="btn primary" data-tsc-yes="${esc(r.id)}"${busy ? ' disabled' : ''}>Approve</button>
      </div>
      ${note ? `<div class="tsc-st err" role="status">${esc(note)}</div>` : ''}
    </section>`;
  }).join('');
}

/** Approve: the athlete's current targets, with the two numbers replaced, through coach_set_goals,
 *  THEN the mark. `deps` lets the test hand in stubs for roles and the client. */
export async function approveSuggestion(row, deps = {}) {
  const r = deps.roles || roles;
  const sb = deps.sb || window.sb;
  if (!row || !sb) return { ok: false, error: 'offline' };
  let existing = null;
  try {
    const { data, error } = await sb.rpc('athlete_plan_meta', { athlete: row.athlete_id });
    // A failed read must not become an empty {}: coach_set_goals replaces the whole JSON, and
    // writing {protein, calories} over it would wipe the plan style the coach set.
    if (error) return { ok: false, error: 'read' };
    existing = Array.isArray(data) && data[0] ? data[0].targets : null;
  } catch { return { ok: false, error: 'read' }; }
  const ok = await r.coachSetGoals(row.athlete_id, approvedTargets(existing, row));
  if (!ok) return { ok: false, error: 'targets' };
  return decide(row, 'approved', sb);
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
        SUGG.note[id] = yes ? "Couldn't approve it. Their targets are unchanged. Try again." : "Couldn't save that. Try again.";
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
