/* OnStandard — Squad (0180). The athlete-facing team board, opt-in by design.
   For a year the roster lived coach-side only and the Privacy sheet promised teammates see
   NOTHING — this screen ships the board without breaking that promise: you appear to your squad
   only after flipping your own switch (right here, next to what it shows), and what appears is
   your name and your daily score number. Never meals, photos, weight, or check-ins — the RPC
   cannot return them. Teammates who haven't opted in are a COUNT, not a list: no fabricated
   rows, no grayed-out names implying data we won't show. */
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { scoreColor } from '../score-band.js';
import * as roles from '../roles.js';

/* Module cache, loadAthleteProfile-style: null = loading, {offline:true} = failed honest,
   {rows} = loaded. A generation counter so a slow first load can't clobber a retry.
   BOARD_FRESH_MS caps how long a populated board is trusted across re-visits — this is a
   "today's standing" surface, not a profile: without a TTL, an athlete who opened Squad once
   and comes back later (a teammate opted in, scores moved) would see the FIRST visit's numbers
   for the rest of the app session with no signal they're stale and no retry button to fix it
   (retry only ever renders on the offline branch). 20s matches the athlete bell's own
   loadNotifications() throttle — fresh enough to feel live, cheap enough not to hammer the RPC
   on fast tab-switching. */
let BOARD = null, boardGen = 0, boardLoadedAt = 0;
const BOARD_FRESH_MS = 20_000;
async function loadBoard(force) {
  const teamId = RT.myCoach && RT.myCoach.teamId;
  if (!teamId) { BOARD = { rows: [] }; return; }
  if (BOARD && BOARD.rows && !force && Date.now() - boardLoadedAt < BOARD_FRESH_MS) return;
  const gen = ++boardGen;
  const rows = await roles.fetchSquadBoard(teamId);
  if (gen !== boardGen) return;
  BOARD = rows === null ? { offline: true } : { rows };
  if (rows !== null) boardLoadedAt = Date.now();
  // The self row carries the authoritative switch state — mirror it so the Privacy sheet's
  // Teammates row reads the same truth without its own fetch.
  const me = rows && rows.find((r) => r.athlete_id === RT.userId);
  if (me) RT.shareSquadScore = !!me.shared; // persists on the next save() any action performs
  if (location.hash === '#squad') window.__render();
}

function boardRow(r, rank, today) {
  const me = r.athlete_id === RT.userId;
  const first = (r.athlete_name || 'You').split(' ')[0];
  const fresh = r.day_date === today;
  const scoreCell = r.score == null
    ? `<span class="status-pill" style="color:var(--text-3)">No log yet</span>`
    : `<div style="text-align:right"><div style="font-size:17px;font-weight:800;color:${scoreColor(r.score)}">${r.score}</div>${fresh ? '' : `<div style="font-size:9.5px;font-weight:700;color:var(--text-3)">yesterday</div>`}</div>`;
  return `
    <div class="lrow" style="cursor:default${me ? ';background:var(--blue-surface);margin:0 -16px;padding-left:16px;padding-right:16px;border-radius:12px' : ''}">
      <div class="lic" style="${me ? 'background:var(--blue-surface);color:var(--blue-bright)' : ''}"><b>${rank}</b></div>
      <div class="lm"><div class="lt">${esc(me ? `${first} · You` : first)}</div>
      <div class="ls">${esc(r.position || (me ? 'Your number is on the board' : ''))}</div></div>
      ${scoreCell}
    </div>`;
}

export default {
  tab: 'progress',
  async mount(root) {
    loadBoard(false);
    const sw = root && root.querySelector('#squad-share');
    if (sw) sw.addEventListener('click', async () => {
      const on = !(RT.shareSquadScore === true);
      // Optimistic flip; a failed write flips back with the honest reason.
      RT.shareSquadScore = on; window.__render();
      const ok = await roles.setShareSquadScore(RT.userId, on);
      if (!ok) { RT.shareSquadScore = !on; window.__render(); return; }
      loadBoard(true);
    });
    const retry = root && root.querySelector('#squad-retry');
    if (retry) retry.addEventListener('click', () => { BOARD = null; window.__render(); loadBoard(true); });
  },
  render() {
    const team = RT.myCoach;
    if (!team || !team.teamId) return `
    ${backHead('Squad', 'Your team, side by side', 'progress')}
    <div class="ne-empty">
      <div class="ne-ring">${icon('users', 30)}</div>
      <div class="ne-t">No squad yet</div>
      <div class="ne-s">The Squad board unlocks when you join a team. Ask your coach for their team code, then connect from your Profile.</div>
    </div>
    <div style="height:10px"></div>`;

    const sharing = RT.shareSquadScore === true;
    const toggle = `
    <section class="card" style="padding:6px 16px">
      <div class="std-switch-row">
        <div class="std-sw-m"><div class="std-sw-t">Show my number to the squad</div>
        <div class="std-sw-s">${sharing ? 'Your name and daily score are on the board. Nothing else ever is.' : 'Off — teammates see you only as a private count. Flip it and they see your name and daily score. Never meals, photos, or check-ins.'}</div></div>
        <div class="std-switch ${sharing ? 'on' : ''}" id="squad-share" role="switch" aria-checked="${sharing}" tabindex="0" aria-label="Show my number to the squad"></div>
      </div>
    </section>`;

    if (BOARD === null) return `
    ${backHead('Squad', esc(team.teamName || 'Your team'), 'progress')}
    ${toggle}
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
    <div><div class="tt">Pulling the board…</div><div class="ts">Real numbers only — one moment.</div></div></div>`;

    if (BOARD.offline) return `
    ${backHead('Squad', esc(team.teamName || 'Your team'), 'progress')}
    ${toggle}
    <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach the board</div>
    <div class="sd-s">Nothing is invented while it's down.</div>
    <div class="sd-cta"><button class="btn ghost sm" id="squad-retry">Retry</button></div></div>`;

    const today = roles.todayISO();
    const shared = (BOARD.rows || []).filter((r) => r.shared || r.athlete_id === RT.userId);
    const privateN = (BOARD.rows || []).length - shared.length;
    return `
    ${backHead('Squad', `${esc(team.teamName || 'Your team')} · ${shared.length} on the board`, 'progress')}
    ${toggle}

    <div class="eyebrow">Today's board</div>
    ${shared.length ? `<section class="card" style="padding:6px 16px">
      ${shared.map((r, i) => boardRow(r, i + 1, today)).join('')}
    </section>` : ''}
    ${shared.length === 1 && shared[0].athlete_id === RT.userId ? `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:6px 2px 0;line-height:1.45">You're first on the board. Teammates appear as they flip their own switch — nobody is shown without it.</div>` : ''}
    ${privateN > 0 ? `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0">${privateN} teammate${privateN > 1 ? 's keep' : ' keeps'} their number private.</div>` : ''}
    <div style="height:10px"></div>`;
  },
};
