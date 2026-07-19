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
/* First-day activation grace buffer (mirrors activation.js — kept inline so requirements.js
   stays import-free by design, per the exec.test catalog/deadline enforcement seam). */
export const ACTIVATION_BUFFER_MIN = 60;

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

/* Derive one requirement's live view. done/late come from the runtime resolver.
   `activationMin` (minute-of-day of the athlete's activation on the activation day, or null)
   protects a just-activated athlete: a window that closed before they could act reads
   "Not required", never "Missed" — the same first-day rule exec.js applies to Home. */
export function derive(req, { done = false, late = false, progress = null } = {}, nowMin = NOW_MIN, activationMin = /** @type {number | null} */ (null)) {
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
  } else if (activationMin != null && due != null && due <= activationMin + ACTIVATION_BUFFER_MIN) {
    status = 'Not required'; statusColor = 'b';
    sub = `Closed ${fmtMin(due)} · you joined after`; subColor = 'b';
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

/* ---------------- Requirements engine (0055) — pure helpers ----------------
   The server holds standing requirement_sets scoped team / position / athlete.
   Resolution precedence: athlete > position > team > built-in CATALOG. A set
   REPLACES the standard wholesale (no merging) — the coach's word is the whole
   contract, and partial merges would make "what am I on?" unanswerable. */

/** Pick the governing set for one athlete out of their team's sets. Pure.
 *  Versioning: among sets sharing a scope, the governing one is the LATEST whose effective_date
 *  is on/before `asOfDate` (the day being scored). A null effective_date is the always-in-effect
 *  base (pre-versioning rows), so a future-dated edit never rescopes an earlier day. asOfDate null
 *  (legacy callers) disables date filtering and returns the sole per-scope match unchanged. */
export function resolveRequirementSet(sets, athleteId, position, asOfDate = /** @type {string | null} */ (null)) {
  if (!Array.isArray(sets) || !sets.length) return null;
  const eff = (s) => s.effective_date || '0001-01-01';
  const govern = (candidates) => {
    const active = asOfDate == null ? candidates : candidates.filter((s) => eff(s) <= asOfDate);
    if (!active.length) return null;
    return active.reduce((a, b) => (eff(a) >= eff(b) ? a : b));
  };
  const pos = String(position || '').trim().toUpperCase();
  const mine = govern(sets.filter(s => s.scope_kind === 'athlete' && String(s.scope_value) === String(athleteId)));
  if (mine) return mine;
  const room = pos ? govern(sets.filter(s => s.scope_kind === 'position' && String(s.scope_value || '').trim().toUpperCase() === pos)) : null;
  if (room) return room;
  return govern(sets.filter(s => s.scope_kind === 'team'));
}

/* Physical slot order for a standard of M meals — maps onto the classic keys first so the
   camera, meal-detail, and server jsonb all keep working; 5th/6th are new slot keys. */
export const STD_SLOT_MAP = {
  1: ['dinner'],
  2: ['breakfast', 'dinner'],
  3: ['breakfast', 'lunch', 'dinner'],
  4: ['breakfast', 'lunch', 'snack', 'dinner'],
  5: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5'],
  6: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'],
};

/* One shared path from a requirement set's items to the athlete day standard
   ({mealsRequired, slots, deadlines, titles} — the setDayStandard shape). state.js applies
   it live; the coach standards editor previews a DRAFT through the same function. */
export function stdFromItems(items) {
  const mealItems = Array.isArray(items) ? items.filter(i => i && i.kind === 'meal') : [];
  if (!mealItems.length) return null;
  const m = Math.min(6, Math.max(1, mealItems.length));
  const slots = STD_SLOT_MAP[m];
  const deadlines = /** @type {Record<string, number>} */ ({});
  const titles = /** @type {Record<string, string>} */ ({});
  const grace = /** @type {Record<string, number>} */ ({});
  const latePolicy = /** @type {Record<string, string>} */ ({});
  slots.forEach((k, i) => {
    const it = mealItems[i] || {};
    if (it.window && it.window.due != null) deadlines[k] = it.window.due;
    if (it.title) titles[k] = it.title;
    // Part B item-schema depth: grace minutes + late policy ride each meal item into the day
    // engine (day.js slotGrace/slotLateCredit). Absent = the classic on-time/half-credit rule.
    if (typeof it.grace === 'number' && it.grace >= 0) grace[k] = Math.min(240, Math.round(it.grace));
    if (it.latePolicy === 'full' || it.latePolicy === 'none' || it.latePolicy === 'half') latePolicy[k] = it.latePolicy;
  });
  return { mealsRequired: m, slots, deadlines, titles, grace, latePolicy };
}

/** An independent (no-coach) athlete's personal standard → the same scored-day shape a coach
 *  standard produces. v1 configures only the meal count (onboarding's 2/3/4 chip); windows and
 *  titles fall back to the classic day. Returns null for a missing/out-of-range count, so the
 *  classic 4-meal day stands. Pure. */
export function stdFromSolo(standard) {
  const m = standard && Number(standard.mealsPerDay);
  if (!(m >= 1 && m <= 6)) return null;
  return stdFromItems(Array.from({ length: Math.round(m) }, () => ({ kind: 'meal' })));
}

/* Defaults per item kind, so a server set only has to carry what the coach chose.
   Every value here mirrors a CATALOG entry — one visual/behavioral language. */
const KIND_DEFAULTS = {
  meal:      { icon: 'utensils', accent: 'g', proof: 'photo', required: true, impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium', freq: { type: 'daily' } },
  lift:      { icon: 'bolt', accent: 'b', proof: 'check', required: true, impact: { kind: 'plan' }, reminder: 'medium', freq: { type: 'daily' } },
  hydration: { icon: 'droplet', accent: 'b', proof: 'counter', required: false, impact: { kind: 'focus' }, reminder: 'low', freq: { type: 'daily' } },
  recovery:  { icon: 'moon', accent: 'p', proof: 'form', required: true, impact: { kind: 'component', comp: 'recovery' }, reminder: 'high', freq: { type: 'daily' } },
  weigh:     { icon: 'scale', accent: 'a', proof: 'scale', required: true, impact: { kind: 'trend' }, reminder: 'high', freq: { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' } },
  checkin:   { icon: 'clipboard', accent: 'g', proof: 'form', required: true, impact: { kind: 'component', comp: 'checkin' }, reminder: 'high', freq: { type: 'weekly', day: 0, label: 'Sundays' }, route: 'checkin' },
  custom:    { icon: 'clipboard', accent: 'b', proof: 'check', required: true, impact: { kind: 'plan' }, reminder: 'medium', freq: { type: 'daily' } },
};

/** Map a server set's items (validated jsonb) into CATALOG-shaped requirements. Pure.
    Unknown kinds fall back to 'custom'; a malformed item is dropped, never invented. */
export function catalogFromItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    if (!it || typeof it !== 'object' || !it.id || !it.title) return null;
    const d = KIND_DEFAULTS[it.kind] || KIND_DEFAULTS.custom;
    return {
      id: String(it.id), title: String(it.title),
      icon: it.icon || d.icon, accent: d.accent,
      proof: PROOF[it.proof] ? it.proof : d.proof,
      freq: it.freq && it.freq.type ? it.freq : d.freq,
      window: it.window && typeof it.window === 'object' ? it.window : { due: 23 * 60 + 30, label: 'Before bed' },
      // Grace minutes ride the requirement so the coach status engine (status.js) judges "overdue"
      // with the SAME deadline+grace the athlete's day engine applies (day.js slotGrace). Clamped
      // exactly like stdFromItems; absent/invalid grace = 0 (the shipped, grace-free behavior).
      grace: typeof it.grace === 'number' && it.grace >= 0 ? Math.min(240, Math.round(it.grace)) : 0,
      required: it.required !== false && d.required,
      impact: d.impact, reminder: d.reminder,
      note: typeof it.note === 'string' ? it.note : '',
      ...(d.route ? { route: d.route } : {}),
    };
  }).filter(Boolean);
}

/** Map a requirement_assignments row into the RT.assigned runtime shape. Pure.
    `real: true` marks rows that must sync completion back to the server. */
export function assignedFromRow(row, coachName) {
  if (!row || !row.id || !row.title) return null;
  let dueLabel = row.due_label || '';
  if (!dueLabel && row.due_at) {
    const d = new Date(row.due_at);
    if (!isNaN(d)) dueLabel = `Due ${fmtMin(d.getHours() * 60 + d.getMinutes())}`;
  }
  return {
    id: String(row.id), title: String(row.title), icon: 'clipboard',
    note: row.note || '', from: coachName || 'Coach',
    dueLabel: dueLabel || 'On your list', proof: row.proof || 'check',
    // The real deadline rides along so the notification planner can remind on a DATED
    // assignment (same-day due_at → one 'soon' reminder); dateless stays list-only.
    dueAtISO: row.due_at || null,
    done: row.status === 'done', seen: false, real: true,
  };
}

/* Coach-assigned tasks (runtime objects) get the same treatment. */
export function deriveAssigned(a) {
  return {
    id: a.id, title: a.title, icon: a.icon || 'clipboard', accent: a.done ? 'g' : 'b',
    proof: a.proof || 'check', required: true, impact: { kind: 'plan' }, reminder: a.reminder || 'medium',
    note: a.note, isAssigned: true, fresh: !a.seen && !a.done,
    status: a.done ? 'Done' : 'New', statusColor: a.done ? 'g' : 'b',
    sub: a.done ? 'Completed tonight' : `From ${a.from} · ${a.dueLabel}`, subColor: a.done ? 'g' : 'b',
    done: a.done, missed: false, next: false, dueLabel: a.dueLabel,
    window: {}, freq: { type: 'once', label: a.dueLabel },
  };
}
