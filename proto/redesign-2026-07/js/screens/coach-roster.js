/* OnStandard Coach OS — Roster tab (Task 8). Full team roster: search, sort, filter chips,
   sparklines, multi-select bulk actions (nudge / assign / group / excuse), and the two sheets
   for managing custom groups and marking athletes excused. Every write here follows Home's law:
   gate UI state changes on the helper's real success return, never clear a selection or close a
   sheet on a failed write, and say so honestly inline. */
import { RT, S, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc, sparkline, errorState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadBook, bookKindFor, entriesFor, bookId } from '../coach-data.js';
import { STATUS_META } from '../status.js';
import { styleLabel } from '../plan-style.js';
import { initialsOf } from '../initials.js';
import { hydrateAvatars } from '../avatar.js';
import { scoreColor, tierFor } from '../score-band.js';
import { nudgePreset, tierForStatus } from '../nudge-presets.js';
import { reasonKey } from '../priority.js';

/* Plan-style pill (0142): a one-letter chip naming the style a TEAM STANDARD governs for this
   row — S/G/I, or nothing when no standard sets one (most rosters, most of the time). This is
   deliberately the ONLY plan-style fact the roster shows per row; a per-athlete assignment or
   their own stated preference only becomes cheap to read once a coach opens that one athlete
   (see coach.js's coach-plan/<id> editor), never for a whole roster at once. */
const STYLE_LETTER = { structured: 'S', guided: 'G', intuitive: 'I' };
function stylePill(style) {
  if (!style) return '';
  const l = styleLabel(style);
  return `<span class="status-pill b" style="margin-left:6px;padding:1px 7px;font-size:10.5px" title="${esc(l.name)} standard">${STYLE_LETTER[style] || '?'}</span>`;
}

/* nav:'operator'. Load whichever book the signed-in role owns (see coach-home.js). */
const loadMyBook = (force) => loadBook(force, bookKindFor(RT.authRole));

/* Operator vocabulary. A trainer manages CLIENTS, not a roster of athletes. */
const VOCAB = {
  team: { title: 'Roster', search: 'Search athletes', loading: 'Loading the roster', offlineTitle: "Can't reach the roster", offlineBody: 'Your team and their scores are safe. Reconnect and the roster loads right here.' },
  practice: { title: 'Clients', search: 'Search clients', loading: 'Loading your clients', offlineTitle: "Can't reach your clients", offlineBody: 'Your clients and their scores are safe. Reconnect and the list loads right here.' },
};
const vocab = () => VOCAB[CD.kind] || VOCAB.team;

let Q = '', SORT = 'score', FILTER = { kind: 'all', value: null };
let SELECTING = false; const SEL = new Set();
let SHOW_GROUPS = false, SHOW_ABSENCE = false, BULK_STATUS = '';
let BULK_BUSY = false;
let GDEL = null;   // group id armed for delete (two-tap confirm), or null
let BULK_NUDGE_ARM = null;   // the editable bulk-nudge body while previewing, or null

const STATUS_ORDER = ['overdue', 'no_activity', 'needs_review', 'below_standard', 'due_soon', 'excused', 'on_standard'];

const NO_MATCH_HTML = `<div style="padding:18px;text-align:center;font-size:12px;font-weight:600;color:var(--text-3)">No one matches that filter.</div>`;

function lastActivityLabel(iso) {
  // "No logs yet", not "No recent activity": at 320w the longer string pushed the whole
  // status line into a mid-word ellipsis, and it says the same thing in half the room.
  if (!iso) return 'No logs yet';
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

/* The dot's colour and the score's colour BOTH already say "on standard" and "below standard",
   so repeating those two in words is noise. The other five statuses carry information neither
   can — and note overdue and below_standard are the same red, so dropping labels wholesale
   would merge them. */
const REDUNDANT_STATUS = new Set(['on_standard', 'below_standard']);

function rosterRow(e) {
  const r = e.row, st = e.status, meta = STATUS_META[st.key];
  const sel = SEL.has(r.athleteId);
  // One calm status signal: a colored dot on the left. The label reads in quiet text-2,
  // not saturated body text — a roster full of red type reads as panic, not information.
  const scoreCol = scoreColor(r.score);
  const activity = esc(lastActivityLabel(r.lastMealAt));
  const sub = REDUNDANT_STATUS.has(st.key)
    ? activity
    : `${esc(meta.label)} <span style="color:var(--text-3)">· ${activity}</span>`;
  /* data-vt-row is what makes a re-sort READABLE. Without it the fourteen rows snap into a new
     order and the coach has to re-read the whole list to find out what moved; with it each row
     travels from its old position to its new one and the movement itself carries the answer. The
     athlete id is the only stable identity a row has — an index would re-pair rows with whoever
     happens to be standing in that slot afterwards, which animates the exact opposite of the
     truth. See window.__restate() in js/router.js. */
  return `
  <div class="roster-row" data-vt-row="ath-${esc(r.athleteId)}" ${SELECTING
    ? `data-sel="${esc(r.athleteId)}" role="checkbox" aria-checked="${sel}" tabindex="0" aria-label="${esc(r.name)}"`
    : `data-go="coach-athlete/${esc(r.athleteId)}" role="button" tabindex="0" aria-label="${esc(r.name)}${r.score != null ? `, score ${r.score}` : ''}. ${esc(meta.label)}"`}>
    ${SELECTING
      ? `<div style="width:20px;height:20px;border-radius:6px;border:2px solid ${sel ? 'var(--green-bright)' : 'var(--hairline)'};background:${sel ? 'var(--green-bright)' : 'transparent'};display:grid;place-items:center;flex:none;color:var(--ink-on-accent);font-weight:900">${sel ? icon('check', 13) : ''}</div>`
      : `<span class="ros-av" data-avatar-uid="${esc(r.athleteId)}" aria-hidden="true"><span data-avatar-fallback>${esc(initialsOf(r.name, '?'))}</span><i class="ros-dot" style="background:${meta.color}"></i></span>`}
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s" style="color:var(--text-2)">${sub}</div>
    </div>
    <div class="rr">
      ${sparkline(r.scoreHistory)}
      <span class="rs" style="color:${scoreCol}">${r.score != null ? r.score : '—'}</span>${stylePill(e.planStyle)}
    </div>
  </div>`;
}

/* ---------------- standing bands ----------------
   The roster is sorted by score and rendered as one card of uniform rows, which makes a 14-person
   squad a fourteen-line column where a 96 and a 47 look exactly alike: the coach has to read
   every line to find the two people who need them. The sort already knows the answer — these
   heads make it visible, so the shape of the day lands before a single name is read.

   Tier names and thresholds come from tierFor() (score-band.js); nothing is re-inlined here, so
   the roster can never disagree with the badge on the athlete's own screen. Rows with no score
   are their own trailing band, because "hasn't logged" is a different fact from "scored low" and
   the coach acts on it differently.

   Bands appear only when the score sort is doing the ordering and the list is the whole book:
   under a name/status/recent sort or a search the ordering means something else, and a band head
   would be labelling a list it did not arrange. */
const BAND_COLOR_BY_CLS = { g: 'var(--green-bright)', b: 'var(--blue-bright)', a: 'var(--amber-bright)', r: 'var(--red-bright)' };
function bandKeyFor(e) {
  if (e.row.score == null) return { key: 'none', name: 'No log today', color: 'var(--text-3)' };
  const t = tierFor(e.row.score);
  return { key: t.cls, name: t.name, color: BAND_COLOR_BY_CLS[t.cls] || 'var(--text-3)' };
}
/* Select mode keeps its bands. Dropping them there would re-flow the whole list the instant the
   coach taps Select — the rows they were aiming at jump, which is the worst possible moment for
   the layout to move. Checkboxes replace the status dot inside the row; the heads are untouched. */
function bandsApply() {
  return SORT === 'score' && !Q.trim() && FILTER.kind !== 'status';
}
function listHtml(view) {
  if (!view.length) return NO_MATCH_HTML;
  if (!bandsApply()) return view.map(rosterRow).join('');
  let out = '', current = null;
  for (let i = 0; i < view.length; i++) {
    const b = bandKeyFor(view[i]);
    if (b.key !== current) {
      current = b.key;
      let n = 0;
      for (let j = i; j < view.length && bandKeyFor(view[j]).key === b.key; j++) n++;
      out += `<header class="ro-band"><span class="l"><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</span><span class="n">${n}</span></header>`;
    }
    out += rosterRow(view[i]);
  }
  return out;
}

function groupSheet(groups) {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Custom groups</div>
    ${groups.map(g => GDEL === g.id ? `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">Delete ${esc(g.name)}?</div><div class="ls">Groups are filters; nobody leaves the roster.</div></div>
      <button class="btn ghost micro" data-gdel-cancel="1" style="width:auto">Keep</button>
      <button class="btn sm" data-gdel-confirm="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px;margin-left:6px;background:var(--danger-solid);color:#fff;border:none">Delete group</button>
    </div>` : `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">${esc(g.name)}</div><div class="ls">${(g.athlete_ids || []).length} ${CD.noun}${(g.athlete_ids || []).length === 1 ? '' : 's'}</div></div>
      ${SEL.size ? `<button class="btn ghost micro" data-gadd="${esc(g.id)}" style="width:auto">Add ${SEL.size}</button>` : ''}
      <button class="btn ghost sm" data-gdel="${esc(g.id)}" style="width:auto;padding:0 10px;height:30px;margin-left:6px;color:var(--red)">Delete</button>
    </div>`).join('') || `<div style="font-size:12px;font-weight:600;color:var(--text-3)">No groups yet.</div>`}
    <div style="display:flex;gap:7px;margin-top:10px">
      <input class="ob-input" id="group-name" maxlength="40" placeholder="New group name" style="flex:1;height:36px" />
      <button class="btn green xs" data-gnew style="width:auto" ${SEL.size ? '' : 'disabled'}>Create with ${SEL.size || 0}</button>
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
    const r = await roles.saveCoachGroup(teamId, { name, athleteIds: [...SEL] }, CD.kind);
    if (r.ok) { act.markCoachSetup('group'); SEL.clear(); SELECTING = false; SHOW_GROUPS = false; await loadMyBook(true); }
    else { b.disabled = false; status(r.error || 'Could not save the group. Check your connection.', true); }
  }));
  root.querySelectorAll('[data-gadd]').forEach(b => b.addEventListener('click', async () => {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === b.getAttribute('data-gadd'));
    if (!g) return;
    b.disabled = true;
    const merged = [...new Set([...(g.athlete_ids || []), ...SEL])];
    const r = await roles.saveCoachGroup(teamId, { id: g.id, name: g.name, athleteIds: merged }, CD.kind);
    if (r.ok) { SEL.clear(); SELECTING = false; await loadMyBook(true); }
    else { b.disabled = false; status(r.error || 'Could not update the group.', true); }
  }));
  // Two-tap delete: first tap arms the row (a group is only a filter, and the row says so),
  // the explicit "Delete group" executes.
  root.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', () => { GDEL = b.getAttribute('data-gdel'); window.__render(); }));
  root.querySelectorAll('[data-gdel-cancel]').forEach(b => b.addEventListener('click', () => { GDEL = null; window.__render(); }));
  root.querySelectorAll('[data-gdel-confirm]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const ok = await roles.deleteCoachGroup(b.getAttribute('data-gdel-confirm'));
    GDEL = null;
    if (ok) { if (FILTER.kind === 'group') FILTER = { kind: 'all', value: null }; await loadMyBook(true); }
    else {
      window.__render();
      // Re-query after the render (same pattern as the absence sheet) — the old node is gone.
      const el = document.querySelector('#group-status');
      if (el) { el.style.color = 'var(--red)'; el.textContent = 'Could not delete it. Check your connection.'; }
    }
  }));
}
function absenceSheet() {
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Excuse ${SEL.size} ${CD.noun}${SEL.size === 1 ? '' : 's'}</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-2);line-height:1.5;margin-bottom:8px">Excused ${CD.nouns} drop out of the priority queue and today's completion math. And nothing pings them while excused.</div>
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
        const r = await roles.saveAthleteException(teamId, id, roles.todayISO(), endISO, reason, CD.kind);
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
      if (el) { el.style.color = 'var(--red)'; el.textContent = `Could not excuse ${failed}. Check your connection.`; }
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
  list.innerHTML = listHtml(view);
  hydrateAvatars(list);
  list.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => toggleSel(root, b.getAttribute('data-sel'))));
  // Route through the router's origin-tracking navigate (NOT bare __go) so Back from the
  // athlete page returns to this filtered roster instead of the coach dashboard.
  list.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    window.__navigate(el.getAttribute('data-go'));
  }));
}

/* A select-mode tap patches in place instead of tearing down the whole shell: window.__render()
   per tap re-ran mount() (and loadMyBook) and replaced the search input, dropping its focus and
   keyboard mid-filter — the exact hazard patchList exists for. Only the 0-to-1 boundary pays for
   a full render, because the sticky bulk bar mounts and unmounts there. */
function toggleSel(root, id) {
  SEL.has(id) ? SEL.delete(id) : SEL.add(id);
  if (SEL.size <= 1) { window.__render(); return; }
  patchList(root);
  updateBulkCounts(root);
}
function updateBulkCounts(root) {
  const n = SEL.size;
  const nudge = root.querySelector('[data-bulk="nudge"]');
  if (nudge) nudge.textContent = `Nudge ${n}`;
  const send = root.querySelector('[data-bulk="nudgesend"]');
  if (send) send.textContent = `Send to ${n}`;
  const note = root.querySelector('#bulk-nudge-note');
  if (note) note.textContent = `This exact message goes to all ${n}, from "${S.operatorIdentity.handle} is waiting".`;
}

export const coachRoster = {
  nav: 'operator', tab: 'roster',
  render() {
    // ONE derivation, shared with coach-home. This screen used to re-derive a team coach's
    // initials from their HANDLE with the "Coach " prefix stripped ("Coach Reynolds" → RE) while
    // coach-home used S.operatorIdentity (name initials → DR). Same signed-in person, two sets of
    // initials on two consecutive screens. Whichever rule is "right", it can only be one of them,
    // and operatorIdentity is the one that already resolves coach vs trainer correctly.
    const head = avatarHead(vocab().title, CD.roster && CD.roster.book[0] ? CD.roster.book[0].name : '', S.operatorIdentity.initials);
    // Audit G-4: offline is checked BEFORE the loading gate — CD.extras stays null on a cold
    // offline load, so gating loading on !CD.extras first (as before) hid this card forever.
    if (CD.roster && CD.roster.offline) return `${head}${errorState({ title: vocab().offlineTitle, body: vocab().offlineBody, retryId: 'roster-retry' })}`;
    if (CD.roster === null || !CD.extras) return `${head}${skeletonRows(5, vocab().loading)}`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    if (!entries.length) {
      // coach-profile is nav:'coach' — a trainer tapping it gets silently bounced by the router,
      // so the practice book routes its share action to the Practice HQ (which owns the code).
      const practice = CD.kind === 'practice';
      const noun = practice ? 'client' : 'athlete';
      return `${head}
      <div class="state-demo">
        <div class="sd-ic">${icon('users', 24)}</div>
        <div class="sd-t">No ${noun}s yet</div>
        <div class="sd-s">Share your ${noun} code. Everyone who joins shows up here in real time.</div>
        <div class="sd-cta" style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
          <button class="btn primary sm" data-go="${practice ? 'trainer-profile' : 'coach-profile/code'}">${icon('share', 16)} Share ${noun} code</button>
          <button class="btn ghost sm" data-go="coach-plan-set/team">${icon('clipboard', 16)} Set your standard</button>
        </div>
      </div>`;
    }

    const positions = [...new Set(entries.map(e => (e.row.position || '').toUpperCase()).filter(Boolean))].sort();
    const groups = (CD.extras && CD.extras.groups) || [];
    const list = applyView(entries);
    // All seven status chips rendered unconditionally, so a one-athlete roster shipped eight
    // filters — six of which could only ever return "No one matches that filter." A filter for a
    // status nobody has is a dead control and pure scan cost on the screen a coach uses to find
    // who needs attention fastest. Render only the statuses actually present, and put the count
    // on the chip so the row doubles as the roster's shape at a glance. A full squad still gets
    // every chip it earns; the currently-selected one is kept even if a search empties it, so the
    // control you just used can't vanish under you.
    const statusCount = entries.reduce((m, e) => (m[e.status.key] = (m[e.status.key] || 0) + 1, m), {});
    const liveStatuses = STATUS_ORDER
      .map((k) => [k, statusCount[k] || 0])
      .filter(([k, n]) => n > 0 || (FILTER.kind === 'status' && FILTER.value === k));
    const fchip = (kind, value, label, dotColor) => {
      const on = FILTER.kind === kind && String(FILTER.value || '') === String(value || '');
      return `<button class="co-chip ${on ? 'on' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-filter="${esc(kind)}:${esc(value == null ? '' : value)}">${dotColor ? `<span class="dot" style="background:${dotColor}"></span>` : ''}${esc(label)}</button>`;
    };
    return `${head}
    <div class="rtools">
      <input class="ob-input rq" id="roster-q" placeholder="${esc(vocab().search)}" value="${esc(Q)}" />
      <button class="btn ghost sm" data-sort>Sort: ${{ score: 'Score', status: 'Status', name: 'A–Z', activity: 'Recent' }[SORT]}</button>
      <button class="btn ${SELECTING ? 'green' : 'ghost'} sm" data-selmode>${SELECTING ? 'Done' : 'Select'}</button>
    </div>
    <div class="co-seg co-scroll">
      ${fchip('all', '', `All ${entries.length}`)}${liveStatuses.map(([k, n]) => fchip('status', k, `${STATUS_META[k].label} ${n}`, STATUS_META[k].color)).join('')}${positions.map(p => fchip('position', p, p)).join('')}${groups.map(g => fchip('group', g.id, g.name)).join('')}
      ${CD.caps.groups ? `<button class="co-chip" data-groups>${icon('plus', 12)} Group</button>` : ''}
    </div>
    ${SHOW_GROUPS ? groupSheet(groups) : ''}
    ${SHOW_ABSENCE ? absenceSheet() : ''}
    <section class="card" id="roster-list" style="padding:2px 0">${listHtml(list)}</section>
    ${SELECTING && SEL.size ? (BULK_NUDGE_ARM != null ? `
    <div class="card" style="position:sticky;bottom:calc(var(--nav-h) + 19px + env(safe-area-inset-bottom, 0px) + 8px);padding:9px;z-index:20">
      <input id="bulk-nudge-body" class="ob-input" maxlength="120" value="${esc(BULK_NUDGE_ARM)}" aria-label="Nudge message" style="width:100%;height:36px;font-size:var(--t-sm)" />
      <div id="bulk-nudge-note" style="font-size:var(--t-xs);font-weight:600;color:var(--text-3);margin:6px 0">This exact message goes to all ${SEL.size}, from "${esc(S.operatorIdentity.handle)} is waiting".</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <button class="btn ghost sm" data-bulk="nudgecancel" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-xs)">Cancel</button>
        <button class="btn sm" data-bulk="nudgesend" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-xs)">Send to ${SEL.size}</button>
      </div>
    </div>` : `
    <div class="card" style="position:sticky;bottom:calc(var(--nav-h) + 19px + env(safe-area-inset-bottom, 0px) + 8px);display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:9px;z-index:20">
      <button class="btn sm" data-bulk="nudge" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-sm)">Nudge ${SEL.size}</button>
      ${CD.caps.assignments ? `<button class="btn ghost sm" data-bulk="assign" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-sm)">Assign</button>` : ''}
      ${CD.caps.groups ? `<button class="btn ghost sm" data-bulk="group" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-sm)">→ Group</button>` : ''}
      ${CD.caps.exceptions ? `<button class="btn ghost sm" data-bulk="absence" ${BULK_BUSY ? 'disabled' : ''} style="font-size:var(--t-sm)">Excuse</button>` : ''}
    </div>`) : ''}
    ${BULK_STATUS ? `<div id="bulk-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:4px">${esc(BULK_STATUS)}</div>` : ''}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadMyBook();
    BULK_STATUS = ''; // a stale "Nudged N." must not survive a tab revisit
    const rosterRetry = root.querySelector('#roster-retry');
    if (rosterRetry) rosterRetry.addEventListener('click', () => { rosterRetry.disabled = true; loadMyBook(true).then(() => window.__render()); });
    const q = root.querySelector('#roster-q');
    // Debounced (the profile school search's own idiom): patchList rebuilds the list subtree and
    // re-wires per-row listeners, and per-keystroke that grows linearly with the roster.
    let qTimer = null;
    if (q) q.addEventListener('input', () => {
      Q = q.value;
      if (qTimer) clearTimeout(qTimer);
      qTimer = setTimeout(() => { qTimer = null; patchList(root); }, 120);
    });
    root.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      // The sort is the flagship case: fourteen rows re-ordering is information, not a repaint.
      SORT = { score: 'status', status: 'name', name: 'activity', activity: 'score' }[SORT]; window.__restate();
    }));
    root.querySelectorAll('[data-selmode]').forEach(b => b.addEventListener('click', () => { SELECTING = !SELECTING; if (!SELECTING) SEL.clear(); BULK_STATUS = ''; BULK_NUDGE_ARM = null; window.__restate(); }));
    root.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => toggleSel(root, b.getAttribute('data-sel'))));
    root.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-filter').split(':');
      FILTER = kind === 'all' ? { kind: 'all', value: null } : { kind, value: value || null }; window.__restate();
    }));
    root.querySelectorAll('[data-groups]').forEach(b => b.addEventListener('click', () => { SHOW_GROUPS = !SHOW_GROUPS; window.__restate(); }));
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    root.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
      if (BULK_BUSY) return;
      const kind = b.getAttribute('data-bulk'); const ids = [...SEL];
      if (kind === 'nudge') {
        // Two-step: arm the editable preview first — the coach reads the exact words before
        // they go to N phones under their name.
        // Bulk-nudge targets whatever the operator selected — "overdue" would be a lie for
        // an athlete who's current, so the default body stays neutral.
        BULK_NUDGE_ARM = nudgePreset(null);
        window.__render();
      } else if (kind === 'nudgecancel') {
        BULK_NUDGE_ARM = null; window.__render();
      } else if (kind === 'nudgesend') {
        const input = root.querySelector('#bulk-nudge-body');
        const body = ((input && input.value) || '').trim() || 'Time to get your log in.';
        BULK_NUDGE_ARM = null;
        BULK_BUSY = true; BULK_STATUS = 'Sending…'; window.__render();
        const today = roles.todayISO();
        const already = ids.filter(id => (RT.coachNudged || {})[id] === today);
        const toSend = ids.filter(id => (RT.coachNudged || {})[id] !== today);
        // Status per athlete, so each intervention row carries the reason_key that clears the
        // coach-home queue (a bare kind:'nudge' row is invisible to buildPriorities).
        const statusById = {};
        for (const e of (entriesFor({ kind: 'team', value: null }) || [])) statusById[e.row.athleteId] = e.status;
        /* ONE server call for the whole selection (scale pass 2026-08-18). The old loop was
           serial per athlete with a 300 ms stagger and a guaranteed rate-limit cliff at
           athlete 21; the server now fans out, dedupes, writes the bell rows AND the
           intervention rows (with these reason keys, so the coach-home queue still clears),
           and returns per-athlete truth. */
        let r = null;
        try {
          if (toSend.length) {
            const reasons = {};
            for (const id of toSend) {
              const st = statusById[id];
              if (st) reasons[id] = { reason_key: reasonKey(st), tier: tierForStatus(st.key) || null };
            }
            r = await roles.bulkNudgePush(toSend, `${S.operatorIdentity.handle} is waiting`, body, {
              bookId: bookId(), book: CD.kind, reasons,
            });
            if (r && r.ok) {
              for (const row of (r.results || [])) {
                if (row && !row.deduped && !row.suppressed) act.markNudged(row.athlete_id);
              }
            }
          }
        } finally {
          BULK_BUSY = false;
        }
        const failedAll = toSend.length && (!r || !r.ok);
        const parts = [];
        if (failedAll) {
          parts.push(r && r.rateLimited ? 'The send limit is busy. Try again in a minute.' : 'Could not send. Check your connection.');
        } else {
          const sent = r ? r.sent : 0;
          parts.push(already.length ? `Nudged ${sent} (${already.length} already nudged today).` : `Nudged ${sent}.`);
          if (r && r.inboxOnly) parts.push(`${r.inboxOnly} land in-app only (no push set up).`);
          if (r && r.deduped) parts.push(`${r.deduped} just got one and were skipped.`);
        }
        BULK_STATUS = parts.join(' ');
        if (!failedAll) { SEL.clear(); SELECTING = false; }
        window.__render();
      } else if (kind === 'assign') {
        // The composer targets team/room scope or ONE athlete (coach-assign/<id>); per-athlete
        // multi-target lands with Create (slice C). Until then the selection is never silently
        // dropped: one selected deep-links to them, more than one says so honestly.
        if (ids.length === 1) { window.__go('coach-assign/' + ids[0]); return; }
        BULK_STATUS = `Assign targets one ${CD.noun} at a time for now. Keep one selected, or assign to everyone from Create.`;
        window.__render();
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
