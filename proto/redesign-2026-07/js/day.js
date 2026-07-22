// Real per-account day state + the honest score, computed from real logged data (not demo
// constants). The formulas are a byte-exact port of the RN engine (src/core/scoring.ts +
// scoringProfiles.ts + commitment.ts) — proven equal by a parity test (scripts/score-parity).
//
// The pure compute functions (computeComponents / scoreFor / tierFor) touch no browser APIs so
// they can be imported by the Node parity test. All Supabase / localStorage I/O is inside
// functions guarded for a non-browser environment.

/* ---------------- engine constants (ported exactly) ---------------- */
export const PROFILE_WEIGHTS = {
  athlete: { nutrition: 0.50, recovery: 0.25, commitment: 0.15, checkin: 0.10 },
  general: { nutrition: 0.55, recovery: 0.20, commitment: 0.15, checkin: 0.10 },
  gain:    { nutrition: 0.55, recovery: 0.25, commitment: 0.10, checkin: 0.10 },
};
export const MEAL_KEYS = ['breakfast', 'lunch', 'snack', 'dinner'];
export const DEADLINE = { breakfast: 570, lunch: 840, snack: 1020, dinner: 1230 }; // minutes from midnight
const QUICK_G = [18, 30, 22]; // Greek yogurt / protein shake / turkey roll-ups (protein g)
const QUICK_K = [150, 160, 120]; // kcal, index-aligned with QUICK_G (mirrors constants.ts QUICK_FOODS)
const PROTEIN_TARGET = 180;
const CAL_TARGET = 3200;
const CI_KEYS = ['energy', 'recovery', 'sleep', 'confidence', 'soreness', 'motivation'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function withinTrailingWeek(dateStr, todayStr) {
  if (!dateStr || !todayStr) return false;
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(todayStr + 'T00:00:00');
  const diff = (b - a) / 86400000;
  return diff >= 0 && diff <= 6;
}

/** Gallery reversal (founder direction 2026-07-15, replacing Rule A): a logged slot counts
 *  toward score/streak regardless of live-vs-gallery capture — the integrity wall is now the
 *  photo-hash duplicate check (migration 0062), not a blanket live-only exclusion. The ONLY
 *  slot that doesn't score is one whose photo was flagged as a duplicate
 *  (`slotMacros[k].flagged === 'dup'`): it stays logged and visible (coach sees the flag) but
 *  earns nothing. Pure + Node-importable, like the other compute fns below. Fixtures that
 *  never set slotMacros meta are unaffected. */
export function mealScored(day, k) {
  return !!(day.meals && day.meals[k]) && !(day.slotMacros && day.slotMacros[k] && day.slotMacros[k].flagged === 'dup');
}

/* ---- Coach standard (0055 requirement_sets → the SCORED day; WS3 slice 2) ----
   A room standard reshapes the day: which meal slots exist, their deadlines, and the
   nutrition denominator (meals 1–6). Null = the shipped classic day (byte-identical:
   MEAL_KEYS slots, DEADLINE windows, denominator 4) — every existing test stays locked. */
let STD = null; // { mealsRequired, slots: [key...], deadlines: {key: minutes}, titles: {key: label} }
function seedStandardSlots() {
  if (!STD || !Array.isArray(STD.slots)) return;
  for (const k of STD.slots) {
    if (!Object.prototype.hasOwnProperty.call(DAY.meals, k)) DAY.meals[k] = false;
  }
}
export function setDayStandard(std) {
  STD = std && std.mealsRequired > 0 && Array.isArray(std.slots) && std.slots.length ? std : null;
  seedStandardSlots();
}
export function dayStandard() { return STD; }
/** Apply the athlete's goal-derived scoring config to the live day: which profile grades them
 *  (athlete / general / gain) and the calorie + protein targets the general/gain curves measure
 *  against. Called from state.js once the profile hydrates; the classic athlete default stands
 *  until a real goal says otherwise. Not persisted in the `days` row — always re-derived from the
 *  profile, exactly like the coach standard. */
export function setDayGoalConfig(profile, proteinTarget, calTarget) {
  DAY.scoringProfile = (profile === 'general' || profile === 'gain') ? profile : 'athlete';
  if (proteinTarget > 0) DAY.proteinTarget = Math.round(proteinTarget);
  if (calTarget > 0) DAY.calTarget = Math.round(calTarget);
}
/** A slot's deadline: the standard's window when set, else the classic map, else end of day. */
export function slotDeadline(k, std = STD) {
  if (std && std.deadlines && std.deadlines[k] != null) return std.deadlines[k];
  return DEADLINE[k] != null ? DEADLINE[k] : 1440;
}
/** Grace minutes for a slot — a meal logged within deadline+grace still counts on-time. A
 *  standard with no grace (every shipped standard + the classic day) is 0, so scoring stays
 *  byte-identical to the parity-locked engine. */
export function slotGrace(k, std = STD) {
  return (std && std.grace && typeof std.grace[k] === 'number') ? std.grace[k] : 0;
}
/** Credit a slot earns when logged past deadline+grace: half (shipped default), full (the coach
 *  forgives lateness), or none (a hard window). Exported so the score breakdown explains lateness
 *  with the SAME credit the score applies (T-01), never a hardcoded half. */
export function slotLateCredit(k, std = STD) {
  const p = std && std.latePolicy && std.latePolicy[k];
  return p === 'full' ? 1 : p === 'none' ? 0 : 0.5;
}
const scoredSlotKeys = (std = STD) => (std && std.slots ? std.slots : MEAL_KEYS);

function effectiveMeals(day, std = STD) {
  let n = 0;
  for (const k of scoredSlotKeys(std)) {
    if (!mealScored(day, k)) continue;
    const at = day.mealLoggedAt && day.mealLoggedAt[k];
    const onTime = at == null || at <= slotDeadline(k, std) + slotGrace(k, std);
    n += onTime ? 1 : slotLateCredit(k, std); // late → the standard's late policy (default: half)
  }
  return n;
}

function proteinToday(day, std = STD) {
  let p = 0;
  for (const k of scoredSlotKeys(std)) {
    // Evidence rule: a logged slot with no saved plate earns 0 protein (matches mealSlotMacros).
    // A duplicate-flagged slot earns 0 protein too (mealScored excludes it).
    if (mealScored(day, k) && day.slotMacros && day.slotMacros[k]) p += day.slotMacros[k].protein || 0;
  }
  const q = day.quickAdded || [];
  for (let i = 0; i < q.length; i++) if (q[i]) p += QUICK_G[i] || 0;
  return p;
}

/** Calories logged today — the SAME evidence rule as protein (only a plated, non-duplicate,
 *  scored slot counts), plus quick-add kcal. Feeds the calorie-target adherence the general/gain
 *  profiles are graded on. */
function kcalToday(day, std = STD) {
  let k = 0;
  for (const key of scoredSlotKeys(std)) {
    if (mealScored(day, key) && day.slotMacros && day.slotMacros[key]) k += day.slotMacros[key].kcal || 0;
  }
  const q = day.quickAdded || [];
  for (let i = 0; i < q.length; i++) if (q[i]) k += QUICK_K[i] || 0;
  return k;
}

/* Calorie-target adherence (0..1), two-sided: full within ±10% of target, linear falloff to 0 at
   ±40%. Over- AND under-eating both lose credit, so `general` can never reward an unsafe deficit.
   Byte-for-byte port of calorieAdherence in src/core/scoringProfiles.ts. */
function calorieAdherence(kcal, target) {
  if (!(target > 0)) return 0;
  const dev = Math.abs(kcal - target) / target;
  if (dev <= 0.1) return 1;
  if (dev >= 0.4) return 0;
  return (0.4 - dev) / 0.3;
}
/* One-sided calorie FLOOR (0..1) for a muscle-gain client: full at/above target, linear to 0 at
   60% of it. Eating ABOVE target is the point of a bulk, so overage is never penalized. */
function calorieFloorAdherence(kcal, target) {
  if (!(target > 0)) return 0;
  if (kcal >= target) return 1;
  const ratio = kcal / target;
  if (ratio <= 0.6) return 0;
  return (ratio - 0.6) / 0.4;
}

/** Profile-aware nutrition sub-score (0..100) — a byte-for-byte port of profileNutritionScore:
 *   - athlete: protein 65 + on-time meals 35 (the shipped formula, unchanged).
 *   - general: calorie adherence 45 + protein 25 + meal consistency 30 (a lose/maintain client).
 *   - gain:    calorie floor 40 + protein 35 + meal consistency 25 (surplus + protein led).
 *  The platform owns these weights; the coach/trainer owns the targets (Scoring Contract). */
function nutritionScore(day, std = STD) {
  const pt = day.proteinTarget > 0 ? day.proteinTarget : PROTEIN_TARGET;
  const proteinFrac = pt > 0 ? Math.min(proteinToday(day, std), pt) / pt : 0;
  // Denominator = the coach standard's meal count (1–6) when one governs; classic 4 otherwise.
  const mealsFrac = clamp(effectiveMeals(day, std) / ((std && std.mealsRequired) || 4), 0, 1);
  const profile = day.scoringProfile || 'athlete';
  if (profile === 'general') {
    const ct = day.calTarget > 0 ? day.calTarget : CAL_TARGET;
    return Math.min(100, Math.round(calorieAdherence(kcalToday(day, std), ct) * 45 + proteinFrac * 25 + mealsFrac * 30));
  }
  if (profile === 'gain') {
    const ct = day.calTarget > 0 ? day.calTarget : CAL_TARGET;
    return Math.min(100, Math.round(calorieFloorAdherence(kcalToday(day, std), ct) * 40 + proteinFrac * 35 + mealsFrac * 25));
  }
  return Math.min(100, Math.round(proteinFrac * 65 + mealsFrac * 35));
}

function recoveryParts(day) {
  if (day.ciSubmitted) {
    let sum = 0, count = 0;
    for (const key of CI_KEYS) {
      if (!(day.ciConfig && day.ciConfig[key])) continue;
      const raw = day.ci ? day.ci[key] : undefined;
      if (typeof raw !== 'number' || !isFinite(raw)) continue;
      sum += key === 'soreness' ? 10 - raw : raw; // soreness has inverse polarity
      count++;
    }
    if (count > 0) return { score: clamp(Math.round((sum / (count * 10)) * 100), 0, 100), isReal: true };
    return { score: 86, isReal: false };
  }
  if (day.ciLast && withinTrailingWeek(day.ciLast.date, day.date)) {
    return { score: Math.round(day.ciLast.recovery), isReal: true }; // weekly carry
  }
  return { score: 86, isReal: false }; // display fallback; contributes 0
}

function commitmentScore(ans) { return ans === 'yes' ? 100 : ans === 'partial' ? 60 : 0; }
export function checkinReal(day) { return !!(day.ciSubmitted || (day.ciLast && withinTrailingWeek(day.ciLast.date, day.date))); }

/** The four sub-scores. `recoveryContribution` is what the total uses (0 unless a real check-in
 *  backs it). Only nutrition depends on the standard (meal slots/windows/denominator); recovery,
 *  commitment, and check-in are standard-independent, so `std` only reaches nutritionScore. */
export function computeComponents(day, std = STD) {
  const rec = recoveryParts(day);
  return {
    nutrition: nutritionScore(day, std),
    recovery: rec.score,
    recoveryContribution: rec.isReal ? rec.score : 0,
    commitment: commitmentScore(day.dailyCommitment),
    checkin: checkinReal(day) ? 100 : 0,
  };
}

export function scoreFor(day, std = STD) {
  const w = PROFILE_WEIGHTS[day.scoringProfile] || PROFILE_WEIGHTS.athlete;
  const c = computeComponents(day, std);
  return clamp(Math.round(w.nutrition * c.nutrition + w.recovery * c.recoveryContribution + w.commitment * c.commitment + w.checkin * c.checkin), 0, 100);
}

export function gradeFor(s) { return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F'; }

/* ---------------- evidence ceiling (mirror of the server trigger) ---------------- */
// Keep the client score honest so the server clamp never has to silently lower it.
export function evidenceCeiling(day) {
  const hasNutrition = MEAL_KEYS.some((k) => day.meals && day.meals[k]) ||
    (day.slotMacros && Object.keys(day.slotMacros).length > 0);
  const hasCheckin = checkinReal(day);
  const hasCommitment = day.dailyCommitment === 'yes' || day.dailyCommitment === 'partial' || day.dailyCommitment === 'no';
  return (hasNutrition ? 55 : 0) + (hasCheckin ? 35 : 0) + (hasCommitment ? 15 : 0);
}
export function clampedScore(day) { return Math.min(scoreFor(day), evidenceCeiling(day)); }

/* ================= real per-account day state + Supabase I/O ================= */
// (browser-only below; the pure functions above stay Node-importable for the parity test.)

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function addDaysISO(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function minutesNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

const DEFAULT_CI = { energy: 8, recovery: 7, sleep: 8, confidence: 9, soreness: 4, motivation: 8 };
const DEFAULT_CICFG = { energy: true, recovery: true, sleep: true, confidence: true, soreness: false, motivation: false };

export const DAY = {
  date: todayISO(),
  meals: { breakfast: false, lunch: false, snack: false, dinner: false },
  mealLoggedAt: {},
  slotMacros: {},
  quickAdded: [false, false, false],
  checkedTasks: {}, // standing NON-MEAL check items completed today { id: true } — tracked, not scored
  hydrationL: 0,
  dailyCommitment: null,
  commitmentFocus: null, // the athlete's written intention for today (rides the checkin jsonb)
  ci: { ...DEFAULT_CI },
  ciConfig: { ...DEFAULT_CICFG },
  ciSubmitted: false,
  ciLast: null,          // { date, recovery }
  proteinTarget: 180,
  calTarget: 3200,
  scoringProfile: 'athlete',
  currentWeight: null,
  scoreHistory: [],      // [{date, score}] past days, for streak/trend
  trustPass: null,       // { granted_date, length_days } from trust_passes, or null (real, coach-granted)
};

export function dayScore() { return scoreFor(DAY); }

/** Reconstruct a past day object from a scoreHistory row (its meals + checkin jsonb) so the
 *  SAME computeComponents that scores today can grade history — real category trends, no
 *  second formula. Rows fetched before the jsonb ride-along return null (callers skip them).
 *
 *  `cfg` overrides the nutrition targets/profile the reconstructed day is scored against.
 *  Default = the live device DAY's values (correct for the signed-in athlete's own history).
 *  A COACH viewing another athlete MUST pass that athlete's own {proteinTarget, calTarget,
 *  scoringProfile}, or nutrition would be graded against the coach device's targets — the
 *  cross-athlete hazard the std-threading also closes. Pair with an explicit std at the
 *  computeComponents/scoreFor call. */
export function dayFromHistoryRow(r, cfg) {
  if (!r || !r.meals || !r.checkin) return null;
  const ck = r.checkin || {};
  const c = cfg || {};
  return {
    date: r.date,
    meals: r.meals,
    mealLoggedAt: ck.mealLoggedAt || {},
    slotMacros: ck.slotMacros || {},
    quickAdded: r.quickAdded || [],
    hydrationL: r.hydrationL || 0,
    dailyCommitment: ck.commitment ?? null,
    ci: { energy: ck.energy, recovery: ck.recovery, sleep: ck.sleep, confidence: ck.confidence, soreness: ck.soreness, motivation: ck.motivation },
    ciConfig: { ...DEFAULT_CICFG },
    ciSubmitted: !!ck.submitted,
    ciLast: ck.ciLast && ck.ciLast.date ? ck.ciLast : null,
    proteinTarget: c.proteinTarget != null ? c.proteinTarget : DAY.proteinTarget,
    calTarget: c.calTarget != null ? c.calTarget : DAY.calTarget,
    scoringProfile: c.scoringProfile != null ? c.scoringProfile : DAY.scoringProfile,
    currentWeight: r.weight ?? null,
    scoreHistory: [],
  };
}
/** "If you finish today" projection — all requirements done — for the reach/possible messaging. */
export function projectedDay() {
  const p = JSON.parse(JSON.stringify(DAY));
  p.meals = { breakfast: true, lunch: true, snack: true, dinner: true };
  // A governing standard projects ITS slots complete (a 6-meal room's "possible" includes
  // meal-5/meal-6; a 2-meal room's projection is just its two).
  for (const k of scoredSlotKeys()) p.meals[k] = true;
  // Gallery slots score now (2026-07-15), so no flag-clearing is needed; a duplicate-flagged
  // slot stays excluded even in the projection — that meal honestly can't count.
  p.ciSubmitted = true;
  p.dailyCommitment = 'yes';
  return p;
}
export function dayComponents() { return computeComponents(DAY); }
export function tierFor(s) { return s >= 90 ? { name: 'OnStandard', cls: 'g' } : s >= 75 ? { name: 'Locked In', cls: 'b' } : s >= 60 ? { name: 'Building', cls: 'a' } : { name: 'Off Standard', cls: 'r' }; }

/** Honest streak with the council-ruled grace (roadmap #11).
 *
 *  - The run is consecutive qualifying (>= 80) HISTORY days ending yesterday, plus today
 *    once today's live score qualifies. An INCOMPLETE today never zeroes the run — the
 *    morning after a 10-day run reads "10", not "0" (the old behavior punished the exact
 *    moment retention is decided).
 *  - ONE sub-80 / missed day per rolling 7 is GRACED: the chain survives it but the graced
 *    day itself doesn't count. A second miss within 7 days of the last graced one ends the
 *    run — grace is a bridge, not a discount.
 *  - Days before the earliest history row are UNKNOWN, not misses: the walk stops there
 *    without burning grace (history hydrates ~60 days; an older run just reads as its
 *    visible tail — honest, never inflated).
 *
 *  Returns { days, todayCounted, graceDate } — graceDate is the most recent graced miss
 *  inside the run (null when the grace is intact). */
export function streakInfo(activationDate = /** @type {string | null} */ (null)) {
  const THRESH = 80;
  const byDate = {};
  let earliest = null;
  for (const h of DAY.scoreHistory || []) {
    byDate[h.date] = h.score;
    if (earliest === null || h.date < earliest) earliest = h.date;
  }
  const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  // First-day activation (no retroactive failure): the activation day is a partial day the athlete
  // is never scored on — it neither counts toward the streak nor breaks it. `activationDate` is a
  // 'YYYY-MM-DD'; null (existing users) leaves every rule below untouched.
  const isActivationDay = !!activationDate && DAY.date === activationDate;
  const todayCounted = !isActivationDay && dayScore() >= THRESH;
  let days = todayCounted ? 1 : 0;
  let graceDate = null;   // most recent graced miss (first one met walking backward)
  let lastGrace = null;   // for the rolling-7 rule
  let cursor = addDaysISO(DAY.date, -1);
  while (earliest !== null && cursor >= earliest) {
    // The activation day and everything before it predate accountability — stop the walk there
    // (never a miss, never burns grace, never counts).
    if (activationDate && cursor <= activationDate) break;
    const s = byDate[cursor];
    if (typeof s === 'number' && s >= THRESH) {
      days++;
      cursor = addDaysISO(cursor, -1);
      continue;
    }
    // a miss (below the bar, or a day with no row inside known history)
    if (lastGrace === null || diffDays(cursor, lastGrace) >= 7) {
      lastGrace = cursor;
      if (graceDate === null) graceDate = cursor;
      cursor = addDaysISO(cursor, -1);
      continue; // graced: chain survives, day doesn't count
    }
    break; // second miss inside the rolling week — the run honestly ends
  }
  return { days, todayCounted, graceDate };
}

/** Back-compat: the plain day count (now grace-aware and morning-safe). `activationDate`
 *  (a 'YYYY-MM-DD', or null) forwards the first-day exclusion to streakInfo. */
export function streakDays(activationDate = /** @type {string | null} */ (null)) { return streakInfo(activationDate).days; }

/* ---- offline cache (per user) ---- */
function cacheKey(userId) { return `onstd-day-${userId}-${DAY.date}`; }
function saveCache(userId) { try { localStorage.setItem(cacheKey(userId), JSON.stringify(DAY)); } catch { /* quota */ } }
function loadCache(userId) { try { const j = JSON.parse(localStorage.getItem(cacheKey(userId)) || 'null'); if (j && j.date === DAY.date) Object.assign(DAY, j); } catch { /* ignore */ } }

/* ---- Supabase read/write ---- */
/* Merge the server row into DAY without ever ERASING same-day local progress. Within one
   day the logged facts are monotonic — a meal, a submitted check-in, a commitment, sipped
   water don't un-happen — so booleans merge with OR and hydration with max. This is what
   makes an offline-logged day survive reconnect: without it, an older server row (meals all
   false) would overwrite the cache-restored local day and the logs would vanish. Returns
   true when the LOCAL day carries anything the server row doesn't (the caller then pushes
   the reconciled day back up). */
function projectRowToDay(row) {
  if (!row) return false;
  let localAhead = false;
  const rowMeals = row.meals || {};
  // Reconcile the classic slots PLUS any standard slots and any extra keys the server row
  // carries (a 6-meal room's meal-5/meal-6 ride the same jsonb).
  const slotSet = new Set([...MEAL_KEYS, ...(STD && STD.slots ? STD.slots : []), ...Object.keys(rowMeals)]);
  for (const k of slotSet) {
    if (DAY.meals[k] && !rowMeals[k]) localAhead = true;
    DAY.meals[k] = !!(DAY.meals[k] || rowMeals[k]);
  }
  const rowHydration = Number(row.hydration_l) || 0;
  if (DAY.hydrationL > rowHydration) localAhead = true;
  DAY.hydrationL = Math.max(DAY.hydrationL, rowHydration);
  if (Array.isArray(row.quick_added) && row.quick_added.length) {
    for (let i = 0; i < DAY.quickAdded.length; i++) {
      if (DAY.quickAdded[i] && !row.quick_added[i]) localAhead = true;
      DAY.quickAdded[i] = !!(DAY.quickAdded[i] || row.quick_added[i]);
    }
  } else if (DAY.quickAdded.some(Boolean)) localAhead = true;
  // Standing check-item completions merge as a UNION: a local tap outranks a server gap; a server
  // completion this device lacks is adopted. Tracked, not scored (never touches computeComponents).
  {
    const rc = (row.checked_tasks && typeof row.checked_tasks === 'object') ? row.checked_tasks : {};
    if (!DAY.checkedTasks) DAY.checkedTasks = {};
    for (const id of Object.keys(DAY.checkedTasks)) { if (DAY.checkedTasks[id] && !rc[id]) localAhead = true; }
    for (const id of Object.keys(rc)) { if (rc[id]) DAY.checkedTasks[id] = true; }
  }
  if (DAY.currentWeight != null && row.current_weight == null) localAhead = true;
  DAY.currentWeight = DAY.currentWeight ?? row.current_weight ?? null;
  const ck = row.checkin || {};
  // Check-in answers: a locally SUBMITTED check-in outranks unsubmitted server answers.
  if (DAY.ciSubmitted && !ck.submitted) {
    localAhead = true;
  } else {
    DAY.ci = { energy: ck.energy ?? DAY.ci.energy, recovery: ck.recovery ?? DAY.ci.recovery, sleep: ck.sleep ?? DAY.ci.sleep, confidence: ck.confidence ?? DAY.ci.confidence, soreness: ck.soreness ?? DAY.ci.soreness, motivation: ck.motivation ?? DAY.ci.motivation };
  }
  DAY.ciSubmitted = !!(DAY.ciSubmitted || ck.submitted);
  DAY.ciLast = ck.ciLast && ck.ciLast.date ? ck.ciLast : (typeof ck.ciLast === 'string' ? { date: ck.ciLast, recovery: ck.recovery ?? 0 } : DAY.ciLast);
  if (DAY.dailyCommitment && ck.commitment == null) localAhead = true;
  DAY.dailyCommitment = DAY.dailyCommitment ?? ck.commitment ?? null;
  DAY.commitmentFocus = DAY.commitmentFocus ?? ck.focus ?? null;
  // Logged-at times ride the same jsonb (they power on-time history + category trends).
  DAY.mealLoggedAt = { ...(ck.mealLoggedAt || {}), ...DAY.mealLoggedAt };
  // Plate meta merges per-slot: local slots win (they carry the freshest AI meta), server
  // fills the slots this device doesn't have.
  DAY.slotMacros = { ...(ck.slotMacros || {}), ...DAY.slotMacros };
  return localAhead;
}

/* The days columns the client may SELECT directly after 0103's column-split grant — everything
   except current_weight, which only the weight_series RPC returns. Keep in sync with the 0103
   grant list (and add any future days column to BOTH). */
export const DAY_SELECT_COLS = 'id,athlete_id,date,meals,hydration_l,tasks,checked_tasks,quick_added,checkin,score,grade,computed_at,updated_at';

/** The athlete's weight-by-date map via the 0103 weight_series RPC (is_self always passes;
 *  a restricted viewer gets zero rows, never an error). Pre-apply fallback: before 0103 lands
 *  the RPC doesn't exist, so a direct column select (still granted then) keeps weight working —
 *  making the client safe to ship AHEAD of the migration, which the 0103 deploy order requires. */
export async function fetchWeightSeries(sb, userId, daysBack) {
  const m = new Map();
  if (!sb || !userId) return m;
  try {
    const { data, error } = await sb.rpc('weight_series', { athlete: userId, days_back: daysBack });
    if (!error && Array.isArray(data)) {
      for (const r of data) if (r && r.weight != null) m.set(String(r.date), r.weight);
      return m;
    }
  } catch { /* fall through to the pre-0103 path */ }
  try {
    const { data } = await sb.from('days').select('date,current_weight')
      .eq('athlete_id', userId).gte('date', addDaysISO(todayISO(), -daysBack)).not('current_weight', 'is', null);
    if (Array.isArray(data)) for (const r of data) if (r && r.current_weight != null) m.set(String(r.date), r.current_weight);
  } catch { /* offline / post-0103 without the RPC result — weight simply absent this load */ }
  return m;
}

export async function loadDay(userId) {
  // Reset to a fresh day FIRST — never merge the fetch onto a previous session's (or a
  // previous calendar day's) in-memory residue. Without this, a user with no server row
  // for today inherits whatever DAY held before (another account's meals/score on a shared
  // device, or yesterday's meals after midnight). The per-user+date cache below restores
  // this user's own state, and projectRowToDay layers the server row on top.
  dayResetLocal();
  DAY.date = todayISO();
  loadCache(userId); // instant offline paint
  const sb = window.sb;
  if (!sb || !userId) return;
  try {
    // Weight visibility (0103): days.current_weight left the direct SELECT grant — weight rides
    // its own permission-gated channel (the weight_series RPC; is_self always passes). Columns
    // are enumerated (never '*', which 42501s once the grant splits), the series is fetched in
    // parallel, and the weights are stitched back onto the fetched rows BEFORE any existing
    // processing — projectRowToDay, the history map, and every downstream consumer are unchanged.
    const since = addDaysISO(DAY.date, -60);
    const [{ data }, { data: hist }, weights] = await Promise.all([
      sb.from('days').select(DAY_SELECT_COLS).eq('athlete_id', userId).eq('date', DAY.date).maybeSingle(),
      // meals + checkin jsonb ride along so Progress can compute REAL per-category trends
      // (computeComponents over reconstructed past days) — never fabricated category numbers.
      sb.from('days').select('date,score,meals,checkin,hydration_l,quick_added').eq('athlete_id', userId).gte('date', since).lt('date', DAY.date).order('date'),
      fetchWeightSeries(sb, userId, 60),
    ]);
    if (data && weights.has(String(data.date))) data.current_weight = weights.get(String(data.date));
    const localAhead = projectRowToDay(data) || (!data && hasLoggedAnything());
    if (Array.isArray(hist)) DAY.scoreHistory = hist.map((r) => ({
      date: r.date, score: r.score ?? 0, weight: weights.has(String(r.date)) ? weights.get(String(r.date)) : null,
      meals: r.meals || null, checkin: r.checkin || null,
      hydrationL: Number(r.hydration_l) || 0, quickAdded: Array.isArray(r.quick_added) ? r.quick_added : [],
    }));
    // Real active Trust Pass (coach-granted; migration 0033/0039). Null if none / not applied.
    try {
      const { data: tp } = await sb.from('trust_passes').select('granted_date,length_days').eq('athlete_id', userId).is('ended_at', null).maybeSingle();
      DAY.trustPass = tp || null;
    } catch { DAY.trustPass = null; }
    saveCache(userId);
    // Reconnect healing: if this device's cached day carries progress the server row lacks
    // (offline logs, a push that never flushed before the app was killed), push the merged
    // day back up NOW — otherwise it would sit local-only until the next tap, and the coach
    // would read "not logged" for a day that was honestly logged.
    if (localAhead) await pushDay(userId, true);
  } catch (e) { console.warn('[day] loadDay failed', e && e.message); }
}

/** True when the in-memory day carries any real logged progress. */
function hasLoggedAnything() {
  return MEAL_KEYS.some((k) => DAY.meals[k]) || DAY.quickAdded.some(Boolean)
    || DAY.hydrationL > 0 || DAY.ciSubmitted || DAY.dailyCommitment != null || DAY.currentWeight != null
    || Object.keys(DAY.checkedTasks || {}).length > 0;
}

/** Flush a pending debounced push immediately (app going to background / being killed —
 *  the 1s debounce window must not lose the last action). No-op when nothing is pending. */
export function flushDayPush(userId) {
  if (!pushTimer || !userId) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  void pushDay(userId, true);
}

let pushTimer = null;
/* Client half of the 0050 minor-consent gate: while blocked (a provable minor without verified
   guardian consent), real data stays ON-DEVICE — the server would reject the writes anyway, so
   we don't fire doomed requests. The cache still saves (nothing is lost; it syncs the moment
   consent verifies). state.js arms/disarms this from the hydrated consent status. */
let SYNC_BLOCKED = false;
export function setSyncBlocked(blocked) { SYNC_BLOCKED = !!blocked; }
export function isSyncBlocked() { return SYNC_BLOCKED; }

/* days.tasks writer (closes the coach-side done-ness gap): a registered provider returns the
   day's per-requirement completion as [{ id, done }] — the SAME requirement ids the coach's
   engines resolve (CATALOG ids like 'recovery', or coach-set meal-slot keys), derived from the
   exec engine's item states. state.js registers it because it owns the resolved standard +
   completion map; day.js stays free of that dependency (no circular import — the setSyncBlocked
   pattern). Before this, pushDay never wrote `tasks`, so every non-meal requirement read as
   never-done in status.js/Insights. Returns null when unregistered so pushDay never blocks and
   never clobbers the column with a stale empty array. */
let taskProvider = null;
export function setDayTaskProvider(fn) { taskProvider = typeof fn === 'function' ? fn : null; }
function currentTasks() {
  if (!taskProvider) return null;
  try {
    const t = taskProvider();
    if (!Array.isArray(t)) return null;
    // Only well-formed { id, done } entries — never a fabricated or malformed row.
    return t.filter((x) => x && x.id != null).map((x) => ({ id: String(x.id), done: !!x.done }));
  } catch { return null; }
}
/* Honest sync surface: the result of the LAST attempted day push — 'ok' | 'error' | null (none
   attempted yet). Home renders a quiet "not synced" pill off this instead of the old silent
   console.warn, so an athlete can't log all week into a void without knowing. */
export const SYNC = { last: null };

export function pushDay(userId, immediate) {
  saveCache(userId);
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  const doPush = async () => {
    const sb = window.sb;
    if (!sb || !userId || SYNC_BLOCKED) return;
    const s = clampedScore(DAY);
    const tasks = currentTasks(); // [{id, done}] from the exec engine, or null if unavailable
    const row = {
      athlete_id: userId, date: DAY.date,
      meals: DAY.meals, hydration_l: DAY.hydrationL, quick_added: DAY.quickAdded,
      checked_tasks: DAY.checkedTasks,
      current_weight: DAY.currentWeight,
      checkin: { ...DAY.ci, submitted: DAY.ciSubmitted, ciLast: DAY.ciLast, commitment: DAY.dailyCommitment, focus: DAY.commitmentFocus, mealLoggedAt: DAY.mealLoggedAt, slotMacros: DAY.slotMacros },
      score: s, grade: gradeFor(s),
      // Only include tasks when we actually derived them — the column defaults to '[]', and 0041's
      // evidence ceiling reads meals/checkin/trust_passes, NOT tasks, so this never moves a score.
      ...(tasks ? { tasks } : {}),
    };
    try {
      // supabase-js reports failures via {error}, it doesn't throw — check both paths so the
      // sync pill is honest for RLS/constraint rejections as well as network deaths.
      const { error } = await sb.from('days').upsert(row, { onConflict: 'athlete_id,date' });
      SYNC.last = error ? 'error' : 'ok';
      if (error) console.warn('[day] pushDay failed', error.message);
    } catch (e) { SYNC.last = 'error'; console.warn('[day] pushDay failed', e && e.message); }
  };
  if (immediate) return doPush();
  pushTimer = setTimeout(doPush, 1000); // debounce bursts of taps
}

export function dayResetLocal() {
  DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
  seedStandardSlots(); // a governing standard's extra slots (meal-5/meal-6) survive the reset
  DAY.mealLoggedAt = {}; DAY.slotMacros = {}; DAY.quickAdded = [false, false, false]; DAY.checkedTasks = {};
  DAY.hydrationL = 0; DAY.dailyCommitment = null; DAY.commitmentFocus = null; DAY.ci = { ...DEFAULT_CI }; DAY.ciConfig = { ...DEFAULT_CICFG };
  DAY.ciSubmitted = false; DAY.ciLast = null; DAY.currentWeight = null; DAY.scoreHistory = []; DAY.trustPass = null;
}

/* ---- mutators (each persists) ---- */
export function dayLogMeal(userId, key, macros, meta) {
  if (!DAY.meals.hasOwnProperty(key)) return;
  DAY.meals[key] = true;
  DAY.mealLoggedAt[key] = minutesNow();
  const m = { ...(DAY.slotMacros[key] || {}) };
  if (macros && typeof macros.protein === 'number') { m.protein = macros.protein || 0; m.kcal = macros.kcal || 0; m.carbs = macros.carbs || 0; m.fat = macros.fat || 0; }
  // Persist the AI plate meta (quality/foods/note + fiber/highlights/detectedRich) so meal-detail
  // survives reload — it rides through the checkin.slotMacros jsonb (pushDay/projectRowToDay).
  // Scoring reads only .protein.
  if (meta) {
    if (meta.quality != null) m.quality = meta.quality;
    if (Array.isArray(meta.foods)) m.foods = meta.foods.slice(0, 8);
    if (meta.note) m.note = meta.note;
    if (meta.userNote) m.userNote = String(meta.userNote).slice(0, 240); // athlete's review-step details (§5.5)
    if (meta.photoQ && typeof meta.photoQ.luma === 'number') m.photoQ = { luma: Math.round(meta.photoQ.luma), sharpness: Math.round((meta.photoQ.sharpness || 0) * 10) / 10 }; // measured capture quality
    if (meta.fiber != null) m.fiber = meta.fiber;
    if (Array.isArray(meta.highlights)) m.highlights = meta.highlights.slice(0, 3);
    if (Array.isArray(meta.detectedRich)) m.detectedRich = meta.detectedRich.slice(0, 8);
    if (meta.live === false) m.live = false;
    if (meta.source) m.source = meta.source;          // 'live' | 'gallery' | 'manual' | 'label'
    if (meta.analysis) m.analysis = String(meta.analysis).slice(0, 1200);
    if (meta.takenAt) m.takenAt = meta.takenAt;       // EXIF capture time of a gallery pick
  }
  if (Object.keys(m).length) DAY.slotMacros[key] = m;
  pushDay(userId);
}
export function daySubmitCheckin(userId, ciValues) {
  if (ciValues) DAY.ci = { ...DAY.ci, ...ciValues };
  DAY.ciSubmitted = true;
  const rec = recoveryParts(DAY);
  DAY.ciLast = { date: DAY.date, recovery: rec.score };
  pushDay(userId);
}
export function daySetCommitment(userId, ans) { DAY.dailyCommitment = ans; pushDay(userId); }
export function daySetFocus(userId, text) { DAY.commitmentFocus = text || null; pushDay(userId); }
export function dayAddWaterOz(userId, oz) { DAY.hydrationL = Math.min(6, DAY.hydrationL + oz * 0.0295735); pushDay(userId); }
export function dayLogWeight(userId, lb) { if (lb) DAY.currentWeight = Math.round(lb); pushDay(userId); }
export function dayToggleQuick(userId, i) { DAY.quickAdded[i] = !DAY.quickAdded[i]; pushDay(userId); }
/* Complete (or un-complete) a standing NON-MEAL check requirement for today (lift / custom). Tracked,
   not scored: it rides into days.tasks so the coach sees it, but never touches computeComponents. */
export function dayCheckTask(userId, id, done = true) {
  if (!id) return;
  if (!DAY.checkedTasks) DAY.checkedTasks = {};
  if (done) DAY.checkedTasks[id] = true; else delete DAY.checkedTasks[id];
  pushDay(userId);
}

/** Insert a real row into the `meals` table (mirrors the RN insertMeal / mapMealToRow) so a coach
 *  can review and comment on the plate. The proto otherwise only writes `days`; coach review +
 *  meal_comments key on a real meal id. Best-effort — a failed insert never blocks logging.
 *  Returns the new meal id (string), the `{ dup: true }` sentinel when the 0062 photo-hash
 *  unique index rejected a reused photo (the caller flags the slot so it doesn't score), or
 *  null on any other failure. */
export async function insertMeal(userId, key, macros, meta, photoPath) {
  const sb = window.sb;
  if (!sb || !userId || SYNC_BLOCKED) return null;
  try {
    const m = meta || {};
    const legacyRow = {
      athlete_id: userId, day_date: DAY.date, type: key,
      photo_path: photoPath || null,
      name: m.name || (key.charAt(0).toUpperCase() + key.slice(1)),
      protein: (macros && macros.protein) || 0, kcal: (macros && macros.kcal) || 0,
      carbs: (macros && macros.carbs) || 0, fat: (macros && macros.fat) || 0,
      quality: m.quality != null ? m.quality : null,
      detected: Array.isArray(m.foods) ? m.foods : [],
      note: m.note || '',
      logged_at: new Date().toISOString(),
    };
    // 0062 integrity/analysis columns. photo_hash only rides with a real photo — the unique
    // index is per-athlete, so a null hash never collides.
    const row = {
      ...legacyRow,
      photo_hash: (typeof m.photoHash === 'string' && /^[0-9a-f]{64}$/.test(m.photoHash)) ? m.photoHash : null,
      source: m.source || null,
      analysis: m.analysis ? String(m.analysis).slice(0, 1200) : null,
      minutes_late: (typeof m.minutesLate === 'number' && isFinite(m.minutesLate))
        ? Math.max(0, Math.min(1440, Math.round(m.minutesLate))) : null,
      photo_taken_at: m.takenAt || null,
      // 0070: fiber history powers the "produce below target lately" pattern.
      fiber: (typeof m.fiber === 'number' && isFinite(m.fiber)) ? Math.max(0, Math.min(60, Math.round(m.fiber))) : null,
    };
    let { data, error } = await sb.from('meals').insert(row).select('id').maybeSingle();
    if (error && error.code === '23505') return { dup: true }; // photo reused — server wall held
    if (error) {
      // Pre-0062 DB (unknown column / stale schema cache): retry with the legacy shape so an
      // un-applied migration can never block logging a meal.
      ({ data, error } = await sb.from('meals').insert(legacyRow).select('id').maybeSingle());
    }
    if (error) { console.warn('[day] insertMeal failed', error.message); return null; }
    return data ? data.id : null;
  } catch (e) { console.warn('[day] insertMeal failed', e && e.message); return null; }
}

/** Upload a meal photo (raw base64 jpeg) to the private meal-photos bucket. Path MUST start with
 *  the athlete's id (storage RLS). Best-effort — a failed upload never blocks logging the meal. */
export async function uploadMealPhoto(userId, key, base64) {
  const sb = window.sb;
  if (!sb || !userId || !base64 || SYNC_BLOCKED) return;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await sb.storage.from('meal-photos').upload(`${userId}/${DAY.date}/${key}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
  } catch (e) { console.warn('[day] photo upload failed', e && e.message); }
}
