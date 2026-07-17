/* OnStandard Coach OS — Roster tab (Task 8). Full team roster: search, sort, filter chips,
   sparklines, multi-select bulk actions (nudge / assign / group / excuse), and the two sheets
   for managing custom groups and marking athletes excused. Every write here follows Home's law:
   gate UI state changes on the helper's real success return, never clear a selection or close a
   sheet on a failed write, and say so honestly inline. */
import { RT, S, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc, sparkline } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster, entriesFor } from '../coach-data.js';
import { STATUS_META } from '../status.js';

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
  return `
  <div class="roster-row" ${SELECTING ? `data-sel="${esc(r.athleteId)}"` : `data-go="coach-athlete/${esc(r.athleteId)}"`}>
    ${SELECTING ? `<div style="width:20px;height:20px;border-radius:6px;border:2px solid ${sel ? 'var(--green-bright)' : 'var(--hairline)'};background:${sel ? 'var(--green-bright)' : 'transparent'};display:grid;place-items:center;flex:none">${sel ? '✓' : ''}</div>` : `<div class="flagdot ${r.flag}"></div>`}
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s"><span style="color:${meta.color};font-weight:800">${meta.label}</span> · ${esc(lastActivityLabel(r.lastMealAt))}</div>
    </div>
    ${sparkline(r.scoreHistory)}
    <span class="rs" style="color:${r.score == null ? 'var(--text-3)' : r.score >= 80 ? 'var(--green-bright)' : r.score >= 60 ? 'var(--amber-bright)' : 'var(--red)'};margin-left:8px">${r.score != null ? r.score : '—'}</span>
  </div>`;
}

function groupSheet(groups) {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Custom groups</div>
    ${groups.map(g => `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">${esc(g.name)}</div><div class="ls">${(g.athlete_ids || []).length} athletes</div></div>
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
    if (r.ok) { SEL.clear(); SELECTING = false; SHOW_GROUPS = false; await loadCoachRoster(true); }
    else { b.disabled = false; status(r.error || 'Could not save the group — check your connection.', true); }
  }));
  root.querySelectorAll('[data-gadd]').forEach(b => b.addEventListener('click', async () => {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === b.getAttribute('data-gadd'));
    if (!g) return;
    b.disabled = true;
    const merged = [...new Set([...(g.athlete_ids || []), ...SEL])];
    const r = await roles.saveCoachGroup(teamId, { id: g.id, name: g.name, athleteIds: merged });
    if (r.ok) { SEL.clear(); SELECTING = false; await loadCoachRoster(true); }
    else { b.disabled = false; status(r.error || 'Could not update the group.', true); }
  }));
  root.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const ok = await roles.deleteCoachGroup(b.getAttribute('data-gdel'));
    if (ok) { if (FILTER.kind === 'group') FILTER = { kind: 'all', value: null }; await loadCoachRoster(true); }
    else { b.disabled = false; status('Could not delete it — check your connection.', true); }
  }));
}
function absenceSheet() {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Excuse ${SEL.size} athlete${SEL.size > 1 ? 's' : ''}</div>
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
    await loadCoachRoster(true);
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
  nav: 'coach', tab: 'roster',
  render() {
    const initials = (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const head = avatarHead('Roster', CD.roster && CD.roster.teams[0] ? CD.roster.teams[0].name : '', initials);
    if (CD.roster === null || !CD.extras) return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div><div><div class="tt">Loading the roster…</div><div class="ts">Real statuses, real scores.</div></div></div>`;
    if (CD.roster.offline) return `${head}<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div><div class="sd-t">Can't reach the roster</div><div class="sd-s">Check your connection and reopen.</div></div>`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    if (!entries.length) return `${head}<div class="state-demo"><div class="sd-ic">${icon('users', 24)}</div><div class="sd-t">No athletes yet</div><div class="sd-s">Share your team code from your profile — every athlete who joins shows up here.</div></div>`;

    const positions = [...new Set(entries.map(e => (e.row.position || '').toUpperCase()).filter(Boolean))].sort();
    const groups = (CD.extras && CD.extras.groups) || [];
    const list = applyView(entries);
    const fchip = (kind, value, label) => {
      const on = FILTER.kind === kind && String(FILTER.value || '') === String(value || '');
      return `<button class="btn ${on ? 'green' : 'ghost'} sm" data-filter="${esc(kind)}:${esc(value == null ? '' : value)}" style="width:auto;padding:0 11px;height:29px;flex:none">${esc(label)}</button>`;
    };
    return `${head}
    <div style="display:flex;gap:7px;margin-bottom:8px">
      <input class="ob-input" id="roster-q" placeholder="Search athletes" value="${esc(Q)}" style="flex:1;height:36px" />
      <button class="btn ghost sm" data-sort style="width:auto;padding:0 11px;height:36px">${{ score: 'Score ↓', status: 'Status', name: 'A–Z', activity: 'Recent' }[SORT]}</button>
      <button class="btn ${SELECTING ? 'green' : 'ghost'} sm" data-selmode style="width:auto;padding:0 11px;height:36px">${SELECTING ? 'Done' : 'Select'}</button>
    </div>
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin:0 -2px 4px">
      ${fchip('all', '', 'All')}${STATUS_ORDER.map(k => fchip('status', k, STATUS_META[k].label)).join('')}${positions.map(p => fchip('position', p, p)).join('')}${groups.map(g => fchip('group', g.id, g.name)).join('')}
      <button class="btn ghost sm" data-groups style="width:auto;padding:0 11px;height:29px;flex:none">＋ Group</button>
    </div>
    ${SHOW_GROUPS ? groupSheet(groups) : ''}
    ${SHOW_ABSENCE ? absenceSheet() : ''}
    <section class="card" id="roster-list" style="padding:2px 0">${list.length ? list.map(rosterRow).join('') : NO_MATCH_HTML}</section>
    ${SELECTING && SEL.size ? `
    <div class="card" style="position:sticky;bottom:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:9px">
      <button class="btn sm" data-bulk="nudge" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Nudge ${SEL.size}</button>
      <button class="btn ghost sm" data-bulk="assign" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Assign</button>
      <button class="btn ghost sm" data-bulk="group" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">→ Group</button>
      <button class="btn ghost sm" data-bulk="absence" ${BULK_BUSY ? 'disabled' : ''} style="height:34px;font-size:11.5px">Excuse</button>
    </div>` : ''}
    ${BULK_STATUS ? `<div id="bulk-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:4px">${esc(BULK_STATUS)}</div>` : ''}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadCoachRoster();
    BULK_STATUS = ''; // a stale "Nudged N." must not survive a tab revisit
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
            const ok = await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
            if (ok) { act.markNudged(id); await roles.logIntervention({ teamId, athleteId: id, kind: 'nudge' }); sent++; }
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
