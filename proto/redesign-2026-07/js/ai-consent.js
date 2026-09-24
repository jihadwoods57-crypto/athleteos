/* Permission before anything reaches the third-party AI (review pass 2026-09-23, G-L5 / A-R2).
 *
 * App Store Review Guideline 5.1.2(i): an app must say where personal data goes, including to a
 * third-party AI, and get explicit permission first. Meal photos, meal messages and the profile
 * facts the AI coaches from go to Anthropic (Claude). This module is the one place the app asks,
 * remembers the answer, and tells the rest of the app what it is.
 *
 * THE SERVER DECIDES. profiles.ai_consent (0243) is the record; every edge function that calls the
 * model checks it for the person whose data it is and answers `{ skipped: 'ai_consent_required' }`
 * without one. The copy on this device is a cache so the app can skip a call it knows will be
 * refused and show the plain "AI reads are off" line instead of a spinner.
 *
 *   true   the person tapped Continue.
 *   false  the person tapped Not now (or switched it off in Privacy).
 *   null   never asked, or not known yet. The server treats it as no.
 *
 * Before an account exists (the onboarding demo) the answer is kept on the device and written to
 * the server once, the first time the account's answer is read and found empty.
 *
 * No import from state.js: state.js imports this module, and the functions take the user id.
 */
import { icon } from './icons.js';
import { overlayOpen } from './overlay-guard.js';
import { AI_PROVIDER } from './privacy-copy.js';

export const AI_CONSENT_REQUIRED = 'ai_consent_required';
const CACHE = (uid) => `os.aiConsent.${uid}`;
const PENDING = (uid) => `os.aiConsent.pending.${uid}`;
const LOCAL = 'os.aiConsent.local';
const MINOR = (uid) => `os.aiConsent.minor.${uid}`;
/* M9: an onboarding answer is kept with its time and only ever lands on an account made within
   this window, so an answer left on a shared phone never speaks for the next person. */
const LOCAL_TTL_MS = 3 * 3600 * 1000;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* no storage */ } };
const fromStr = (s) => (s === '1' ? true : s === '0' ? false : null);
const toStr = (v) => (v === true ? '1' : v === false ? '0' : null);

function readLocal() {
  const raw = get(LOCAL);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !Number.isFinite(o.at) || Date.now() - o.at > LOCAL_TTL_MS) return null;
    return fromStr(o.v);
  } catch { return null; }
}

/** The answer this device knows for `uid` (or the pre-account answer when `uid` is empty). */
export function aiConsentCached(uid) {
  return uid ? fromStr(get(CACHE(uid))) : readLocal();
}

/** I6: a provable minor whose parent has not approved yet. The server treats them as no consent
 *  (has_ai_consent, 0243); the app does not offer them the sheet, and says why instead. */
export function aiMinorPending(uid) {
  return !!uid && get(MINOR(uid)) === '1';
}

/** The plain line for a person the AI is not reading. */
export const AI_MINOR_LINE = 'Nia starts once a parent or guardian approves your account.';

/** A server reply said the AI was skipped for lack of consent. Forget a stale yes on this device,
 *  so the next AI moment asks instead of silently failing. */
export function noteAiConsentRequired(uid) {
  if (uid && aiConsentCached(uid) === true) put(CACHE(uid), null);
}

/** True when a function's reply is the consent skip. */
export function isConsentSkip(data) {
  return !!(data && (data.skipped === AI_CONSENT_REQUIRED || data.error === AI_CONSENT_REQUIRED));
}

/** A coach-side line for a consent skip. `who` is the server's answer: 'athlete' when the athlete
 *  has not said yes (nothing about their meal may go), 'you' when the coach has not. */
export function aiOffForCoach(who) {
  return who === 'athlete'
    ? 'This athlete has not turned on Nia, so she can’t look at their meal. Your question was posted.'
    : 'Nia is off for you, so she stays quiet. Your question was posted. Turn on Nia in Privacy on your Profile.';
}

async function writeServer(value) {
  const sb = typeof window !== 'undefined' ? window.sb : null;
  if (!sb || typeof sb.rpc !== 'function') return false;
  try {
    const { error } = await sb.rpc('set_ai_consent', { p_consent: value === true });
    return !error;
  } catch { return false; }
}

/** Read the server's answer for `uid` into the cache, writing a pending answer first when there is
 *  one (an onboarding answer, or a write that failed offline). Returns the answer, or the cached
 *  one when the server cannot be reached. */
export async function refreshAiConsent(uid) {
  if (!uid) return aiConsentCached(null);
  const sb = typeof window !== 'undefined' ? window.sb : null;
  if (!sb || typeof sb.from !== 'function') return aiConsentCached(uid);
  let server;
  try {
    // my_ai_consent (0243): the answer AND whether a parent still has to approve first.
    let data = null;
    let error = null;
    if (typeof sb.rpc === 'function') ({ data, error } = await sb.rpc('my_ai_consent'));
    if (error || !data || typeof data !== 'object') {
      ({ data, error } = await sb.from('profiles').select('ai_consent').eq('id', uid).maybeSingle());
      if (error) return aiConsentCached(uid);
    } else {
      put(MINOR(uid), data.minor_pending === true ? '1' : null);
    }
    server = data && typeof data.ai_consent === 'boolean' ? data.ai_consent : null;
  } catch { return aiConsentCached(uid); }
  const pending = fromStr(get(PENDING(uid)));
  const local = readLocal();
  // A failed write from this device wins over what the server holds (it is newer); the onboarding
  // answer only fills an EMPTY record, so it can never undo a choice made later on another phone.
  const want = pending !== null ? pending : (server === null ? local : null);
  if (want !== null && want !== server && (await writeServer(want))) server = want;
  if (want !== null && server === want) { put(PENDING(uid), null); put(LOCAL, null); }
  put(CACHE(uid), toStr(server));
  return server;
}

/** Record an answer for `uid` (or on the device before an account exists). Returns true when the
 *  server has it; false leaves it pending on the device, written at the next refresh. */
export async function setAiConsent(uid, value) {
  const v = value === true;
  if (!uid) { put(LOCAL, JSON.stringify({ v: toStr(v), at: Date.now() })); return true; }
  put(CACHE(uid), toStr(v));
  const ok = await writeServer(v);
  put(PENDING(uid), ok ? null : toStr(v));
  return ok;
}

/* ------------------------------------------------------------------ the sheet */

/** The words, per audience. `operator` is a coach, trainer, dietitian or parent: their own data
 *  is their question; an athlete's data goes only if that athlete agreed too. Pure. */
export function aiConsentCopy(role = 'athlete') {
  const operator = role && role !== 'athlete' && role !== 'client';
  return operator ? {
    title: 'The AI Nutritionist uses Anthropic',
    lead: `When you ask the AI Nutritionist about a meal, OnStandard sends your question and that meal’s conversation to ${AI_PROVIDER}, an AI company, so it can answer.`,
    rows: [
      ['share', 'What is sent', 'Your question, the meal’s photos and messages, and the profile facts the AI coaches from. An athlete’s data is sent only if that athlete has said yes too.'],
      ['shield', 'What Anthropic does with it', 'Reads it to answer. It does not use it to train its models, and keeps it only briefly for safety checks.'],
      ['toggle', 'If you choose Not now', 'Everything else works. The AI Nutritionist stays quiet for you. You can change this any time in Privacy on your Profile.'],
    ],
  } : {
    title: 'Your meals are read by AI',
    lead: `To read your meal photos and answer you in your meal conversations, OnStandard sends them to ${AI_PROVIDER}, an AI company.`,
    rows: [
      ['share', 'What is sent', 'Your meal photos, what you write in a meal conversation, and the facts the AI coaches from: your goal, weight goal, position, allergies and your coach’s standard.'],
      ['shield', 'What Anthropic does with it', 'Reads it to answer you. It does not use it to train its models, and keeps it only briefly for safety checks.'],
      ['toggle', 'If you choose Not now', 'Everything else works. A photo still counts as proof, you can type your numbers with Search, and the AI stays quiet. You can change this any time in Privacy on your Profile.'],
    ],
  };
}

/** The sheet's markup. Pure, for tests. Continue and Not now only; neither is the word Allow. */
export function aiConsentSheetHtml(role = 'athlete') {
  const c = aiConsentCopy(role);
  return `
    <div class="aic-card" role="dialog" aria-modal="true" aria-labelledby="aic-t" tabindex="-1">
      <div class="aic-grab" aria-hidden="true"></div>
      <div class="aic-ic" aria-hidden="true">${icon('sparkle', 22)}</div>
      <h2 class="aic-title" id="aic-t">${c.title}</h2>
      <p class="aic-lead">${c.lead}</p>
      <div class="aic-rows" role="list">
        ${c.rows.map(([ic, t, s]) => `
        <div class="aic-row" role="listitem">
          <span class="aic-ric" aria-hidden="true">${icon(ic, 16)}</span>
          <span class="aic-rtx"><b>${t}</b><span>${s}</span></span>
        </div>`).join('')}
      </div>
      <div class="aic-foot">
        <button type="button" class="btn primary" data-aic="yes">Continue</button>
        <button type="button" class="btn ghost" data-aic="no">Not now</button>
      </div>
    </div>`;
}

let OPEN = null;   // the pending promise while the sheet is up: one sheet, however many callers

/** Show the sheet. Resolves true (Continue), false (Not now) or null (dismissed with Escape or
 *  the scrim: nothing is recorded and nothing is sent). */
export function openAiConsentSheet(role = 'athlete') {
  if (OPEN) return OPEN;
  if (typeof document === 'undefined') return Promise.resolve(null);
  OPEN = new Promise((resolve) => {
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const el = document.createElement('div');
    el.className = 'aicsheet';
    el.innerHTML = aiConsentSheetHtml(role);
    const done = (v) => {
      document.removeEventListener('keydown', onKey);
      el.classList.remove('on');
      setTimeout(() => { try { el.remove(); } catch { /* gone */ } }, 180);
      OPEN = null;
      if (opener && typeof opener.focus === 'function') { try { opener.focus(); } catch { /* left the DOM */ } }
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { done(null); return; }
      if (e.key === 'Tab') {
        const f = el.querySelectorAll('button');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('click', (ev) => {
      if (ev.target === el) { done(null); return; }
      const b = ev.target && ev.target.closest && ev.target.closest('[data-aic]');
      if (b) done(b.getAttribute('data-aic') === 'yes');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    try { el.querySelector('[data-aic="yes"]').focus(); } catch { /* focus is a nicety */ }
  });
  return OPEN;
}

/**
 * The one door every AI moment goes through. Resolves true only when the person has said yes.
 *   - a known yes: true at once, no sheet;
 *   - a known Not now: false, no sheet (unless `ask`, the "Turn on AI reads" buttons);
 *   - never asked: the sheet, once; the answer is recorded.
 * `uid` empty means no account yet (onboarding): the answer stays on the device.
 */
export async function ensureAiConsent(uid, { role = 'athlete', ask = false } = {}) {
  // I6: a minor waiting on a parent is never offered the sheet; the caller says why instead.
  if (aiMinorPending(uid)) return false;
  let v = aiConsentCached(uid || null);
  if (v === true) return true;
  if (uid && v === null) v = await refreshAiConsent(uid);
  if (aiMinorPending(uid)) return false;
  if (v === true) return true;
  if (v === false && !ask) return false;
  // Another overlay is up (a tour, a sheet): never stack on it. The caller treats it as not yet.
  if (overlayOpen('.aicsheet')) return false;
  const answer = await openAiConsentSheet(role);
  if (answer === null) return false;
  await setAiConsent(uid || null, answer);
  return answer === true;
}
