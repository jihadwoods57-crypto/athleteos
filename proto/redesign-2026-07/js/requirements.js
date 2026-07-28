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

/* The headline mix is style + goal-profile aware (plan-style.js weightsFor), so the impact copy
   can never be a constant — a Guided general adult sees Nutrition 52%, not 50%. requirements.js
   stays import-free by design, so state.js REGISTERS a provider that returns the live weights;
   until it does we fall back to the shipped structured/athlete row. Every consumer keeps reading
   IMPACT_LABEL[key] — the values are getters, so they re-read the weights on every access. */
let weightsProvider = null;
export function setImpactWeightsProvider(fn) { weightsProvider = typeof fn === 'function' ? fn : null; }

const FALLBACK_WEIGHTS = { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 };
function impactWeights() {
  let w = null;
  try { w = weightsProvider ? weightsProvider() : null; } catch (_) { w = null; }
  return w && typeof w.nutrition === 'number' ? w : FALLBACK_WEIGHTS;
}
/** The live whole-number weight for one component, for display copy. */
export function weightPct(comp) { return Math.round((impactWeights()[comp] || 0) * 100); }

export const IMPACT_LABEL = {
  get nutrition() { return `Nutrition · ${weightPct('nutrition')}% of score`; },
  get recovery()  { return `Recovery · ${weightPct('recovery')}% of score`; },
  get checkin()   { return `Weekly check-in · ${weightPct('checkin')}% of score`; },
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

/** The plan-style item (0142) out of a governing requirement set's items, or null when the
 *  standard doesn't set one. Mirrors the server's athlete_governing_plan_style: the SAME
 *  resolveRequirementSet precedence has already picked the set, so this only reads the item.
 *  Shape out: { style, overrides } — the resolvePlanStyle `teamStandard` argument. */
export function planStyleFromItems(items, setBy) {
  const it = Array.isArray(items) ? items.find(i => i && i.kind === 'plan_style' && i.style) : null;
  return it ? { style: it.style, overrides: it.overrides || null, setBy: setBy || null } : null;
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
  // Snack-optional (0086 item.snack): slot keys that are loggable but NOT required — they earn
  // credit when logged (day.js numerator) yet never count against the athlete (out of the
  // denominator, and required:false in the exec catalog so they can't read overdue).
  const optional = /** @type {string[]} */ ([]);
  slots.forEach((k, i) => {
    const it = mealItems[i] || {};
    if (it.window && it.window.due != null) deadlines[k] = it.window.due;
    if (it.title) titles[k] = it.title;
    // Part B item-schema depth: grace minutes + late policy ride each meal item into the day
    // engine (day.js slotGrace/slotLateCredit). Absent = the classic on-time/half-credit rule.
    if (typeof it.grace === 'number' && it.grace >= 0) grace[k] = Math.min(240, Math.round(it.grace));
    if (it.latePolicy === 'full' || it.latePolicy === 'none' || it.latePolicy === 'half') latePolicy[k] = it.latePolicy;
    if (it.snack === true) optional.push(k);
  });
  // Denominator = the REQUIRED meals only. PARITY: no snack-flagged item → requiredCount === m, so
  // mealsRequired is byte-identical to before. A standard that marks every meal a snack keeps 1
  // required (never divide by zero).
  const requiredCount = mealItems.filter(it => it.snack !== true).length;
  const mealsRequired = Math.min(6, Math.max(1, requiredCount || m));
  return { mealsRequired, slots, deadlines, titles, grace, latePolicy, optional };
}

/* ---- Day-type resolution (0086 item.dayType + 0100 team_week_pattern) ----
   A coach can mark a requirement item to apply on training days, rest days, or any day, and set a
   weekly training/rest pattern for the team. These two PURE helpers turn that into "which items
   govern the day being scored". Parity is the contract: with no team pattern (dayType 'any'),
   NOTHING is filtered and stdFromItems is byte-identical to before. */

/** The type of a given day from a team's weekly pattern. `pattern` is a 7-element array of
 *  'training' | 'rest', indexed by JS getDay() (0 = Sunday). A missing/malformed pattern, or a
 *  slot that isn't training/rest, resolves to 'any' — i.e. no day-type gating. */
export function dayTypeFor(pattern, dayOrISO) {
  if (!Array.isArray(pattern) || pattern.length !== 7) return 'any';
  let dow;
  if (typeof dayOrISO === 'number') dow = dayOrISO;
  else { const d = new Date(String(dayOrISO) + 'T12:00:00'); if (isNaN(d)) return 'any'; dow = d.getDay(); }
  const t = pattern[dow];
  return (t === 'training' || t === 'rest') ? t : 'any';
}

/** Keep only the items that apply on a day of the given type. An item with no dayType (or 'any')
 *  ALWAYS applies, so every existing set — none of which carry dayType — is returned unchanged.
 *  When dayType is 'any' (no pattern), nothing is filtered at all. */
export function filterItemsByDayType(items, dayType) {
  if (!Array.isArray(items)) return items;
  if (dayType !== 'training' && dayType !== 'rest') return items; // 'any' / unknown → no gating
  return items.filter((it) => {
    const d = it && it.dayType;
    return d == null || d === 'any' || d === dayType;
  });
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
