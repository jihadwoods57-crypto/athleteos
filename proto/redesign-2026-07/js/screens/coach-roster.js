/* OnStandard Coach OS — Roster tab (Task 8). Full team roster: search, sort, filter chips,
   sparklines, multi-select bulk actions (nudge / assign / group / excuse), and the two sheets
   for managing custom groups and marking athletes excused. Every write here follows Home's law:
   gate UI state changes on the helper's real success return, never clear a selection or close a
   sheet on a failed write, and say so honestly inline. */
import { RT, S, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc, sparkline, errorState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadBook, bookKindFor, entriesFor, logBookIntervention } from '../coach-data.js';
import { STATUS_META } from '../status.js';

/* nav:'operator' — load whichever book the signed-in role owns (see coach-home.js). */
const loadMyBook = (force) => loadBook(force, bookKindFor(RT.authRole));

/* Operator vocabulary — a trainer manages CLIENTS, not a roster of athletes. */
const VOCAB = {
  team: { title: 'Roster', search: 'Search athletes', loading: 'Loading the roster', offlineTitle: "Can't reach the roster", offlineBody: 'Your team and their scores are safe — reconnect and the roster loads right here.' },
  practice: { title: 'Clients', search: 'Search clients', loading: 'Loading your clients', offlineTitle: "Can't reach your clients", offlineBody: 'Your clients and their scores are safe — reconnect and the list loads right here.' },
};
const vocab = () => VOCAB[CD.kind] || VOCAB.team;

let Q = '', SORT = 'score', FILTER = { kind: 'all', value: null };
let SELECTING = false; const SEL = new Set();
let SHOW_GROUPS = false, SHOW_ABSENCE = false, BULK_STATUS = '';
let BULK_BUSY = false;

const STATUS_ORDER = ['overdue', 'no_activity', 'needs_review', 'below_standard', 'due_soon', 'excused', 'on_standard'];

const NO_MATCH_HTML = `<div style="padding:18px;text-align:center;font-size:12px;font-weight:600;color:var(--text-3)">No one matches that filter.</div>`;

function lastActivityLabel(iso) {
  if (!iso) return 'No recent activity';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'Active just now';
  if (h < 24) return `Active ${h}h ago`;
  return `Active ${Math.floor(h / 24)}d ago`;
}

function applyView(entries) {
  let list = entries;
  const q = Q.trim().toLowerCase();
  if (q) list = list.filter(e => e.row.name.toLowerCase().includes(q));
  if (FILTER.kind === 'position') list = list.filter(e => (e.row.position || '').toUpperCase() === FILTER.value);
  if (FILTER.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === FILTER.value);
    const ids = new Set((g && g.athlete_ids) || []);
    list = list.filter(e => ids.has(e.row.athleteId));
  }
  if (FILTER.kind === 'status') list = list.filter(e => e.status.key === FILTER.value);
  const by = {
    score: (a, b) => (b.row.score ?? -1) - (a.row.score ?? -1),
    status: (a, b) => STATUS_ORDER.indexOf(a.status.key) - STATUS_ORDER.indexOf(b.status.key),
    name: (a, b) => a.row.name.localeCompare(b.row.name),
    activity: (a, b) => String(b.row.lastMealAt || '').localeCompare(String(a.row.lastMealAt || '')),
  };
  return [...list].sort(by[SORT] || by.score);
}

function rosterRow(e) {
  const r = e.row, st = e.status, meta = STATUS_META[st.key];
  const sel = SEL.has(r.athleteId);
  // One calm status signal: a colored dot on the left. The label reads in quiet text-2,
  // not saturated body text — a roster full of red type reads as panic, not information.
  const scoreCol = r.score == null ? 'var(--text-3)' : r.score >= 80 ? 'var(--green-bright)' : r.score >= 60 ? 'var(--amber-bright)' : '#FF9B9B';
  return `
  <div class="roster-row" ${SELECTING ? `data-sel="${esc(r.athleteId)}"` : `data-go="coach-athlete/${esc(r.athleteId)}"`}>
    ${SELECTING
      ? `<div style="width:20px;height:20px;border-radius:6px;border:2px solid ${sel ? 'var(--green-bright)' : 'var(--hairline)'};background:${sel ? 'var(--green-bright)' : 'transparent'};display:grid;place-items:center;flex:none;color:#04140b;font-weight:900;font-size:12px">${sel ? '✓' : ''}</div>`
      : `<span style="width:9px;height:9px;border-radius:50%;background:${meta.color};flex:none;box-shadow:0 0 8px ${meta.color}40"></span>`}
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s" style="color:var(--text-2)">${esc(meta.label)} <span style="color:var(--text-3)">· ${esc(lastActivityLabel(r.lastMealAt))}</span></div>
    </div>
    ${sparkline(r.scoreHistory)}
    <span class="rs" style="color:${scoreCol};margin-left:8px">${r.score != null ? r.score : '—'}</span>
  </div>`;
}

function groupSheet(groups) {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Custom groups</div>
    ${groups.map(g => `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">${esc(g.name)}</div><div class="ls">${(g.athlete_ids || []).length} athlete${(g.athlete_ids || []).length === 1 ? '' : 's'}</div></div>
      ${SEL.size ? `<button class="btn ghost sm" data-gadd="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px">Add ${SEL.size}</button>` : ''}
      <button class="btn ghost sm" data-gdel="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px;margin-left:6px;color:var(--red)">Delete</button>
    </div>`).join('') || `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No groups yet.</div>`}
    <div style="display:flex;gap:7px;margin-top:10px">
      <input class="ob-input" id="group-name" maxlength="40" placeholder="New group name" style="flex:1;height:36px" />
      <button class="btn green sm" data-gnew style="width:auto;padding:0 12px;height:36px" ${SEL.size ? '' : 'disabled'}>Create with ${SEL.size || 0}</button>
    </div>
    <div id="group-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:5px"></div>
  </section>`;
}
function wireGroupSheet(root, teamId) {
  const status = (msg, bad) => { const el = root.querySelector('#group-status'); if (el) { el.style.color = bad ? 'var(--red)' : 'var(--green-bright)'; el.textContent = msg; } };
  root.querySelectorAll('[data-gnew]').forEach(b => b.addEventListener('click', async () => {
    const name = ((root.querySelector('#group-name') || {}).value || '').trim();
    if (!name) { status('Name the group first.', true); return; }
    b.disabled = true;
    const r = await roles.saveCoachGroup(teamId, { name, athleteIds: [...SEL] });
    if (r.ok) { act.markCoachSetup('group'); SEL.clear(); SELECTING = false; SHOW_GROUPS = false; await loadMyBook(true); }
    else { b.disabled = false; status(r.error || 'Could not save the group — check your connection.', true); }
  }));
  root.querySelectorAll('[data-gadd]').forEach(b => b.addEventListener('click', async () => {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === b.getAttribute('data-gadd'));
    if (!g) return;
    b.disabled = true;
    const merged = [...new Set([...(g.athlete_ids || []), ...SEL])];
    const r = await roles.saveCoachGroup(teamId, { id: g.id, name: g.name, athleteIds: merged });
    if (r.ok) { SEL.clear(); SELECTING = false; await loadMyBook(true); }
    else { b.disabled = false; status(r.error || 'Could not update the group.', true); }
  }));
  root.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const ok = await roles.deleteCoachGroup(b.getAttribute('data-gdel'));
    if (ok) { if (FILTER.kind === 'group') FILTER = { kind: 'all', value: null }; await loadMyBook(true); }
    else { b.disabled = false; status('Could not delete it — check your connection.', true); }
  }));
}
function absenceSheet() {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Excuse ${SEL.size} athlete${SEL.size === 1 ? '' : 's'}</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-2);line-height:1.5;margin-bottom:8px">Excused athletes drop out of the priority queue and today's completion math — and nothing pings them while excused.</div>
    <input class="ob-input" id="abs-reason" maxlength="120" placeholder="Reason (travel, injury, family…)" style="height:36px" />
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px">
      <button class="btn sm" data-abs="0" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:12px">Just today</button>
      <button class="btn ghost sm" data-abs="6" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:12px">Through the week</button>
    </div>
    <div id="abs-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:5px"></div>
  </section>`;
}
function wireAbsenceSheet(root, teamId) {
  root.querySelectorAll('[data-abs]').forEach(b => b.addEventListener('click', async () => {
    if (BULK_BUSY) return;
    const days = +b.getAttribute('data-abs');
    const reason = ((root.querySelector('#abs-reason') || {}).value || '').trim();
    const end = new Date(); end.setDate(end.getDate() + days);
    const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    BULK_BUSY = true; window.__render();
    let failed = 0;
    try {
      for (const id of [...SEL]) {
        const r = await roles.saveAthleteException(teamId, id, roles.todayISO(), endISO, reason);
        if (!r.ok) failed++;
      }
    } finally {
      BULK_BUSY = false;
    }
    if (failed) {
      window.__render();
      // Re-query after the render: the clicked BUTTON node is gone (root itself is the
      // persistent #device node and stays valid — only element references go stale).
      const el = document.querySelector('#abs-status');
      if (el) { el.style.color = 'var(--red)'; el.textContent = `Could not excuse ${failed} — check your connection.`; }
      return;
    }
    SEL.clear(); SELECTING = false; SHOW_ABSENCE = false;
    await loadMyBook(true);
  }));
}

/* Search must patch #roster-list in place — a full window.__render() per keystroke would
   replace the <input> node and drop focus/keyboard mid-word in a WebView (cf. foodsearch.js). */
function patchList(root) {
  const list = root.querySelector('#roster-list');
  if (!list) return;
  const entries = entriesFor({ kind: 'team', value: null }) || [];
  const view = applyView(entries);
  list.innerHTML = view.length ? view.map(rosterRow).join('') : NO_MATCH_HTML;
  list.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-sel'); SEL.has(id) ? SEL.delete(id) : SEL.add(id); window.__render();
  }));
  // Route through the router's origin-tracking navigate (NOT bare __go) so Back from the
  // athlete page returns to this filtered roster instead of the coach dashboard.
  list.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    window.__navigate(el.getAttribute('data-go'));
  }));
}

export const coachRoster = {
  nav: 'operator', tab: 'roster',
  render() {
    // A coach's avatar initials come from their HANDLE with the "Coach " prefix stripped
    // ("Coach Baker" → BA), which is not the same as name-initials — keep that exact derivation.
    // A trainer has no handle, so theirs come from their name.
    const initials = CD.kind === 'practice'
      ? S.operatorIdentity.initials
      : (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const head = avatarHead(vocab().title, CD.roster && CD.roster.book[0] ? CD.roster.book[0].name : '', initials);
    // Audit G-4: offline is checked BEFORE the loading gate — CD.extras stays null on a cold
    // offline load, so gating loading on !CD.extras first (as before) hid this card forever.
    if (CD.roster && CD.roster.offline) return `${head}${errorState({ title: vocab().offlineTitle, body: vocab().offlineBody, retryId: 'roster-retry' })}`;
    if (CD.roster === null || !CD.extras) return `${head}${skeletonRows(5, vocab().loading)}`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    if (!entries.length) return `${head}
      <div class="state-demo">
        <div class="sd-ic">${icon('users', 24)}</div>
        <div class="sd-t">No athletes yet</div>
        <div class="sd-s">Share your athlete code — everyone who joins shows up here in real time.</div>
        <div class="sd-cta" style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
          <button class="btn primary sm" data-go="coach-profile/code">${icon('share', 16)} Share athlete code</button>
          <button class="btn ghost sm" data-go="coach-plan-set/team">${icon('clipboard', 16)} Set your standard</button>
        </div>
      </div>`;

    const positions = [...new Set(entries.map(e => (e.row.position || '').toUpperCase()).filter(Boolean))].sort();
    const groups = (CD.extras && CD.extras.groups) || [];
    const list = applyView(entries);
    const fchip = (kind, value, label, dotColor) => {
      const on = FILTER.kind === kind && String(FILTER.value || '') === String(value || '');
      return `<button class="co-chip ${on ? 'on' : ''}" data-filter="${esc(kind)}:${esc(value == null ? '' : value)}">${dotColor ? `<span class="dot" style="background:${dotColor}"></span>` : ''}${esc(label)}</button>`;
    };
    return `${head}
    <div style="display:flex;gap:var(--s2);margin-bottom:var(--s3)">
      <input class="ob-input" id="roster-q" placeholder="${esc(vocab().search)}" value="${esc(Q)}" style="flex:1;height:38px" />
      <button class="btn ghost sm" data-sort style="width:auto;padding:0 12px;height:38px">${{ score: 'Score ↓', status: 'Status', name: 'A–Z', activity: 'Recent' }[SORT]}</button>
      <button class="btn ${SELECTING ? 'green' : 'ghost'} sm" data-selmode style="width:auto;padding:0 12px;height:38px">${SELECTING ? 'Done' : 'Select'}</button>
    </div>
    <div class="co-seg co-scroll">
      ${fchip('all', '', 'All')}${STATUS_ORDER.map(k => fchip('status', k, STATUS_META[k].label, STATUS_META[k].color)).join('')}${positions.map(p => fchip('position', p, p)).join('')}${groups.map(g => fchip('group', g.id, g.name)).join('')}
      ${CD.caps.groups ? '<button class="co-chip" data-groups>＋ Group</button>' : ''}
    </div>
    ${SHOW_GROUPS ? groupSheet(groups) : ''}
    ${SHOW_ABSENCE ? absenceSheet() : ''}
    <section class="card" id="roster-list" style="padding:2px 0">${list.length ? list.map(rosterRow).join('') : NO_MATCH_HTML}</section>
    ${SELECTING && SEL.size ? `
    <div class="card" style="position:sticky;bottom:calc(96px + env(safe-area-inset-bottom, 0px) + 8px);display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:9px;z-index:20">
      <button class="btn sm" data-bulk="nudge" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Nudge ${SEL.size}</button>
      ${CD.caps.assignments ? `<button class="btn ghost sm" data-bulk="assign" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Assign</button>` : ''}
      ${CD.caps.groups ? `<button class="btn ghost sm" data-bulk="group" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">→ Group</button>` : ''}
      ${CD.caps.exceptions ? `<button class="btn ghost sm" data-bulk="absence" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Excuse</button>` : ''}
    </div>` : ''}
    ${BULK_STATUS ? `<div id="bulk-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:4px">${esc(BULK_STATUS)}</div>` : ''}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadMyBook();
    BULK_STATUS = ''; // a stale "Nudged N." must not survive a tab revisit
    const rosterRetry = root.querySelector('#roster-retry');
    if (rosterRetry) rosterRetry.addEventListener('click', () => { rosterRetry.disabled = true; loadMyBook(true).then(() => window.__render()); });
    const q = root.querySelector('#roster-q');
    if (q) q.addEventListener('input', () => { Q = q.value; patchList(root); });
    root.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      SORT = { score: 'status', status: 'name', name: 'activity', activity: 'score' }[SORT]; window.__render();
    }));
    root.querySelectorAll('[data-selmode]').forEach(b => b.addEventListener('click', () => { SELECTING = !SELECTING; if (!SELECTING) SEL.clear(); BULK_STATUS = ''; window.__render(); }));
    root.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-sel'); SEL.has(id) ? SEL.delete(id) : SEL.add(id); window.__render();
    }));
    root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-filter').split(':');
      FILTER = kind === 'all' ? { kind: 'all', value: null } : { kind, value: value || null }; window.__render();
    }));
    root.querySelectorAll('[data-groups]').forEach(b => b.addEventListener('click', () => { SHOW_GROUPS = !SHOW_GROUPS; window.__render(); }));
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    root.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
      if (BULK_BUSY) return;
      const kind = b.getAttribute('data-bulk'); const ids = [...SEL];
      if (kind === 'nudge') {
        BULK_BUSY = true; BULK_STATUS = 'Sending…'; window.__render();
        const today = new Date().toISOString().slice(0, 10);
        const already = ids.filter(id => (RT.coachNudged || {})[id] === today);
        const toSend = ids.filter(id => (RT.coachNudged || {})[id] !== today);
        let sent = 0, failed = 0;
        try {
          for (const id of toSend) {
            const ok = await roles.nudgePush(id, `${S.operatorIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
            if (ok) { act.markNudged(id); await logBookIntervention({ athleteId: id, kind: 'nudge' }); sent++; }
            else failed++;
          }
        } finally {
          BULK_BUSY = false;
        }
        const parts = [`Nudged ${sent}.`];
        if (already.length) parts[0] = `Nudged ${sent} (${already.length} already nudged today).`;
        if (failed) parts.push(`${failed} failed — check your connection.`);
        BULK_STATUS = parts.join(' ');
        if (!failed) { SEL.clear(); SELECTING = false; }
        window.__render();
      } else if (kind === 'assign') {
        window.__go('coach-assign');   // composer already supports team/room scope; per-athlete multi-target lands with Create (slice C)
      } else if (kind === 'group') {
        SHOW_GROUPS = true; window.__render();
      } else if (kind === 'absence') {
        SHOW_ABSENCE = true; window.__render();
      }
    }));
    wireGroupSheet(root, teamId);
    wireAbsenceSheet(root, teamId);
  },
};
