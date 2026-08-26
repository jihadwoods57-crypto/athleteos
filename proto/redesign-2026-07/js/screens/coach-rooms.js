/* #coach-rooms — position rooms builder + assignment (T-04, slices 1+2). Create first-class rooms
   (from roster positions or a custom name), see who's in each, and assign the Needs-Assignment queue.
   Athletes auto-map to a room by position on join (server, 0101); this screen is the manual override.
   Slice 2 stops short of a room-scoped-standard editor UI (a room's standard is still authored via
   the standards editor's position scope) — that editor is slice 3. */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, emptyState, errorState, skeletonRows } from '../components.js';
import { initialsOf } from '../initials.js';
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
let DELETING = null;     // roomId armed for delete (two-tap confirm), or null
let ERR = '';            // one red status line (#rooms-status); set by any failed write
let ADD_VAL = '';        // the typed room name, preserved across a failed add
let RENAME_VAL = null;   // the typed rename, preserved across a failed save, or null

async function run(work) {
  if (BUSY) return;
  BUSY = true; ERR = ''; window.__render();
  try { await work(); } finally { BUSY = false; window.__render(); }
}
/* Every write reports failure through the one status line. run() used to swallow results:
   a failed save re-rendered into a screen that looked exactly like success minus the room. */
const FAIL = "Couldn't save that. Check your connection.";
const staffName = (id) => { const s = (STAFF || []).find((x) => x.staff_id === id); return s ? s.name : null; };
const setOwner = (roomId, staffId) => run(async () => { OPEN_OWNER = null; const r = await roles.setRoomOwner(roomId, staffId); if (r.ok) await loadCoachRoster(true); else ERR = FAIL; });
const createRoom = (label) => run(async () => {
  const id = teamId(); const key = slugifyRoomKey(label);
  if (!id || !key) return;
  const r = await roles.saveTeamRoom(id, { key, label: label.trim().slice(0, 40) });
  if (r.ok) { ADD_VAL = ''; try { act.markCoachSetup('group'); } catch { /* best-effort */ } await loadCoachRoster(true); }
  else { ADD_VAL = label; ERR = FAIL; }   // the typed name survives the failure
});
const deleteRoom = (roomId) => run(async () => { DELETING = null; if (await roles.deleteTeamRoom(roomId)) await loadCoachRoster(true); else ERR = FAIL; });
// Rename reuses saveTeamRoom's existing update-by-id path (it already upserts on `id`) —
// no new backend call needed. The room's key (used by position auto-assignment matching)
// is deliberately left untouched by a rename; only the display label changes.
const renameRoom = (room, label) => run(async () => {
  const clean = String(label || '').trim().slice(0, 40);
  if (!clean || clean === room.label) { RENAMING = null; RENAME_VAL = null; return; }
  const r = await roles.saveTeamRoom(teamId(), { id: room.id, key: room.key, label: clean });
  if (r.ok) { RENAMING = null; RENAME_VAL = null; await loadCoachRoster(true); }
  else { RENAME_VAL = clean; ERR = FAIL; }   // editor stays open with the typed value
});
const assign = (athleteId, roomId) => run(async () => { const r = await roles.assignAthleteRoom(athleteId, roomId); if (r.ok) await loadCoachRoster(true); else ERR = FAIL; });

export const coachRooms = {
  nav: 'coach', tab: 'profile',
  render() {
    const head = backHead('Rooms', 'Position units for your team.', 'coach-profile');
    if (!CD.extras) {
      // Roster resolved but the book couldn't load: a skeleton here never resolves (there is no
      // fetch left in flight), so it has to say so. Retry re-runs the roster load.
      if (CD.roster && CD.roster.offline) return `${head}${errorState({ title: "Couldn't load your team", body: 'Your rooms are safe. Reconnect and they load right here.', retryId: 'rooms-retry' })}`;
      return `${head}${skeletonRows(3, 'Loading your team')}`;
    }
    const rooms = (CD.extras && CD.extras.rooms) || [];
    const { byRoom, needs } = groupRosterByRoom(rosterRows(), rooms);
    const suggestions = suggestedRooms(rosterPositions(), rooms);

    const roomCard = (rm) => {
      const members = byRoom.get(rm.id) || [];
      return `
      <section class="card" style="padding:6px 16px;margin-bottom:10px">
        ${DELETING === rm.id ? `
        <div class="lrow" style="cursor:default;gap:8px">
          <div class="lm"><div class="lt">Delete ${esc(rm.label)}?</div>
            <div class="ls">${members.length ? `Its ${members.length} athlete${members.length === 1 ? '' : 's'} stay on the roster, unassigned. ` : ''}A standard scoped to this position keeps running until you clear it in the standards editor.</div></div>
          <button class="btn ghost sm" data-room-del-cancel="1" style="width:auto;padding:0 12px;height:34px;flex:none">Keep</button>
          <button class="btn sm" data-room-del-confirm="${esc(rm.id)}" style="width:auto;padding:0 12px;height:34px;flex:none;background:var(--danger-solid);color:#fff;border:none">Delete room</button>
        </div>` : RENAMING === rm.id ? `
        <div class="lrow" style="cursor:default;gap:8px">
          <input class="ob-input room-rename-input" data-room-rename-input="${esc(rm.id)}" maxlength="40" value="${esc(RENAMING === rm.id && RENAME_VAL != null ? RENAME_VAL : rm.label)}" style="flex:1" aria-label="Rename ${esc(rm.label)}" />
          <button class="btn sm" data-room-rename-save="${esc(rm.id)}" style="width:auto;padding:0 12px;height:34px">Save</button>
          <button class="btn ghost sm" data-room-rename-cancel="1" style="width:auto;padding:0 12px;height:34px">Cancel</button>
        </div>` : `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:rgba(var(--blue-rgb),0.14);color:var(--blue-bright)">${icon('users', 17)}</div>
          <div class="lm"><div class="lt">${esc(rm.label)}</div><div class="ls">${members.length ? `${members.length} athlete${members.length === 1 ? '' : 's'}` : 'No one assigned yet'}</div></div>
          <button class="btn ghost sm" data-room-rename="${esc(rm.id)}" aria-label="Rename room" style="width:34px;padding:0;height:30px;flex:none">${icon('edit', 15)}</button>
          <button class="btn ghost micro" data-go="coach-plan-set/position/${esc(String(rm.label).trim().toUpperCase())}" style="width:auto">Standard</button>
          <button class="btn ghost sm" data-room-del="${esc(rm.id)}" style="width:auto;padding:0 10px;height:30px;color:var(--red);margin-left:6px">Delete</button>
        </div>`}
        <div class="lrow" data-owner-toggle="${esc(rm.id)}" style="cursor:pointer;padding-left:6px">
          <div class="xico sm gray" style="width:26px;height:26px">${icon('user', 15)}</div>
          <div class="lm"><div class="lt" style="font-size:13.5px">Room owner</div><div class="ls">${rm.staff_owner_id ? (staffName(rm.staff_owner_id) ? esc(staffName(rm.staff_owner_id)) : 'Assigned') : 'Unassigned · tap to set'}</div></div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
        ${OPEN_OWNER === rm.id ? `<div class="chip-row" role="radiogroup" aria-label="Room owner" style="margin:2px 0 8px 6px">
          ${(STAFF || []).map((s) => `<span class="chp ${s.staff_id === rm.staff_owner_id ? 'on' : ''}" role="radio" aria-checked="${s.staff_id === rm.staff_owner_id ? 'true' : 'false'}" tabindex="0" data-set-owner="${esc(rm.id)}|${esc(s.staff_id)}">${esc(s.name)}</span>`).join('') || '<span class="ls">No staff yet. Invite staff first.</span>'}
          ${rm.staff_owner_id ? `<span class="chp" role="button" tabindex="0" data-set-owner="${esc(rm.id)}|">Clear</span>` : ''}
        </div>` : ''}
        ${members.map((m) => `
        <div class="lrow" style="cursor:default;padding-left:6px">
          <div class="xico sm gray" style="width:26px;height:26px">${esc(initialsOf(m.name, 'A', 1))}</div>
          <div class="lm"><div class="lt" style="font-size:14px">${esc(m.name)}</div><div class="ls">${m.position ? `${esc(m.position)} · ` : ''}They stay on the roster, just not in this room.</div></div>
          <button class="btn ghost sm" data-room-unassign="${esc(m.athleteId)}" style="width:auto;padding:0 10px;height:28px;font-size:var(--t-xs)">Unassign</button>
        </div>`).join('')}
      </section>`;
    };

    const needsCard = needs.length && rooms.length ? `
      <div class="eyebrow" style="color:var(--amber-bright)">Needs assignment · ${needs.length}</div>
      <section class="card" style="padding:6px 16px;background:var(--amber-surface);border-color:var(--amber-border)">
        ${needs.map((m) => `
        <div class="lrow" style="cursor:default;display:block;padding:10px 4px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div class="xico sm gray" style="width:26px;height:26px">${esc(initialsOf(m.name, 'A', 1))}</div>
            <div class="lm"><div class="lt" style="font-size:14px">${esc(m.name)}</div>${m.position ? `<div class="ls">${esc(m.position)}</div>` : ''}</div>
          </div>
          <div class="chip-row" style="margin:0">${rooms.map((rm) => `<span class="chp" role="button" tabindex="0" aria-label="Assign ${esc(m.name)} to ${esc(rm.label)}" data-assign="${esc(m.athleteId)}|${esc(rm.id)}">${esc(rm.label)}</span>`).join('')}</div>
        </div>`).join('')}
      </section>` : '';

    // An empty list after a FAILED extras read is not "no rooms yet", and this screen's empty
    // state invites the coach to build rooms they may already have.
    const roomsFailed = !!(CD.extras && CD.extras.failed) && !rooms.length;
    const roomList = rooms.length
      ? rooms.map(roomCard).join('')
      : roomsFailed
        ? errorState({ title: "Couldn't load your rooms", body: 'Any rooms you already built are safe. Reconnect and they list right here.', retryId: 'rooms-retry' })
        : emptyState({ icon: 'users', title: 'No rooms yet', body: 'Create a room for each position group. Athletes drop into their room as they join.', action: { label: 'Add a room', id: 'rooms-empty-add' } });

    const suggestChips = suggestions.length ? `
      <div class="eyebrow">Suggested from your roster · tap to add</div>
      <div class="chip-row" id="room-suggest">
        ${suggestions.map((s) => `<span class="chp" role="button" tabindex="0" aria-label="Add a ${esc(s.label)} room" data-room-add="${esc(s.label)}">${icon('plus', 12)} ${esc(s.label)}</span>`).join('')}
      </div>` : '';

    return `
    ${backHead('Rooms', 'Position units. Build them before athletes join; assign anyone below.', 'coach-profile')}
    ${roomList}
    ${needsCard}
    ${suggestChips}

    <div class="eyebrow">Add a room</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="room-name" class="ob-input" maxlength="40" placeholder="e.g. Defensive Backs" value="${esc(ADD_VAL)}" style="flex:1" ${BUSY ? 'disabled' : ''} />
      <button class="btn sm" id="room-add" style="width:auto;padding:0 16px" ${BUSY ? 'disabled' : ''}>${BUSY ? 'Adding…' : 'Add'}</button>
    </div>
    <div id="rooms-status" style="font-size:var(--t-xs);font-weight:700;color:var(--red);min-height:16px;margin-top:6px">${esc(ERR)}</div>

    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Rooms vs groups</div>
      <div class="ts">A <b>room</b> is a permanent position unit an athlete belongs to. It can carry its own standard (set the position scope in the standards editor). A custom <b>group</b> on the roster is an ad-hoc filter you build any time. New athletes auto-join the room matching their position.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Direct entry (a relaunch restoring #coach-rooms) reaches this mount before any coach
    // screen has fetched the roster — the skeleton never resolved. Kick the load; the arrival
    // hook in loadBook repaints #coach-rooms on success and failure alike, so no .then here
    // (one on the deduped early-return path repainted every frame while a load was in flight).
    if (CD.roster === null) loadCoachRoster();
    // Lazy-load the staff list once, for the owner picker.
    // `s || []` also absorbs a null (FAILED) read; the owner picker having no choices is an
    // absence, not a claim, so it stays best-effort. A later mount retries.
    if (STAFF === null && teamId()) { STAFF = []; roles.fetchTeamStaff(teamId()).then((s) => { STAFF = s || []; window.__render(); }); }
    const roomsRetry = root.querySelector('#rooms-retry');
    if (roomsRetry) roomsRetry.addEventListener('click', () => { roomsRetry.disabled = true; loadCoachRoster(true).then(() => window.__render()); });
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
    // Delete is two-tap: the first tap arms the row (it states what actually happens), the
    // explicit "Delete room" executes. Arming clears any other open inline editor.
    root.querySelectorAll('[data-room-del]').forEach((el) => el.addEventListener('click', () => {
      DELETING = el.getAttribute('data-room-del'); RENAMING = null; OPEN_OWNER = null; window.__render();
    }));
    root.querySelectorAll('[data-room-del-cancel]').forEach((el) => el.addEventListener('click', () => { DELETING = null; window.__render(); }));
    root.querySelectorAll('[data-room-del-confirm]').forEach((el) => el.addEventListener('click', () => deleteRoom(el.getAttribute('data-room-del-confirm'))));
    // The empty state's Add-a-room action hands focus to the real input below it.
    const emptyAdd = root.querySelector('#rooms-empty-add');
    if (emptyAdd) emptyAdd.addEventListener('click', () => {
      const nameInput = root.querySelector('#room-name');
      if (nameInput) {
        nameInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
        nameInput.focus();
      }
    });
    root.querySelectorAll('[data-room-rename]').forEach((el) => el.addEventListener('click', () => {
      RENAMING = el.getAttribute('data-room-rename'); RENAME_VAL = null; OPEN_OWNER = null; window.__render();
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
