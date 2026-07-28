/* #coach-rooms — position rooms builder + assignment (T-04, slices 1+2). Create first-class rooms
   (from roster positions or a custom name), see who's in each, and assign the Needs-Assignment queue.
   Athletes auto-map to a room by position on join (server, 0101); this screen is the manual override.
   Slice 2 stops short of a room-scoped-standard editor UI (a room's standard is still authored via
   the standards editor's position scope) — that editor is slice 3. */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, emptyState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster } from '../coach-data.js';
import { suggestedRooms, slugifyRoomKey, groupRosterByRoom } from '../rooms.js';

const teamId = () => CD.roster && CD.roster.teams && CD.roster.teams[0] && CD.roster.teams[0].id;
const rosterRows = () => (CD.roster && CD.roster.rows) || [];
const rosterPositions = () => rosterRows().map((r) => (r.position || '').toUpperCase());

let BUSY = false;        // guards double-submit while a write + reload is in flight
let STAFF = null;        // team staff list (for the owner picker), lazy-loaded in mount
let OPEN_OWNER = null;   // roomId whose owner picker is expanded, or null
let RENAMING = null;     // roomId currently showing its inline rename input, or null

async function run(work) {
  if (BUSY) return;
  BUSY = true; window.__render();
  try { await work(); } finally { BUSY = false; window.__render(); }
}
const staffName = (id) => { const s = (STAFF || []).find((x) => x.staff_id === id); return s ? s.name : null; };
const setOwner = (roomId, staffId) => run(async () => { OPEN_OWNER = null; const r = await roles.setRoomOwner(roomId, staffId); if (r.ok) await loadCoachRoster(true); });
const createRoom = (label) => run(async () => {
  const id = teamId(); const key = slugifyRoomKey(label);
  if (!id || !key) return;
  const r = await roles.saveTeamRoom(id, { key, label: label.trim().slice(0, 40) });
  if (r.ok) { try { act.markCoachSetup('group'); } catch { /* best-effort */ } await loadCoachRoster(true); }
});
const deleteRoom = (roomId) => run(async () => { if (await roles.deleteTeamRoom(roomId)) await loadCoachRoster(true); });
// Rename reuses saveTeamRoom's existing update-by-id path (it already upserts on `id`) —
// no new backend call needed. The room's key (used by position auto-assignment matching)
// is deliberately left untouched by a rename; only the display label changes.
const renameRoom = (room, label) => run(async () => {
  const clean = String(label || '').trim().slice(0, 40);
  if (!clean || clean === room.label) { RENAMING = null; return; }
  const r = await roles.saveTeamRoom(teamId(), { id: room.id, key: room.key, label: clean });
  RENAMING = null;
  if (r.ok) await loadCoachRoster(true);
});
const assign = (athleteId, roomId) => run(async () => { const r = await roles.assignAthleteRoom(athleteId, roomId); if (r.ok) await loadCoachRoster(true); });

export const coachRooms = {
  nav: 'coach', tab: 'profile',
  render() {
    if (CD.roster === null || !CD.extras) return `${backHead('Rooms', 'Position units for your team.', 'coach-profile')}${skeletonRows(3, 'Loading your team')}`;
    const rooms = (CD.extras && CD.extras.rooms) || [];
    const { byRoom, needs } = groupRosterByRoom(rosterRows(), rooms);
    const suggestions = suggestedRooms(rosterPositions(), rooms);

    const roomCard = (rm) => {
      const members = byRoom.get(rm.id) || [];
      return `
      <section class="card" style="padding:6px 16px;margin-bottom:10px">
        ${RENAMING === rm.id ? `
        <div class="lrow" style="cursor:default;gap:8px">
          <input class="ob-input room-rename-input" data-room-rename-input="${esc(rm.id)}" maxlength="40" value="${esc(rm.label)}" style="flex:1" />
          <button class="btn sm" data-room-rename-save="${esc(rm.id)}" style="width:auto;padding:0 12px;height:34px">Save</button>
          <button class="btn ghost sm" data-room-rename-cancel="1" style="width:auto;padding:0 12px;height:34px">Cancel</button>
        </div>` : `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:rgba(59,130,246,0.14);color:var(--blue-bright)">${icon('users', 17)}</div>
          <div class="lm"><div class="lt">${esc(rm.label)}</div><div class="ls">${members.length ? `${members.length} athlete${members.length === 1 ? '' : 's'}` : 'No one assigned yet'}</div></div>
          <button class="btn ghost sm" data-room-rename="${esc(rm.id)}" aria-label="Rename room" style="width:34px;padding:0;height:30px;flex:none">${icon('edit', 15)}</button>
          <button class="btn ghost sm" data-go="coach-plan-set/position/${esc(String(rm.label).trim().toUpperCase())}" style="width:auto;padding:0 12px;height:30px">Standard</button>
          <button class="btn ghost sm" data-room-del="${esc(rm.id)}" style="width:auto;padding:0 10px;height:30px;color:var(--red);margin-left:6px">Delete</button>
        </div>`}
        <div class="lrow" data-owner-toggle="${esc(rm.id)}" style="cursor:pointer;padding-left:6px">
          <div class="xico sm gray" style="width:26px;height:26px">${icon('user', 15)}</div>
          <div class="lm"><div class="lt" style="font-size:13.5px">Room owner</div><div class="ls">${rm.staff_owner_id ? (staffName(rm.staff_owner_id) ? esc(staffName(rm.staff_owner_id)) : 'Assigned') : 'Unassigned · tap to set'}</div></div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
        ${OPEN_OWNER === rm.id ? `<div class="chip-row" style="margin:2px 0 8px 6px">
          ${(STAFF || []).map((s) => `<span class="chp ${s.staff_id === rm.staff_owner_id ? 'on' : ''}" data-set-owner="${esc(rm.id)}|${esc(s.staff_id)}">${esc(s.name)}</span>`).join('') || '<span class="ls">No staff yet — invite staff first.</span>'}
          ${rm.staff_owner_id ? `<span class="chp" data-set-owner="${esc(rm.id)}|">Clear</span>` : ''}
        </div>` : ''}
        ${members.map((m) => `
        <div class="lrow" style="cursor:default;padding-left:6px">
          <div class="xico sm gray" style="width:26px;height:26px">${esc((m.name || 'A').trim().charAt(0).toUpperCase())}</div>
          <div class="lm"><div class="lt" style="font-size:14px">${esc(m.name)}</div>${m.position ? `<div class="ls">${esc(m.position)}</div>` : ''}</div>
          <button class="btn ghost sm" data-room-unassign="${esc(m.athleteId)}" style="width:auto;padding:0 10px;height:28px;font-size:11px">Remove</button>
        </div>`).join('')}
      </section>`;
    };

    const needsCard = needs.length && rooms.length ? `
      <div class="eyebrow" style="color:var(--amber-bright)">Needs assignment · ${needs.length}</div>
      <section class="card" style="padding:6px 16px;background:var(--amber-surface);border-color:var(--amber-border)">
        ${needs.map((m) => `
        <div class="lrow" style="cursor:default;display:block;padding:10px 4px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div class="xico sm gray" style="width:26px;height:26px">${esc((m.name || 'A').trim().charAt(0).toUpperCase())}</div>
            <div class="lm"><div class="lt" style="font-size:14px">${esc(m.name)}</div>${m.position ? `<div class="ls">${esc(m.position)}</div>` : ''}</div>
          </div>
          <div class="chip-row" style="margin:0">${rooms.map((rm) => `<span class="chp" data-assign="${esc(m.athleteId)}|${esc(rm.id)}">${esc(rm.label)}</span>`).join('')}</div>
        </div>`).join('')}
      </section>` : '';

    const roomList = rooms.length
      ? rooms.map(roomCard).join('')
      : emptyState({ icon: 'users', title: 'No rooms yet', body: 'Create a room for each position group. Athletes drop into their room as they join.' });

    const suggestChips = suggestions.length ? `
      <div class="eyebrow">Suggested from your roster · tap to add</div>
      <div class="chip-row" id="room-suggest">
        ${suggestions.map((s) => `<span class="chp" data-room-add="${esc(s.label)}">＋ ${esc(s.label)}</span>`).join('')}
      </div>` : '';

    return `
    ${backHead('Rooms', 'Position units — build them before athletes join; assign anyone below.', 'coach-profile')}
    ${roomList}
    ${needsCard}
    ${suggestChips}

    <div class="eyebrow">Add a room</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="room-name" class="ob-input" maxlength="40" placeholder="e.g. Defensive Backs" style="flex:1" ${BUSY ? 'disabled' : ''} />
      <button class="btn sm" id="room-add" style="width:auto;padding:0 16px" ${BUSY ? 'disabled' : ''}>${BUSY ? 'Adding…' : 'Add'}</button>
    </div>

    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Rooms vs groups</div>
      <div class="ts">A <b>room</b> is a permanent position unit an athlete belongs to — it can carry its own standard (set the position scope in the standards editor). A custom <b>group</b> on the roster is an ad-hoc filter you build any time. New athletes auto-join the room matching their position.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Lazy-load the staff list once, for the owner picker.
    if (STAFF === null && teamId()) { STAFF = []; roles.fetchTeamStaff(teamId()).then((s) => { STAFF = s || []; window.__render(); }); }
    root.querySelectorAll('[data-owner-toggle]').forEach((el) => el.addEventListener('click', () => {
      const id = el.getAttribute('data-owner-toggle'); OPEN_OWNER = OPEN_OWNER === id ? null : id; window.__render();
    }));
    root.querySelectorAll('[data-set-owner]').forEach((el) => el.addEventListener('click', () => {
      const [roomId, staffId] = el.getAttribute('data-set-owner').split('|'); setOwner(roomId, staffId || null);
    }));
    const input = root.querySelector('#room-name');
    const add = root.querySelector('#room-add');
    const submit = () => { const v = (input && input.value || '').trim(); if (v) createRoom(v); };
    if (add) add.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    root.querySelectorAll('[data-room-add]').forEach((el) => el.addEventListener('click', () => createRoom(el.getAttribute('data-room-add'))));
    root.querySelectorAll('[data-room-del]').forEach((el) => el.addEventListener('click', () => deleteRoom(el.getAttribute('data-room-del'))));
    root.querySelectorAll('[data-room-rename]').forEach((el) => el.addEventListener('click', () => {
      RENAMING = el.getAttribute('data-room-rename'); OPEN_OWNER = null; window.__render();
    }));
    root.querySelectorAll('[data-room-rename-cancel]').forEach((el) => el.addEventListener('click', () => { RENAMING = null; window.__render(); }));
    const submitRename = (roomId) => {
      const room = ((CD.extras && CD.extras.rooms) || []).find((r) => r.id === roomId);
      const input = root.querySelector(`[data-room-rename-input="${roomId}"]`);
      if (room && input) renameRoom(room, input.value);
    };
    root.querySelectorAll('[data-room-rename-save]').forEach((el) => el.addEventListener('click', () => submitRename(el.getAttribute('data-room-rename-save'))));
    root.querySelectorAll('[data-room-rename-input]').forEach((el) => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitRename(el.getAttribute('data-room-rename-input'));
      else if (e.key === 'Escape') { RENAMING = null; window.__render(); }
    }));
    root.querySelectorAll('[data-room-unassign]').forEach((el) => el.addEventListener('click', () => assign(el.getAttribute('data-room-unassign'), null)));
    root.querySelectorAll('[data-assign]').forEach((el) => el.addEventListener('click', () => {
      const [athleteId, roomId] = el.getAttribute('data-assign').split('|');
      assign(athleteId, roomId);
    }));
  },
};
