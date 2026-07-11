/* OnStandard — Requirements Engine (pure; no imports, no state).
   A requirement is ANY coach-defined obligation. Everything on Home's list,
   Plan·Schedule, and the coach assign flow derives from this one catalog +
   the derivation functions below. state.js supplies runtime + completion.

   impact.kind is the honesty hook:
     component  -> feeds one of the four real score components (n/r/c/k)
     trend      -> season trend + logging streak; NEVER daily points (weight, body photo)
     focus      -> this week's coach focus; visible, not scored (hydration)
     plan       -> coach-assigned task; covered by the commitment answer, coach sees it
*/

export const PROOF = {
  photo:   { label: 'Photo proof',   route: 'camera',   verb: 'Log' },
  form:    { label: 'Quick form',    route: 'recovery', verb: 'Complete' },
  scale:   { label: 'Scale entry',   route: 'weight',   verb: 'Log' },
  counter: { label: 'Running count', route: 'log',      verb: 'Add' },
  check:   { label: 'One-tap check', route: null,       verb: 'Mark done' }, // completes on its detail screen
};

export const IMPACT_LABEL = {
  nutrition: 'Nutrition · 50% of score',
  recovery:  'Recovery · 25% of score',
  checkin:   'Weekly check-in · 10% of score',
  trend:     'Season trend · not scored',
  focus:     "This week's focus · coach sees it",
  plan:      'Part of your plan · commitment covers it',
};

/* The proto's clock: 7:12 PM (dinner due 8:00 PM, "48 min remaining"). */
export const NOW_MIN = 19 * 60 + 12;
export const TODAY_DOW = 5; // Friday — Morning Weight runs Mon/Wed/Fri

export const CATALOG = [
  { id: 'breakfast', title: 'Breakfast', icon: 'utensils', accent: 'g', proof: 'photo',
    freq: { type: 'daily' }, window: { open: 7 * 60, due: 570 }, required: true,
    impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
    note: 'Protein first — 40g+ before 9:30 AM sets up the whole day.' },
  { id: 'lunch', title: 'Lunch', icon: 'bowl', accent: 'g', proof: 'photo',
    freq: { type: 'daily' }, window: { open: 12 * 60, due: 14 * 60 }, required: true,
    impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
    note: 'Don’t skip it. Carbs land around training.' },
  { id: 'weight', title: 'Morning Weight', icon: 'scale', accent: 'a', proof: 'scale',
    freq: { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' }, window: { due: 9 * 60 }, required: true,
    impact: { kind: 'trend' }, reminder: 'high',
    note: 'Same time, same conditions. We read the trend, never one morning.' },
  { id: 'dinner', title: 'Dinner', icon: 'bowl', accent: 'b', proof: 'photo',
    freq: { type: 'daily' }, window: { open: 18 * 60, due: 1230 }, required: true,
    impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
    note: 'Protein + slow carb + a vegetable. Close the day right.' },
  { id: 'hydration', title: 'Hydration · 120 oz', icon: 'droplet', accent: 'b', proof: 'counter',
    freq: { type: 'daily' }, window: { due: 21 * 60 + 30 }, required: false,
    impact: { kind: 'focus' }, reminder: 'low',
    note: '20 oz before practice. Water with every meal. Done by 9:30 PM.' },
  { id: 'recovery', title: 'Recovery Check-In', icon: 'moon', accent: 'p', proof: 'form',
    freq: { type: 'daily' }, window: { due: 23 * 60 + 30, label: 'Before bed' }, required: true,
    impact: { kind: 'component', comp: 'recovery' }, reminder: 'high',
    note: '20 seconds. Coach reads readiness before tomorrow’s practice.' },
  { id: 'weekly', title: 'Weekly Check-In', icon: 'clipboard', accent: 'g', proof: 'form',
    freq: { type: 'weekly', day: 0, label: 'Sundays' }, window: { due: 21 * 60 }, required: true,
    impact: { kind: 'component', comp: 'checkin' }, reminder: 'high', route: 'checkin',
    note: 'The week in one honest read: energy, sleep, soreness, weight.' },
];

export function fmtMin(m) {
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
export function freqLabel(f) {
  return f.type === 'daily' ? 'Required daily' : f.type === 'weekly' ? `Required weekly · ${f.label}` : `Required ${f.label}`;
}

export function runsToday(req, dow = TODAY_DOW) {
  const f = req.freq;
  if (f.type === 'daily') return true;
  if (f.type === 'days') return f.days.includes(dow);
  if (f.type === 'weekly') return f.day === dow;
  return false;
}

/* Derive one requirement's live view. done/late come from the runtime resolver. */
export function derive(req, { done = false, late = false, progress = null } = {}, nowMin = NOW_MIN) {
  const due = req.window.due;
  const dueLabel = req.window.label || `Due by ${fmtMin(due)}`;
  let status, statusColor, sub, subColor, accent = req.accent, missed = false, next = false;

  if (done) {
    status = late ? 'Logged late' : req.proof === 'form' ? 'Done' : 'Logged';
    statusColor = late ? 'a' : 'g'; accent = 'g';
    sub = late ? 'Logged tonight' : 'In on time'; subColor = late ? 'a' : 'g';
  } else if (progress != null) {
    status = 'Open'; statusColor = 'b';
    sub = `${progress} · ${dueLabel.toLowerCase()}`; subColor = 'b';
  } else if (nowMin > due) {
    status = 'Missed'; statusColor = 'a'; missed = true;
    sub = `Was due ${fmtMin(due)}`; subColor = 'a'; accent = 'a';
  } else if (due - nowMin <= 90 && (!req.window.open || nowMin >= req.window.open)) {
    status = 'Due soon'; statusColor = 'a'; next = true;
    sub = dueLabel; subColor = 'a'; accent = 'a';
  } else if (req.window.open && nowMin < req.window.open) {
    status = 'Upcoming'; statusColor = 'b';
    sub = `Opens ${fmtMin(req.window.open)}`; subColor = 'b';
  } else {
    status = 'Later'; statusColor = req.accent === 'p' ? 'p' : 'b';
    sub = dueLabel; subColor = req.accent === 'p' ? 'p' : 'b';
  }
  return { ...req, status, statusColor, sub, subColor, accent, done, late, missed, next, dueLabel };
}

/* Coach-assigned tasks (runtime objects) get the same treatment. */
export function deriveAssigned(a) {
  return {
    id: a.id, title: a.title, icon: a.icon || 'clipboard', accent: a.done ? 'g' : 'b',
    proof: 'check', required: true, impact: { kind: 'plan' }, reminder: a.reminder || 'medium',
    note: a.note, isAssigned: true, fresh: !a.seen && !a.done,
    status: a.done ? 'Done' : 'New', statusColor: a.done ? 'g' : 'b',
    sub: a.done ? 'Completed tonight' : `From ${a.from} · ${a.dueLabel}`, subColor: a.done ? 'g' : 'b',
    done: a.done, missed: false, next: false, dueLabel: a.dueLabel,
    window: {}, freq: { type: 'once', label: a.dueLabel },
  };
}
