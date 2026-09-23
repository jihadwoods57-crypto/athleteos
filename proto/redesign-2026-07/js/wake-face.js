/* The wake-up, when the athlete is ALREADY on the phone.
 *
 * AlarmKit takes over a LOCKED phone. An unlocked phone gets a compact banner that the system
 * chooses, and an athlete who happens to be inside OnStandard at 6:00 got nothing at all: the
 * roll call opened underneath whatever screen they were on and the only sign was a Home card they
 * were not looking at. This module is that missing moment. When a wake-up opens while the app is
 * in the foreground, or the app comes to the foreground while one is open or late and unanswered,
 * the alarm face covers the screen: who is asking, the clock, the coach's words, the one button.
 *
 * It is a FACE, not a second record. The tap goes through the same ackCommitment() every other
 * in-app answer uses, so the server stamps it and the Live Activity ends exactly as before.
 *
 * Decisions are pure (wakeFaceTarget / nextWakeFaceAt) so they are tested; the DOM half is thin.
 */
import { WAKEUP_TYPE } from './wakeup-morning.js';
import { wakeupPhase, deadlineOf, closesAtOf, fmtAt, offsetFor, lateMinutes, DEFAULT_ACTION } from './commitments.js';

/** How long the answered state stays up before the face leaves on its own. */
export const WAKE_FACE_LINGER_MS = 2600;
/** The scheduler never sleeps longer than this; a longer wait is re-armed on the next sync. */
export const WAKE_FACE_MAX_WAIT_MS = 24 * 3600000;
/** While the face is up, ask the shell for taps the alarm recorded outside the WebView. */
export const WAKE_FACE_DRAIN_MS = 4000;

const isWake = (r) => r && r.type === WAKEUP_TYPE && r.instance_status !== 'cancelled';
const unanswered = (r) => !r.acknowledged_at && r.status !== 'excused' && r.status !== 'acknowledged'
  && !(r.verdict && r.verdict !== 'pending');
/* The face rings at the wake-up TIME, not at the open. Since 0242 (2026-09-23) a wake-up opens 10
   minutes before its time so the lock-screen card can be up first; the alarm itself still sounds at
   the time the coach set, and a full-screen face ten minutes early would be a second, earlier
   alarm. So the face waits for starts_at, while the answer is accepted from the open. */
const ringsAt = (r) => Date.parse((r && r.starts_at) || '');

/**
 * The wake-up the face should be showing right now, or null.
 * Open or late, unanswered, not dismissed for this session, nearest start first.
 */
export function wakeFaceTarget(rows, nowISO, dismissed) {
  if (!Array.isArray(rows)) return null;
  const skip = dismissed || new Set();
  const live = rows.filter((r) => isWake(r) && unanswered(r) && !skip.has(String(r.instance_id)))
    .filter((r) => { const p = wakeupPhase(r, nowISO); return p === 'open' || p === 'late'; })
    .filter((r) => { const t = ringsAt(r); return !isFinite(t) || Date.parse(nowISO || '') >= t; })
    .sort((a, b) => Date.parse(a.starts_at || '') - Date.parse(b.starts_at || ''));
  return live[0] || null;
}

/** The next instant an unanswered wake-up rings (its start time, see ringsAt), in epoch ms, or null
 *  when none is ahead. */
export function nextWakeFaceAt(rows, nowMs) {
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    if (!isWake(r) || !unanswered(r)) continue;
    const t = ringsAt(r);
    if (!isFinite(t) || t <= nowMs) continue;
    if (best == null || t < best) best = t;
  }
  return best;
}

/** What the face says under the clock. Pure, so the copy is pinned by a test. */
export function wakeFaceLine(row, nowISO) {
  const off = offsetFor(row, nowISO);
  const clock = (iso) => fmtAt(iso, off);
  const phase = wakeupPhase(row, nowISO);
  if (phase === 'late') return { late: true, text: `You’re late. A check-in still counts until ${clock(closesAtOf(row))}.` };
  return { late: false, text: `On Standard until ${clock(deadlineOf(row))}.` };
}

/* ------------------------------------------------------------------ the DOM half */

const DISMISSED = new Set();
let timer = null;
let tick = null;
let drain = null;
let deps = null;

/** Other full-screen surfaces this one yields to. Mirrors gestures.js / router.js / lock-moment.js. */
const OTHER_OVERLAYS = '.tour, .imgview, .memsheet, .tapback, .lockstamp, .pmoment, .sheet-scrim';

function el() { return typeof document !== 'undefined' ? document.querySelector('.wakeface') : null; }

function clockNow() {
  const d = new Date();
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stopLoops() {
  if (tick) { clearInterval(tick); tick = null; }
  if (drain) { clearInterval(drain); drain = null; }
}

export function hideWakeFace() {
  stopLoops();
  const e = el();
  if (!e) return;
  e.classList.remove('on');
  setTimeout(() => { try { e.remove(); } catch { /* gone */ } }, 220);
}

function faceHtml(row, nowISO) {
  const line = wakeFaceLine(row, nowISO);
  const label = (row.action_label && String(row.action_label).trim()) || DEFAULT_ACTION[WAKEUP_TYPE] || 'I’m Up';
  return `
  <div class="wf-top">
    <div class="wf-eyebrow${line.late ? ' late' : ''}">${line.late ? 'YOU’RE LATE' : 'WAKE-UP ROLL CALL'}</div>
    <div class="wf-coach">${esc(row.coach_name || row.title || 'Your coach')}</div>
  </div>
  <div class="wf-clock" aria-hidden="true">${clockNow()}</div>
  <div class="wf-line${line.late ? ' late' : ''}">${esc(line.text)}</div>
  ${row.message ? `<p class="wf-msg">${esc(row.message)}</p>` : ''}
  <div class="wf-acts">
    <button class="btn primary wf-cta" type="button" data-wf-ack>${esc(label)}</button>
    <button class="btn ghost wf-later" type="button" data-wf-later>Not now</button>
  </div>
  <div class="wf-foot">Your coach can see who’s up. The morning counts toward today’s score.</div>`;
}

function answeredHtml(row, at, points) {
  const late = lateMinutes({ ...row, acknowledged_at: at }) != null;
  const lm = lateMinutes({ ...row, acknowledged_at: at });
  const pts = points > 0 ? Math.round(late ? points / 2 : points) : 0;
  return `
  <div class="wf-done${late ? ' late' : ''}">
    <div class="wf-done-mark" aria-hidden="true"></div>
    <div class="wf-eyebrow${late ? ' late' : ''}">${late ? `LATE · ${lm} MIN` : 'ON STANDARD'}</div>
    <div class="wf-clock">${clockNow()}</div>
    <div class="wf-line">${pts ? `+${pts} on today’s score. ` : ''}Breakfast is next.</div>
  </div>`;
}

/**
 * Show the face for one wake-up. Idempotent for the same instance. Yields to any other overlay.
 * @param {object} row the athlete's own my_commitments row
 */
export function showWakeFace(row) {
  if (!row || typeof document === 'undefined' || !document.body) return false;
  if (document.querySelector(OTHER_OVERLAYS)) return false;
  const nowISO = new Date().toISOString();
  const cur = el();
  if (cur && cur.getAttribute('data-wakeface') === String(row.instance_id)) return true;
  if (cur) { try { cur.remove(); } catch { /* replaced */ } }
  stopLoops();

  const e = document.createElement('div');
  e.className = 'wakeface';
  e.setAttribute('data-wakeface', String(row.instance_id));
  e.setAttribute('role', 'dialog');
  e.setAttribute('aria-modal', 'true');
  e.setAttribute('aria-label', 'Wake-up roll call');
  e.innerHTML = faceHtml(row, nowISO);
  document.body.appendChild(e);
  requestAnimationFrame(() => e.classList.add('on'));
  try { if (deps && deps.buzz) deps.buzz('lock'); } catch { /* no haptics here */ }

  const later = e.querySelector('[data-wf-later]');
  if (later) later.addEventListener('click', () => { DISMISSED.add(String(row.instance_id)); hideWakeFace(); });

  const cta = e.querySelector('[data-wf-ack]');
  if (cta) cta.addEventListener('click', async () => {
    if (cta.disabled) return;
    cta.disabled = true; cta.textContent = 'Saving…';
    let at = null;
    try { at = deps && deps.ack ? await deps.ack(row.instance_id) : null; } catch { at = null; }
    if (!at) {
      cta.disabled = false;
      const lbl = (row.action_label && String(row.action_label).trim()) || DEFAULT_ACTION[WAKEUP_TYPE] || 'I’m Up';
      cta.textContent = lbl;
      let fail = e.querySelector('.wf-fail');
      if (!fail) { fail = document.createElement('div'); fail.className = 'wf-fail'; fail.setAttribute('role', 'alert'); e.querySelector('.wf-acts').after(fail); }
      fail.textContent = 'Didn’t save. Check your signal and tap again.';
      return;
    }
    settle(row, at);
  });

  // The clock ticks, and the line flips from open to late on its own, without a repaint from
  // anyone. The whole face leaves if the roll call closes underneath it: Home's card says missed.
  tick = setInterval(() => {
    const now = new Date().toISOString();
    const c = e.querySelector('.wf-clock'); if (c) c.textContent = clockNow();
    if (e.querySelector('.wf-done')) return;
    const p = wakeupPhase(row, now);
    if (p === 'closed') { hideWakeFace(); return; }
    const line = wakeFaceLine(row, now);
    const l = e.querySelector('.wf-line'); if (l) { l.textContent = line.text; l.classList.toggle('late', line.late); }
    const eb = e.querySelector('.wf-eyebrow'); if (eb) { eb.textContent = line.late ? 'YOU’RE LATE' : 'WAKE-UP ROLL CALL'; eb.classList.toggle('late', line.late); }
  }, 1000);

  // A banner tap on the alarm while the app is open lands in the native pending store, not in
  // this WebView. Ask the shell for it every few seconds so the face settles within moments of
  // the athlete answering on the alarm rather than on the next launch.
  drain = setInterval(async () => {
    try {
      const n = deps && deps.drain ? await deps.drain() : 0;
      if (Number(n) > 0 && deps && deps.refresh) {
        const fresh = await deps.refresh(row.instance_id);
        if (fresh && fresh.acknowledged_at) settle(fresh, fresh.acknowledged_at);
      }
    } catch { /* next beat */ }
  }, WAKE_FACE_DRAIN_MS);
  return true;
}

function settle(row, at) {
  const e = el(); if (!e) return;
  stopLoops();
  e.innerHTML = answeredHtml(row, at, deps && deps.points ? Number(deps.points()) : 0);
  e.classList.add('answered');
  try { if (deps && deps.buzz) deps.buzz('success'); } catch { /* no-op */ }
  // Then the team board (roll call rebuilt, 2026-09-23): the athlete just got up, and the board is
  // where they see who else is. A tap goes now; otherwise it goes when the moment has lingered.
  const toBoard = () => {
    if (el() !== e) return;
    hideWakeFace();
    try { if (typeof location !== 'undefined' && row && row.instance_id) location.hash = `#rollcall-board/${row.instance_id}`; } catch { /* no router here */ }
  };
  e.addEventListener('click', toBoard, { once: true });
  setTimeout(toBoard, WAKE_FACE_LINGER_MS);
  try { if (deps && deps.onAnswered) deps.onAnswered(row.instance_id); } catch { /* no-op */ }
}

/**
 * Wire the DOM half once. `ack(instanceId)` resolves to the server stamp or null, `refresh(id)`
 * returns the freshest row, `drain()` asks the shell for native taps, `points()` says what the
 * morning is worth today, `buzz(kind)` is haptics, `onAnswered(id)` lets Home repaint.
 */
export function initWakeFace(d) { deps = { ...(deps || {}), ...(d || {}) }; }

/**
 * Re-evaluate against the rows Home just loaded: show the face if one is due now, else sleep
 * until the next one opens. Safe on every sync; it replaces its own timer.
 */
export function armWakeFace(rows, nowMs = Date.now()) {
  if (timer) { clearTimeout(timer); timer = null; }
  const target = wakeFaceTarget(rows, new Date(nowMs).toISOString(), DISMISSED);
  if (target) { showWakeFace(target); return 'shown'; }
  const next = nextWakeFaceAt(rows, nowMs);
  if (next == null) return 'idle';
  const wait = Math.min(WAKE_FACE_MAX_WAIT_MS, Math.max(250, next - nowMs + 500));
  timer = setTimeout(() => {
    timer = null;
    // Re-read the freshest rows the caller can give us at fire time (the coach may have moved
    // or skipped the day since we slept), then decide again.
    const fresh = deps && deps.rows ? deps.rows() : rows;
    armWakeFace(fresh, Date.now());
  }, wait);
  return 'armed';
}

/** Test seam. */
export function _resetWakeFace() { DISMISSED.clear(); if (timer) clearTimeout(timer); timer = null; stopLoops(); deps = null; }
