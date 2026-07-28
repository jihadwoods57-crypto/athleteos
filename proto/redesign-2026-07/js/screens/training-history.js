/* Training history — the athlete's session log (0135): date · session · how'd it go · notes.
   Reached from Progress. Includes the solo "Log a workout" entry (self-log, no coach requirement)
   so Individual-plan users with no coach still have a training surface. Tracked, not scored. */
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';
import * as roles from '../roles.js';

let CACHE = { logs: null, loading: false };
let PENDING_DELETE = null;
const FEEL = ['', 'Rough', 'Tough', 'OK', 'Good', 'Great'];

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(d); }
}

async function load() {
  CACHE.loading = true;
  CACHE.logs = await roles.listTrainingLogs();
  CACHE.loading = false;
  if (window.__render) window.__render();
}

function logCard(l) {
  const feelCls = l.feel >= 4 ? 'g' : l.feel >= 3 ? 'a' : 'r';
  const feel = l.feel ? `<span class="status-pill ${feelCls}">${esc(FEEL[l.feel] || '')}</span>` : '';
  const self = l.source === 'self' ? `<span class="status-pill">Self-logged</span>` : '';
  const pending = PENDING_DELETE === l.id;
  return `<section class="card pad" style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <div style="font-size:14.5px;font-weight:800">${esc(l.title || 'Workout')}</div>
      <div style="font-size:11.5px;font-weight:700;color:var(--text-3);white-space:nowrap">${esc(fmtDate(l.log_date))}</div>
    </div>
    ${feel || self ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${feel}${self}</div>` : ''}
    ${l.note ? `<p style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.45">${esc(l.note)}</p>` : ''}
    <div style="text-align:right;margin-top:6px"><button class="tl-del${pending ? ' arm' : ''}" data-tl-del="${l.id}">${pending ? 'Delete?' : 'Delete'}</button></div>
  </section>`;
}

export default {
  tab: 'progress',
  render() {
    const logs = CACHE.logs || [];
    const head = backHead('Training', 'Your sessions — tracked, not scored', 'progress');
    const addBtn = `<button class="btn green sm" data-go="log-training" style="width:100%">${icon('bolt', 16)} Log a workout</button>`;
    if (!CACHE.loading && !logs.length && CACHE.logs !== null) {
      return `${head}
      ${addBtn}
      <div class="state-demo" style="margin-top:14px"><div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">No sessions yet</div>
      <div class="sd-s">Log a workout after you train — what you did and how it went. If your coach programs sessions, they show up on your day and land here when you log them.</div></div>`;
    }
    if (CACHE.logs === null) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading your sessions…</div></div></div>`;
    }
    return `${head}
    ${addBtn}
    <div style="height:14px"></div>
    ${logs.map(logCard).join('')}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    if (CACHE.logs === null && !CACHE.loading) load();
    root.querySelectorAll('[data-tl-del]').forEach((el) => el.addEventListener('click', async () => {
      const id = el.getAttribute('data-tl-del');
      if (PENDING_DELETE !== id) { PENDING_DELETE = id; if (window.__render) window.__render(); return; }
      PENDING_DELETE = null;
      const ok = await roles.deleteTrainingLog(id);
      if (ok && CACHE.logs) CACHE.logs = CACHE.logs.filter((l) => l.id !== id);
      if (window.__render) window.__render();
    }));
  },
};
