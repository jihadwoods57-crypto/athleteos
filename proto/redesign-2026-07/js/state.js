/* OnStandard — Redesign Prototype · LIVE state engine.
   ONE source of truth. Screens read getters; actions mutate runtime; everything
   recomputes through the same honest formula so numbers can never drift.

   Score model = the shipped weighted engine (core/scoring.ts), NOT additive +pts:
     score = round( 0.50*Nutrition + 0.25*Recovery + 0.15*Commitment + 0.10*WeeklyCheckin )
   Weight is deliberately OUT of the daily score (season-goal arc, weightProgress.ts).
*/

import { CATALOG, runsToday, derive, deriveAssigned, assignedFromRow, resolveRequirementSet } from './requirements.js';
import { TOS_VERSION } from './ob-helpers.js';
import {
  DAY, computeComponents as realComponents, projectedDay, scoreFor,
  streakDays as dayStreak, streakInfo, loadDay, pushDay, uploadMealPhoto, flushDayPush,
  setSyncBlocked, isSyncBlocked, SYNC,
  dayLogMeal, daySubmitCheckin, daySetCommitment, dayAddWaterOz, dayLogWeight, dayResetLocal,
  insertMeal, MEAL_KEYS, DEADLINE, minutesNow, mealScored,
  setDayStandard, slotDeadline, setDayGoalConfig,
} from './day.js';
import { deriveExec, mapPressure, samePlan } from './exec.js';
import { normalizePrefs } from './notify-plan.js';
import { splitServerRows } from './notif-feed.js';
import { groundExtras, buildClarifications, analysisTiming } from './meal-intel.js';
import { base64ToBytes, sha256Hex, photoAgeMinutes } from './photo-hash.js';
import {
  fetchMyPracticeIdentity, fetchMyTeamIdentity, fetchMyCoach, fetchMyTrainer, fetchMyConsent,
  requestGuardianConsent as rpcRequestConsent,
  fetchRequirementSets, fetchMyAssignments, completeAssignmentRemote,
  fetchMyNotifications, markMyNotificationsRead,
  fetchMyCoachHandle, setMyCoachName, checkPhotoReuse,
} from './roles.js';
import { track, EVENTS } from './analytics.js';

/* minutes-from-midnight → "8:14 AM" (real logged times, never a canned '8:14 AM') */
export function fmtClock(min) {
  if (min == null) return '';
  let h = Math.floor(min / 60) % 12; if (h === 0) h = 12;
  const ap = Math.floor(min / 60) < 12 ? 'AM' : 'PM';
  return `${h}:${String(min % 60).padStart(2, '0')} ${ap}`;
}

/* The meal currently being captured (Phase 5 AI loop). When MEAL.result is set, S.logging and
   the score use the REAL analyzed macros instead of the demo placeholders.
   Integrity fields (0062): photoHash (sha256 of the downscaled JPEG — the duplicate wall),
   source ('live'|'gallery'|'manual'|'label'), takenAt (EXIF capture time of a gallery pick),
   capturedAtMin (when THIS capture happened, for the timing pill + minutes_late). */
export const MEAL = {
  key: null, mealType: null, photoBase64: null, photoDataUrl: null, result: null, live: true,
  questions: null, photoHash: null, source: null, takenAt: null, capturedAtMin: null,
};

/* In-flight capture persistence (sessionStorage, NOT RT). The MEAL object holds the staged photo +
   analysis, which live outside RT, so a hard WebView reload mid-capture (#analyzing /
   #meal-questions / #meal-analysis) would otherwise lose the photo and any PAID analysis and
   dead-end back to the camera. sessionStorage is the right scope: it survives an in-session reload
   but a fresh app launch correctly starts clean. Best-effort — quota/absent-store degrades to
   in-session-only, never blocks capture (and stays safe in a non-browser test env). */
const MEAL_KEY = 'onstd-proto-meal-v1';
function saveMeal() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (!MEAL.photoBase64 && !MEAL.result && !MEAL.questions) { sessionStorage.removeItem(MEAL_KEY); return; }
    sessionStorage.setItem(MEAL_KEY, JSON.stringify(MEAL));
  } catch { /* quota / disabled — capture still works this session, just not across a reload */ }
}
function loadMeal() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const j = JSON.parse(sessionStorage.getItem(MEAL_KEY) || 'null');
    if (j && typeof j === 'object') Object.assign(MEAL, j);
  } catch { /* corrupt / blocked store — start clean */ }
}
loadMeal(); // restore an in-flight capture across a reload, before the first render

/** Bound the AI's macros to sane per-meal ranges (Atwater fallback for calories) so a mis-read
   can never spike the score — a lightweight port of macroGrounding for v1. */
function groundResult(d) {
  const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(v || 0)));
  // Belt-and-braces: the AI response is untrusted text. Strip angle brackets at the source so a
  // crafted analyze-meal payload can never inject markup (render sites still escape as well).
  const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);
  const protein = clampN(d.protein, 120), carbs = clampN(d.carbs, 250), fat = clampN(d.fat, 150);
  const kcal = clampN(d.kcal || (4 * protein + 4 * carbs + 9 * fat), 2200);
  const extras = groundExtras(d);
  return {
    name: clean(d.name) || 'Meal', quality: clampN(d.quality, 100),
    protein, carbs, fat, kcal,
    fiber: extras.fiber,
    highlights: extras.highlights,
    detected: extras.detectedNames,      // legacy consumers keep plain names
    detectedRich: extras.detectedRich,   // confidence-aware renderers use this (now with quantity)
    note: clean(d.note),
    analysis: extras.analysis,           // detailed coach paragraph (0062); '' from an old edge fn
  };
}

export const WEIGHTS = { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

/* Weight's due time — read from the one catalog truth, never a second hardcoded copy. */
const WEIGHT_DUE = CATALOG.find((r) => r.id === 'weight').window.due;

export function computeScore(c) {
  return Math.round(
    WEIGHTS.nutrition * c.nutrition +
    WEIGHTS.recovery  * c.recovery +
    WEIGHTS.commitment* c.commitment +
    WEIGHTS.checkin   * c.checkin
  );
}

/* Score tiers (Bo's brief) — same bands everywhere. */
export function tier(s) {
  if (s >= 90) return { name: 'OnStandard', cls: 'g' };
  if (s >= 75) return { name: 'Locked In',  cls: 'b' };
  if (s >= 60) return { name: 'Building',   cls: 'a' };
  return { name: 'Off Standard', cls: 'r' };
}

/* ---------------- Runtime (persisted) ---------------- */
const KEY = 'onstd-proto-rt-v1';
const DEFAULT_RT = {
  dinnerLogged: false,
  recoveryDone: false,
  weightLogged: false,   // late log (window was 9 AM) — trend only, never scored
  weightLoggedAt: null,  // minutes-from-midnight of the real weight log — drives honest "late"
  hydrationOz: 0,        // real: 0 until the athlete logs water (syncRtFromDay reflects DAY.hydrationL)
  notifsRead: false,
  notifPrefs: null,      // reminder prefs {enabled,quietFrom,quietTo,allowDeadline}; null → framework defaults
  serverNotifs: [],      // cached server notification rows (0027: nudges, join events, digests)
  serverAckAt: null,     // when the bell was last opened — offline unread-badge ack for server rows
  day0: false,           // fresh-athlete empty-state mode (set by finishing onboarding)
  day0Breakfast: false,  // day-0 first meal logged
  lastMove: null,        // {from, to, gain, what} — powers confirmation screens
  assigned: [],          // coach-assigned requirements: {id,title,icon,note,from,dueLabel,done,seen,real?}
  reqSets: null,         // team's standing requirement_sets (0055) — cached for resolution surfaces
  stdMeals: null,        // resolved governing standard {mealsRequired, slots, deadlines, titles} — drives the scored day
  coachSeenMealIds: [],  // coach device: meal ids opened in the activity feed (drives unseen dots)
  coachNudged: {},       // coach device: athleteId -> ISO date of last nudge (one per athlete per day)
  theme: 'dark',         // 'dark' | 'light' | 'system' — dark is the shipped default (WS2b)
  coachComments: [],     // coach->athlete comments; REALLY land in the athlete's meal thread
  planUpdate: null,      // coach-published plan update; REALLY lands in Plan·Notes + notifications
  squadScope: 'position',// coach-controlled leaderboard scope: 'team' | 'position' | 'off'
  trainerNotes: [],      // trainer->client notes; REALLY land in the athlete's notifications
  camPrimed: false,      // Apple-style camera permission priming shown once
  homeOpenSections: {},  // WS6: per-section open state for Home's collapsible groups (Later/Done)
  profile: null,         // athlete identity: {name, sport, position, school, level, avatar(dataURL)} — from onboarding / signed-in profile, never fabricated
  ob: null,              // onboarding scratch — the athlete's real selections, captured as they build their Standard
  allergies: [],         // declared in onboarding, enforced everywhere (guardian). Empty until the athlete declares one.
  injured: false,        // injury mode: the Standard adapts (rehab replaces recovery emphasis)
  partnerNudged: false,  // peer accountability: one nudge sent tonight
  wearable: false,       // v1 has NO wearable integration — never show fabricated hardware data
  // --- real auth (Supabase session drives these; null until signed in) ---
  userId: null,
  email: null,
  authRole: null,        // 'athlete' | 'coach' | 'trainer' | 'parent' (from profile)
  // --- trainer's real practice identity (Practice HQ) ---
  practice: null,        // last server-confirmed {id,name,code}, or null — never a fabricated persona
  practiceLoading: true, // true until the first hydrate attempt (success or failure) completes
  practiceOffline: false,// true when the last hydrate attempt failed while a cached identity exists
  // --- athlete's own profile/targets hydration state (same honest model as practice/team) ---
  profileLoading: true,  // true until the first hydrate attempt (success or failure) completes
  profileOffline: false, // true when the last hydrate attempt failed while no cached targets exist
  // --- coach's real team identity (same honest model as practice) ---
  team: null,            // last server-confirmed {id,name,code}, or null — never "Coach Mark"
  teamLoading: true,
  teamOffline: false,
  // --- athlete's real linked coach ({teamId,teamName,name}) — null until a real team link exists ---
  myCoach: null,
  // --- a trainer's CLIENT: linked practice + trainer ({practiceId,practiceName,name,handle}) — null until a real practice link ---
  myTrainer: null,
  // --- guardian consent (athlete side of 0008/0050): last server-confirmed state, or null ---
  // { status: 'verified'|'pending'|'revoked'|'none', guardianEmail } — only meaningful for minors.
  consent: null,
};
function load() {
  try {
    const rt = { ...DEFAULT_RT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
    rt.wearable = false; // v1: no wearable integration exists — override any stale saved flag
    return rt;
  }
  catch { return { ...DEFAULT_RT }; }
}
export const RT = load();
function save() { localStorage.setItem(KEY, JSON.stringify(RT)); }

/* ---------------- Theme (WS2b: light / dark / system) ---------------- */
export function applyTheme() {
  if (typeof document === 'undefined') return;
  const mode = RT.theme || 'dark';
  const sysDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const eff = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', eff);
}
applyTheme(); // stamp before first paint — no flash of the wrong theme
// Re-arm the cached coach standard (WS3 slice 2) before the first score computes, so a
// 6-meal room's day never flashes as a classic 3-meal day between boot and hydrate.
if (RT.stdMeals) setDayStandard(RT.stdMeals);
if (typeof matchMedia === 'function') {
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((RT.theme || 'dark') === 'system') applyTheme(); }); }
  catch { /* older WebView — system mode simply resolves at boot */ }
}

/* ---------------- Auth helpers ---------------- */
export function routeForRole(role) {
  return role === 'coach' ? 'coach' : role === 'trainer' ? 'trainer' : role === 'parent' ? 'parent' : 'home';
}
/* Shared utility screens (billing, privacy, settings, terms, …) are reached by every role.
   They must render inside the SIGNED-IN role's chrome and route "back"/"Done" to that role's
   own profile — a hardcoded nav/'profile' put a coach inside the athlete tab bar. */
export function roleNav() {
  return RT.authRole === 'coach' ? 'coach' : RT.authRole === 'trainer' ? 'trainer' : 'athlete';
}
export function roleProfileRoute() {
  return RT.authRole === 'coach' ? 'coach-profile' : RT.authRole === 'trainer' ? 'trainer-profile' : 'profile';
}
function friendlyAuth(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid login')) return 'That email or password is incorrect.';
  if (m.includes('email not confirmed') || m.includes('not confirmed') || m.includes('confirm your email')) return 'Confirm your email first — check your inbox for the link, then sign in.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already')) return 'That email already has an account — try signing in.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('password')) return 'Password must be at least 8 characters.';
  if (m.includes('valid email') || m.includes('email address')) return 'Enter a valid email address.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) return 'Network problem — check your connection.';
  return msg || 'Something went wrong. Try again.';
}

/* ---------------- Derived (live) — REAL, from the persisted DAY (parity-proven engine) ---------------- */
// recovery is reported as its scoring CONTRIBUTION (0 unless a real check-in backs it), so
// computeScore(componentsNow()) === the engine's athleteScore. See day.js + scoreParity.test.ts.
function componentsNow() {
  const c = realComponents(DAY);
  return { nutrition: c.nutrition, recovery: c.recoveryContribution, commitment: c.commitment, checkin: c.checkin };
}
function componentsDone() {
  const c = realComponents(projectedDay());
  return { nutrition: c.nutrition, recovery: c.recoveryContribution, commitment: c.commitment, checkin: c.checkin };
}

/* Macros for the meal currently being logged. Until the AI loop (Phase 5) fills real macros,
   this uses the proto's analysis macros so a logged meal contributes real protein to the score. */
function loggingMacros() {
  const m = (S.logging && S.logging.macros) || {};
  return { protein: m.protein || 0, kcal: m.cals || 0, carbs: m.carbs || 0, fat: m.fat || 0 };
}

/* Meal slots surfaced as required rows (snack is an optional bonus slot, still loggable). */
const REQ_MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
/* The athlete's REQUIRED meal slots: the governing coach standard's slots (0055) when one
   is active, else the classic three. Every "how many meals" surface reads this one place. */
function reqMealSlots() {
  return (RT.stdMeals && Array.isArray(RT.stdMeals.slots) && RT.stdMeals.slots.length)
    ? RT.stdMeals.slots : REQ_MEAL_SLOTS;
}
/* Physical slot order for a standard of M meals — maps onto the classic keys first so the
   camera, meal-detail, and server jsonb all keep working; 5th/6th are new slot keys. */
const STD_SLOT_MAP = {
  1: ['dinner'],
  2: ['breakfast', 'dinner'],
  3: ['breakfast', 'lunch', 'dinner'],
  4: ['breakfast', 'lunch', 'snack', 'dinner'],
  5: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5'],
  6: ['breakfast', 'lunch', 'snack', 'dinner', 'meal-5', 'meal-6'],
};
const SLOT_DUE = { breakfast: 'Due by 10:00 AM', lunch: 'Due by 2:00 PM', snack: 'Optional', dinner: 'Due by 8:00 PM' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Display title for a meal slot key: the coach standard's title when one governs
 *  ("Post-practice fuel"), else a humanized key — never a raw "Meal-5" (WS7 audit fix). */
export function slotTitle(k) {
  if (!k) return '';
  const t = RT.stdMeals && RT.stdMeals.titles && RT.stdMeals.titles[k];
  return t || cap(String(k).replace('-', ' '));
}
/* The slot a new capture should fill: an explicit choice (from a requirement row), else the
   next OPEN slot by time of day — the earliest unlogged slot whose deadline is still ahead,
   or the latest open slot if every window has passed. Never a hardcoded breakfast/dinner. */
function nextOpenSlot(explicit) {
  if (explicit && MEAL_KEYS.includes(explicit) && !DAY.meals[explicit]) return explicit;
  const open = MEAL_KEYS.filter(k => !DAY.meals[k]);
  if (!open.length) return null;
  const now = minutesNow();
  return open.find(k => now <= DEADLINE[k]) || open[open.length - 1];
}

/* Meal detail for one slot, built from the REAL persisted plate (slotMacros meta + logged time).
   No fabricated lunch, no canned coach thread. Photo is the in-session capture when available;
   across reloads there's no local photo, so the detail shows the data without a fake stock plate. */
export function mealDetail(slot) {
  const k = MEAL_KEYS.includes(slot) ? slot : (MEAL_KEYS.find(x => DAY.meals[x]) || 'dinner');
  const logged = !!DAY.meals[k];
  const meta = DAY.slotMacros[k] || {};
  const at = DAY.mealLoggedAt[k];
  const deadline = slotDeadline(k); // coach-standard aware, falls back to the classic map
  const late = at != null && at > deadline;
  const foods = Array.isArray(meta.foods) && meta.foods.length ? meta.foods : (logged ? ['Your logged meal'] : []);
  return {
    slot: k, logged, name: cap(k),
    loggedAt: at != null ? fmtClock(at) : null, late,
    loggedAtMin: at != null ? at : null,
    deadlineMin: deadline, deadlineLabel: fmtClock(deadline),
    minutesLate: at != null ? Math.max(0, at - deadline) : null,
    score: meta.quality != null ? meta.quality : null,
    foods,
    macros: { protein: meta.protein || 0, carbs: meta.carbs || 0, fat: meta.fat || 0, cals: meta.kcal || 0 },
    img: (MEAL.key === k && MEAL.photoDataUrl) ? MEAL.photoDataUrl : null,
    note: meta.note || '',
    live: meta.live !== false,
    source: meta.source || (meta.live === false ? 'gallery' : null),
    flagged: meta.flagged || null,   // 'dup' → logged but doesn't score (photo reuse)
    takenAt: meta.takenAt || null,   // EXIF capture time of a gallery pick
    analysis: meta.analysis || '',   // the AI's detailed paragraph (0062), '' pre-migration
    mealId: meta.mealId || null, // real meals.id → powers the coach↔athlete comment thread
    fiber: meta.fiber || 0,
    highlights: Array.isArray(meta.highlights) ? meta.highlights : [],
    detectedRich: Array.isArray(meta.detectedRich) && meta.detectedRich.length
      ? meta.detectedRich
      : (foods || []).map((f) => ({ name: f, confidence: 'high' })),
  };
}

/** Honest projection: what the score becomes if the check-in is submitted right now with
 *  `ci` answers (falls back to the day's current answers). Never a hardcoded "+6". */
export function checkinProjection(ci) {
  const p = JSON.parse(JSON.stringify(DAY));
  if (ci) p.ci = { ...p.ci, ...ci };
  p.ciSubmitted = true;
  const to = scoreFor(p);
  return { to, gain: Math.max(0, to - computeScore(componentsNow())) };
}

/** After loadDay(), reflect the real day into the RT flags the rest of the UI still reads. */
export function syncRtFromDay() {
  RT.dinnerLogged = !!DAY.meals.dinner;
  RT.recoveryDone = !!DAY.ciSubmitted;
  RT.day0Breakfast = !!DAY.meals.breakfast;
  RT.weightLogged = DAY.currentWeight != null;
  if (!RT.weightLogged) RT.weightLoggedAt = null;
  RT.hydrationOz = Math.round(DAY.hydrationL / 0.0295735);
  // "day 0" (fresh empty state) until the athlete logs anything real today
  RT.day0 = !DAY.meals.breakfast && !DAY.meals.lunch && !DAY.meals.snack && !DAY.meals.dinner && !DAY.ciSubmitted && !DAY.dailyCommitment;
  save();
}

/* ---------------- Goal → scoring profile + targets (proto mirror of src/core) ----------------
   A solo client never gets a coach to set their scoring, so the goal they chose at signup drives
   it: lose/maintain → the calorie-target `general` profile, build → the surplus `gain` profile,
   performance (the default) → the shipped athlete formula. Mirrors profileForGoal (scoringProfiles)
   + deriveTargetsFromGoal (goalMapping); tolerant of the client onboarding slugs AND the BaseGoal
   enum. The platform owns the weights, the coach/trainer owns the targets (Scoring Contract). */
const GOAL_CAL_DEFAULT = 3200, GOAL_PROTEIN_DEFAULT = 180, GOAL_BW_DEFAULT = 171;
function scoringProfileForGoal(goal) {
  switch (goal) {
    case 'gain': case 'build': case 'gain_muscle': case 'gain_weight': return 'gain';
    case 'lose': case 'lose_fat': case 'maintain': case 'health': return 'general';
    default: return 'athlete'; // performance / perform / unknown → the shipped formula, unchanged
  }
}
function goalDerivedTargets(goal, bodyweightLb) {
  const bw = bodyweightLb > 0 ? bodyweightLb : GOAL_BW_DEFAULT;
  const p = (n) => Math.max(80, Math.round(n / 5) * 5);      // protein floor 80 g (safety)
  const c = (n) => Math.max(1500, Math.round(n / 50) * 50);  // calorie floor 1500 (safety)
  switch (goal) {
    case 'lose': case 'lose_fat':   return { proteinTarget: p(bw * 0.9), calTarget: c(bw * 12) };
    case 'gain': case 'build': case 'gain_muscle': case 'gain_weight':
                                    return { proteinTarget: p(bw * 1.0), calTarget: c(bw * 17) };
    case 'maintain': case 'health': return { proteinTarget: p(bw * 0.8), calTarget: c(bw * 15) };
    default:                        return { proteinTarget: GOAL_PROTEIN_DEFAULT, calTarget: GOAL_CAL_DEFAULT };
  }
}
/* Derive the athlete's scoring profile + calorie/protein targets from their real goal (server
   baseGoal, else the onboarding scratch) and body weight, and push them onto the live DAY so the
   score honors what they signed up for. A coach/trainer-set target (athlete_profiles.targets)
   always wins over the goal-derived default. Idempotent — safe on every profile hydrate. */
function applyGoalToDay() {
  const p = RT.profile || {};
  const goal = p.baseGoal || (RT.ob && RT.ob.goal) || null;
  if (!goal) { setDayGoalConfig('athlete', 0, 0); return; } // no goal yet → shipped athlete default
  const bw = (p.baseWeight != null ? +p.baseWeight : 0)
    || (RT.ob && RT.ob.currentWeight ? +RT.ob.currentWeight : 0)
    || (DAY.currentWeight != null ? +DAY.currentWeight : 0) || GOAL_BW_DEFAULT;
  const derived = goalDerivedTargets(goal, bw);
  const t = p.targets || {};
  const proteinTarget = (t.protein > 0 ? +t.protein : derived.proteinTarget);
  const calTarget = (t.calories > 0 ? +t.calories : derived.calTarget);
  setDayGoalConfig(scoringProfileForGoal(goal), proteinTarget, calTarget);
}

/* ---------------- Actions ---------------- */
/* The exec engine's catalog for the current runtime: a governing coach standard swaps ITS meal
   slots (count/titles/windows) in for the classic meals; no standard → the classic CATALOG,
   byte-identical. Shared by the live exec getter AND tomorrow's pre-scheduled reminder plan. */
function execCatalog() {
  const std = RT.stdMeals;
  if (!std) return CATALOG;
  const mealItems = reqMealSlots().map((k) => {
    const base = CATALOG.find(c => c.id === k);
    return {
      id: k, title: (std.titles && std.titles[k]) || (base ? base.title : cap(k.replace('-', ' '))),
      icon: base ? base.icon : 'utensils', accent: base ? base.accent : 'g', proof: 'photo',
      freq: { type: 'daily' }, window: { ...(base ? base.window : {}), due: slotDeadline(k) }, required: true,
      impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium', note: base ? base.note : '',
    };
  });
  return [...mealItems, ...CATALOG.filter(r => !REQ_MEAL_SLOTS.includes(r.id))];
}

/* An assignment's due time as minutes-from-midnight, ONLY when its real due_at lands on the
   current local day — dateless or other-day assignments get no reminder (null). */
function dueAtMinToday(dueAtISO) {
  if (!dueAtISO) return null;
  const d = new Date(dueAtISO);
  if (isNaN(d)) return null;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return iso === String(DAY.date) ? d.getHours() * 60 + d.getMinutes() : null;
}

/* Registered-this-session guard for the push token, plus the token itself so sign-out can
   unregister THIS device (and only this device) — otherwise a coach nudge for the previous
   account would keep landing on a phone they no longer use. Session-scoped by design. */
let PUSH_TOKEN_TRIED = false;
let PUSH_TOKEN_VALUE = null;

/* Server-notification fetch throttle (in-memory: refetch at most every 15s, resets on
   reload) so the bell's mount → fetch → repaint cycle can never loop. */
let NOTIF_FETCH_AT = 0;

export const act = {
  /* Log a real meal into a real slot. One implementation for every meal (camera or search),
     any slot — not a hardcoded breakfast/dinner. Persists the AI plate (quality/foods/note)
     per slot so the meal-detail screen survives a reload. */
  logMeal(slotArg) {
    const slot = nextOpenSlot(slotArg) || slotArg || MEAL.key;
    if (!slot || !MEAL_KEYS.includes(slot) || DAY.meals[slot]) return;
    const from = computeScore(componentsNow());
    const hasPhoto = MEAL.photoBase64 && MEAL.key === slot;
    // Timing accountability (0062): minutes past this slot's deadline at log time, computed on
    // the athlete's own clock (the only honest source) and persisted so the COACH side can
    // render the same on-time/late sentence the athlete saw.
    const minutesLate = Math.max(0, minutesNow() - slotDeadline(slot));
    const source = MEAL.key === slot ? (MEAL.source || (hasPhoto ? 'live' : 'manual')) : 'manual';
    const integrity = {
      live: MEAL.live !== false, source, minutesLate,
      photoHash: hasPhoto ? MEAL.photoHash : null,
      takenAt: hasPhoto ? MEAL.takenAt : null,
    };
    const meta = MEAL.result
      ? { quality: MEAL.result.quality, foods: MEAL.result.detected, note: MEAL.result.note, name: MEAL.result.name || MEAL.mealType,
          fiber: MEAL.result.fiber || 0, highlights: MEAL.result.highlights || [], detectedRich: MEAL.result.detectedRich || [],
          analysis: MEAL.result.analysis || '', ...integrity }
      : { name: MEAL.mealType || cap(slot), ...integrity };
    const macros = loggingMacros();
    dayLogMeal(RT.userId, slot, macros, meta);
    if (hasPhoto) uploadMealPhoto(RT.userId, slot, MEAL.photoBase64);
    // Insert a real `meals` row so a coach can review + comment; persist the id for the thread.
    // A { dup: true } return means the 0062 photo-hash wall caught a reused photo that slipped
    // past the pre-check: the slot stays logged (honest record) but is flagged so it never
    // scores, and the flag is visible to athlete + coach.
    const photoPath = hasPhoto ? `${RT.userId}/${DAY.date}/${slot}.jpg` : null;
    insertMeal(RT.userId, slot, macros, meta, photoPath).then((res) => {
      if (res && res.dup) {
        DAY.slotMacros[slot] = { ...(DAY.slotMacros[slot] || {}), flagged: 'dup' };
        pushDay(RT.userId);
        track(EVENTS.MEAL_DUP_BLOCKED, { stage: 'insert' });
        window.__render && window.__render();
      } else if (res) {
        DAY.slotMacros[slot] = { ...(DAY.slotMacros[slot] || {}), mealId: res };
        pushDay(RT.userId);
      }
    });
    // Reflect the just-logged meal into every RT flag the UI reads. Beyond the legacy
    // dinnerLogged/day0Breakfast flags, this recomputes RT.day0 — Progress gates on it, so it
    // must clear the moment a real meal lands. logMeal used to hand-set only the two flags, so
    // RT.day0 went stale-true and Progress showed the day-0 empty state for the rest of the
    // session after the first log.
    syncRtFromDay();
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: cap(slot) };
    save();
    track(EVENTS.MEAL_LOGGED, { slot, source: hasPhoto ? 'photo' : 'manual' });
    if (source === 'gallery') {
      track(EVENTS.MEAL_GALLERY_LOGGED, { slot });
      const age = photoAgeMinutes(MEAL.takenAt, Date.now());
      if (age != null && age >= 60) track(EVENTS.MEAL_STALE_PHOTO, { slot });
    }
    this.syncNotifications();
  },
  // Back-compat aliases (camera/search buttons and older routes) → the single logMeal impl.
  logDinner() { this.logMeal('dinner'); },
  day0Meal() { this.logMeal('breakfast'); },
  submitRecovery(ciValues) {
    if (DAY.ciSubmitted) return;
    const from = computeScore(componentsNow());
    RT.recoveryDone = true;
    daySubmitCheckin(RT.userId, ciValues);
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: 'Recovery Check-In' };
    save();
    track(EVENTS.RECOVERY_SUBMITTED);
    this.syncNotifications();
  },
  logWeight(lb) { const v = parseFloat(lb); if (!isFinite(v) || v <= 0) return; RT.weightLogged = true; RT.weightLoggedAt = minutesNow(); dayLogWeight(RT.userId, v); save(); track(EVENTS.WEIGHT_LOGGED); this.syncNotifications(); },
  addWater(oz) { RT.hydrationOz = Math.min(160, RT.hydrationOz + oz); dayAddWaterOz(RT.userId, oz); save(); this.syncNotifications(); },
  readNotifs() {
    RT.notifsRead = true;
    RT.serverAckAt = new Date().toISOString(); // offline badge-ack for server rows
    save();
    void markMyNotificationsRead(); // best-effort server truth; grouping updates on next fetch
  },
  /* Refresh the cached server notification rows (0027 feed: coach nudges, join events,
     digests). Throttled — the bell mount calls this on every visit. Returns whether the
     cache changed so the screen can repaint exactly once when new rows land. */
  async loadNotifications() {
    if (!RT.userId) return false;
    const now = Date.now();
    if (now - NOTIF_FETCH_AT < 15000) return false;
    NOTIF_FETCH_AT = now;
    const rows = await fetchMyNotifications();
    const changed = JSON.stringify(rows) !== JSON.stringify(RT.serverNotifs || []);
    if (changed) { RT.serverNotifs = rows; save(); }
    return changed;
  },
  /* Post the engine's notification plan to native (schedule/cancel). Idempotent: skipped
     when the plan is unchanged since the last post, so completions auto-cancel their
     reminders and untouched state causes zero churn. Also pre-schedules TOMORROW's plan
     (fresh status, tomorrow's weekday) so a day without an app-open still gets reminders —
     the next open replaces everything, bounding staleness to one day. Best-effort. */
  syncNotifications() {
    void this.registerPushToken(); // piggyback: same permission moment, once per session
    try {
      let plan = S.exec.plan;
      // Celebration already posted today: strip it so a post-celebration score change (snack
      // slot, commitment) can't re-post the "You're OnStandard" banner a second time.
      if (plan.some((p) => p.id === 'celebrate') && RT._celebratedOn === String(DAY.date)) {
        plan = plan.filter((p) => p.id !== 'celebrate');
      }
      const [y, mo, d] = String(DAY.date).split('-').map(Number);
      try {
        const tm = new Date(y, mo - 1, d + 1);
        const tmISO = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
        const tomorrow = deriveExec({
          nowMin: -1, dow: tm.getDay(), status: {}, assigned: [],
          pressure: mapPressure(RT.ob && RT.ob.standard && RT.ob.standard.pressure),
          catalog: execCatalog(), dateISO: tmISO, prefs: RT.notifPrefs,
          coachName: S.coach.hasCoach && S.coach.isNamed ? S.coach.name : null,
        }).plan.map((p) => ({ ...p, dayOffset: 1 }));
        plan = [...plan, ...tomorrow];
      } catch { /* tomorrow is a bonus — today's plan still ships */ }
      // Dedupe by DAY too: a bare plan-equality check is date-blind, so two different days
      // with identical state would otherwise skip the sync and the new day gets zero reminders.
      const last = RT._lastPlan;
      if (last && last.date === String(DAY.date) && samePlan(plan, last.plan)) return;
      const N = window.OnStandardNative;
      if (!N || !N.notify) return; // bridge not injected yet — retry on the next trigger
      N.notify.sync(plan.map((p) => ({
        id: p.id,
        atISO: p.immediate ? null : new Date(y, mo - 1, d + (p.dayOffset || 0), Math.floor(p.fireAtMin / 60), p.fireAtMin % 60).toISOString(),
        title: p.title, body: p.body,
        route: p.route || null, // tap lands on the exact screen (e.g. camera/dinner), not Home
      })));
      RT._lastPlan = { date: String(DAY.date), plan }; save(); // recorded only once the post was handed to native
      if (plan.some((p) => p.id === 'celebrate')) RT._celebratedOn = String(DAY.date);
    } catch { /* delivery failed — leave _lastPlan unset so the next trigger retries */ }
  },
  /* Update reminder prefs (quiet hours / deadline override / master switch) and resync.
     The master switch is also written server-side (profiles.notifications_opt_out, 0067) so
     automated pushes (weekly digest, coach nudge) honor the same choice. Best-effort. */
  setNotifPrefs(patch) {
    RT.notifPrefs = { ...normalizePrefs(RT.notifPrefs), ...(patch || {}) };
    save();
    this.syncNotifications();
    if (patch && 'enabled' in patch && window.sb && RT.userId) {
      try {
        void window.sb.from('profiles')
          .update({ notifications_opt_out: !RT.notifPrefs.enabled })
          .eq('id', RT.userId);
      } catch { /* server pref is best-effort; local prefs already applied */ }
    }
  },
  /* Register this device's push token (coach→athlete nudges) via the bridge, once per
     session, after sign-in. Fire-and-forget; a denial or missing seam is a silent no-op. */
  async registerPushToken() {
    if (PUSH_TOKEN_TRIED || !RT.userId) return;
    const N = window.OnStandardNative;
    const sb = window.sb;
    if (!N || !N.push || !sb) return;
    PUSH_TOKEN_TRIED = true;
    try {
      const r = await N.push.token();
      if (r && r.token) {
        PUSH_TOKEN_VALUE = r.token;
        await sb.rpc('register_device_token', { tok: r.token, plat: r.platform || null });
      }
    } catch { /* best-effort — permission denied / no EAS project / offline */ }
  },
  setCommitment(ans) { daySetCommitment(RT.userId, ans); save(); track(EVENTS.COMMITMENT_SET, { answer: ans }); },

  /* ---- Phase 5: real meal capture → AI → real macros ---- */
  captureMeal(base64, dataUrl, slot, live = true, extra) {
    MEAL.photoBase64 = base64; MEAL.photoDataUrl = dataUrl; MEAL.result = null;
    MEAL.live = live !== false;
    MEAL.source = MEAL.live ? 'live' : 'gallery';
    MEAL.capturedAtMin = minutesNow();
    MEAL.takenAt = (extra && extra.takenAt) || null; // EXIF time of a gallery pick (or null)
    MEAL.photoHash = null;
    // Hash the downscaled JPEG in the background (best-effort) so the reuse pre-check and the
    // insert are ready by the time the athlete confirms. checkPhotoReuse() below awaits it.
    void (async () => {
      try {
        const h = await sha256Hex(base64ToBytes(base64));
        if (MEAL.photoBase64 === base64) MEAL.photoHash = h; // still the same capture
      } catch { /* hashing unavailable — server wall still holds */ }
    })();
    // Real slot: the requirement row's slot if it passed one, else the next open slot by time.
    const key = nextOpenSlot(slot) || slot || 'dinner';
    MEAL.key = key;
    MEAL.mealType = cap(key);
    save(); saveMeal();
  },
  /* Duplicate-photo pre-check (0062): has THIS athlete already logged this exact photo?
     Run before the paid analyze call so a reused gallery pick is caught for free. Fail-open —
     offline or pre-migration the server unique index still backstops at insert time. */
  async checkPhotoReuse() {
    if (!MEAL.photoBase64) return { reused: false };
    if (!MEAL.photoHash) {
      try { MEAL.photoHash = await sha256Hex(base64ToBytes(MEAL.photoBase64)); } catch { /* no WebCrypto */ }
    }
    if (!MEAL.photoHash) return { reused: false };
    const prior = await checkPhotoReuse(MEAL.photoHash);
    if (Array.isArray(prior) && prior.length) {
      track(EVENTS.MEAL_DUP_BLOCKED, { stage: 'precheck' });
      return { reused: true, prior: prior[0] };
    }
    return { reused: false };
  },
  /* The current meal's analyze-meal request body (mode 'meal'); phase is added per call.
     Timing rides along (0062) so the AI's analysis can hold the standard on on-time/late —
     measured on the athlete's clock at CAPTURE time, respecting a coach standard's windows. */
  _analysisBody() {
    const capturedAt = MEAL.capturedAtMin != null ? MEAL.capturedAtMin : minutesNow();
    const timing = analysisTiming(capturedAt, slotDeadline(MEAL.key || 'dinner'));
    return {
      mode: 'meal', mealType: MEAL.mealType || 'Dinner', goal: RT.primaryGoal || null,
      photoBase64: MEAL.photoBase64, ...(timing ? { timing } : {}),
    };
  },
  /* Phase 'analyze'. THE CLARIFYING MOMENT: when the model is genuinely unsure about something
     that would move the macros, it returns questions — we surface them ({ok, kind:'questions'})
     so the athlete answers what the camera can't see, rather than discarding them and forcing a
     guess. A confident read returns the finished result directly. */
  async runAnalysis() {
    const sb = window.sb;
    if (!sb || !MEAL.photoBase64) return { ok: false, error: 'No photo to analyze.' };
    MEAL.questions = null;
    try {
      const { data, error } = await sb.functions.invoke('analyze-meal', { body: { ...this._analysisBody(), phase: 'analyze' } });
      if (error) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'error' }); return { ok: false, error: 'Analysis failed. Check your connection and retake.' }; }
      if (data && data.kind === 'questions') {
        const qs = Array.isArray(data.questions) ? data.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3) : [];
        if (qs.length) { MEAL.questions = qs; save(); saveMeal(); return { ok: true, kind: 'questions' }; }
        // Model asked but sent nothing usable — finalize straight through rather than dead-end.
        return this.finalizeAnalysis([]);
      }
      if (data && data.kind === 'result') { MEAL.result = groundResult(data); save(); saveMeal(); return { ok: true, kind: 'result' }; }
      track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'unreadable' });
      return { ok: false, error: 'Could not read that meal. Try another angle.' };
    } catch (e) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'exception' }); return { ok: false, error: 'Analysis failed. Retake and try again.' }; }
  },
  /* Phase 'finalize': fold the athlete's answers (parallel to MEAL.questions) in as truth for
     what the photo can't show, then ground + store the result. `answers = []` is the honest
     Skip path — the model estimates without them, exactly as the old auto-finalize did. */
  async finalizeAnalysis(answers) {
    const sb = window.sb;
    if (!sb || !MEAL.photoBase64) return { ok: false, error: 'No photo to analyze.' };
    const clarifications = buildClarifications(MEAL.questions || [], answers || []);
    try {
      const { data, error } = await sb.functions.invoke('analyze-meal', { body: { ...this._analysisBody(), phase: 'finalize', clarifications } });
      if (error) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'error' }); return { ok: false, error: 'Analysis failed. Check your connection and retake.' }; }
      if (data && data.kind === 'result') { MEAL.result = groundResult(data); MEAL.questions = null; save(); saveMeal(); return { ok: true, kind: 'result' }; }
      track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'unreadable' });
      return { ok: false, error: 'Could not read that meal. Try another angle.' };
    } catch (e) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'exception' }); return { ok: false, error: 'Analysis failed. Retake and try again.' }; }
  },
  clearMeal() {
    MEAL.key = null; MEAL.mealType = null; MEAL.photoBase64 = null; MEAL.photoDataUrl = null;
    MEAL.result = null; MEAL.live = true; MEAL.questions = null;
    MEAL.photoHash = null; MEAL.source = null; MEAL.takenAt = null; MEAL.capturedAtMin = null;
    saveMeal();
  },
  /* Manual entry (food search / label scan): stage the REAL built plate as the meal to log —
     the actual macros the athlete assembled, not a demo constant. No AI "quality" is invented.
     `source` distinguishes 'manual' (search-built plate) from 'label' (typed off the panel —
     exact numbers, never estimated) so every downstream surface says the honest thing. */
  captureManual(macros, foods, slot, source = 'manual') {
    MEAL.key = nextOpenSlot(slot) || slot || 'dinner';
    MEAL.mealType = cap(MEAL.key);
    MEAL.photoBase64 = null; MEAL.photoDataUrl = null;
    MEAL.live = true; // manual entries have no photo provenance — never inherit a prior gallery pick's non-live flag
    MEAL.source = source === 'label' ? 'label' : 'manual';
    MEAL.photoHash = null; MEAL.takenAt = null;
    MEAL.capturedAtMin = minutesNow();
    MEAL.result = {
      quality: null,
      protein: Math.round(macros.protein || 0), carbs: Math.round(macros.carbs || 0),
      fat: Math.round(macros.fat || 0), kcal: Math.round(macros.kcal || 0),
      detected: Array.isArray(foods) ? foods.slice(0, 8) : [], note: '',
    };
    saveMeal();
  },

  startDay0() { RT.lastMove = null; dayResetLocal(); applyGoalToDay(); syncRtFromDay(); pushDay(RT.userId, true); save(); this.syncNotifications(); },
  // Coach→athlete assignments: real rows (0055) sync completion to the server; local-only
  // items (injury-mode rehab) stay local. Optimistic — server truth reasserts on next hydrate.
  completeAssigned(id) {
    const a = RT.assigned.find(x => x.id === id);
    if (a && !a.done) {
      a.done = true; a.seen = true; save(); this.syncNotifications();
      if (a.real) completeAssignmentRemote(a.id); // best-effort; _loadAssignmentsIntoRt self-heals
    }
  },
  seeAssigned() { RT.assigned.forEach(a => { a.seen = true; }); save(); },
  primeCamera() { RT.camPrimed = true; save(); },
  /* WS6: persist a Home collapse-section's open state so re-renders don't reset it. */
  setHomeSection(id, open) {
    if (!id) return;
    RT.homeOpenSections = { ...(RT.homeOpenSections || {}), [id]: !!open };
    save();
  },
  saveProfile(p) { RT.profile = { ...(RT.profile || {}), ...p }; save(); },
  /* Onboarding scratch: the athlete's real selections captured step-by-step (DOM is wiped
     between routes, so each interaction persists here rather than being read at the end). */
  captureOb(patch) { RT.ob = { ...(RT.ob || {}), ...patch }; save(); },
  clearJoin() { if (RT.ob) { delete RT.ob.join; save(); } },
  saveAllergies(list) { RT.allergies = list.slice(0, 8); save(); },
  setAuthRole(role) { RT.authRole = role; save(); },
  nudgePartner() { RT.partnerNudged = true; save(); },
  toggleInjury() {
    RT.injured = !RT.injured;
    const rehabIdx = RT.assigned.findIndex(a => a.id === 'rehab');
    if (RT.injured && rehabIdx === -1) {
      RT.assigned.push({ id: 'rehab', title: 'Rehab · band work 2×15', icon: 'bolt',
        note: 'Rehab replaces intensity while you heal. Completion counts like any requirement.',
        from: 'Injury Mode', dueLabel: 'Before practice', done: false, seen: false });
      RT.notifsRead = false;
    } else if (!RT.injured && rehabIdx !== -1) {
      RT.assigned.splice(rehabIdx, 1);
    }
    save();
  },

  /* ---------------- Real auth (Supabase, in the WebView) ---------------- */
  async signUp(email, password, name, role) {
    const sb = window.sb;
    if (!sb) return { ok: false, error: 'Auth is not ready yet. Try again in a moment.' };
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name, role } } });
    if (error) return { ok: false, error: friendlyAuth(error.message) };
    // Shared-device safety: creating a NEW account on top of a stale previous identity wipes
    // the old user's local state; the fresh onboarding scratch (this person's own, keyed by
    // the email they just typed) survives via keepPendingOb.
    if (RT.userId && data.user && RT.userId !== data.user.id) this._wipeUserScopedState({ keepPendingOb: true });
    RT.userId = data.user ? data.user.id : null;
    RT.email = email;
    RT.authRole = role;
    save();
    track(EVENTS.ONBOARDING_COMPLETED, { role });
    return { ok: true, session: !!data.session };
  },
  async signIn(email, password) {
    const sb = window.sb;
    if (!sb) return { ok: false, error: 'Auth is not ready yet. Try again in a moment.' };
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: friendlyAuth(error.message) };
    // Shared-device safety: a different real user signing in must never inherit ANY of the
    // previous user's local state — day, profile identity, practice identity, assignments.
    if (RT.userId && RT.userId !== data.user.id) this._wipeUserScopedState({ keepPendingOb: true });
    RT.userId = data.user.id;
    RT.email = email;
    let role = 'athlete';
    try {
      const { data: prof } = await sb.from('profiles').select('primary_role').eq('id', data.user.id).maybeSingle();
      if (prof && prof.primary_role) role = prof.primary_role;
    } catch { /* fall back to athlete */ }
    RT.authRole = role;
    save();
    const hadServerProfile = await this._loadProfileIntoRt(RT.userId);
    // Back-fill: if onboarding was captured locally but never fully reached the server (a signup
    // that had no session at the time, or a partial persistOnboarding failure — e.g. a
    // pre-migration-0048 DB rejecting phases 2–4 after phase 1 already created the row), persist
    // the remaining phases now that we hold a real session. Per-phase _synced flags make this
    // retryable on every sign-in without redoing work that already succeeded.
    // Backfill only when the scratch belongs to THIS user: scratch with a captured email is
    // trusted only for that email (shared-device safety); legacy scratch without one is
    // trusted only for the original no-server-row case.
    const obEmail = ((RT.ob && RT.ob.email) || '').toLowerCase();
    const obMine = obEmail ? obEmail === (email || '').trim().toLowerCase() : !hadServerProfile;
    // A scratch that provably belongs to a DIFFERENT email must not linger into this user's
    // authenticated session (coachProfile and the backfill both read RT.ob). Legacy scratch
    // without an email keeps the historical behavior above.
    if (RT.ob && obEmail && !obMine) { RT.ob = null; RT.allergies = []; save(); }
    if (role === 'athlete' && RT.ob && obMine) {
      if (hadServerProfile && !RT.ob._synced) {
        // Grandfather: onboarding predates the phase flags — nothing to backfill, and
        // re-running could clobber later profile edits with stale scratch.
        this.captureOb({ _synced: { legacy: true, extra: true, stamps: true, join: true } });
      } else if (!hadServerProfile || !RT.ob._synced || Object.values(RT.ob._synced).some((v) => !v)) {
        try { await this.persistOnboarding(); } catch { /* best-effort */ }
      }
    }
    if (role === 'coach' && RT.ob && RT.ob.coach && obMine && !RT.ob.teamCode) {
      try { await this.persistCoachOnboarding(); } catch { /* best-effort */ }
    }
    if (role === 'trainer' && RT.ob && RT.ob.trainer && obMine && !RT.ob.practiceCode) {
      try { await this.persistTrainerOnboarding(); } catch { /* best-effort */ }
    }
    if (role === 'trainer') await this._loadPracticeIntoRt(RT.userId);
    if (role === 'coach') { await this._loadTeamIntoRt(RT.userId); await this._loadCoachHandleIntoRt(); }
    if (role === 'athlete') { await this._loadCoachIntoRt(RT.userId); await this._loadTrainerIntoRt(RT.userId); await this._loadConsentIntoRt(RT.userId); await this._loadAssignmentsIntoRt(); }
    await loadDay(RT.userId);
    syncRtFromDay();
    return { ok: true, role };
  },
  /* Read the athlete's REAL identity from the server into RT.profile so the UI shows who they
     actually are — never the Jihad Woods placeholder. Returns true iff a server athlete_profiles
     row exists. Best-effort; keeps whatever we already have. */
  async _loadProfileIntoRt(userId) {
    const sb = window.sb;
    if (!sb || !userId) return false;
    // Whether we already had real coach-set targets cached from a prior successful hydrate —
    // an offline athlete who already has these must never be told their coach set none.
    const hadTargets = !!(RT.profile && RT.profile.targets);
    RT.profileLoading = true; save();
    try {
      const { data: prof } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle();
      // SETTLED sentinel: supabase-js resolves network/RLS failures into `{error}` without
      // throwing — destructure it so a real fetch failure is never misread as "no targets".
      const { data: ap, error: apErr } = await sb.from('athlete_profiles').select('sport,position,level,base_weight,base_goal,season_goal,targets,dob').eq('athlete_id', userId).maybeSingle();
      const patch = {};
      if (prof && prof.full_name) patch.name = prof.full_name;
      if (ap) {
        if (ap.sport) patch.sport = ap.sport; if (ap.position) patch.position = ap.position; if (ap.level) patch.level = ap.level;
        if (ap.base_weight != null) patch.baseWeight = ap.base_weight;
        if (ap.base_goal) patch.baseGoal = ap.base_goal;
        if (ap.season_goal && typeof ap.season_goal === 'object') patch.seasonGoal = ap.season_goal;
        if (ap.targets && typeof ap.targets === 'object') patch.targets = ap.targets;
        if (ap.dob) patch.dob = ap.dob; // drives the client-side minor gate (mirrors 0050's is_provable_minor)
      }
      // The patch above only ever touches RT.profile.targets when `ap` actually came back, so a
      // previously-cached target (hadTargets) survives an errored fetch untouched — the athlete
      // keeps seeing their real numbers while `offline` still flags the connection is down.
      RT.profileOffline = !!apErr;
      if (Object.keys(patch).length) { RT.profile = { ...(RT.profile || {}), ...patch }; save(); }
      // Grade the day by the athlete's real goal (calorie-target for a lose/maintain client, a
      // surplus floor for a gainer, the shipped formula for a performance athlete) now that
      // baseGoal / baseWeight / coach-set targets are hydrated.
      applyGoalToDay();
      RT.profileLoading = false; save();
      return !!ap;
    } catch {
      // threw instead of resolving — same honest treatment as a resolved {error}; any cached
      // target (hadTargets) is untouched because nothing in this catch writes RT.profile.
      RT.profileOffline = true;
      RT.profileLoading = false; save();
      return false;
    }
  },
  /* Read the trainer's REAL practice identity (business name + client join code) into RT —
     mirrors _loadProfileIntoRt for athletes, and mirrors practiceLoadDecision in
     src/core/practiceIdentity.ts (the tested oracle) inline, the same way roles.js mirrors
     inviteLink/inviteShareText rather than importing compiled TS into the WebView.
     Distinguishes FOUR honest outcomes so Practice HQ never shows a broken/fabricated state,
     and a real outage is never misreported as still-minting:
       - a real practice was found -> RT.practice set, offline cleared (live)
       - nothing usable came back but we already had a cached identity -> keep the cache, flag
         offline (reconnecting; navigator.onLine is coarse in WKWebView, so this also catches a
         same-tick RLS/network hiccup rather than wiping a real business identity)
       - the fetch itself failed (network/RLS error) and there is no cache -> flag offline with
         no identity to show — never "minting" on a real error (minting means we CONFIRMED no
         row exists yet, which a failed fetch never does)
       - the fetch succeeded and confirmed no practice row exists, and there is no cache ->
         honestly still minting */
  async _loadPracticeIntoRt(userId) {
    if (!userId) return;
    const hadCache = !!(RT.practice && RT.practice.code);
    RT.practiceLoading = true; save();
    const identity = await fetchMyPracticeIdentity();
    const fetchFailed = !!(identity && identity.error);
    if (identity && identity.code) {
      RT.practice = { id: identity.id, name: identity.name, code: identity.code };
      RT.practiceOffline = false;
    } else if (hadCache) {
      RT.practiceOffline = true; // keep RT.practice as-is (last-known real identity)
    } else if (fetchFailed) {
      RT.practice = null;
      RT.practiceOffline = true; // honest offline — never "minting" on a real fetch error
    } else {
      RT.practice = null;
      RT.practiceOffline = false;
    }
    RT.practiceLoading = false;
    save();
  },
  /* Shared-device safety: wipe EVERY user-scoped bit of local state (the in-memory DAY plus
     the persisted runtime) so the next account on this device can never inherit the previous
     user's meals, score, identity, assignments, or onboarding scratch. Also deletes dynamic
     keys that aren't in DEFAULT_RT (e.g. _lastPlan/_celebratedOn) — Object.assign alone
     leaves them behind. `keepPendingOb` preserves a not-yet-synced onboarding scratch that
     carries its owner's email (the email-confirm flow routes through Welcome, which signs
     out, before the first real sign-in) — signIn's obMine guard ensures only that same email
     can ever consume or render it. */
  _wipeUserScopedState(opts) {
    const keep = opts && opts.keepPendingOb && RT.ob && RT.ob.email
      ? { ob: RT.ob, allergies: RT.allergies } : null;
    const camPrimed = RT.camPrimed; // device-level (camera permission priming), not user data
    // Cancel every scheduled device reminder FIRST — the previous account's "dinner closes
    // soon" must never fire for a signed-out user or the next account on this phone.
    try {
      const N = window.OnStandardNative;
      if (N && N.notify) N.notify.sync([]);
    } catch { /* never block a wipe */ }
    PUSH_TOKEN_TRIED = false; PUSH_TOKEN_VALUE = null; // next sign-in re-registers its own token
    NOTIF_FETCH_AT = 0; // next account's bell fetches its own feed immediately
    try { dayResetLocal(); } catch { /* never block a wipe */ }
    // A staged in-flight capture (photo + analysis) is user data now that it persists to
    // sessionStorage — clear it too so the next account on this device never inherits it.
    try { this.clearMeal(); } catch { /* never block a wipe */ }
    for (const k of Object.keys(RT)) { if (!(k in DEFAULT_RT)) delete RT[k]; }
    Object.assign(RT, JSON.parse(JSON.stringify(DEFAULT_RT)), { camPrimed });
    if (keep) { RT.ob = keep.ob; RT.allergies = keep.allergies; }
    save();
  },
  /* Read the coach's REAL team identity (team name + join code) into RT — the exact honest
     four-state model as _loadPracticeIntoRt (loading | offline | minting | live), so the
     coach profile never shows a fabricated persona or a dead "No code yet" on an outage. */
  async _loadTeamIntoRt(userId) {
    if (!userId) return;
    const hadCache = !!(RT.team && RT.team.code);
    RT.teamLoading = true; save();
    const identity = await fetchMyTeamIdentity();
    const fetchFailed = !!(identity && identity.error);
    if (identity && identity.code) {
      RT.team = { id: identity.id, name: identity.name, code: identity.code };
      RT.teamOffline = false;
    } else if (hadCache) {
      RT.teamOffline = true; // keep RT.team as-is (last-known real identity)
    } else if (fetchFailed) {
      RT.team = null;
      RT.teamOffline = true; // honest offline — never "minting" on a real fetch error
    } else {
      RT.team = null;
      RT.teamOffline = false;
    }
    RT.teamLoading = false;
    save();
  },
  /* Athlete guardian-consent state (the client half of 0050): hydrate the newest request's
     status, then arm/disarm the day-sync gate. A PROVABLE minor (dob says <18 — the same rule
     as the server's is_provable_minor) without verified consent must not push real data: the
     server would reject it anyway (0050 write-block), so the client keeps the day on-device
     and TELLS the athlete why instead of failing silently. Fetch failures keep last-known. */
  async _loadConsentIntoRt(userId) {
    if (!userId) return;
    const res = await fetchMyConsent(userId);
    if (res && !res.error) { RT.consent = res; save(); }
    this._armSyncGate();
  },
  /* Is the signed-in athlete a provable minor? Mirrors 0050: dob (or base age) shows < 18;
     unknown age = adult (the live-beta ruling documented in the migration). */
  _isProvableMinor() {
    const dob = RT.profile && RT.profile.dob;
    if (!dob) return false;
    const d = new Date(String(dob) + 'T12:00:00');
    if (isNaN(d)) return false;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age < 18;
  },
  _armSyncGate() {
    const blocked = this._isProvableMinor() && !(RT.consent && RT.consent.status === 'verified');
    setSyncBlocked(blocked);
  },
  /* Ask a parent/guardian for consent (0008 RPC), then re-hydrate so the UI shows pending. */
  async requestGuardianConsent(email) {
    const addr = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, error: 'Enter your parent or guardian’s email.' };
    const r = await rpcRequestConsent(addr);
    if (!r.ok) return r;
    RT.consent = { status: 'pending', guardianEmail: addr };
    save();
    this._armSyncGate();
    return { ok: true };
  },
  /* Read the athlete's REAL linked coach (their team + the head coach's display name) into
     RT.myCoach. Confirmed "no team link" clears it (an athlete who left a team must not keep
     a stale coach); a fetch failure keeps the last-known link rather than wiping it. */
  async _loadCoachIntoRt(userId) {
    if (!userId) return;
    const res = await fetchMyCoach();
    if (res && res.error) return; // network/RLS hiccup — keep last-known
    RT.myCoach = res || null;
    save();
  },
  /* A trainer's CLIENT: read their linked practice + the trainer's real name into RT.myTrainer —
     the practice mirror of _loadCoachIntoRt. A confirmed "no practice link" clears it (a client
     who left keeps no stale trainer); a fetch failure keeps the last-known link rather than wiping
     it. Fails open on a pre-0063 DB (fetchMyTrainer degrades to the practice name only). */
  async _loadTrainerIntoRt(userId) {
    if (!userId) return;
    const res = await fetchMyTrainer();
    if (res && res.error) return; // network/RLS hiccup — keep last-known
    RT.myTrainer = res || null;
    save();
  },
  /* Preferred coach name (0056): server value → RT.profile.coachName; a handle chosen in
     onboarding scratch (RT.ob.coach.coachName) is pushed on first authenticated hydrate,
     then the server copy is canonical. Best-effort: offline keeps last-known. */
  async _loadCoachHandleIntoRt() {
    if (!RT.userId) return;
    const pending = (RT.ob && RT.ob.coach && (RT.ob.coach.coachName || '').trim()) || '';
    const server = await fetchMyCoachHandle();
    if (server && server.error) return; // keep last-known
    if (!server && pending) {
      const r = await setMyCoachName(pending);
      if (r.ok && r.name) { RT.profile = { ...(RT.profile || {}), coachName: r.name }; save(); return; }
    }
    RT.profile = { ...(RT.profile || {}), coachName: server || null };
    save();
  },
  /* Coach activity feed: per-device seen marks (which meals the coach has opened). */
  markMealSeen(id) {
    if (!id) return;
    if (!Array.isArray(RT.coachSeenMealIds)) RT.coachSeenMealIds = [];
    if (!RT.coachSeenMealIds.includes(id)) {
      RT.coachSeenMealIds.push(id);
      if (RT.coachSeenMealIds.length > 300) RT.coachSeenMealIds = RT.coachSeenMealIds.slice(-300);
      save();
    }
  },
  markNudged(athleteId) {
    RT.coachNudged = { ...(RT.coachNudged || {}), [athleteId]: new Date().toISOString().slice(0, 10) };
    save();
  },
  setTheme(mode) {
    RT.theme = ['dark', 'light', 'system'].includes(mode) ? mode : 'dark';
    save(); applyTheme();
  },
  /** Coach edits their handle from the profile card. */
  async saveCoachHandle(name) {
    const r = await setMyCoachName(name);
    if (r.ok) { RT.profile = { ...(RT.profile || {}), coachName: r.name }; save(); }
    return r;
  },
  /* Real coach assignments (0055) → RT.assigned. Server truth WINS for real rows (an
     optimistic local "done" that never reached the server flips back on next hydrate —
     self-healing, never silently out of sync with what the coach sees). Local `seen`
     flags and non-real items (injury-mode rehab) are preserved. Best-effort: with the
     table not yet applied / offline, the fetch returns [] and we keep what we have. */
  async _loadAssignmentsIntoRt() {
    if (!RT.userId) return;
    const rows = await fetchMyAssignments();
    if (!rows.length && !RT.assigned.some(a => a.real)) return; // nothing server-side yet — keep local
    const coachName = (RT.myCoach && RT.myCoach.name) || 'Coach';
    const prevSeen = new Set(RT.assigned.filter(a => a.seen).map(a => a.id));
    const real = rows.map(r => assignedFromRow(r, coachName)).filter(Boolean)
      .map(a => ({ ...a, seen: prevSeen.has(a.id) || a.done }));
    RT.assigned = [...RT.assigned.filter(a => !a.real), ...real];
    // the team's standing requirement sets govern the athlete's scored day (WS3 slice 2)
    if (RT.myCoach && RT.myCoach.teamId) RT.reqSets = await fetchRequirementSets(RT.myCoach.teamId);
    this._applyStandardFromSets();
    save();
  },
  /* Resolve the governing set (athlete > position room > team) into the DAY engine: slot
     list, deadlines, titles, and the nutrition denominator. No set → the classic day. */
  _applyStandardFromSets() {
    const set = resolveRequirementSet(RT.reqSets || [], RT.userId, (RT.profile || {}).position);
    const mealItems = set && Array.isArray(set.items) ? set.items.filter(i => i && i.kind === 'meal') : [];
    if (!mealItems.length) { RT.stdMeals = null; setDayStandard(null); return; }
    const m = Math.min(6, Math.max(1, mealItems.length));
    const slots = STD_SLOT_MAP[m];
    const deadlines = {}, titles = {};
    slots.forEach((k, i) => {
      const it = mealItems[i] || {};
      if (it.window && it.window.due != null) deadlines[k] = it.window.due;
      if (it.title) titles[k] = it.title;
    });
    RT.stdMeals = { mealsRequired: m, slots, deadlines, titles };
    setDayStandard(RT.stdMeals);
  },
  /* Athlete: redeem a coach team code (or a trainer practice code) from the Connect screen.
     The server re-validates the code and creates the membership (SECURITY DEFINER RPCs from
     0002; direct code joins are immediately active — having the code IS the consent step,
     per the 0038 linking design). On success the real link is re-hydrated so the UI flips
     to the connected state without a restart. */
  async joinByCode(rawCode) {
    const sb = window.sb;
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return { ok: false, error: 'Enter the code first.' };
    if (!sb || !RT.userId) return { ok: false, error: 'You need a connection for this — try again when you’re online.' };
    let kind = null;
    try {
      const { error } = await sb.rpc('join_team', { code, athlete_position: (RT.profile && RT.profile.position) || null });
      if (!error) kind = 'team';
    } catch { /* not a team code — try practice below */ }
    if (!kind) {
      try {
        const { error } = await sb.rpc('join_practice', { code });
        if (!error) kind = 'practice';
      } catch { /* neither */ }
    }
    if (!kind) { track(EVENTS.CODE_JOIN_FAILED); return { ok: false, error: 'That code didn’t match a team or practice. Check it with your coach and try again.' }; }
    if (kind === 'team') await this._loadCoachIntoRt(RT.userId);
    else if (kind === 'practice') await this._loadTrainerIntoRt(RT.userId);
    track(EVENTS.COACH_CONNECTED, { kind });
    return { ok: true, kind };
  },
  async signOut() {
    const sb = window.sb;
    // Unregister THIS device's push token (and only this device) before the session dies —
    // otherwise coach nudges for the signed-out account keep landing on this phone.
    try {
      if (sb && RT.userId && PUSH_TOKEN_VALUE) {
        await sb.from('device_tokens').delete().eq('user_id', RT.userId).eq('token', PUSH_TOKEN_VALUE);
      }
    } catch { /* best-effort */ }
    try { if (sb) await sb.auth.signOut(); } catch { /* ignore */ }
    this._wipeUserScopedState({ keepPendingOb: true });
  },
  /* Send a password-reset email. Neutral by design — we never reveal whether an account exists,
     so the same confirmation shows regardless (anti account-enumeration). The link lands on the
     configured recovery target; completing the reset (setting the new password) is handled there. */
  async requestPasswordReset(email) {
    const sb = window.sb;
    const addr = (email || '').trim();
    if (!addr) return { ok: false, error: 'Enter your email.' };
    if (sb) {
      try { await sb.auth.resetPasswordForEmail(addr, { redirectTo: 'https://onstandard.app/reset' }); }
      catch { /* neutral: never leak whether the address is registered */ }
    }
    return { ok: true };
  },
  /* Apple 5.1.1(v): REAL in-app account deletion. Calls the delete_account RPC (server cascades
     the athlete's rows), signs out, and wipes local state. Best-effort on the RPC so a missing
     backend still signs the user out; returns whether the server delete succeeded. */
  async deleteAccount() {
    const sb = window.sb;
    let serverOk = false;
    try { if (sb && RT.userId) { const { error } = await sb.rpc('delete_account', {}); serverOk = !error; } } catch { /* fall through to local wipe */ }
    try { if (sb) await sb.auth.signOut(); } catch { /* ignore */ }
    this._wipeUserScopedState(); // no keepPendingOb: the account is gone, the scratch dies too
    return serverOk;
  },
  async saveAthleteProfile(fields) {
    const sb = window.sb;
    if (!sb || !RT.userId) return false;
    try { const { error } = await sb.from('athlete_profiles').upsert({ athlete_id: RT.userId, ...fields }); return !error; }
    catch { return false; }
  },
  /* Persist edited identity to the SERVER rows the coach actually reads: full_name → profiles,
     sport/position → athlete_profiles. The old editProfile saved only to local RT, so a coach
     never saw a post-onboarding name/sport change. Returns false if either write fails so the
     UI can say "saved on this phone, not synced." */
  async saveIdentity({ full_name, sport, position }) {
    const sb = window.sb;
    if (!sb || !RT.userId) return false;
    let ok = true;
    try {
      if (full_name) { const { error } = await sb.from('profiles').update({ full_name }).eq('id', RT.userId); if (error) ok = false; }
    } catch { ok = false; }
    const ap = {};
    if (sport) ap.sport = sport;
    if (position) ap.position = position;
    if (Object.keys(ap).length) { if (!(await this.saveAthleteProfile(ap))) ok = false; }
    return ok;
  },
  /* Consent receipt — every role accepts the same terms line at account creation.
     Best-effort (0048 columns); idempotent enough: re-stamping only refreshes the receipt. */
  async _stampConsent(committedAt) {
    const sb = window.sb;
    if (!sb || !RT.userId) return false;
    try {
      const { error } = await sb.from('profiles').update({
        tos_accepted_at: new Date().toISOString(),
        tos_version: TOS_VERSION,
        ...(committedAt ? { committed_at: committedAt } : {}),
      }).eq('id', RT.userId);
      return !error;
    } catch { return false; }
  },
  /* Persist the athlete's captured onboarding (RT.ob) to the server + local RT. Awaitable;
     idempotent (upserts + on-conflict RPCs), so it back-fills a confirmation-delayed signup
     on the next sign-in. Each phase is tracked in RT.ob._synced ({legacy, extra, stamps, join})
     and skipped once it has succeeded, EXCEPT that a synced phase is never re-run — this is what
     makes a later profile edit safe from being clobbered by stale onboarding scratch. Unsynced
     phases retry on every sign-in, so a partial failure (e.g. phases 2–4 rejected by a
     pre-migration-0048 DB while phase 1 already created the row) is never permanently lost. */
  async persistOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const synced = { legacy: false, extra: false, stamps: false, join: false, ...(ob._synced || {}) };
    const name = ob.name || (RT.profile && RT.profile.name) || '';
    // local identity first (always — cheap, idempotent)
    this.saveProfile({ name, sport: ob.sport || '', position: ob.position || '', level: ob.level || '' });
    this.saveAllergies(ob.allergies || RT.allergies || []);
    // phase 1: legacy athlete_profiles fields (skip once written so a later profile edit is never clobbered)
    if (!synced.legacy) {
      const fields = {};
      if (ob.sport) fields.sport = ob.sport;
      if (ob.position) fields.position = ob.position;
      if (ob.level) fields.level = ob.level;
      if (ob.goal) fields.base_goal = ob.goal;
      if (ob.currentWeight) fields.base_weight = Math.round(ob.currentWeight);
      if (ob.currentWeight || ob.targetWeight) fields.season_goal = { start: ob.currentWeight || null, target: ob.targetWeight || null };
      synced.legacy = Object.keys(fields).length ? await this.saveAthleteProfile(fields) : true;
    }
    // phase 2: 0048 columns — separate upsert so a pre-migration DB rejects only this call
    if (!synced.extra) {
      if (!ob.dob && !ob.standard) synced.extra = true;
      else {
        const extra = {};
        if (ob.dob) extra.dob = ob.dob;
        if (ob.standard) extra.standard = ob.standard;
        synced.extra = await this.saveAthleteProfile(extra);
      }
    }
    // phase 3: consent + commitment stamps (profiles_self_write; 0048 columns, best-effort)
    if (!synced.stamps && sb && RT.userId) {
      synced.stamps = await this._stampConsent(ob.committedAt);
    }
    // phase 4: redeem the validated join code (server re-validates; idempotent)
    if (!synced.join) {
      if (!(ob.join && ob.join.code)) synced.join = true;
      else if (sb && RT.userId) {
        try {
          const rpc = ob.join.kind === 'practice' ? 'join_practice' : 'join_team';
          const args = ob.join.kind === 'practice'
            ? { code: ob.join.code }
            : { code: ob.join.code, athlete_position: ob.position || null };
          const { error } = await sb.rpc(rpc, args);
          if (!error) {
            synced.join = true;
            if (ob.join.school) this.saveProfile({ school: ob.join.school });
          }
        } catch { /* retried on next sign-in */ }
      }
    }
    this.captureOb({ _synced: synced });
    return synced.legacy;
  },
  /* Mint the coach's real org + team + join code from RT.ob.coach. Idempotent: a minted
     code short-circuits. Org insert must set created_by = auth.uid() (orgs_write policy). */
  async persistCoachOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const c = ob.coach || {};
    if (!sb || !RT.userId) return false;
    await this._stampConsent(null); // best-effort; never gates team/org creation
    if (ob.teamCode) return true;
    // Staff-code path (0061): joining an existing staff replaces team creation entirely.
    if (c.staffCode) {
      try {
        const { data, error } = await sb.rpc('join_staff', { p_code: c.staffCode });
        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row) {
          this.captureOb({ teamCode: null, joinedStaff: { teamName: row.team_name, role: row.staff_role } });
          return true;
        }
        return false;
      } catch { return false; }
    }
    let orgId = c.orgId || null;
    if (!orgId && c.schoolName) {
      try {
        const { data: found } = await sb.rpc('find_org', { p_name: c.schoolName, p_state: c.state || null });
        if (found && found.length) orgId = found[0].id;
        else {
          const { data: ins } = await sb.from('orgs')
            .insert({ name: c.schoolName, type: 'school', city: c.city || null, state: c.state || null, created_by: RT.userId })
            .select('id').maybeSingle();
          if (ins) orgId = ins.id;
        }
      } catch { /* org optional — a code-only team still works */ }
    }
    try {
      const { data: code, error } = await sb.rpc('create_team', {
        team_name: c.teamName || 'My Team', team_sport: c.sport || null,
        team_org: orgId, team_discoverable: c.discoverable !== false,
      });
      if (error || !code) return false;
      this.captureOb({ teamCode: code });
      return true;
    } catch { return false; }
  },
  /* Mint the trainer's real practice + client code. Idempotent via RT.ob.practiceCode. */
  async persistTrainerOnboarding() {
    const sb = window.sb;
    const ob = RT.ob || {};
    const t = ob.trainer || {};
    if (!sb || !RT.userId) return false;
    await this._stampConsent(null); // best-effort; never gates practice creation
    if (ob.practiceCode) return true;
    try {
      const { data: code, error } = await sb.rpc('create_practice', {
        practice_name: t.practiceName || 'My Practice', practice_handle: null, is_discoverable: true,
      });
      if (error || !code) return false;
      this.captureOb({ practiceCode: code });
      return true;
    } catch { return false; }
  },
  // Called by the router boot gate to sync RT from a restored Keychain session. If the
  // restored session belongs to a different user than the persisted runtime (Keychain and
  // localStorage can diverge — e.g. app data cleared but not the Keychain), wipe first.
  // ROLE-INTEGRITY: when RT.authRole is unknown (fresh localStorage + restored session —
  // reinstall keeping the Keychain, WebView storage eviction), fetch primary_role BEFORE the
  // boot gate routes; otherwise routeForRole(null) dumps a coach/trainer on the ATHLETE home
  // and hydrateDay hydrates athlete-side data for them. The interactive sign-in screen always
  // fetched the role; this restored path was the gap (role walkthrough 2026-07-15).
  async _syncSession(user) {
    if (!user) return;
    if (RT.userId && RT.userId !== user.id) this._wipeUserScopedState({ keepPendingOb: true });
    RT.userId = user.id; RT.email = user.email || RT.email; save();
    if (!RT.authRole) {
      try {
        const { data: prof } = await window.sb.from('profiles').select('primary_role').eq('id', user.id).maybeSingle();
        if (prof && prof.primary_role) { RT.authRole = prof.primary_role; save(); }
      } catch { /* offline — routes as athlete until the next successful boot */ }
    }
  },
  // Load today's real day from Supabase and reflect it into the UI flags.
  async hydrateDay() {
    if (RT.userId) {
      await this._loadProfileIntoRt(RT.userId);
      if (RT.authRole === 'trainer') await this._loadPracticeIntoRt(RT.userId);
      if (RT.authRole === 'coach') { await this._loadTeamIntoRt(RT.userId); await this._loadCoachHandleIntoRt(); }
      if (!RT.authRole || RT.authRole === 'athlete') {
        await this._loadCoachIntoRt(RT.userId);
        await this._loadTrainerIntoRt(RT.userId);
        await this._loadConsentIntoRt(RT.userId);
        await this._loadAssignmentsIntoRt();
      }
    }
    await loadDay(RT.userId); syncRtFromDay(); this.syncNotifications();
  },
  // User-driven recovery from the Plan offline card (data-act="retryProfile") — re-attempts the
  // same hydrate _loadProfileIntoRt already does at boot/signIn; the router awaits this then
  // re-renders (router.js), so a success repaints real targets in place. No auto-retry/polling.
  async retryProfile() {
    if (RT.userId) await this._loadProfileIntoRt(RT.userId);
  },
};
window.__act = act;

// The day push is debounced (~1s of tap-coalescing) — an app backgrounded or killed inside
// that window would lose its last action until the next open. Flush the pending push the
// moment the WebView goes hidden.
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && RT.userId) flushDayPush(RT.userId);
  });
}

/* ---------------- The app state (live getters) ---------------- */
export const S = {
  // Identity comes from the athlete's real profile (onboarding capture or the signed-in
  // profiles/athlete_profiles rows loaded into RT.profile). Never fabricate a real-sounding
  // name/school/sport — an unknown field is blank/neutral, not "Jihad Woods · Central Catholic".
  get athlete() {
    const p = RT.profile || {};
    const name = (p.name || '').trim();
    const first = name ? name.split(' ')[0] : 'Athlete';
    const last = name ? name.split(' ').slice(1).join(' ') : '';
    return {
      first, last, name: name || 'Athlete',
      initials: ((first[0] || 'A') + (last[0] || '')).toUpperCase(),
      sport: p.sport || '', position: p.position || '',
      school: p.school || '', level: p.level || '',
      avatar: p.avatar || null,
    };
  },
  // The athlete's REAL linked coach — from their active team membership + the head coach's
  // display name. NEVER a fabricated persona: with no link, hasCoach is false and every
  // coach-specific surface must gate on it; `name`/`nameMid` degrade to honest generic copy.
  get coach() {
    // The athlete/client's mentor: their team coach (RT.myCoach) first, else — for a trainer's
    // client with no team — their linked trainer (RT.myTrainer). ONE surface, so every coach-gated
    // screen lights up for a client too, with the right NOUN (coach vs trainer) for copy. NEVER a
    // fabricated persona: no link → hasCoach false and copy degrades to honest generic wording.
    const c = RT.myCoach || null;
    const tr = !c && RT.myTrainer ? RT.myTrainer : null;
    const src = c || tr;
    const kind = c ? 'coach' : (tr ? 'trainer' : null);
    const name = ((src && src.name) || '').trim();
    const team = c ? ((c.teamName || '').trim()) : ((tr && tr.practiceName) || '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    return {
      hasCoach: !!src,                  // a real coach (team) OR trainer (practice) link exists
      kind,                             // 'coach' | 'trainer' | null — lets copy pick the noun
      noun: kind === 'trainer' ? 'trainer' : 'coach',
      isNamed: !!name,                  // the mentor's real display name is known
      name: name || (kind === 'trainer' ? 'Your trainer' : 'Your coach'),   // sentence-start
      nameMid: name || (kind === 'trainer' ? 'your trainer' : 'your coach'), // mid-sentence
      initials: parts.length ? parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : (kind === 'trainer' ? 'T' : 'C'),
      role: name ? (kind === 'trainer' ? 'Trainer' : 'Head Coach') : '',
      team,                             // team name (coach) or practice name (trainer)
    };
  },

  // The coach's OWN identity for their profile — server-confirmed name/team/join-code with
  // the same four honest states as trainerIdentity: loading | offline | minting | live.
  get coachIdentity() {
    const realName = ((RT.profile && RT.profile.name) || '').trim();
    const realTeam = ((RT.team && RT.team.name) || '').trim();
    const code = (RT.team && RT.team.code) || '';
    const initials = realName
      ? realName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
      : 'C';
    const state = RT.teamLoading ? 'loading' : RT.teamOffline ? 'offline' : !code ? 'minting' : 'live';
    // The handle the room uses ("Coach JB") — 0056 server value first, then a last-name
    // derivation, never a bare fabricated persona.
    const handle = ((RT.profile && RT.profile.coachName) || '').trim()
      || (realName ? `Coach ${realName.split(/\s+/).pop()}` : 'Coach');
    return {
      name: realName || 'Coach',
      initials,
      handle,
      teamName: realTeam || 'Your team',
      code,
      hasIdentity: !!realName && !!realTeam,
      state,
    };
  },

  // Trainer's real identity for Practice HQ: server-confirmed name/business/code, or an honest
  // neutral fallback — never a fabricated persona (no "Tracy Boone", no dead "No code yet").
  // `state` names the render mode roles.js drives off of: loading | offline | minting | live.
  get trainerIdentity() {
    const realName = (RT.profile && RT.profile.name || '').trim();
    const realPractice = (RT.practice && RT.practice.name || '').trim();
    const code = (RT.practice && RT.practice.code) || '';
    const initials = realName
      ? realName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
      : 'T';
    const state = RT.practiceLoading ? 'loading' : RT.practiceOffline ? 'offline' : !code ? 'minting' : 'live';
    return {
      name: realName || 'Trainer',
      initials,
      practiceName: realPractice || 'Your practice',
      code,
      hasIdentity: !!realName && !!realPractice,
      state,
    };
  },

  // Real on-device clock + greeting (the status bar renders S.now; on iOS this is the system
  // clock — here it's the browser's, never a frozen 7:12).
  get now() {
    const d = new Date(); let h = d.getHours() % 12; if (h === 0) h = 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  get greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  },

  get components() { return { now: componentsNow(), done: componentsDone() }; },
  get score() { return computeScore(componentsNow()); },
  get possible() { return computeScore(componentsDone()); },
  get tier() { return tier(this.score); },
  // Yesterday's real score from history, or null if yesterday has no row (the ring then
  // hides the "vs yesterday" delta rather than comparing against a different day).
  get scoreYesterday() {
    const d = new Date(DAY.date + 'T00:00:00'); d.setDate(d.getDate() - 1);
    const yISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const y = (DAY.scoreHistory || []).find(h => h.date === yISO);
    return y ? y.score : null;
  },
  get streakDays() { return dayStreak(); },
  // Guardian-consent surface (athlete side of 0050). `needed` gates the Home banner + the
  // sync pill copy; a verified minor and every adult read as not-needed.
  get consent() {
    const minor = act._isProvableMinor();
    const status = (RT.consent && RT.consent.status) || 'none';
    return {
      minor,
      status,
      guardianEmail: (RT.consent && RT.consent.guardianEmail) || null,
      needed: minor && status !== 'verified',
    };
  },
  // Honest sync surface for Home: 'blocked' (minor awaiting consent — on purpose),
  // 'error' (last push failed — offline/rejected), or null (fine / nothing attempted).
  get syncIssue() {
    if (isSyncBlocked()) return 'blocked';
    return SYNC.last === 'error' ? 'error' : null;
  },
  // Grace-aware streak state for the label surfaces. The grace "recharges": a graced miss
  // older than the trailing 7 days reads as intact again (one miss per rolling week).
  get streak() {
    const info = streakInfo();
    let graceUsedRecently = false;
    if (info.graceDate) {
      const diff = Math.round((new Date(DAY.date + 'T12:00:00') - new Date(info.graceDate + 'T12:00:00')) / 86400000);
      graceUsedRecently = diff >= 0 && diff < 7;
    }
    const label = graceUsedRecently
      ? `grace used ${new Date(info.graceDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })}`
      : 'grace intact';
    return { ...info, graceUsedRecently, label };
  },
  // The slot a manual/camera log should fill right now (next open by time of day), or null if
  // every meal is already logged. Drives the food-search / label-scan log buttons.
  get currentSlot() { return nextOpenSlot(); },
  // The athlete's REAL coach-set nutrition targets (athlete_profiles.targets), or null if none.
  get planTargets() {
    const t = (RT.profile && RT.profile.targets) || null;
    if (!t) return null;
    const v = (x) => (x != null && x !== '' ? x : null);
    const out = { protein: v(t.protein), calories: v(t.calories), weight: v(t.weight) };
    return (out.protein || out.calories || out.weight) ? out : null;
  },
  // Honest 4-state resolution for Plan surfaces: a coach-set target, a hydrate still in flight,
  // an offline/failed fetch with nothing cached, or a genuinely-unset coach. 'set' takes
  // precedence over everything — an offline athlete who already has cached real targets
  // (S.planTargets survives an errored refetch, see _loadProfileIntoRt) must never see the
  // offline card or the "not set" copy.
  get planTargetsState() {
    if (this.planTargets) return 'set';
    if (RT.profileLoading) return 'loading';
    if (RT.profileOffline) return 'offline';
    return 'unset';
  },
  get planGoalLabel() {
    // Both base_goal spellings exist in real rows: the core writes 'performance'
    // (goalMapping/BASE_GOAL_CHIPS), older proto onboarding wrote 'perform'. Same label.
    const g = RT.profile && RT.profile.baseGoal;
    return g === 'gain' ? 'Gain weight' : g === 'lose' ? 'Lose fat' : g === 'maintain' ? 'Maintain' : (g === 'perform' || g === 'performance') ? 'Perform' : null;
  },
  // Experience voice (mirrors roleVoice.experienceKind: general profile = lose/maintain →
  // the personal-client experience; athlete/gain keep the team frame). Gates recruiter/sport
  // copy that reads wrong aimed at an adult on a personal goal.
  get experience() {
    const g = RT.profile && RT.profile.baseGoal;
    return (g === 'lose' || g === 'maintain') ? 'client' : 'athlete';
  },

  // How many meals today's standard requires (coach standard 1–6, classic 3) — the one number
  // Plan copy should quote instead of a hardcoded "three" (WS7 audit fix).
  get mealsRequiredCount() { return reqMealSlots().length; },

  /* The rulebook rows Plan's Schedule tab renders: the classic CATALOG, or — when a coach
     standard governs (WS3 slice 2) — ITS meal slots (count/titles/windows) plus the non-meal
     catalog rows. Same mapping as the exec engine, so the rulebook can never contradict Home. */
  get scheduleCatalog() {
    if (!RT.stdMeals) return CATALOG;
    return [
      ...reqMealSlots().map((k) => {
        const base = CATALOG.find(c => c.id === k);
        return {
          id: k, title: (RT.stdMeals.titles && RT.stdMeals.titles[k]) || (base ? base.title : cap(k.replace('-', ' '))),
          icon: base ? base.icon : 'utensils', accent: base ? base.accent : 'g', proof: 'photo',
          freq: { type: 'daily' },
          // label dropped on purpose: the standard's deadline is the truth; a cached classic
          // label ("Due by 8:00 PM") would lie about a moved window.
          window: { ...(base ? base.window : {}), due: slotDeadline(k), label: null },
          required: true, impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
          note: base ? base.note : 'Photo proof — part of your room standard.',
        };
      }),
      ...CATALOG.filter(r => !REQ_MEAL_SLOTS.includes(r.id)),
    ];
  },

  get remainingCount() {
    // Standard-aware even on day 0: a coach standard's meal count (1–6) drives the number,
    // never a hardcoded 3/4 (WS7 audit fix).
    if (RT.day0) return reqMealSlots().length + 1 - (RT.day0Breakfast ? 1 : 0);
    const openMeals = reqMealSlots().filter(k => !mealScored(DAY, k)).length;
    return openMeals + (DAY.ciSubmitted ? 0 : 1);
  },

  /* Human-readable breakdown that MAPS onto the real weights and sums to /100. */
  get breakdown() {
    const c = componentsNow();
    // Standard-aware counting (WS7 audit fix): a coach standard's slots + denominator (1–6)
    // drive this line; the classic day keeps its 4-slot count (MEAL_KEYS incl. snack).
    const std = RT.stdMeals;
    const bdSlots = (std && Array.isArray(std.slots) && std.slots.length) ? std.slots : MEAL_KEYS;
    const bdDenom = (std && std.mealsRequired) || 4;
    const logged = bdSlots.filter(k => DAY.meals[k]);
    const nutriNote = logged.length
      ? `${logged.length} of ${bdDenom} meals logged${logged.length < bdDenom ? ' — more to come' : ' · full day'}`
      : 'No meals logged yet — each one builds Nutrition';
    const commit = DAY.dailyCommitment;
    const commitNote = commit === 'yes' ? 'You confirmed you hit your plan today'
      : commit === 'partial' ? 'You logged a partial day — honest counts'
      : commit === 'no' ? 'You logged an off day — the honest tap still counts'
      : 'No commitment logged yet — one honest tap earns it';
    return [
      { key: 'Nutrition', earned: Math.round(WEIGHTS.nutrition * c.nutrition), possible: 50,
        note: nutriNote, accent: 'g', weightPct: 50 },
      { key: 'Recovery', earned: Math.round(WEIGHTS.recovery * c.recovery), possible: 25,
        note: DAY.ciSubmitted ? 'Tonight’s check-in submitted'
          : (DAY.ciLast ? 'Carried from your last check-in; tonight refreshes it' : 'No check-in yet — submit tonight to earn this'), accent: 'p', weightPct: 25 },
      { key: 'Daily commitment', earned: Math.round(WEIGHTS.commitment * c.commitment), possible: 15,
        note: commitNote, accent: 'b', weightPct: 15 },
      { key: 'Weekly check-in', earned: Math.round(WEIGHTS.checkin * c.checkin), possible: 10,
        note: c.checkin ? 'This week’s check-in is in' : 'No weekly check-in yet — opens Sunday', accent: 'g', weightPct: 10 },
    ];
  },
  get weightLine() {
    if (RT.weightLogged) {
      return { label: 'Morning Weight', state: 'late', note: 'Logged late tonight. Counts for your season trend; never for the daily score.' };
    }
    return minutesNow() <= WEIGHT_DUE
      ? { label: 'Morning Weight', state: 'open', note: `Weigh in by ${fmtClock(WEIGHT_DUE)} to keep your season trend current.` }
      : { label: 'Morning Weight', state: 'missed', note: "Missed today. It doesn't affect your score — weight only tracks your season trend." };
  },
  get reachPlan() {
    const plan = [];
    reqMealSlots().forEach(k => { if (!mealScored(DAY, k)) plan.push({ label: `Log ${cap(k)}`, gain: null, accent: 'g' }); });
    if (!DAY.ciSubmitted) { const g = checkinProjection().gain; plan.push({ label: 'Submit recovery check-in', gain: g || null, accent: 'p' }); }
    return plan;
  },

  get requirements() {
    if (RT.day0) {
      return [
        { id: 'breakfast', title: 'Breakfast', icon: 'utensils', accent: RT.day0Breakfast ? 'g' : 'a', status: RT.day0Breakfast ? 'Logged' : 'Open', statusColor: RT.day0Breakfast ? 'g' : 'a',
          sub: RT.day0Breakfast ? 'Logged just now' : 'Photo proof', subColor: RT.day0Breakfast ? 'g' : 'a', meta: RT.day0Breakfast ? 'First log' : 'Start here', done: RT.day0Breakfast, route: RT.day0Breakfast ? 'meal-detail' : 'camera' },
        { id: 'lunch', title: 'Lunch', icon: 'bowl', accent: 'b', status: 'Upcoming', statusColor: 'b', sub: 'Due by 2:00 PM', subColor: 'b', meta: 'Photo proof', done: false, route: 'camera' },
        { id: 'dinner', title: 'Dinner', icon: 'bowl', accent: 'b', status: 'Upcoming', statusColor: 'b', sub: 'Due by 8:00 PM', subColor: 'b', meta: 'Photo proof', done: false, route: 'camera' },
        { id: 'recovery', title: 'Recovery Check-In', icon: 'moon', accent: 'p', status: 'Later', statusColor: 'p', sub: 'Before bed', subColor: 'p', meta: 'Recovery · 25%', done: false, route: 'recovery' },
      ];
    }
    /* ---- ENGINE-DERIVED: today's list from the catalog + REAL runtime (DAY) ---- */
    const lateMeal = (k) => DAY.mealLoggedAt[k] != null && DAY.mealLoggedAt[k] > slotDeadline(k);
    const resolve = (id) => {
      switch (id) {
        case 'breakfast': return { done: mealScored(DAY, 'breakfast'), late: lateMeal('breakfast') };
        case 'lunch':     return { done: mealScored(DAY, 'lunch'), late: lateMeal('lunch') };
        case 'dinner':    return { done: mealScored(DAY, 'dinner'), late: lateMeal('dinner') };
        case 'weight':    return { done: RT.weightLogged, late: RT.weightLogged };
        case 'hydration': return { done: RT.hydrationOz >= 120, progress: `${RT.hydrationOz} of 120 oz` };
        case 'recovery':  return { done: DAY.ciSubmitted };
        default:
          // standard-driven meal slots (snack promoted to required, meal-5/meal-6)
          if (Object.prototype.hasOwnProperty.call(DAY.meals, id)) return { done: mealScored(DAY, id), late: lateMeal(id) };
          return {};
      }
    };
    const decorate = (d) => {
      const isMeal = Object.prototype.hasOwnProperty.call(DAY.meals, d.id);
      let meta, route, sub = d.sub, subColor = d.subColor;
      if (isMeal) {
        const slotMeta = DAY.slotMacros[d.id];
        const q = slotMeta && slotMeta.quality;
        // d.done is mealScored — the only logged-but-not-done state left is a duplicate-flagged
        // photo (0062 integrity wall). Say so honestly instead of the bare "Photo proof" a
        // truly-empty slot shows. Gallery picks score now, so they read as plain done rows.
        const dupFlagged = !d.done && slotMeta && slotMeta.flagged === 'dup';
        meta = d.done ? (q != null ? `Scored ${q}` : 'Logged') : (dupFlagged ? 'Duplicate photo' : 'Photo proof');
        route = d.done ? `meal-detail/${d.id}` : (dupFlagged ? `meal-detail/${d.id}` : `camera/${d.id}`);
        if (d.done) {
          const at = DAY.mealLoggedAt[d.id];
          sub = at != null ? `Logged ${fmtClock(at)}${d.late ? ' · late' : ''}` : 'Logged';
          subColor = d.late ? 'a' : 'g';
        } else if (dupFlagged) {
          sub = "Logged, but this photo was already used — it doesn't count";
          subColor = 'a';
        }
      } else if (d.id === 'weight') {
        meta = d.done ? 'Trend only' : 'Not scored'; route = 'weight';
      } else if (d.id === 'hydration') {
        meta = d.done ? 'Focus hit' : 'Optional'; route = 'log';
      } else if (d.id === 'recovery') {
        meta = d.done ? 'Recovery in' : 'Recovery · 25%'; route = d.done ? 'recovery-confirm' : 'recovery';
      } else { meta = ''; route = 'home'; }
      return { ...d, meta, route, sub, subColor };
    };
    const now = minutesNow();
    // With no governing standard the classic catalog renders byte-identically. A coach
    // standard (0055) swaps the meal rows for ITS slots — count, titles, and windows —
    // while weight/recovery keep their catalog behavior.
    const effCatalog = !RT.stdMeals
      ? CATALOG.filter(r => runsToday(r) && r.id !== 'weekly' && r.id !== 'hydration')
      : [
        ...reqMealSlots().map((k) => {
          const base = CATALOG.find(c => c.id === k);
          const title = (RT.stdMeals.titles && RT.stdMeals.titles[k]) || (base ? base.title : cap(k.replace('-', ' ')));
          return {
            id: k, title, icon: base ? base.icon : 'utensils', accent: base ? base.accent : 'g', proof: 'photo',
            freq: { type: 'daily' }, window: { ...(base ? base.window : {}), due: slotDeadline(k) }, required: true,
            impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
            note: base ? base.note : 'Photo proof — part of your room standard.',
          };
        }),
        ...CATALOG.filter(r => !REQ_MEAL_SLOTS.includes(r.id) && r.id !== 'weekly' && r.id !== 'hydration' && runsToday(r)),
      ];
    const rows = effCatalog.map(r => decorate(derive(r, resolve(r.id), now)));
    // hydration rides as the optional row after the required set
    const hydro = decorate(derive(CATALOG.find(r => r.id === 'hydration'), resolve('hydration'), now));
    const assigned = RT.assigned.map(a => ({ ...deriveAssigned(a), meta: a.done ? 'Coach sees it' : 'From coach', route: `requirement/${a.id}` }));
    const fresh = assigned.filter(a => a.fresh);
    const rest = assigned.filter(a => !a.fresh);
    return [...fresh, ...rows, hydro, ...rest];
  },
  get metCount() {
    if (RT.day0) return RT.day0Breakfast ? 1 : 0;
    const meals = reqMealSlots().filter(k => mealScored(DAY, k)).length;
    return meals + (DAY.ciSubmitted ? 1 : 0) + RT.assigned.filter(a => a.done).length;
  },
  get reqTotal() { return reqMealSlots().length + 1 + RT.assigned.length; }, // required meals + recovery + coach-assigned

  // Real proof trail: one card per actually-logged meal (real time + real meal score if the AI
  // saved one), plus hydration/weight/recovery from real state. No canned 8:14 AM / 95 / 183.8 lb.
  get activity() {
    const a = [];
    for (const k of MEAL_KEYS) {
      if (!DAY.meals[k]) continue;
      const at = DAY.mealLoggedAt[k];
      const meta = DAY.slotMacros[k] || {};
      const late = at != null && at > DEADLINE[k];
      // in-session photo for the just-captured slot; else no fake stock plate
      const img = (MEAL.key === k && MEAL.photoDataUrl) ? MEAL.photoDataUrl : null;
      a.push({
        time: at != null ? `Today · ${fmtClock(at)}${late ? ' · late' : ''}` : 'Today',
        type: cap(k),
        value: meta.quality != null ? String(meta.quality) : 'Logged',
        vClass: meta.quality != null ? (meta.quality >= 80 ? 'g' : 'b') : 'muted',
        img, route: `meal-detail/${k}`,
      });
    }
    if (RT.hydrationOz > 0) a.push({ time: 'Today', type: 'Hydration', value: `${RT.hydrationOz} oz`, vClass: 'b', img: null, route: 'log' });
    if (RT.weightLogged && DAY.currentWeight != null) a.push({ time: 'Today', type: 'Morning Weight', value: `${DAY.currentWeight} lb`, vClass: 'muted', img: null, route: 'weight' });
    a.push(DAY.ciSubmitted
      ? { time: 'Today', type: 'Recovery Check-In', value: 'Done', vClass: 'g', img: null, route: 'recovery-confirm' }
      : { time: 'Tonight', type: 'Recovery Check-In', value: 'Upcoming', vClass: 'muted', img: null, dim: true, route: 'recovery' });
    return a;
  },

  get nextMove() {
    if (RT.day0) return RT.day0Breakfast
      ? { label: 'Log Lunch', gain: null, route: 'camera/lunch', accent: 'g' }
      : { label: 'Log First Meal', gain: null, route: 'camera', accent: 'g' };
    const openReq = reqMealSlots().filter(k => !mealScored(DAY, k));
    const openSlot = openReq.find(k => minutesNow() <= DEADLINE[k]) || openReq[0];
    // Meal gain depends on the plate, unknown until analyzed → no fabricated "+6".
    if (openSlot) return { label: `Log ${cap(openSlot)}`, gain: null, route: `camera/${openSlot}`, accent: 'g' };
    if (!DAY.ciSubmitted) return { label: 'Do Recovery Check-In', gain: checkinProjection().gain || null, route: 'recovery', accent: 'p' };
    return null; // day complete
  },

  get finish() {
    const next = this.nextMove;
    return {
      current: this.score, possible: this.possible,
      met: `${this.metCount}/${this.reqTotal}`,
      nextMove: next ? next.label.replace('Do ', '') : 'Day complete',
      nextGain: next ? next.gain : null,
      risk: DAY.ciSubmitted ? 'None left' : 'Recovery Check-In',
      riskSub: DAY.ciSubmitted ? 'everything is in' : 'keeps your streak alive',
    };
  },

  // Real Trust Pass: reflects an active `trust_passes` row (coach-granted, migration 0033/0039),
  // loaded by day.js. No pass → honestly inactive; never a fabricated "day 3 of 14".
  get trustPass() {
    const tp = DAY.trustPass;
    if (!tp || !tp.granted_date) return { active: false };
    const start = new Date(tp.granted_date + 'T00:00:00');
    const now = new Date(DAY.date + 'T00:00:00');
    const len = tp.length_days || 10;
    const day = Math.min(len, Math.max(1, Math.floor((now - start) / 86400000) + 1));
    return { active: true, day, length: len, note: 'Camera-free today, credited from your real logging history.' };
  },

  /* ---------- EXECUTION ENGINE (one derivation for Home / Hub / FAB / notifications) ---------- */
  get exec() {
    const mstat = (k) => {
      const at = DAY.mealLoggedAt[k];
      return { done: mealScored(DAY, k), late: at != null && at > slotDeadline(k), at: at != null ? fmtClock(at) : null };
    };
    const std = RT.stdMeals;
    const catalog = execCatalog();
    const status = {
      breakfast: mstat('breakfast'), lunch: mstat('lunch'), dinner: mstat('dinner'),
      // weight due comes from the catalog; late only when we actually know the log time
      weight: { done: RT.weightLogged, late: RT.weightLogged && RT.weightLoggedAt != null && RT.weightLoggedAt > WEIGHT_DUE },
      hydration: { oz: RT.hydrationOz },
      recovery: { done: DAY.ciSubmitted },
    };
    if (std) for (const k of reqMealSlots()) status[k] = mstat(k);
    return deriveExec({
      nowMin: minutesNow(),
      dow: new Date().getDay(),
      status,
      // A dated assignment (real due_at TODAY) gets a reminder; dateless ones stay list-only.
      assigned: RT.assigned.map((a) => ({ ...a, dueAtMin: dueAtMinToday(a.dueAtISO) })),
      pressure: mapPressure(RT.ob && RT.ob.standard && RT.ob.standard.pressure),
      score: this.score, possible: this.possible, streak: this.streakDays,
      catalog,
      dateISO: String(DAY.date),
      prefs: RT.notifPrefs,
      coachName: this.coach.hasCoach && this.coach.isNamed ? this.coach.name : null,
    });
  },

  get unreadNotifs() {
    // Derived rows keep the coarse all-read flag; server rows count as unread until the
    // server says read OR the bell was opened after they arrived (offline ack).
    const derived = RT.notifsRead ? 0 : this.notifications.new.filter((n) => !n.server).length;
    const ack = RT.serverAckAt ? Date.parse(RT.serverAckAt) : 0;
    const server = (RT.serverNotifs || []).filter(
      (r) => r && !r.read_at && (!r.created_at || Date.parse(r.created_at) > ack),
    ).length;
    return derived + server;
  },

  // ---------- PLAN ----------
  // Per-athlete plan claims are now real getters (planTargets/planGoalLabel + S.weight). This
  // object holds only GENERIC nutrition guidance (not per-athlete facts) + the honest notes feed.
  plan: {
    plate: ['1 protein', '1 carb', '1 color', '1 fluid'],
    swaps: [
      { k: 'Protein', v: 'chicken · steak · eggs · turkey · Greek yogurt · tuna' },
      { k: 'Carbs', v: 'rice · potatoes · oats · pasta · fruit · tortillas' },
      { k: 'On the go', v: 'Chipotle bowl · grilled sandwich · smoothie · rice bowl' },
    ],
    // Plan-change notes have no backend feed (coach changes are targets via coach_set_goals).
    // Only surface a real published update if one exists; otherwise honestly empty.
    get notes() {
      return RT.planUpdate ? [{ who: 'coach', name: 'Coach', when: RT.planUpdate.when, text: RT.planUpdate.text }] : [];
    },
  },

  // Meal detail is built per-slot from the real persisted plate via mealDetail(slot) — the old
  // fabricated lunch + canned coach thread are gone. (meal.js calls mealDetail directly.)

  // what's being logged right now — REAL analyzed meal when present; a real persisted plate when
  // revisiting a logged slot; otherwise an HONEST empty state (never demo steak-and-potatoes).
  get logging() {
    const slot = MEAL.key || nextOpenSlot() || 'dinner';
    if (MEAL.result) {
      const r = MEAL.result;
      return {
        name: MEAL.mealType || cap(slot),
        due: SLOT_DUE[slot] || 'Log when ready', remaining: 'Captured just now',
        img: MEAL.photoDataUrl || null, score: r.quality,
        foods: r.detected.length ? r.detected : ['Your meal'],
        macros: { protein: r.protein, carbs: r.carbs, fat: r.fat, cals: r.kcal },
        planMatch: { verdict: r.quality >= 75 ? 'Strong meal' : 'Logged', detail: r.note || 'Analyzed from your photo.', level: r.quality >= 75 ? 'g' : 'b' },
        ai: r.note || (MEAL.source === 'label' ? 'Exact numbers off the panel — no estimate needed.'
          : MEAL.source === 'manual' ? 'Entered by you — the plate you actually built.'
          : 'Logged from your photo.'),
        analysis: r.analysis || '',            // the ONE detailed AI read (0062); note is the fallback
        capturedAtMin: MEAL.capturedAtMin,     // for the timing pill on the analysis hero
        empty: false, live: MEAL.live !== false,
      };
    }
    // Already-logged slot being revisited: show its REAL persisted plate, not a demo meal.
    const meta = DAY.slotMacros[slot];
    if (meta && DAY.meals[slot]) {
      return {
        name: cap(slot), due: SLOT_DUE[slot] || '', remaining: 'Logged',
        img: (MEAL.key === slot && MEAL.photoDataUrl) || null,
        score: meta.quality != null ? meta.quality : null,
        foods: Array.isArray(meta.foods) && meta.foods.length ? meta.foods : ['Your logged meal'],
        macros: { protein: meta.protein || 0, carbs: meta.carbs || 0, fat: meta.fat || 0, cals: meta.kcal || 0 },
        planMatch: { verdict: 'Logged', detail: meta.note || 'Analyzed from your photo.', level: 'b' },
        ai: meta.note || 'Logged from your photo.',
        analysis: meta.analysis || '', capturedAtMin: null,
        empty: false,
      };
    }
    // Nothing captured or analyzed yet — honest empty state, never steak-and-potatoes constants.
    return {
      name: cap(slot), due: SLOT_DUE[slot] || 'Log when ready', remaining: 'Take a photo to analyze',
      img: null, score: null, foods: [],
      macros: { protein: 0, carbs: 0, fat: 0, cals: 0 },
      planMatch: { verdict: 'Not analyzed yet', detail: 'Capture your meal and the AI reads it — real macros from your photo, no guesses.', level: 'b' },
      ai: 'Take a photo of your meal and I’ll analyze it for real.',
      analysis: '', capturedAtMin: null,
      empty: true,
    };
  },

  // ---------- MEAL HISTORY (past days, from real day rows; today derives live) ----------
  // Real per-day score + tier from scoreHistory. Per-meal thumbnails aren't stored historically,
  // so no fabricated plates — just the honest day scores, most recent first.
  get history() {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return (DAY.scoreHistory || []).slice().reverse().map(h => {
      const d = new Date(h.date + 'T00:00:00');
      return { day: DOW[d.getDay()], date: `${MON[d.getMonth()]} ${d.getDate()}`, score: h.score || 0, tier: tier(h.score || 0).name, meals: [] };
    });
  },
  // Last 6 days incl. today, for the streak week strip — real scores, honest gaps.
  get streakWeek() {
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const past = (DAY.scoreHistory || []).slice(-5).map(h => {
      const d = new Date(h.date + 'T00:00:00');
      return { d: DOW[d.getDay()], s: h.score || 0, on: (h.score || 0) >= 80 };
    });
    const today = new Date(DAY.date + 'T00:00:00');
    past.push({ d: DOW[today.getDay()], s: this.score, on: this.score >= 80, today: true });
    return past;
  },

  // ---------- WEIGHT (real: today's log + historical current_weight rows) ----------
  // Nothing here is invented. current = today's log or the latest real historical value.
  // target/start come from the athlete's season_goal (athlete_profiles). deltaMonth/pace
  // stay null until there are ≥2 real data points / a real target — the UI hides them.
  get weight() {
    const p = RT.profile || {};
    const sg = p.seasonGoal || {};
    const rows = (DAY.scoreHistory || []).filter(h => h.weight != null).map(h => Number(h.weight));
    const history = DAY.currentWeight != null ? [...rows, Number(DAY.currentWeight)] : rows;
    // Number.isFinite guards: season_goal is a free-shape jsonb — a non-numeric target must
    // degrade to the honest '—', never render as "NaN lb".
    const num = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
    const current = history.length ? history[history.length - 1] : num(p.baseWeight);
    const target = num(sg.target);
    const start = num(sg.start) != null ? num(sg.start) : num(p.baseWeight);
    let deltaMonth = null;
    if (history.length >= 2) {
      const d = history[history.length - 1] - history[0];
      deltaMonth = `${d >= 0 ? '+' : ''}${d.toFixed(1)} lb`;
    }
    let pace = null;
    if (target != null && current != null && history.length >= 2) {
      pace = Math.abs(target - current) <= Math.abs(target - history[0]) ? 'On pace' : 'Off pace';
    }
    return {
      current: current != null ? String(current) : null,
      unit: 'lb', target, start, history,
      deltaMonth, pace,
    };
  },

  // ---------- RECOVERY (engine-driven: these questions ARE the scoring inputs) ----------
  get recovery() {
    // Question set = the engine's check-in keys, filtered by the enabled config — identical to
    // the RN Recovery screen. Anchors keep REAL polarity (soreness: 5 chips = very sore; the
    // engine inverts it internally), so the stored value is always honest to what was answered.
    const ANCHORS = [
      { key: 'energy',     k: 'Energy',        lo: 'Low',     hi: 'High' },
      { key: 'recovery',   k: 'Recovery',      lo: 'Beat up', hi: 'Fully recovered' },
      { key: 'sleep',      k: 'Sleep quality', lo: 'Poor',    hi: 'Great' },
      { key: 'confidence', k: 'Confidence',    lo: 'Shaky',   hi: 'Dialed in' },
      { key: 'soreness',   k: 'Soreness',      lo: 'None',    hi: 'Very sore' },
      { key: 'motivation', k: 'Motivation',    lo: 'Flat',    hi: 'Fired up' },
    ];
    // 5 chips map to the engine's 0–10 scale as 2/4/6/8/10; initial selection reflects the
    // day's current values so reopening the form shows what will actually be submitted.
    const fields = ANCHORS.filter(a => DAY.ciConfig && DAY.ciConfig[a.key])
      .map(a => ({ ...a, val: Math.min(5, Math.max(1, Math.round((DAY.ci[a.key] ?? 6) / 2))) }));
    return { fields };
  },

  // ---------- WEEKLY CHECK-IN (honest: the weekly ritual isn't separately wired in v1) ----------
  // No fabricated "Submitted Sunday · readiness 84". Readiness reflects the last REAL recovery
  // check-in if one exists; the form is a blank preview until the weekly flow is wired.
  get weekly() {
    const last = DAY.ciLast && DAY.ciLast.date ? DAY.ciLast : null;
    return {
      status: 'Opens Sunday · not submitted yet',
      submitted: false,
      readiness: last ? Math.round(last.recovery) : null,
      fields: [
        { k: 'Energy this week' }, { k: 'Recovery' }, { k: 'Sleep' },
        { k: 'Confidence' }, { k: 'Soreness' }, { k: 'Motivation' },
      ],
    };
  },

  // ---------- PROGRESS (real: computed from DAY.scoreHistory + today's live score) ----------
  // Only the metrics we can actually compute from real day rows. Per-requirement consistency,
  // "biggest pattern", coach/AI summaries etc. have no real source yet → the screen shows an
  // honest "more as you log" note instead of inventing them.
  get progress() {
    const hist = (DAY.scoreHistory || []).map(h => ({ date: h.date, score: h.score || 0 }));
    const series = [...hist, { date: DAY.date, score: this.score }];
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const last7 = series.slice(-7);
    const weekScores = last7.map(d => d.score);
    const weekAvg = avg(weekScores);
    const prev7 = series.slice(-14, -7).map(d => d.score);
    const prevAvg = avg(prev7);
    const weekDelta = (weekAvg != null && prevAvg != null) ? `${weekAvg - prevAvg >= 0 ? '+' : ''}${weekAvg - prevAvg}` : null;
    const last30 = series.slice(-30);
    const monthConsistency = last30.length >= 5 ? Math.round(last30.filter(d => d.score >= 80).length / last30.length * 100) : null;
    let best = 0, run = 0;
    for (const d of series) { if (d.score >= 80) { run++; best = Math.max(best, run); } else run = 0; }
    return {
      hasHistory: hist.length > 0,
      weekScores, weekAvg, weekDelta,
      onDays: `${weekScores.filter(s => s >= 80).length} of ${weekScores.length}`,
      weekDayLabels: last7.map(d => 'SMTWTFS'[new Date(d.date + 'T00:00:00').getDay()]),
      monthConsistency, bestStreak: best,
    };
  },

  // Squad / leaderboard: no backend (comp_mode is unused; the real roster lives coach-side).
  // The athlete Squad screen is an honest "coming soon" — no fabricated teammates here.

  // ---------- NOTIFICATIONS (live) ----------
  get notifications() {
    const e = this.exec;
    const fresh = [];
    for (const o of e.overdue) fresh.push({
      level: 'high', title: `${o.title} is overdue`, body: `${o.sub}.`, when: 'now', icon: o.icon, route: o.route,
    });
    if (e.now && e.now.state !== 'overdue') fresh.push({
      level: 'medium', title: `Next up: ${e.now.title}`,
      body: e.now.countdown ? `${e.now.countdown} left · ${e.now.dueLabel}.` : `${e.now.dueLabel}.`,
      when: 'now', icon: e.now.icon, route: e.now.route,
    });
    // Skip assigned items the engine already surfaced (as NOW or overdue) — no double-listing.
    const surfaced = new Set([...(e.now ? [e.now.id] : []), ...e.overdue.map((o) => o.id)]);
    RT.assigned.filter((a) => !a.done && !surfaced.has(a.id)).forEach((a) => fresh.push({
      level: 'medium', title: `${a.from || 'Coach'} added: ${a.title}`,
      body: `${a.note} Due: ${(a.dueLabel || '').toLowerCase()}.`, when: 'now', icon: 'clipboard', route: `requirement/${a.id}`,
    }));
    if (RT.injured) fresh.push({ level: 'medium', title: 'Your Standard adapted', body: 'Rehab is on your list; nutrition tilts anti-inflammatory while you heal.', when: 'now', icon: 'bolt', route: 'injury' });
    if (RT.hydrationOz >= 120) fresh.push({ level: 'positive', title: 'Hydration standard hit', body: `${RT.hydrationOz} oz in. This week's focus, handled. Coach sees it.`, when: 'now', icon: 'droplet', route: 'log' });
    if (e.celebration) fresh.push({
      level: 'positive', title: "You're OnStandard", body: `Every requirement is in at ${e.score}. Day ${this.streakDays} of your streak locks at midnight.`,
      when: 'now', icon: 'check', route: 'home',
    });
    // Tiered streak-at-risk row: only while a 2+ day streak hasn't been counted today and the
    // day isn't already a celebration (which has its own positive row above — no double-count).
    // Amber/flame when this week's grace is already used (stronger loss-aversion signal); blue/
    // shield when grace is still intact (mild reminder). Leads the feed either way.
    const st = this.streak;
    if (st.days >= 2 && !st.todayCounted && !e.celebration) {
      // Same actionable route the home ribbon uses (log the next open item); falls back to the
      // score breakdown when everything left is time-locked — never a no-op 'home' tap.
      const stNext = e.now || e.overdue[0] || null;
      const stRoute = stNext ? stNext.route : 'score-breakdown';
      fresh.unshift(st.graceUsedRecently ? {
        level: 'high', icon: 'flame', when: 'now', route: stRoute,
        title: `Your ${st.days}-day streak ends tonight`,
        body: `This week’s grace day is already used — hit 80 before midnight or the streak resets.`,
      } : {
        level: 'medium', icon: 'shield', when: 'now', route: stRoute,
        title: `Keep your ${st.days}-day run alive`,
        body: `Finish today to extend your ${st.days}-day run. 80 before midnight locks it in.`,
      });
    }
    // Server rows (0027: coach nudges, join events, digests) join the feed here — the coach
    // nudge that pushed to the phone finally shows in the bell too. Unread server rows land
    // under New (after the live derived rows); read ones fill Earlier.
    const srv = splitServerRows(RT.serverNotifs, Date.now());
    return { new: [...fresh, ...srv.unread], earlier: srv.read };
  },
};

// convenience
export function pct(v, of) { return Math.round((v / of) * 100); }
window.S = S; // debug
