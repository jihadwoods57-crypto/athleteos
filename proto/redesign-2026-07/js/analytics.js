/* OnStandard — anonymous activation/funnel analytics (proto is the shipped app; this is the
   source of truth, tested from src/core/protoAnalytics.test.ts).
 *
 * WHY THIS EXISTS: migration 0037 answers "how many athletes logged today?" retroactively over
 * days/meals — but it can only see AUTHENTICATED users who already reached the loop. It cannot
 * see the funnel: how many started onboarding vs finished, where they dropped, how often meal
 * analysis FAILED, how many under-13s hit the age gate. Those are anonymous, client-only signals.
 * This seam captures them.
 *
 * PRIVACY IS STRUCTURAL, not a promise:
 *   - Events are keyed to an anonymous per-install session id, NEVER a user id or email.
 *   - Event names are a FIXED vocabulary (unknown names are dropped).
 *   - Prop VALUES may only be numbers, booleans, or short enum-shaped strings
 *     (/^[a-z0-9_.:-]{1,24}$/). A name, email, or free-text note is structurally unrepresentable
 *     — redact() strips anything else. So an event can never carry PII even by mistake.
 *
 * INERT BY DEFAULT (guardrail): events buffer locally (bounded). flush() sends to a sink ONLY
 * when one is configured (window.__ANALYTICS_SINK, injected like __SUPABASE). With no sink, the
 * buffer just rolls over in localStorage and nothing ever leaves the device.
 */

/* The whole allowed event vocabulary. Adding a signal = adding it here (keeps the surface auditable). */
export const EVENTS = Object.freeze({
  APP_OPEN: 'app_open',
  ONBOARDING_STARTED: 'onboarding_started',   // Get Started tapped
  ONBOARDING_ROLE: 'onboarding_role',         // a role was picked  {role}
  GOAL_SELECTED: 'goal_selected',             // {goal}
  AGE_BLOCKED: 'age_blocked',                 // under-13 gate hit (a real, invisible drop)
  ONBOARDING_COMPLETED: 'onboarding_completed', // account created  {role}
  // Paywall funnel (2026-07-21) — the surface events the report insists on. PAYWALL_VIEWED is the
  // exposure signal (fire the moment the screen is visible, or conversion readouts undercount).
  // The lagging events (trial→paid, renewal, refund) are server truth from App Store Server
  // Notifications / Play RTDN, NOT client events — see docs/paywall/event-schema.md.
  PAYWALL_VIEWED: 'paywall_viewed',           // {variant, cadence} — plans OR covered screen shown
  PLAN_SELECTED: 'plan_selected',             // {plan, cadence} — a plan card tapped
  TRIAL_STARTED: 'trial_started',             // {plan, cadence} — "Start free" tapped (intent; billing go-live gated)
  MEAL_LOGGED: 'meal_logged',                 // {slot, source}
  MEAL_ANALYSIS_FAILED: 'meal_analysis_failed', // {reason}  — the client-only signal 0037 can't see
  // Deterministic-scoring cutover (2026-07-21): the app computes meal quality; the AI's own
  // number is only this cross-check so drift between the two is measurable post-ship.
  MEAL_SCORE_DELTA: 'meal_score_delta',       // {ai, det, delta} — AI estimate vs deterministic score
  MEAL_TEXT_CONFLICT: 'meal_text_conflict',   // {det} — AI prose disagreed with the band; deterministic copy shown
  MEAL_GALLERY_LOGGED: 'meal_gallery_logged', // {slot} — gallery photos score now; measure usage
  MEAL_DUP_BLOCKED: 'meal_dup_blocked',       // {stage:'precheck'|'insert'} — reuse attempt caught
  MEAL_STALE_PHOTO: 'meal_stale_photo',       // {slot} — gallery pick with an old EXIF capture time
  COMMITMENT_SET: 'commitment_set',           // {answer}
  RECOVERY_SUBMITTED: 'recovery_submitted',
  CHECKIN_SUBMITTED: 'checkin_submitted',
  WEIGHT_LOGGED: 'weight_logged',
  COACH_CONNECTED: 'coach_connected',         // {kind}
  CODE_JOIN_FAILED: 'code_join_failed',
  APP_ERROR: 'app_error',                     // {where} — crash/unhandled rejection (truncated)
});
const EVENT_SET = new Set(Object.values(EVENTS));

const ENUM_RE = /^[a-z0-9_.:-]{1,24}$/;

/** Keep only PII-safe prop entries: numbers (finite), booleans, and short enum-shaped strings.
 *  Everything else (names, emails, free text, objects, long strings) is dropped. Caps at 6 keys. */
export function redactProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(props)) {
    if (n >= 6) break;
    if (!/^[a-z][a-z0-9_]{0,19}$/.test(k)) continue; // key must itself be enum-shaped
    const v = props[k];
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; n++; }
    else if (typeof v === 'boolean') { out[k] = v; n++; }
    else if (typeof v === 'string' && ENUM_RE.test(v)) { out[k] = v; n++; }
    // strings that aren't enum-shaped, objects, arrays, null → dropped (PII firewall)
  }
  return out;
}

/** Build a validated event, or null if the name isn't in the vocabulary. `now` is injected
 *  (ms epoch) so this stays pure/testable — callers pass Date.now() at the edge. */
export function makeEvent(name, props, now, sessionId) {
  if (!EVENT_SET.has(name)) return null;
  const e = { n: name, t: Math.floor(now) || 0 };
  const p = redactProps(props);
  if (Object.keys(p).length) e.p = p;
  if (sessionId && ENUM_RE.test(String(sessionId))) e.s = String(sessionId);
  return e;
}

/** Push onto a bounded buffer (drop-oldest at cap) — never grows without limit. Pure. */
export function bufferPush(buffer, event, cap = 500) {
  const buf = Array.isArray(buffer) ? buffer.slice() : [];
  if (!event) return buf;
  buf.push(event);
  return buf.length > cap ? buf.slice(buf.length - cap) : buf;
}

/** Split a buffer into a batch to send (oldest-first, size-capped) and the remainder to keep.
 *  On a successful send the caller persists `rest`; on failure it keeps the whole buffer. Pure. */
export function takeBatch(buffer, max = 50) {
  const buf = Array.isArray(buffer) ? buffer : [];
  const batch = buf.slice(0, max);
  const rest = buf.slice(max);
  return { batch, rest };
}

/* ===================== browser runtime (localStorage + gated flush) ===================== */
// Everything below touches window/localStorage and is guarded so the pure functions above stay
// Node-importable by the test. The runtime is a thin shell over the pure core.

const BUF_KEY = 'onstd-analytics-buf-v1';
const SID_KEY = 'onstd-analytics-sid';

function hasBrowser() { return typeof window !== 'undefined' && typeof localStorage !== 'undefined'; }

/** Anonymous per-install session id. Random, no identity link — purely to sessionize funnels.
 *  Uses crypto when present; a time+counter fallback otherwise (uniqueness, not secrecy, matters). */
function sessionId() {
  if (!hasBrowser()) return null;
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (sid) return sid;
    let rnd = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const a = new Uint8Array(8); window.crypto.getRandomValues(a);
      rnd = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    } else {
      rnd = 's' + ((typeof performance !== 'undefined' ? performance.now() : 0) | 0).toString(16);
    }
    sid = rnd.slice(0, 24);
    localStorage.setItem(SID_KEY, sid);
    return sid;
  } catch { return null; }
}

function readBuf() {
  try { const j = JSON.parse(localStorage.getItem(BUF_KEY) || '[]'); return Array.isArray(j) ? j : []; }
  catch { return []; }
}
function writeBuf(buf) { try { localStorage.setItem(BUF_KEY, JSON.stringify(buf)); } catch { /* quota */ } }

/** Record one event (best-effort, never throws). No-op outside the browser. */
export function track(name, props) {
  if (!hasBrowser()) return;
  try {
    const now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    const ev = makeEvent(name, props, now, sessionId());
    if (!ev) return;
    writeBuf(bufferPush(readBuf(), ev));
  } catch { /* analytics must never break the app */ }
}

/** The configured sink, or null. Injected as window.__ANALYTICS_SINK = { url } by the native
 *  shell once the founder wires it (mirrors __SUPABASE). Absent → the seam is INERT. */
function sink() {
  try {
    const s = hasBrowser() && window.__ANALYTICS_SINK;
    return s && typeof s.url === 'string' && s.url ? s : null;
  } catch { return null; }
}

/** Flush buffered events to the sink IF one is configured. Inert (no network) otherwise.
 *  On success drops the sent batch; on failure keeps everything for the next flush. */
export async function flush() {
  if (!hasBrowser()) return;
  const s = sink();
  if (!s) return; // no sink wired → stay local, never send
  const buf = readBuf();
  if (!buf.length) return;
  const { batch, rest } = takeBatch(buf);
  try {
    const res = await fetch(s.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true, // let it complete past a page-hide
    });
    if (res && res.ok) writeBuf(rest); // drop only what the sink accepted
  } catch { /* offline / sink down — keep the buffer, retry next flush */ }
}

let inited = false;
/** Wire crash capture + a visibility-hidden flush. Idempotent; call once at boot. */
export function initAnalytics() {
  if (!hasBrowser() || inited) return;
  inited = true;
  const cap = (where) => track(EVENTS.APP_ERROR, { where: String(where || 'unknown').slice(0, 24).toLowerCase().replace(/[^a-z0-9_.:-]/g, '') || 'error' });
  try {
    window.addEventListener('error', (e) => cap((e && e.filename && e.filename.split('/').pop()) || 'error'));
    window.addEventListener('unhandledrejection', () => cap('promise'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') void flush(); });
  } catch { /* listeners unavailable — events still buffer */ }
  void flush(); // opportunistic flush of anything buffered from a prior session
}
