/* Training history — the athlete's session log (0135): date · session · how'd it go · notes.
   Reached from Progress. Includes the solo "Log a workout" entry (self-log, no coach requirement)
   so Individual-plan users with no coach still have a training surface. Tracked, not scored. */
import { icon } from '../icons.js';
import { backHead, esc, emptyState, errorState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';

/* `logs: null` is "not loaded", `failed: true` is "we asked and could not find out". They were
   the same value until now, so an offline athlete was shown the empty state and told they had
   never trained. Cached rows survive a later failure: they were real when they arrived. */
let CACHE = { logs: null, loading: false, failed: false };
let PENDING_DELETE = null;
let FAILED_DELETE = null; // a delete the server refused: the button stays armed and says so
const FEEL = ['', 'Rough', 'Tough', 'OK', 'Good', 'Great'];

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(d); }
}

async function load() {
  CACHE.loading = true;
  CACHE.failed = false;
  const rows = await roles.listTrainingLogs();
  CACHE.loading = false;
  if (rows === null) CACHE.failed = true;
  else CACHE.logs = rows;
  if (window.__render) window.__render();
}

function logCard(l) {
  // Self-reported mood is never a warning: 4+ reads green, everything else stays neutral.
  const feelCls = l.feel >= 4 ? 'g' : '';
  const feel = l.feel ? `<span class="status-pill${feelCls ? ` ${feelCls}` : ''}">${esc(FEEL[l.feel] || '')}</span>` : '';
  const self = l.source === 'self' ? `<span class="status-pill">Self-logged</span>` : '';
  const pending = PENDING_DELETE === l.id;
  return `<section class="card pad" style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <div style="font-size:var(--t-base);font-weight:800">${esc(l.title || 'Workout')}</div>
      <div style="font-size:var(--t-xs);font-weight:700;color:var(--text-3);white-space:nowrap">${esc(fmtDate(l.log_date))}</div>
    </div>
    ${feel || self ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${feel}${self}</div>` : ''}
    ${l.note ? `<p style="font-size:var(--t-sm);font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.45">${esc(l.note)}</p>` : ''}
    <div style="text-align:right;margin-top:6px"><button class="tl-del${pending ? ' arm' : ''}" data-tl-del="${l.id}">${pending ? (FAILED_DELETE === l.id ? "Couldn't delete · tap to retry" : 'Delete?') : 'Delete'}</button></div>
  </section>`;
}

export default {
  tab: 'progress',
  render() {
    const logs = CACHE.logs || [];
    const head = backHead('Training', 'Your sessions · tracked, not scored', 'progress');
    const addBtn = `<button class="btn green sm" data-go="log-training" style="width:100%">${icon('bolt', 16)} Log a workout</button>`;
    // Honest failure BEFORE the empty state: with nothing cached we do not know whether they
    // have sessions, and "No sessions yet" would be an answer we have not earned.
    if (CACHE.failed && !logs.length) {
      return `${head}
      ${addBtn}
      ${errorState({
    title: "Couldn't load your sessions",
    body: 'Your training log is safe on the server. Reconnect and it loads right here.',
    retryId: 'th-retry',
  })}`;
    }
    if (!CACHE.loading && !logs.length && CACHE.logs !== null) {
      return `${head}
      ${addBtn}
      ${emptyState({
    icon: 'bolt',
    title: 'No sessions yet',
    body: 'Log a workout after you train: what you did and how it went. If your coach programs sessions, they show up on your day and land here when you log them.',
    action: { label: 'Log a workout', go: 'log-training' },
  })}`;
    }
    if (CACHE.logs === null) {
      // Skeleton shaped like the session rows it stands in for, not a text card announcing a wait.
      return `${head}${skeletonRows(3, 'Loading your sessions')}`;
    }
    return `${head}
    ${addBtn}
    <div style="height:14px"></div>
    ${logs.map(logCard).join('')}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    if (CACHE.logs === null && !CACHE.loading && !CACHE.failed) load();
    const retry = root.querySelector('#th-retry');
    if (retry) retry.addEventListener('click', () => { if (!CACHE.loading) { retry.disabled = true; load(); } });
    root.querySelectorAll('[data-tl-del]').forEach((el) => el.addEventListener('click', async () => {
      const id = el.getAttribute('data-tl-del');
      if (PENDING_DELETE !== id) { PENDING_DELETE = id; FAILED_DELETE = null; if (window.__render) window.__render(); return; }
      const ok = await roles.deleteTrainingLog(id);
      if (ok) {
        PENDING_DELETE = null; FAILED_DELETE = null;
        if (CACHE.logs) CACHE.logs = CACHE.logs.filter((l) => l.id !== id);
      } else {
        // The server said no: stay armed and say so, instead of silently repainting back to
        // "Delete" as if nothing happened. The next tap retries the delete directly.
        PENDING_DELETE = id; FAILED_DELETE = id;
      }
      if (window.__render) window.__render();
    }));
  },
};
