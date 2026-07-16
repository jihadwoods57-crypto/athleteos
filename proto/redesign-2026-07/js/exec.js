/* OnStandard — Execution Engine (pure; the clock and all state are ARGUMENTS).
   One ExecState drives Home, the Action Hub, the FAB dot, and the notification plan —
   the four surfaces can never disagree. Scoring is NEVER computed here (DECISION-MEMO
   D3): score/possible/streak arrive as inputs from the existing projections. */
import { CATALOG, runsToday, fmtMin, IMPACT_LABEL } from './requirements.js';
import { planNotifications } from './notify-plan.js';

export const DUE_SOON_MIN = 90;

/** Tone display string → engine pressure value. Accepts both the onboarding knob labels
 *  ("Keep it gentle" / "Hold me accountable" / "Max pressure") and the notification-settings
 *  tone names (Supportive / Direct / Intense — spec §13.3). Tone changes wording only. */
export function mapPressure(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('gentl') || s.includes('support')) return 'gentle';
  if (s.includes('max') || s.includes('intens')) return 'max';
  return 'accountable';
}

/** 47 → '47 min' · 132 → '2:12'. Null/negative → ''. */
export function fmtCountdown(mins) {
  if (mins == null || mins < 0) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} min`;
}

export function samePlan(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

const COLOR = { done: 'green', done_late: 'green', overdue: 'red', due_soon: 'gold', ready: 'gold', locked: 'gray' };
const PILL = { done: 'Logged', done_late: 'Logged late', overdue: 'Overdue', due_soon: 'Due soon', ready: 'Open', locked: 'Upcoming' };

function itemState(req, st, nowMin) {
  if (st.done) return st.late ? 'done_late' : 'done';
  if (nowMin > req.window.due) return 'overdue';
  if (req.window.open != null && nowMin < req.window.open) return 'locked';
  if (req.window.due - nowMin <= DUE_SOON_MIN) return 'due_soon';
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
export function deriveExec({ nowMin, dow, status, assigned = [], pressure = 'accountable', score = 0, possible = 0, streak = 0, catalog = CATALOG, dateISO = '', prefs = null, coachName = null }) {
  const rows = catalog.filter((r) => r.id !== 'weekly' && runsToday(r, dow));
  const items = rows.map((req) => {
    const st = status[req.id] || {};
    const isHydro = req.id === 'hydration';
    const hydroDone = isHydro && (st.oz || 0) >= 120;
    const done = isHydro ? hydroDone : !!st.done;
    let state = itemState(req, { done, late: !!st.late }, nowMin);
    // Optional items are never late in a way that matters — cap overdue/due_soon to
    // 'ready' so hydration (etc.) never renders the red "still counts" treatment.
    if (!req.required && (state === 'overdue' || state === 'due_soon')) state = 'ready';
    const minsLeft = !done && nowMin <= req.window.due ? req.window.due - nowMin : null;
    const dueLabel = req.window.label || `due ${fmtMin(req.window.due)}`;
    const impact = IMPACT_LABEL[req.impact.comp || req.impact.kind] || '';
    let sub;
    if (state === 'done' || state === 'done_late') sub = st.at ? `Logged at ${st.at}${st.late ? ' · late' : ''}` : (isHydro ? `${st.oz} oz · goal hit` : req.proof === 'form' ? 'Submitted' : 'In');
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
  const byDue = (arr) => arr.slice().sort((a, b) => (a.window ? a.window.due : 1e9) - (b.window ? b.window.due : 1e9));
  const doneItems = all.filter((i) => i.state === 'done' || i.state === 'done_late');
  const overdue = byDue(all.filter((i) => i.required && i.state === 'overdue'));
  const met = all.filter((i) => i.required && (i.state === 'done' || i.state === 'done_late')).length;
  const total = all.filter((i) => i.required).length;
  const celebration = met === total && total > 0;

  // NOW: overdue (earliest due) → due_soon (nearest due) → ready required (earliest due) → assigned.
  // LOCKED items never enter the ladder — the NOW card must always be actionable. When everything
  // actionable is exhausted but locked required items remain, now/next are null and it is NOT celebration.
  const openRequired = all.filter((i) => i.required && !['done', 'done_late'].includes(i.state));
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
  ];

  // Notification plan: delegated to the pure planner framework (notify-plan.js) — stages,
  // urgency, short-window collapse, coalescing, quiet hours, caps, and type-aware copy all
  // live there. Each entry carries the in-app `route` the tap should land on ("Dinner closes
  // at 8:30" → the dinner camera, not Home) — the last inch of the accountability loop.
  const doneIds = new Set(items.filter((i) => i.state === 'done' || i.state === 'done_late').map((i) => i.id));
  const plan = planNotifications({
    nowMin, dateISO, dayOffset: 0,
    reqs: rows.filter((r) => r.required && !doneIds.has(r.id)),
    assigned: assigned.map((a) => ({ id: a.id, title: a.title, from: a.from, done: !!a.done, dueAtMin: a.dueAtMin })),
    pressure, prefs, celebration, score, streak, coachName,
  });

  return { items: all, now, next, later, doneItems, overdue, met, total, score, possible, celebration, plan };
}
