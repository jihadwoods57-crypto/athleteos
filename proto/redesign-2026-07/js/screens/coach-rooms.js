/* #coach-rooms — position rooms builder (T-04 slice 1). Create first-class rooms (from the
   positions already on the roster, or a custom name) BEFORE athletes are assigned. Slice 1 is the
   room object + CRUD only: no auto-assign on join, no room-scoped scoring — those are slice 2. */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, emptyState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster } from '../coach-data.js';
import { suggestedRooms, slugifyRoomKey } from '../rooms.js';

const teamId = () => CD.roster && CD.roster.teams && CD.roster.teams[0] && CD.roster.teams[0].id;
const rosterPositions = () => ((CD.roster && CD.roster.rows) || []).map((r) => (r.position || '').toUpperCase());

let BUSY = false; // guards double-submit while a write + reload is in flight

async function createRoom(label) {
  const id = teamId();
  const key = slugifyRoomKey(label);
  if (!id || !key || BUSY) return;
  BUSY = true; window.__render();
  const r = await roles.saveTeamRoom(id, { key, label: label.trim().slice(0, 40) });
  if (r.ok) { try { act.markCoachSetup('group'); } catch { /* best-effort */ } await loadCoachRoster(true); }
  BUSY = false;
  window.__render();
}

export const coachRooms = {
  nav: 'coach', tab: 'profile',
  render() {
    if (CD.roster === null || !CD.extras) return `${backHead('Rooms', 'Position units for your team.', 'coach-profile')}${skeletonRows(3, 'Loading your team')}`;
    const rooms = (CD.extras && CD.extras.rooms) || [];
    const suggestions = suggestedRooms(rosterPositions(), rooms);

    const roomList = rooms.length ? `
      <section class="card" style="padding:6px 16px">
        ${rooms.map((rm) => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:rgba(59,130,246,0.14);color:var(--blue-bright)">${icon('users', 17)}</div>
          <div class="lm"><div class="lt">${esc(rm.label)}</div><div class="ls">Position room</div></div>
          <button class="btn ghost sm" data-room-del="${esc(rm.id)}" style="width:auto;padding:0 12px;height:30px;color:var(--red)">Delete</button>
        </div>`).join('')}
      </section>` : emptyState({ icon: 'users', title: 'No rooms yet', body: 'Create a room for each position group. Athletes drop into their room as they join.' });

    const suggestChips = suggestions.length ? `
      <div class="eyebrow">Suggested from your roster · tap to add</div>
      <div class="chip-row" id="room-suggest">
        ${suggestions.map((s) => `<span class="chp" data-room-add="${esc(s.label)}">＋ ${esc(s.label)}</span>`).join('')}
      </div>` : '';

    return `
    ${backHead('Rooms', 'Position units for your team — build them before athletes join.', 'coach-profile')}
    ${roomList}
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
      <div class="ts">A <b>room</b> is a permanent position unit (your D-line, your distance group). A custom <b>group</b> on the roster is an ad-hoc filter you build any time. Auto-assign by position and room-only standards come next.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const input = root.querySelector('#room-name');
    const add = root.querySelector('#room-add');
    if (add && input) add.addEventListener('click', () => { const v = (input.value || '').trim(); if (v) createRoom(v); });
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = (input.value || '').trim(); if (v) createRoom(v); } });
    root.querySelectorAll('[data-room-add]').forEach((el) => el.addEventListener('click', () => createRoom(el.getAttribute('data-room-add'))));
    root.querySelectorAll('[data-room-del]').forEach((el) => el.addEventListener('click', async () => {
      if (BUSY) return; BUSY = true; el.disabled = true;
      const ok = await roles.deleteTeamRoom(el.getAttribute('data-room-del'));
      if (ok) await loadCoachRoster(true);
      BUSY = false; window.__render();
    }));
  },
};
