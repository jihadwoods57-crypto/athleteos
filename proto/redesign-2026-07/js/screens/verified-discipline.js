/* OnStandard — Verified Discipline profile (0138), athlete-controlled.
   The recruit-facing aggregate: percentages and counts, nothing else. The screen shows the athlete
   EXACTLY what a recruiter would see before they turn sharing on, and names what is withheld —
   because "share my discipline record" is not a decision anyone should make blind.

   The server enforces the same rule: verified_discipline() refuses unless the athlete's own
   share_verified_discipline switch is on, and is structurally incapable of returning an event, a
   location, a class name, a time of day, or a schedule. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import { loadVerifiedDiscipline, setShareDiscipline, todayISO, shiftISO } from '../commitment-data.js';

let DATA = null;
let SHARING = null;   // null = unknown until the profile row lands

const stat = (label, value, suffix = '') => `
  <div class="vc-stat">
    <div class="vc-sv">${value == null ? '—' : esc(String(value)) + suffix}</div>
    <div class="vc-sk">${esc(label)}</div>
  </div>`;

export default {
  tab: 'profile',
  render() {
    const d = DATA || {};
    const on = SHARING === true;

    return `
    ${backHead('Verified Discipline', 'What a recruiter would see', 'settings')}

    <section class="card pad">
      <div class="eyebrow" style="margin:0 0 12px">Your record · last 90 days</div>
      <div class="vc-stats">
        ${stat('On-time arrival', d.on_time_arrival_pct, '%')}
        ${stat('Morning response', d.morning_response_pct, '%')}
        ${stat('Commitments completed', d.commitments_completed)}
        ${stat('Accountability', d.accountability_pct, '%')}
      </div>
    </section>

    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon g" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div>
        <div class="tt">What is never shared</div>
        <div class="ts">Recruiters see the four numbers above and nothing else. Not where you were, not which building, not your class schedule, not what time you did anything, not any single day. There is no way for them to ask for it — the record simply doesn't contain it.</div>
      </div>
    </div>

    <div style="height:14px"></div>
    <section class="card pad">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1">
          <div class="tt">Share this profile</div>
          <div class="ts">Off by default. Only you can turn it on, and you can turn it off any time.</div>
        </div>
        <button class="chip ${on ? 'on' : ''}" id="vc-share" aria-pressed="${on}">${on ? 'Shared' : 'Private'}</button>
      </div>
    </section>
    <div style="height:20px"></div>`;
  },

  mount(root) {
    const uid = RT.userId;
    if (uid && DATA === null) {
      loadVerifiedDiscipline(uid, shiftISO(todayISO(), -89), todayISO()).then((d) => {
        DATA = d || {};
        if (root.isConnected) window.__render && window.__render();
      });
    }
    if (SHARING === null) {
      SHARING = !!RT.shareVerifiedDiscipline;
    }
    const btn = root.querySelector('#vc-share');
    if (btn) btn.addEventListener('click', async () => {
      const next = !(SHARING === true);
      btn.disabled = true; btn.textContent = '…';
      const ok = await setShareDiscipline(next);
      btn.disabled = false;
      if (!ok) { window.__render && window.__render(); return; }
      SHARING = next;
      RT.shareVerifiedDiscipline = next;
      window.__render && window.__render();
    });
  },
};
