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
const QUICK_G = [18, 30, 22]; // Greek yogurt / protein shake / turkey roll-ups
const PROTEIN_TARGET = 180;
const CI_KEYS = ['energy', 'recovery', 'sleep', 'confidence', 'soreness', 'motivation'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function withinTrailingWeek(dateStr, todayStr) {
  if (!dateStr || !todayStr) return false;
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(todayStr + 'T00:00:00');
  const diff = (b - a) / 86400000;
  return diff >= 0 && diff <= 6;
}

function effectiveMeals(day) {
  let n = 0;
  for (const k of MEAL_KEYS) {
    if (!day.meals || !day.meals[k]) continue;
    const at = day.mealLoggedAt && day.mealLoggedAt[k];
    n += (at == null || at <= DEADLINE[k]) ? 1 : 0.5; // late meal earns half (matches effectiveMealsLogged)
  }
  return n;
}

function proteinToday(day) {
  let p = 0;
  for (const k of MEAL_KEYS) {
    // Evidence rule: a logged slot with no saved plate earns 0 protein (matches mealSlotMacros).
    if (day.meals && day.meals[k] && day.slotMacros && day.slotMacros[k]) p += day.slotMacros[k].protein || 0;
  }
  const q = day.quickAdded || [];
  for (let i = 0; i < q.length; i++) if (q[i]) p += QUICK_G[i] || 0;
  return p;
}

function nutritionScore(day) {
  // athlete profile branch of profileNutritionScore (general/gain add calorie adherence later).
  const pt = day.proteinTarget > 0 ? day.proteinTarget : PROTEIN_TARGET;
  const proteinFrac = pt > 0 ? Math.min(proteinToday(day), pt) / pt : 0;
  const mealsFrac = clamp(effectiveMeals(day) / 4, 0, 1);
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
function checkinReal(day) { return !!(day.ciSubmitted || (day.ciLast && withinTrailingWeek(day.ciLast.date, day.date))); }

/** The four sub-scores. `recoveryContribution` is what the total uses (0 unless a real check-in backs it). */
export function computeComponents(day) {
  const rec = recoveryParts(day);
  return {
    nutrition: nutritionScore(day),
    recovery: rec.score,
    recoveryContribution: rec.isReal ? rec.score : 0,
    commitment: commitmentScore(day.dailyCommitment),
    checkin: checkinReal(day) ? 100 : 0,
  };
}

export function scoreFor(day) {
  const w = PROFILE_WEIGHTS[day.scoringProfile] || PROFILE_WEIGHTS.athlete;
  const c = computeComponents(day);
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
  hydrationL: 0,
  dailyCommitment: null,
  ci: { ...DEFAULT_CI },
  ciConfig: { ...DEFAULT_CICFG },
  ciSubmitted: false,
  ciLast: null,          // { date, recovery }
  proteinTarget: 180,
  scoringProfile: 'athlete',
  currentWeight: null,
  scoreHistory: [],      // [{date, score}] past days, for streak/trend
  trustPass: null,       // { granted_date, length_days } from trust_passes, or null (real, coach-granted)
};

export function dayScore() { return scoreFor(DAY); }
/** "If you finish today" projection — all requirements done — for the reach/possible messaging. */
export function projectedDay() {
  const p = JSON.parse(JSON.stringify(DAY));
  p.meals = { breakfast: true, lunch: true, snack: true, dinner: true };
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
export function streakInfo() {
  const THRESH = 80;
  const byDate = {};
  let earliest = null;
  for (const h of DAY.scoreHistory || []) {
    byDate[h.date] = h.score;
    if (earliest === null || h.date < earliest) earliest = h.date;
  }
  const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const todayCounted = dayScore() >= THRESH;
  let days = todayCounted ? 1 : 0;
  let graceDate = null;   // most recent graced miss (first one met walking backward)
  let lastGrace = null;   // for the rolling-7 rule
  let cursor = addDaysISO(DAY.date, -1);
  while (earliest !== null && cursor >= earliest) {
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

/** Back-compat: the plain day count (now grace-aware and morning-safe). */
export function streakDays() { return streakInfo().days; }

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
  for (const k of MEAL_KEYS) {
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
  // Plate meta merges per-slot: local slots win (they carry the freshest AI meta), server
  // fills the slots this device doesn't have.
  DAY.slotMacros = { ...(ck.slotMacros || {}), ...DAY.slotMacros };
  return localAhead;
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
    const { data } = await sb.from('days').select('*').eq('athlete_id', userId).eq('date', DAY.date).maybeSingle();
    const localAhead = projectRowToDay(data) || (!data && hasLoggedAnything());
    const since = addDaysISO(DAY.date, -60);
    const { data: hist } = await sb.from('days').select('date,score,current_weight').eq('athlete_id', userId).gte('date', since).lt('date', DAY.date).order('date');
    if (Array.isArray(hist)) DAY.scoreHistory = hist.map((r) => ({ date: r.date, score: r.score ?? 0, weight: r.current_weight ?? null }));
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
    || DAY.hydrationL > 0 || DAY.ciSubmitted || DAY.dailyCommitment != null || DAY.currentWeight != null;
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
export function pushDay(userId, immediate) {
  saveCache(userId);
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  const doPush = async () => {
    const sb = window.sb;
    if (!sb || !userId) return;
    const s = clampedScore(DAY);
    const row = {
      athlete_id: userId, date: DAY.date,
      meals: DAY.meals, hydration_l: DAY.hydrationL, quick_added: DAY.quickAdded,
      current_weight: DAY.currentWeight,
      checkin: { ...DAY.ci, submitted: DAY.ciSubmitted, ciLast: DAY.ciLast, commitment: DAY.dailyCommitment, slotMacros: DAY.slotMacros },
      score: s, grade: gradeFor(s),
    };
    try { await sb.from('days').upsert(row, { onConflict: 'athlete_id,date' }); }
    catch (e) { console.warn('[day] pushDay failed', e && e.message); }
  };
  if (immediate) return doPush();
  pushTimer = setTimeout(doPush, 1000); // debounce bursts of taps
}

export function dayResetLocal() {
  DAY.meals = { breakfast: false, lunch: false, snack: false, dinner: false };
  DAY.mealLoggedAt = {}; DAY.slotMacros = {}; DAY.quickAdded = [false, false, false];
  DAY.hydrationL = 0; DAY.dailyCommitment = null; DAY.ci = { ...DEFAULT_CI }; DAY.ciConfig = { ...DEFAULT_CICFG };
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
    if (meta.fiber != null) m.fiber = meta.fiber;
    if (Array.isArray(meta.highlights)) m.highlights = meta.highlights.slice(0, 3);
    if (Array.isArray(meta.detectedRich)) m.detectedRich = meta.detectedRich.slice(0, 8);
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
export function dayAddWaterOz(userId, oz) { DAY.hydrationL = Math.min(6, DAY.hydrationL + oz * 0.0295735); pushDay(userId); }
export function dayLogWeight(userId, lb) { if (lb) DAY.currentWeight = Math.round(lb); pushDay(userId); }
export function dayToggleQuick(userId, i) { DAY.quickAdded[i] = !DAY.quickAdded[i]; pushDay(userId); }

/** Insert a real row into the `meals` table (mirrors the RN insertMeal / mapMealToRow) so a coach
 *  can review and comment on the plate. The proto otherwise only writes `days`; coach review +
 *  meal_comments key on a real meal id. Best-effort — a failed insert never blocks logging.
 *  Returns the new meal id (or null) so callers can persist it for the comment thread. */
export async function insertMeal(userId, key, macros, meta, photoPath) {
  const sb = window.sb;
  if (!sb || !userId) return null;
  try {
    const m = meta || {};
    const row = {
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
    const { data, error } = await sb.from('meals').insert(row).select('id').maybeSingle();
    if (error) { console.warn('[day] insertMeal failed', error.message); return null; }
    return data ? data.id : null;
  } catch (e) { console.warn('[day] insertMeal failed', e && e.message); return null; }
}

/** Upload a meal photo (raw base64 jpeg) to the private meal-photos bucket. Path MUST start with
 *  the athlete's id (storage RLS). Best-effort — a failed upload never blocks logging the meal. */
export async function uploadMealPhoto(userId, key, base64) {
  const sb = window.sb;
  if (!sb || !userId || !base64) return;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await sb.storage.from('meal-photos').upload(`${userId}/${DAY.date}/${key}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
  } catch (e) { console.warn('[day] photo upload failed', e && e.message); }
}
