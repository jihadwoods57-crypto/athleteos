/* OnStandard — Execution Engine (pure; the clock and all state are ARGUMENTS).
   One ExecState drives Home, the Action Hub, the FAB dot, and the notification plan —
   the four surfaces can never disagree. Scoring is NEVER computed here (DECISION-MEMO
   D3): score/possible/streak arrive as inputs from the existing projections. */
import { CATALOG, runsToday, fmtMin, IMPACT_LABEL } from './requirements.js';
import { planNotifications } from './notify-plan.js';
import { windowPreActivation } from './activation.js';
import { dayDecided } from './dayverdict.js';

export const DUE_SOON_MIN = 90;

/** Tone display string → engine pressure value. Accepts the onboarding knob labels
 *  ("Remind me gently" / "Hold me accountable" / "High accountability", plus legacy "Max
 *  pressure") and the notification-settings tone names (Supportive / Direct / Intense — spec
 *  §13.3). Tone changes wording only. */
export function mapPressure(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('gentl') || s.includes('support')) return 'gentle';
  if (s.includes('max') || s.includes('intens') || s.includes('high')) return 'max';
  return 'accountable';
}

/** 47 → '47 min' · 132 → '2:12'. Null/negative → ''. */
export function fmtCountdown(mins) {
  if (mins == null || mins < 0) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}

export function samePlan(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

const COLOR = { done: 'green', done_late: 'green', overdue: 'red', due_soon: 'gold', ready: 'gold', locked: 'gray', not_required: 'gray' };
const PILL = { done: 'Logged', done_late: 'Logged late', overdue: 'Overdue', due_soon: 'Due soon', ready: 'Open', locked: 'Upcoming', not_required: 'Not required' };

function itemState(req, st, nowMin) {
  if (st.done) return st.late ? 'done_late' : 'done';
  // A meal within its grace window (day.js slotGrace) still scores on time, so it must not read
  // as red "overdue" here — it stays actionable until deadline+grace. Absent grace = 0 (unchanged).
  const grace = (req.window && typeof req.window.grace === 'number') ? req.window.grace : 0;
  const close = req.window.due + grace;
  if (nowMin > close) return 'overdue';
  if (req.window.open != null && nowMin < req.window.open) return 'locked';
  if (close - nowMin <= DUE_SOON_MIN) return 'due_soon';
  return 'ready';
}

const ROUTE = {
  breakfast: (d) => (d ? 'meal-detail/breakfast' : 'camera/breakfast'),
  lunch: (d) => (d ? 'meal-detail/lunch' : 'camera/lunch'),
  dinner: (d) => (d ? 'meal-detail/dinner' : 'camera/dinner'),
  weight: () => 'weight',
  hydration: () => 'log',
  recovery: (d) => (d ? 'recovery-confirm' : 'recovery'),
};

/**
 * The one derivation. `status` carries real completion; nothing here fabricates data.
 * Weekly Check-In is deliberately excluded (untracked in v1 — its completion isn't wired;
 * the Action Hub shows it as a navigational row on Sundays only, outside this engine).
 */
export function deriveExec({ nowMin, dow, status, assigned = [], pressure = 'accountable', score = 0, possible = 0, streak = 0, catalog = CATALOG, dateISO = '', prefs = null, coachName = null, activationMin = /** @type {number | null} */ (null) }) {
  const rows = catalog.filter((r) => r.id !== 'weekly' && runsToday(r, dow));
  const items = rows.map((req) => {
    const st = status[req.id] || {};
    const isHydro = req.id === 'hydration';
    const hydroDone = isHydro && (st.oz || 0) >= 120;
    const done = isHydro ? hydroDone : !!st.done;
    let state = itemState(req, { done, late: !!st.late }, nowMin);
    // First-day activation (no retroactive failure): a REQUIRED window that closed before the
    // athlete could act — activation moment + buffer — is not their responsibility today. It
    // reads "Not required", never overdue/missed, and drops out of the denominator, the NOW
    // ladder, and reminders. A meal they logged anyway still counts (done wins).
    if (req.required && !done && windowPreActivation(req.window.due, activationMin)) state = 'not_required';
    // Optional items are never late in a way that matters — cap overdue/due_soon to
    // 'ready' so hydration (etc.) never renders the red "still counts" treatment.
    if (!req.required && (state === 'overdue' || state === 'due_soon')) state = 'ready';
    const minsLeft = !done && nowMin <= req.window.due ? req.window.due - nowMin : null;
    const dueLabel = req.window.label || `due ${fmtMin(req.window.due)}`;
    const impact = IMPACT_LABEL[req.impact.comp || req.impact.kind] || '';
    let sub;
    if (state === 'done' || state === 'done_late') sub = st.at ? `Logged at ${st.at}${st.late ? ' · late' : ''}` : (isHydro ? `${st.oz} oz · goal hit` : req.proof === 'form' ? 'Submitted' : 'In');
    else if (state === 'not_required') sub = `Closed at ${fmtMin(req.window.due)} — you joined after, so it won’t count`;
    else if (state === 'overdue') sub = `Was due ${fmtMin(req.window.due)} — still counts, log it late`;
    else if (state === 'locked') sub = `Opens at ${fmtMin(req.window.open)}`;
    else if (isHydro) sub = `${st.oz || 0} of 120 oz · ${dueLabel}`;
    else sub = dueLabel;
    return {
      id: req.id, title: req.title, icon: req.icon, state, color: COLOR[state], pill: PILL[state],
      minsLeft, countdown: fmtCountdown(minsLeft), dueLabel, why: `${req.note} ${impact ? `**${impact}**` : ''}`.trim(),
      sub,
      // Dynamic standard slots (snack-as-required, meal-5/meal-6) follow the photo-proof
      // route convention even without a ROUTE entry.
      route: ROUTE[req.id] ? ROUTE[req.id](done)
        : req.proof === 'photo' ? (done ? `meal-detail/${req.id}` : `camera/${req.id}`) : 'home',
      required: !!req.required, tracked: true,
      window: req.window, proof: req.proof, oz: isHydro ? (st.oz || 0) : undefined,
    };
  });

  const assignedItems = assigned.map((a) => ({
    id: a.id, title: a.title, icon: a.icon || 'clipboard',
    state: a.done ? 'done' : 'ready', color: a.done ? 'green' : 'gold', pill: a.done ? 'Done' : 'Open',
    minsLeft: null, countdown: '', dueLabel: a.dueLabel || '', why: a.note || '',
    sub: a.done ? 'Completed' : `From ${a.from || 'Coach'} · ${a.dueLabel || ''}`,
    route: `requirement/${a.id}`, required: true, tracked: true, assigned: true,
  }));

  const all = [...items, ...assignedItems];

  // Verdict timing: a required window past its close is "Late" (amber, still savable) while the day
  // is live, and only becomes "Missed" (red) once the day is DECIDED — no required window still open.
  // The internal state stays 'overdue' so NOW ordering and the denominator are untouched; only the
  // display (color/pill) changes. Done/optional/not_required items are never re-treated.
  const decided = dayDecided(all);
  for (const i of all) {
    if (i.required && i.state === 'overdue') {
      i.color = decided ? 'red' : 'gold';
      i.pill = decided ? 'Missed' : 'Late';
    }
  }

  const byDue = (arr) => arr.slice().sort((a, b) => (a.window ? a.window.due : 1e9) - (b.window ? b.window.due : 1e9));
  const doneItems = all.filter((i) => i.state === 'done' || i.state === 'done_late');
  const overdue = byDue(all.filter((i) => i.required && i.state === 'overdue'));
  const met = all.filter((i) => i.required && (i.state === 'done' || i.state === 'done_late')).length;
  // Pre-activation windows ('not_required') are excused today — out of the denominator so a
  // late-signup athlete is never scored against windows that closed before they activated.
  const total = all.filter((i) => i.required && i.state !== 'not_required').length;
  const celebration = met === total && total > 0;

  // NOW: overdue (earliest due) → due_soon (nearest due) → ready required (earliest due) → assigned.
  // LOCKED items never enter the ladder — the NOW card must always be actionable. When everything
  // actionable is exhausted but locked required items remain, now/next are null and it is NOT celebration.
  const openRequired = all.filter((i) => i.required && i.state !== 'not_required' && !['done', 'done_late'].includes(i.state));
  let ordered = [];
  if (!celebration) {
    ordered = [
      ...overdue,
      ...byDue(openRequired.filter((i) => i.state === 'due_soon')),
      ...byDue(openRequired.filter((i) => i.state === 'ready' && !i.assigned)),
      ...openRequired.filter((i) => i.assigned && i.state !== 'overdue'),
    ];
  }
  const now = ordered[0] || null;
  const next = ordered[1] || null;
  const later = [
    ...ordered.slice(2),
    ...byDue(all.filter((i) => i.required && i.state === 'locked')),
    ...all.filter((i) => !i.required && !['done', 'done_late'].includes(i.state)),
    // Excused-today (pre-activation) rows sit quietly at the bottom — visible for honesty
    // ("won't count"), never in the NOW ladder.
    ...all.filter((i) => i.required && i.state === 'not_required'),
  ];

  // Notification plan: delegated to the pure planner framework (notify-plan.js) — stages,
  // urgency, short-window collapse, coalescing, quiet hours, caps, and type-aware copy all
  // live there. Each entry carries the in-app `route` the tap should land on ("Dinner closes
  // at 8:30" → the dinner camera, not Home) — the last inch of the accountability loop.
  const doneIds = new Set(items.filter((i) => i.state === 'done' || i.state === 'done_late').map((i) => i.id));
  // Never remind an athlete about a window that closed before they activated.
  const notReqIds = new Set(items.filter((i) => i.state === 'not_required').map((i) => i.id));
  const plan = planNotifications({
    nowMin, dateISO, dayOffset: 0,
    reqs: rows.filter((r) => r.required && !doneIds.has(r.id) && !notReqIds.has(r.id)),
    assigned: assigned.map((a) => ({ id: a.id, title: a.title, from: a.from, done: !!a.done, dueAtMin: a.dueAtMin })),
    pressure, prefs, celebration, score, streak, coachName,
  });

  return { items: all, now, next, later, doneItems, overdue, met, total, score, possible, celebration, plan, decided };
}
