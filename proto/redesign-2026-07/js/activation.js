/* OnStandard — First-day activation (pure; no imports, no DOM, no Date.now — callers pass the
   clock). The one job: never let a just-activated athlete be marked overdue/missed/Off-Standard
   for requirement windows that closed before their account or standard was live ("how am I
   already overdue for lunch"). Threaded as ARGUMENTS through the exec/requirements/status engines
   exactly like nowMin, so the score math (DECISION-MEMO D3, parity-locked) is never touched.

   Model: full first-day GRACE. On the activation day the athlete may still log — logs save and
   the coach sees them — but the day is shown as "Not scored yet", pre-activation required
   windows read "Not required", and the day never counts against a streak. Full scoring resumes
   the next local day (the handoff's default). Missing/expired activation ⇒ fully active, so every
   existing athlete is completely unaffected. */

export const ACTIVATION_BUFFER_MIN = 60;

function localDateOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an activation stamp into { date, min }. Accepts an ISO datetime (uses the SAME
 *  device-local clock as day.js minutesNow/todayISO) or a bare 'YYYY-MM-DD' (min 0 = start of
 *  day, so nothing reads as pre-activation). Null / unparseable → null. */
export function parseActivation(activationAt) {
  if (!activationAt) return null;
  const s = String(activationAt);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, min: 0 };
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return { date: localDateOf(d), min: d.getHours() * 60 + d.getMinutes() };
}

/** True when a required item's due window (window close, minute-of-day) landed at or before the
 *  athlete could realistically act — activation moment plus a grace buffer (so a window that
 *  opens minutes after signup isn't instantly "due"). Pure. activationMin null ⇒ fully active. */
export function windowPreActivation(dueMin, activationMin, buffer = ACTIVATION_BUFFER_MIN) {
  if (activationMin == null || dueMin == null) return false;
  return dueMin <= activationMin + buffer;
}

/** First-day state for the day being scored. activationMin/notYetScored are only meaningful on
 *  the activation day; everything false/null otherwise (fully active).
 *  @param {string|null} activationAt ISO datetime / 'YYYY-MM-DD' / null (the athlete's activation stamp).
 *  @param {string} todayISO the local date being scored ('YYYY-MM-DD').
 *  @returns {{ isActivationDay: boolean, activationMin: number|null, notYetScored: boolean }} */
export function activationInfo(activationAt, todayISO) {
  const a = parseActivation(activationAt);
  const isActivationDay = !!a && a.date === todayISO;
  return {
    isActivationDay,
    activationMin: isActivationDay ? a.min : null,
    notYetScored: isActivationDay,
  };
}
