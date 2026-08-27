/* OnStandard — Redesign Prototype · LIVE state engine.
   ONE source of truth. Screens read getters; actions mutate runtime; everything
   recomputes through the same honest formula so numbers can never drift.

   Score model = the shipped weighted engine (core/scoring.ts), NOT additive +pts:
     score = round( 0.50*Nutrition + 0.25*Recovery + 0.15*Commitment + 0.10*WeeklyCheckin )
   Weight is deliberately OUT of the daily score (season-goal arc, weightProgress.ts).
*/

import { CATALOG, SNACK_BONUS, runsToday, derive, deriveAssigned, assignedFromRow, resolveRequirementSet, stdFromItems, stdFromSolo, dayTypeFor, filterItemsByDayType, catalogFromItems, planStyleFromItems, setImpactWeightsProvider } from './requirements.js';
import { resolvePlanStyle, SIGNAL_KEYS, CHECKIN_SIGNAL_KEYS, styleLabel, styleSourceLabel } from './plan-style.js';
import { TOS_VERSION } from './ob-helpers.js';
import { tierFor, ON_STANDARD, qualityAccent } from './score-band.js';
import { initialsOf } from './initials.js';
import {
  DAY, computeComponents as realComponents, projectedDay, scoreFor, dayFromHistoryRow,
  streakDays as dayStreak, streakInfo, loadDay, reloadPassState, pushDay, uploadMealPhoto, flushDayPush,
  setSyncBlocked, isSyncBlocked, SYNC, setDayTaskProvider,
  dayLogMeal, daySubmitCheckin, daySetCommitment, daySetFocus, dayLogWeight, dayResetLocal, dayCheckTask,
  insertMeal, MEAL_KEYS, minutesNow, mealScored,
  setDayStandard, slotDeadline, slotGrace, slotLateCredit, slotOpen, setDayGoalConfig,
  setDayPlanStyle, weightsForDay, DAY_SELECT_COLS, PROFILE_WEIGHTS,
} from './day.js';
import { creditsLeft } from './pass.js';
import { deriveExec, mapPressure, samePlan } from './exec.js';
import { activationInfo, parseActivation } from './activation.js';
import { normalizePrefs } from './notify-plan.js';
import { commitmentReminders } from './commitments.js';
import { normalizeCoachPrefs, alertKeys, buildCoachSyncPlan } from './coach-notify-plan.js';
import { entriesFor, getScope, CD } from './coach-data.js';
import { splitServerRows } from './notif-feed.js';
import { jobKey, putJob, readQueue, removeJob, updateJob, due as dueJobs, backoffMs } from './meal-outbox.js';
import * as SQ from './sync-queue.js';
import { setVcUidProvider } from './commitment-data.js';
import { CS as CS_DATA, loadMine as loadCsMine } from './connected-standard-data.js';
import { factsFromCorrection, candidateFactsFromFoodChange, sameFact } from './memory.js';
import { TOUR_IDS } from './tour-plan.js';
import {
  groundExtras, buildClarifications, analysisTiming, applyMealCorrection, applyFoodRemoval, classifyMealEvent, restrictionConflicts,
  mealQualityScore, qualityBand, qualityReason, analysisAgreesWithBand, analysisAgreesWithNumbers, analysisAgreesWithComponents, stripFoodMentions, shouldVerify,
  contextForChat,
} from './meal-intel.js';
import { groundMealFromFoods, groundMealTotals, gapFoods, labelProducts, isCompleteMealResult } from './nutrition.js';
import { explainCategories, reachPlan as modelReachPlan, maxPossibleScore, mealMaxGain, CI_BEST } from './breakdown-model.js';
import { cachedMealPhoto, todayMealPhotoPath, invalidateMealPhoto, resolveMealPhoto } from './photo-store.js';
import { base64ToBytes, sha256Hex, photoAgeMinutes } from './photo-hash.js';
import {
  fetchMyPracticeIdentity, fetchMyTeamIdentity, fetchMyCoach, fetchMyTrainer, fetchMyConsent,
  requestGuardianConsent as rpcRequestConsent,
  fetchRequirementSets, fetchRelevantRequirementSets, fetchMyAssignments, completeAssignmentRemote,
  fetchMyNotifications, markMyNotificationsRead,
  fetchMyCoachHandle, setMyCoachName, checkPhotoReuse, notifyMyCoach,
  fetchPassPolicy, spendPass as rpcSpendPass, fetchTeamWeekPattern, fetchCoachSetupState, fetchPracticeSetupState, fetchMyRoomLabel,
  fetchMyMemoryFacts, upsertMemoryFact, setMemoryFactStatus,
  fetchFoodMemory, insertFoodMemoryItem, updateFoodMemoryItem, archiveFoodMemoryItem,
  bumpFoodMemoryItem, upsertFoodMemoryPlace,
  uploadAvatar as rpcUploadAvatar, removeAvatar as rpcRemoveAvatar,
  todayISO,
} from './roles.js';
import { bustAvatar } from './avatar.js';
import { itemFromMeal, memoryContextForAnalysis, mealSignature } from './food-memory.js';
import { foodMemory, warmFoodMemory, invalidateFoodMemory } from './food-memory-data.js';
import { track, EVENTS } from './analytics.js';

/* minutes-from-midnight → "8:14 AM" (real logged times, never a canned '8:14 AM') */
export function fmtClock(min) {
  if (min == null) return '';
  let h = Math.floor(min / 60) % 12; if (h === 0) h = 12;
  const ap = Math.floor(min / 60) < 12 ? 'AM' : 'PM';
  return `${h}:${String(min % 60).padStart(2, '0')} ${ap}`;
}
/** A coarse elapsed span for deadline copy: "45m", "1h 4m", "3h". Minutes alone under the hour,
 *  and a clean hour drops its minutes so "2h" never prints as "2h 0m". */
export function fmtGap(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/* The meal currently being captured (Phase 5 AI loop). When MEAL.result is set, S.logging and
   the score use the REAL analyzed macros instead of the demo placeholders.
   Integrity fields (0062): photoHash (sha256 of the downscaled JPEG — the duplicate wall),
   source ('live'|'gallery'|'manual'|'label'), takenAt (EXIF capture time of a gallery pick),
   capturedAtMin (when THIS capture happened, for the timing pill + minutes_late). */
export const MEAL = {
  key: null, mealType: null, photoBase64: null, photoDataUrl: null, result: null, live: true,
  questions: null, photoHash: null, source: null, takenAt: null, capturedAtMin: null,
  userNote: null, // athlete-entered invisible details (oil, sauce, prep) from the review step (spec §5.5)
  photoQ: null,   // measured capture stats {luma, sharpness} — real numbers from the capture canvas
  memoryId: null, memoryTimes: null, // one-tap re-log of a saved Food Memory item (0192) — bumps its count on log
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

/** Ground the AI result into numbers the APP owns (Tier 1 invariants, 2026-07-21):
    1. NUTRITION — per-food macros bounded against the curated food DB (nutrition.js); totals
       are the SUM of the per-food numbers, so removing a food later subtracts exactly its
       share. Payloads from older edge deploys (no per-food macros) fall back to meal-level
       DB bounding. The old hard caps stay as the outermost belt-and-braces.
    2. SCORING — quality is computed HERE by mealQualityScore (deterministic, same evaluation
       the rubric displays). The AI's own quality survives only as aiQuality, feeding the
       meal_score_delta cross-check analytic — it is never shown and never stored as the score.
    3. LANGUAGE — the AI paragraph rides along only when its tone can sit next to the computed
       band; on conflict the deterministic qualityReason line speaks instead.
    Exported for protoGroundResult.test.ts — the payload-compat gate that feeds real old-shape
    (no per-food macros) and new-shape wire payloads through this exact function. */
export function groundResult(d) {
  const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(v || 0)));
  // Belt-and-braces: the AI response is untrusted text. Strip angle brackets at the source so a
  // crafted analyze-meal payload can never inject markup (render sites still escape as well).
  const clean = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, 200);
  const extras = groundExtras(d);

  // ---- nutrition: per-food attribution when the payload carries it; totals fallback otherwise
  const perFood = extras.detectedRich.some((f) => f && f.per);
  let detectedRich = extras.detectedRich;
  let totals;
  if (perFood) {
    const g = groundMealFromFoods(extras.detectedRich);
    detectedRich = g.foods;
    totals = g.totals;
  } else {
    totals = groundMealTotals(d, extras.detectedNames).totals;
  }
  const protein = clampN(totals.protein, 120), carbs = clampN(totals.carbs, 250), fat = clampN(totals.fat, 150);
  const kcal = clampN(totals.kcal || (4 * protein + 4 * carbs + 9 * fat), 2200);
  const gm = { protein, carbs, fat, kcal };

  // ---- scoring: deterministic, timing measured on the athlete's clock at capture
  const timing = analysisTiming(MEAL.capturedAtMin != null ? MEAL.capturedAtMin : minutesNow(), slotDeadline(MEAL.key || 'dinner'));
  const quality = mealQualityScore({ macros: gm, fiber: extras.fiber, detected: detectedRich, minutesLate: timing ? timing.minutesLate : 0 });
  const aiQuality = d.quality != null ? clampN(d.quality, 100) : null;
  if (quality != null && aiQuality != null) track(EVENTS.MEAL_SCORE_DELTA, { ai: aiQuality, det: quality, delta: quality - aiQuality });

  // ---- language: score, NUMBERS and words must agree (one evaluation result)
  // The band check governs tone; the numeric check governs figures. The model wrote its paragraph
  // against its OWN estimate, and everything above has just replaced that estimate — so prose
  // quoting a protein or calorie number the breakdown will not show is dropped here, before it can
  // reach either the card or the thread bubble (which is now composed from this same object).
  const band = qualityBand(quality);
  let analysis = extras.analysis;
  let note = clean(d.note);
  // The component rail rides with its siblings (founder 2026-08-11): prose praising a macro the
  // chips just marked a miss ("Good start on protein" over a "Protein low" chip) is the same
  // contradiction as a wrong figure, and gets the same fallback.
  const verdictInputs = { macros: gm, fiber: extras.fiber, detected: detectedRich, minutesLate: timing ? timing.minutesLate : 0 };
  if (!analysisAgreesWithBand(analysis, band) || !analysisAgreesWithBand(note, band)
    || !analysisAgreesWithNumbers(analysis, { ...gm, fiber: extras.fiber })
    || !analysisAgreesWithNumbers(note, { ...gm, fiber: extras.fiber })
    || !analysisAgreesWithComponents(analysis, verdictInputs)
    || !analysisAgreesWithComponents(note, verdictInputs)) {
    track(EVENTS.MEAL_TEXT_CONFLICT, { det: quality != null ? quality : -1 });
    analysis = '';
    note = qualityReason(gm, extras.fiber, detectedRich) || 'Logged. The breakdown shows how this plate reads.';
  }

  return {
    name: clean(d.name) || 'Meal', quality, aiQuality,
    protein, carbs, fat, kcal,
    fiber: extras.fiber,
    highlights: extras.highlights,
    detected: detectedRich.map((f) => f.name), // legacy consumers keep plain names
    detectedRich,                              // confidence-aware renderers (now with per-food macros)
    note,
    analysis,                                  // detailed coach paragraph (0062); '' from an old edge fn
  };
}

/* The engine's own headline mix for TODAY (style x goal profile — plan-style.js weightsFor via
   day.js weightsForDay). Every surface that PRINTS a weight must read this, never a constant. */
export function liveWeights() { return weightsForDay(DAY); }
/** Whole-number weight for one component, for display copy (e.g. "Nutrition · " + liveWeightPct('nutrition') + "% of score"). */
export function liveWeightPct(comp) { return Math.round((liveWeights()[comp] || 0) * 100); }
setImpactWeightsProvider(liveWeights);

/* The athlete-profile mix, kept ONLY as the documented grandfathering baseline and for tests
   that pin it. Derived from the ONE owner (plan-style.js via day.js) so it can never drift.
   Nothing may print a percentage from here; use liveWeightPct(). */
export const WEIGHTS = PROFILE_WEIGHTS.athlete;

/* Weight's due time — read from the one catalog truth, never a second hardcoded copy. */
const WEIGHT_DUE = CATALOG.find((r) => r.id === 'weight').window.due;

/* Headline score for TODAY. Reads the SAME style x profile mix the engine scores with
   (day.js scoreFor -> weightsForDay), so S.score can no longer disagree with the breakdown
   that explains it — the contradiction this product can least afford.

   This is NOT a scoring change: PROFILE_WEIGHTS.athlete is identical to WEIGHTS above, so an
   athlete-profile account's number is byte-for-byte unchanged (grandfathering holds).
   For every other style/profile the engine ALREADY scored them on these weights; only the
   proto's displayed number was stale. */
export function computeScore(c) {
  const w = liveWeights();
  return Math.round(
    w.nutrition * c.nutrition +
    w.recovery  * c.recovery +
    w.commitment* c.commitment +
    w.checkin   * c.checkin
  );
}

/* Score tiers — re-exported from score-band.js, which owns the thresholds. This used to be a
   fourth hand-written copy of the ladder with a 75 floor for "Locked In", five points below the
   80 the streak gate and the roster both use. One definition now; see score-band.js. */
export const tier = tierFor;

/* ---------------- Runtime (persisted) ---------------- */
const KEY = 'onstd-proto-rt-v1';
const DEFAULT_RT = {
  // Whose email confirmation is still outstanding, when signUp returned a user but NO session.
  // Declared here (not left as a dynamic key) so it round-trips through save/load and is reset
  // per-account by _wipeUserScopedState. Null whenever nobody is mid-confirmation.
  pendingConfirmEmail: null,
  // Custom email verification (2026-08-02 — prod runs mailer_autoconfirm=true, so GoTrue itself
  // never sends a confirmation and stamps every signup confirmed on arrival; see
  // 0176_email_verification.sql). Tri-state on purpose: null = not loaded yet (never render the
  // banner off a guess — that would flash it for every verified user for one frame), true/false =
  // the real server value. Reset per-account by _wipeUserScopedState like everything above it.
  emailVerified: null,
  dinnerLogged: false,
  recoveryDone: false,
  weightLogged: false,   // late log (window was 9 AM) — trend only, never scored
  weightLoggedAt: null,  // minutes-from-midnight of the real weight log — drives honest "late"
  notifsRead: false,
  notifPrefs: null,      // reminder prefs {enabled,quietFrom,quietTo,allowDeadline}; null → framework defaults
  coachNotifPrefs: null, // COACH device reminder prefs (briefing/recap/hourly/immediate/quiet/myRoomOnly); null → coach defaults
  _lastCoachAlertKeys: [], // last synced objective overdue signatures (alertKeys) — drives the NEW-critical diff across syncs
  serverNotifs: [],      // cached server notification rows (0027: nudges, join events, digests)
  serverAckAt: null,     // when the bell was last opened — offline unread-badge ack for server rows
  day0: false,           // fresh-athlete empty-state mode (set by finishing onboarding)
  day0Breakfast: false,  // day-0 first meal logged
  activationDate: null,  // ISO stamp of onboarding commit (first-day activation; never backdate). Server committed_at is the cross-device backstop.
  lastMove: null,        // {from, to, gain, what} — powers confirmation screens
  assigned: [],          // coach-assigned requirements: {id,title,icon,note,from,dueLabel,done,seen,real?}
  reqSets: null,         // team's standing requirement_sets (0055) — cached for resolution surfaces
  stdMeals: null,        // resolved governing standard {mealsRequired, slots, deadlines, titles} — drives the scored day
  coachSeenMealIds: [],  // coach device: meal ids opened in the activity feed (drives unseen dots)
  coachNudged: {},       // coach device: athleteId -> ISO date of last nudge (one per athlete per day)
  coachSetup: {},        // coach first-run checklist: real per-step completion flags (sharedCode/standard/staff/group) marked when the coach actually does each step; reset per-account by _wipeUserScopedState
  coachVoice: null,      // coach's AI-voice config {enabled,tone,level,approved:[],prohibited}; null → defaults. Consumed live by the coach-voice-nudge edge fn (home.js)
  theme: 'dark',         // 'dark' | 'light' | 'system' — dark is the shipped default (WS2b)
  haptics: true,         // device preference: light vibration on taps/logs (router buzz())
  coachComments: [],     // coach->athlete comments; REALLY land in the athlete's meal thread
  planUpdate: null,      // coach-published plan update; REALLY lands in Plan·Notes + notifications
  trainerNotes: [],      // trainer->client notes; REALLY land in the athlete's notifications
  camPrimed: false,      // Apple-style camera permission priming shown once
  homeOpenSections: {},  // WS6: per-section open state for Home's collapsible groups (Later/Done)
  lastLockSeen: null,    // 'YYYY-MM-DD' of the last locked day whose stamp was shown (lock-moment.js) — display only, never scoring
  lastMilestone: null,   // streak length whose milestone stamp was shown, so 7/30/100 fire once each
  reviewAskedAt: null,   // epoch ms of the last store-rating prompt actually shown on this device (review-ask.js)
  hadRoster: false,      // this account has, at some point, been on a coach/trainer roster — set true, never back
  keepRecordSeen: false, // the "your record stays yours" card after leaving a roster was dismissed
  obPlanCtaDone: false,  // the "you picked <plan> in onboarding" trial card was tapped/dismissed/superseded
  tourSeen: {},          // first-run tour + contextual tips: id ('tour:athlete' | 'tip:progress') -> ISO shown-at (tour.js). Wiped per-account with the rest of DEFAULT_RT.
  profile: null,         // athlete identity: {name, sport, position, school, level, avatar(dataURL)} — from onboarding / signed-in profile, never fabricated
  ob: null,              // onboarding scratch — the athlete's real selections, captured as they build their Standard
  allergies: [],         // FLAT summary list (guardian check + profile row). Derived from restrictions when structured.
  restrictions: null,    // structured (spec §18.1): {allergies:[{name,severity}], intolerances:[], preferences:[]}
  injured: false,        // injury mode: the Standard adapts (rehab replaces recovery emphasis)
  wearable: false,       // reserved; #devices gates on the live native health probe, not this flag
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
  applyDaypart();
}

/* Which part of the day it is, on the root, so the canvas can agree with the greeting.
 *
 * The app says "Good morning" and then paints the identical background it paints at 11pm. This
 * stamps the same three buckets S.greeting uses — deliberately the SAME boundaries, read from the
 * same clock, so copy and canvas can never disagree about what time it is — and tokens.css shifts
 * one token off it. Nothing but --bg-grad-top changes: it must read as the light in the room
 * changing, not as a second theme the athlete didn't choose. */
export function applyDaypart() {
  if (typeof document === 'undefined') return;
  const h = new Date().getHours();
  document.documentElement.setAttribute('data-daypart', h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
}
applyTheme(); // stamp before first paint — no flash of the wrong theme (also stamps the daypart)
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
  return RT.authRole === 'coach' ? 'coach'
    : RT.authRole === 'trainer' ? 'trainer'
    // A parent has no tab bar of its own, so this used to fall through to 'athlete' — which both
    // painted the athlete tab bar on shared screens AND made navAdmits() refuse a parent, so a
    // parent could not open #delete-account at all. 'parent' is admitted and renders no tabs.
    : RT.authRole === 'parent' ? 'parent'
    : 'athlete';
}
/* Team-creation failures in a coach's own words. A raw Postgres string ("permission denied for
   table teams", "duplicate key value violates unique constraint …") tells a coach nothing and
   reads as a crash; the console still carries the original for us. */
function friendlyTeamCreate(err) {
  const m = String((err && err.message) || err || '').toLowerCase();
  if (err) { try { console.error('[createTeamNow]', err); } catch { /* no console */ } }
  if (!m) return "Couldn't create your team. Try again.";
  if (m.includes('permission denied') || m.includes('row-level security') || m.includes('policy')) {
    return "This account isn't allowed to create a team. If you joined with a staff code you're already on one. Contact your head coach.";
  }
  if (m.includes('duplicate') || m.includes('already exists') || m.includes('unique constraint')) {
    return 'You already have a team. Pull down to refresh, or reopen the app.';
  }
  if (m.includes('fetch') || m.includes('network') || m.includes('timeout') || m.includes('failed to send')) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return "Couldn't create your team. Try again.";
}
export function roleProfileRoute() {
  return RT.authRole === 'coach' ? 'coach-profile'
    : RT.authRole === 'trainer' ? 'trainer-profile'
    // A parent's hub IS their profile. Without this branch every shared settings screen's
    // back/Done exit ("Keep my account", the appearance screen's Done) dropped a parent onto
    // #profile — the ATHLETE Profile screen, a different role's UI.
    : RT.authRole === 'parent' ? 'parent'
    : 'profile';
}
function friendlyAuth(msg) {
  const m = String(msg || '').toLowerCase();
  if (m.includes('invalid login')) return 'That email or password is incorrect.';
  if (m.includes('email not confirmed') || m.includes('not confirmed') || m.includes('confirm your email')) return 'Confirm your email first: check your inbox for the link, then sign in.';
  if (m.includes('disabled') || m.includes('banned') || m.includes('suspended')) return "This account isn't available right now. Contact your coach or support.";
  // Anti-enumeration on the sign-up path: never definitively confirm an address is registered.
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already')) return 'That email may already be registered. Try signing in or resetting your password.';
  if (m.includes('provider') || m.includes('identity') || m.includes('oauth')) return 'That account uses a different sign-in method. Try email and password.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again, or reset your password.';
  // GoTrue's email-frequency limit (prod smtp_max_frequency = 60s) phrases itself as
  // "For security purposes, you can only request this after 47 seconds" — which matches none of
  // the rules above, so it used to reach the user as raw server prose. Keep its real number.
  if (m.includes('for security purposes') || m.includes('only request this after')) {
    const secs = (String(msg).match(/(\d+)\s*second/) || [])[1];
    return secs ? `Wait ${secs} seconds before trying that again.` : 'Wait a moment before trying that again.';
  }
  if (m.includes('password')) return 'Use a longer password (at least 12 characters).';
  if (m.includes('valid email') || m.includes('email address')) return 'Enter a valid email address.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to')) return "You're offline. Check your connection and try again.";
  // The guardian RPCs (0008, 0081) raise their own prose. Most of it is already written for a
  // reader ("this invite has expired — ask for a new one") and passes through below untouched;
  // these two are engineer fragments that reached the user lowercase and mid-sentence.
  if (m.includes('must be signed in')) return 'Sign in first, then try that again.';
  if (m.includes('invalid guardian email')) return "That doesn't look like a valid email address. Check it and try again.";
  return msg || "That didn't go through. Try again in a moment.";
}

/* ---------------- Derived (live) — REAL, from the persisted DAY (parity-proven engine) ---------------- */
// recovery is reported as its scoring CONTRIBUTION (0 unless a real check-in backs it), so
// computeScore(componentsNow()) === the engine's athleteScore. See day.js + scoreParity.test.ts.
function componentsNow() {
  const c = realComponents(DAY);
  return { nutrition: c.nutrition, recovery: c.recoveryContribution, commitment: c.commitment, checkin: c.checkin };
}
/* Honest per-meal Daily Score attribution: today's score minus the score of the same day
   WITHOUT this meal. Never fabricated — it's the same pure component math the score getter
   uses, run twice. A late meal shows its real half-credit; a duplicate-flagged slot shows 0. */
function mealImpact(k) {
  if (!DAY.meals || !DAY.meals[k]) return 0;
  const stripped = {
    ...DAY,
    meals: { ...DAY.meals, [k]: false },
    mealLoggedAt: { ...DAY.mealLoggedAt },
    slotMacros: { ...DAY.slotMacros },
  };
  delete stripped.mealLoggedAt[k];
  delete stripped.slotMacros[k];
  const w = realComponents(DAY);
  const wo = realComponents(stripped);
  const withScore = computeScore({ nutrition: w.nutrition, recovery: w.recoveryContribution, commitment: w.commitment, checkin: w.checkin });
  const withoutScore = computeScore({ nutrition: wo.nutrition, recovery: wo.recoveryContribution, commitment: wo.commitment, checkin: wo.checkin });
  return Math.max(0, withScore - withoutScore);
}
/* The ceiling the athlete can still reach today. Clock-aware on purpose: a meal whose window
   has already closed can only be logged LATE from here, so it projects at half nutrition credit
   instead of promising on-time credit that is no longer earnable.

   Without the clock this disagreed with the breakdown sheet, which has always decayed (see
   breakdown-model.js maxDay). The hero could read "max today 100" while the sheet the athlete
   opens from that very hero said 87 — and the score ring's ceiling arc was drawn from the
   optimistic number, so the "path back" it showed was partly unreachable. */
function componentsDone() {
  const c = realComponents(projectedDay(minutesNow()));
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
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Is this slot loggable-but-not-required? The standard's own `optional` list when one governs,
 *  else the classic rule (snack is the bonus slot). */
function optionalSlot(k) {
  const std = RT.stdMeals;
  return std ? !!(Array.isArray(std.optional) && std.optional.includes(k)) : !REQ_MEAL_SLOTS.includes(k);
}
/** The deadline line for ONE named slot, coach-standard aware. Exported so a screen that already
 *  knows which slot it's logging (the camera, routed as `camera/dinner`) reads THAT slot's
 *  deadline instead of re-deriving a next-open slot and quoting a different meal's time. */
export function mealDueLabel(k) {
  // Founder ruling 2026-08-20: the engine's rule stands (an optional slot logged past its
  // deadline earns the late credit, half by default), so the copy states it — "counts whenever
  // you log it" was only true under a coach's late-forgives-all policy.
  if (optionalSlot(k)) {
    const dl = slotDeadline(k);
    // A coach's late-forgives-all policy really does mean "whenever"; only then say so.
    return (dl != null && slotLateCredit(k) < 1) ? `Optional · full credit by ${fmtClock(dl)}` : 'Optional · counts whenever you log it';
  }
  const dl = slotDeadline(k);
  return dl != null ? `Due by ${fmtClock(dl)}` : 'Log when ready';
}
/** The same deadline, plus the honest state of it. ONE source, so no screen re-inlines its own
 *  idea of "is this late" — the camera header used to paint every deadline amber, a deadline an
 *  hour in the FUTURE and one an hour in the PAST reading identically, which is the opposite of
 *  what amber means in this system (warning only: at risk, off pace). Three tones, mapped to the
 *  hues already reserved for them: quiet on time, amber inside the last half hour, red once the
 *  window has closed, and the red case says by how much rather than restating the time. An
 *  optional slot carries no tone at all: there is nothing to be late for. */
export function mealDueState(k) {
  const label = mealDueLabel(k);
  if (optionalSlot(k)) return { label, tone: 'quiet', minutesLate: 0 };
  const dl = slotDeadline(k);
  if (dl == null) return { label, tone: 'quiet', minutesLate: 0 };
  const left = dl - minutesNow();
  if (left < 0) return { label: `Late by ${fmtGap(-left)}`, tone: 'late', minutesLate: -left };
  return { label, tone: left <= 30 ? 'warn' : 'quiet', minutesLate: 0 };
}
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
/* Every LOGGABLE slot: the standard's own slots when one governs, else the classic four. Wider
   than reqMealSlots() — it keeps the classic snack, which is loggable but not required. */
function allMealSlots() {
  return (RT.stdMeals && Array.isArray(RT.stdMeals.slots) && RT.stdMeals.slots.length)
    ? RT.stdMeals.slots : MEAL_KEYS;
}
function nextOpenSlot(explicit) {
  // The standard's OWN slots when one governs. Against the classic MEAL_KEYS a 5- or 6-meal
  // standard's 'meal-5'/'meal-6' failed the membership test, so an explicit "Log Meal 5" fell
  // through and filed the capture under whatever classic slot was open next. Slot keys 1–4 are
  // identical either way, so the classic day is untouched (slotDeadline falls back to DEADLINE).
  const keys = allMealSlots();
  if (explicit && keys.includes(explicit) && !DAY.meals[explicit]) return explicit;
  const open = keys.filter(k => !DAY.meals[k]);
  if (!open.length) return null;
  const now = minutesNow();
  return open.find(k => now <= slotDeadline(k)) || open[open.length - 1];
}

/** Does this logged slot have a photo behind it? Photo-sourced logs ('live'/'gallery' — or
 *  legacy meta with no source recorded, where we try and degrade) get their stored image
 *  resolved; 'manual'/'label' logs honestly have no photo (spec §7.2). */
export function slotHasPhoto(k) {
  const meta = DAY.slotMacros[k] || {};
  if (meta.source) return meta.source === 'live' || meta.source === 'gallery';
  return true; // legacy rows recorded no source: attempt the fetch, degrade to placeholder on miss
}
/** The slot's best available image RIGHT NOW: the in-session capture, else the cached signed
 *  Storage URL (photo-store). Null means "not resolved yet" or "no photo submitted". */
function slotImage(k) {
  if (MEAL.key === k && MEAL.photoDataUrl) return MEAL.photoDataUrl;
  if (!slotHasPhoto(k)) return null;
  return cachedMealPhoto(todayMealPhotoPath(RT.userId, String(DAY.date), k));
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
  /* The DISH name, and ONLY when it says more than the slot already does. Manual and label logs
     store the slot name in this field, and rows logged before it was carried have nothing at all,
     so "Dinner" and "" both resolve to null and every caller falls back to the slot exactly as it
     did before. Deliberately a SEPARATE field from `name`: `name` is the slot and eight call sites
     depend on that ("Dinner logged", "Log Dinner", the photo viewer label, the AI's prose) — none
     of them want "Chicken, Rice & Broccoli logged". Same test the coach's meal review has used
     since it started reading meals.name. */
  const dishRaw = typeof meta.name === 'string' ? meta.name.trim() : '';
  const dish = dishRaw && dishRaw.toLowerCase() !== cap(k).toLowerCase() ? dishRaw : null;
  return {
    slot: k, logged, name: cap(k), dish,
    loggedAt: at != null ? fmtClock(at) : null, late,
    loggedAtMin: at != null ? at : null,
    deadlineMin: deadline, deadlineLabel: fmtClock(deadline),
    minutesLate: at != null ? Math.max(0, at - deadline) : null,
    score: meta.quality != null ? meta.quality : null,
    foods,
    macros: { protein: meta.protein || 0, carbs: meta.carbs || 0, fat: meta.fat || 0, cals: meta.kcal || 0 },
    img: slotImage(k),
    note: meta.note || '',
    userNote: meta.userNote || '', // the athlete's own review-step details (§5.5)
    hasPhoto: slotHasPhoto(k),
    live: meta.live !== false,
    source: meta.source || (meta.live === false ? 'gallery' : null),
    flagged: meta.flagged || null,   // 'dup' → logged but doesn't score (photo reuse)
    takenAt: meta.takenAt || null,   // EXIF capture time of a gallery pick
    corrections: Array.isArray(meta.corrections) ? meta.corrections : [], // athlete corrections (audit)
    orig: meta.orig || null,         // the AI's original estimate, frozen at first correction
    photoQ: meta.photoQ || null,     // measured capture quality {luma, sharpness} (or null)
    analysis: meta.analysis || '',   // the AI's detailed paragraph (0062), '' pre-migration
    styleApplied: meta.styleApplied || null, // 0142 — which plan style the server wrote it for
    // Optimistic-log state (display only — no scoring path reads these). `pending` means the meal
    // is logged and the AI read is still in flight; `pendingQuestions` are the clarifying questions
    // asked in the thread; `analysisFailed` is a terminal, retryable failure.
    pending: !!meta.pending,
    pendingQuestions: Array.isArray(meta.pendingQuestions) ? meta.pendingQuestions : null,
    analysisFailed: meta.analysisFailed || null,
    rereadError: meta.rereadError || null, // the re-read couldn't fetch the photo back from storage
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

/** The check-in's honest ceiling: submitting right now with the best possible answers — the
 *  SAME CI_BEST constant the Score Breakdown's reach plan runs through the engine, so the
 *  Recovery screen's "earn up to" and the breakdown can never quote different numbers. */
export function checkinBestProjection() { return checkinProjection(CI_BEST); }

/** After loadDay(), reflect the real day into the RT flags the rest of the UI still reads. */
export function syncRtFromDay() {
  RT.dinnerLogged = !!DAY.meals.dinner;
  RT.recoveryDone = !!DAY.ciSubmitted;
  RT.day0Breakfast = !!DAY.meals.breakfast;
  RT.weightLogged = DAY.currentWeight != null;
  if (!RT.weightLogged) RT.weightLoggedAt = null;
  // "day 0" (fresh empty state) until the athlete logs anything real today
  RT.day0 = !DAY.meals.breakfast && !DAY.meals.lunch && !DAY.meals.snack && !DAY.meals.dinner && !DAY.ciSubmitted && !DAY.dailyCommitment;
  save();
}

/* The athlete's activation stamp for the first-day (no-retroactive-failure) rules. The account's
   SERVER birthday (profiles.created_at, hydrated into RT.profile.createdAt) is the authoritative,
   tamper-proof anchor — it can't be stale because the row didn't exist until the account did. A
   commit stamp (RT.activationDate / RT.profile.committedAt) only refines the minute-of-day, and
   only when it lands on the birthday; a stale cross-day carry (the founder's 11-day-old stamp) is
   ignored. No server birthday (older clients) ⇒ prior commit-stamp behavior, so nobody regresses. */
function activationStamp() {
  const created = (RT.profile && RT.profile.createdAt) || null;
  const committed = RT.activationDate || (RT.profile && RT.profile.committedAt) || null;
  if (created) {
    const cd = parseActivation(created);
    const md = committed ? parseActivation(committed) : null;
    if (cd && md && md.date === cd.date) return committed; // same-day: keep the finer minute
    if (cd) return created;                                 // reject a stale cross-day commit
  }
  return committed;
}
/** The activation calendar date only ('YYYY-MM-DD'), or null. */
function activationDateOnly() {
  const p = parseActivation(activationStamp());
  return p ? p.date : null;
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
/* The athlete's nutrition scoring config from their goal + bodyweight + coach-set targets — the
   ONE source both the athlete's own hydrate (applyGoalToDay) and the coach-side score breakdown
   read, so a coach viewing an athlete grades their day exactly as the athlete is graded. A
   coach/trainer target (athlete_profiles.targets) wins over the goal-derived default; no goal →
   the shipped athlete defaults (never another athlete's device values). Pure + exported for the
   coach reconstruction. */
export function nutritionConfigForGoal(goal, bodyweightLb, targets) {
  if (!goal) return { scoringProfile: 'athlete', proteinTarget: GOAL_PROTEIN_DEFAULT, calTarget: GOAL_CAL_DEFAULT };
  const derived = goalDerivedTargets(goal, bodyweightLb > 0 ? +bodyweightLb : GOAL_BW_DEFAULT);
  const t = targets || {};
  return {
    scoringProfile: scoringProfileForGoal(goal),
    proteinTarget: t.protein > 0 ? +t.protein : derived.proteinTarget,
    calTarget: t.calories > 0 ? +t.calories : derived.calTarget,
  };
}
/* ---------------- Plan style → the live day (0142) ----------------
   The THIRD axis: goal sets direction, standard reshapes the day, style sets how much structure
   the athlete is held to. One resolution, shared by the athlete's own hydrate and every surface
   that has to explain it, so "what am I on and who set it?" always has one answer.

   The role decides who CONTROLS it, not what it is: a team athlete's coach owns the setting, a
   trainer client proposes, an independent adult chooses. The stated preference is carried
   through in every case — see plan-style.js resolvePlanStyle. */
function planStyleRoleFor() {
  const p = RT.profile || {};
  if (RT.myCoach && RT.myCoach.teamId) return 'athlete';   // on a team → the coach's call
  if (RT.myTrainer || p.trainerId) return 'client';        // a practice client → propose
  const r = p.primaryRole || (RT.ob && RT.ob.role) || null;
  if (r === 'coach' || r === 'trainer' || r === 'nutrition') return r;
  return 'solo';                                           // an independent adult chooses freely
}

/** The athlete's resolved plan style — the ONE derivation every surface reads. */
export function resolveMyPlanStyle() {
  const p = RT.profile || {};
  const teamStandard = planStyleFromItems(RT.stdItems, (RT.myCoach && RT.myCoach.name) || null);
  const targets = p.targets || {};
  return resolvePlanStyle({
    role: planStyleRoleFor(),
    teamStandard,
    proAssignment: targets.style
      ? { style: targets.style, styleOverrides: targets.styleOverrides || null, setBy: (RT.myCoach && RT.myCoach.name) || (RT.myTrainer && RT.myTrainer.name) || null }
      : null,
    selfChoice: p.planStyle || null,
    preference: p.planStylePreference || (RT.ob && RT.ob.structurePref) || null,
    // Grandfather (founder decision): an account that already has scored history keeps today's
    // exact formula rather than being moved to the new Guided default on release day.
    hasHistory: Array.isArray(DAY.scoreHistory) && DAY.scoreHistory.length > 0,
  });
}

/* A style's tracked body signals become check-in QUESTIONS (digestion/cravings) through the
   SAME ciConfig gate every other check-in field uses — no second form, no second engine. Only
   the two check-in-scoped signals are touched; the athlete's other toggles are left alone. */
function applyStyleCheckinConfig(knobs) {
  if (!DAY.ciConfig) return;
  for (const key of CHECKIN_SIGNAL_KEYS) {
    DAY.ciConfig[key] = !!(knobs && knobs.signals && knobs.signals[key]);
  }
}

/** The trailing-week rate at which this athlete answered their signal prompts (0..1). Feeds
 *  awarenessScore so one skipped day barely moves the number. Real data only — computed from
 *  the signals actually stored on the last 7 day rows; null when there is no history to read. */
function signalWeekRate() {
  const hist = Array.isArray(DAY.scoreHistory) ? DAY.scoreHistory.slice(-7) : [];
  if (!hist.length) return null;
  let answered = 0;
  for (const h of hist) {
    const sig = (h && h.checkin && h.checkin.signals) || (h && h.signals) || null;
    if (sig && Object.keys(sig).some(slot => sig[slot] && Object.keys(sig[slot]).length)) answered++;
  }
  return answered / hist.length;
}

/** Push the resolved style onto the live DAY: the scoring branch, the check-in questions, and
   the awareness week-rate. Idempotent — safe on every hydrate, exactly like applyGoalToDay. */
function applyPlanStyleToDay() {
  const res = resolveMyPlanStyle();
  RT.planStyle = res;
  setDayPlanStyle(res.style, res.knobs);
  applyStyleCheckinConfig(res.knobs);
  DAY.signalWeekRate = signalWeekRate();
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
  // ONE derivation, shared with the coach breakdown (nutritionConfigForGoal) so they never drift.
  const cfg = nutritionConfigForGoal(goal, bw, p.targets);
  setDayGoalConfig(cfg.scoringProfile, cfg.proteinTarget, cfg.calTarget);
}

/* ---------------- Actions ---------------- */
/* The exec engine's catalog for the current runtime: a governing coach standard swaps ITS meal
   slots (count/titles/windows) in for the classic meals; no standard → the classic CATALOG,
   byte-identical. Shared by the live exec getter AND tomorrow's pre-scheduled reminder plan. */
function execCatalog() {
  const std = RT.stdMeals;
  let base;
  if (!std) {
    base = CATALOG;
  } else {
    const mealItems = reqMealSlots().map((k) => {
      const b = CATALOG.find(c => c.id === k);
      return {
        id: k, title: (std.titles && std.titles[k]) || (b ? b.title : cap(k.replace('-', ' '))),
        icon: b ? b.icon : 'utensils', accent: b ? b.accent : 'g', proof: 'photo',
        // BOTH edges come from the standard. Spreading only `due` used to leave the catalog's
        // classic open time behind, so a coach-moved dinner read "Opens 6:00 PM · Due by 5:00 PM".
        freq: { type: 'daily' }, window: { ...(b ? b.window : {}), open: slotOpen(k), due: slotDeadline(k), grace: slotGrace(k) },
        // Snack-optional (0100/0086): a snack slot is loggable but not required — it never reads
        // overdue and drops out of the denominator. Every other slot stays required (parity).
        required: !(std.optional && std.optional.includes(k)),
        impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium', note: b ? b.note : '',
      };
    });
    base = [...mealItems, ...CATALOG.filter(r => !REQ_MEAL_SLOTS.includes(r.id))];
  }
  // Coach standing NON-MEAL items (lift/custom/extra hydration/weigh) — surfaced to the athlete's
  // list, TRACKED not scored. Drop any 'component' item (meals/recovery/checkin feed the score and
  // are already handled above) and dedupe by id, so this only ADDS the coach's plan/focus/trend
  // requirements and never alters an existing scored one. RT.stdItems null (no coach set) → coach
  // is [] → base returned unchanged, so a no-coach day stays byte-identical.
  const coach = catalogFromItems(RT.stdItems).filter(r => r && r.impact && r.impact.kind !== 'component');
  if (!coach.length) return base;
  const seen = new Set(base.map(r => r.id));
  return [...base, ...coach.filter(r => !seen.has(r.id))];
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
/* Live binding read by screens/notifications.js: true while the last server-notification fetch
   FAILED (network, not empty). Never persisted — it resets to false on the next good fetch. */
export let notifsFetchFailed = false;

/* A vision read is the longest call this app makes; past this it is not slow, it is gone. */
const ANALYSIS_TIMEOUT_MS = 45_000;

/**
 * An edge-function call that CANNOT hang.
 *
 * supabase-js's invoke() is a bare fetch with no deadline, and the meal outbox drains behind a
 * single `_draining` lock — so ONE request that never settles (a cold function, a campus captive
 * portal that accepts the socket and then answers nothing) froze the entire queue for the rest of
 * the session. The meal sat on "Reading your plate…" forever, and neither foregrounding the app
 * nor reconnecting could shake it loose, because both of those just call drainMealOutbox() and
 * that returned immediately at the lock. A deadline turns an unbounded wait into an ordinary
 * retryable failure, which the queue already knows how to handle.
 *
 * Racing rather than aborting: invoke() takes no AbortSignal, so the socket is abandoned rather
 * than cancelled. That costs one dangling request and buys back the queue — the right trade.
 *
 * Never throws. Returns the same `{ data, error }` shape invoke() does, so callers are unchanged.
 */
function invokeWithDeadline(name, body, ms = ANALYSIS_TIMEOUT_MS) {
  const sb = window.sb;
  if (!sb) return Promise.resolve({ data: null, error: { message: 'offline' } });
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), ms);
  });
  return Promise.race([sb.functions.invoke(name, { body }), deadline])
    .then((r) => { clearTimeout(timer); return r || { data: null, error: { message: 'empty' } }; })
    .catch((e) => { clearTimeout(timer); return { data: null, error: e || { message: 'error' } }; });
}

export const act = {
  /* Log a real meal into a real slot. One implementation for every meal (camera or search),
     any slot — not a hardcoded breakfast/dinner. Persists the AI plate (quality/foods/note)
     per slot so the meal-detail screen survives a reload. */
  logMeal(slotArg) {
    /* A PHOTO belongs to the slot it was taken for. nextOpenSlot() exists so a MANUAL "log
       something" lands on whatever slot is still open, but applying that redirect to a photo
       capture silently files breakfast's plate under lunch — and because everything below keys
       off `MEAL.key === slot`, the redirect also dropped the photo, skipped the `pending` marker,
       and stamped the meal `source:'manual'`, settling it at 0g with no read ever queued. That
       even suppressed the empty-read rescue link, which requires fromPhoto.
       So: a capture pins its own slot. If that slot is already logged the guard below refuses the
       double-log, which is honest — far better than inventing a zero-macro meal in a slot the
       athlete never photographed. */
    const captured = (MEAL.photoBase64 && MEAL.key) ? MEAL.key : null;
    const slot = captured || nextOpenSlot(slotArg) || slotArg || MEAL.key;
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
      ...(hasPhoto && MEAL.photoQ ? { photoQ: MEAL.photoQ } : {}),
    };
    const userNote = MEAL.key === slot ? MEAL.userNote : null;
    // A photo logged BEFORE the AI has read it. `pending` is display-only — every scoring path
    // reads protein/kcal/quality/flagged and nothing else, so this marker cannot move the score.
    // `pendingHash` is the anti-stale guard: the analysis result is only allowed to land on this
    // slot if it came from THIS photo (see applyAnalysisResult).
    const optimistic = hasPhoto && !MEAL.result;
    const meta = MEAL.result
      ? { quality: MEAL.result.quality, foods: MEAL.result.detected, note: MEAL.result.note, name: MEAL.result.name || MEAL.mealType,
          fiber: MEAL.result.fiber || 0, highlights: MEAL.result.highlights || [], detectedRich: MEAL.result.detectedRich || [],
          analysis: MEAL.result.analysis || '', ...(MEAL.result.styleApplied ? { styleApplied: MEAL.result.styleApplied } : {}), ...(userNote ? { userNote } : {}), ...integrity }
      : { name: MEAL.mealType || cap(slot), ...(userNote ? { userNote } : {}), ...integrity,
          ...(optimistic ? { pending: true, pendingHash: MEAL.photoHash || null } : {}) };
    const macros = loggingMacros();
    dayLogMeal(RT.userId, slot, macros, meta);
    const photoPath = hasPhoto ? `${RT.userId}/${DAY.date}/${slot}.jpg` : null;

    // OPTIMISTIC PATH (photo logged before the AI has read it). The athlete gets their day back
    // immediately; the remaining work — upload, insert, analyse — becomes ONE durable outbox job.
    // Scoring is honest by construction: a slot with no macros and no quality scores exactly like
    // a manually-logged meal already does (timing credit only; qualityFrac skips slots with no
    // numeric quality, so a missing signal never costs the athlete). Nothing in the score engine
    // changes — the macros simply arrive a few seconds later, exactly as a correction's do.
    if (meta.pending) {
      putJob({
        k: jobKey(RT.userId, DAY.date, slot),
        uid: RT.userId, date: DAY.date, slot,
        base64: MEAL.photoBase64, photoPath, photoHash: MEAL.photoHash || null,
        mealType: MEAL.mealType || cap(slot),
        capturedAtMin: MEAL.capturedAtMin != null ? MEAL.capturedAtMin : minutesNow(),
        userNote, macros, meta,
        needUpload: true, needInsert: true, needAnalysis: true,
        tries: 0, lastTryAt: 0,
      });
      void this.drainMealOutbox();
    } else {
      // The photo is proof; it must survive a bad connection. On a failed upload the bytes join
      // the durable outbox as an upload-only job (insert/analysis are handled right here), so the
      // same retry-with-backoff that guards the optimistic path guards this one. Fire-and-forget
      // is still the shape — logging never waits on the network.
      if (hasPhoto) {
        const b64 = MEAL.photoBase64;
        void uploadMealPhoto(RT.userId, slot, b64).then((ok) => {
          if (ok || !RT.userId) return;
          putJob({
            k: jobKey(RT.userId, DAY.date, slot),
            uid: RT.userId, date: DAY.date, slot,
            base64: b64, photoPath, photoHash: MEAL.photoHash || null,
            needUpload: true, needInsert: false, needAnalysis: false,
            tries: 1, lastTryAt: Date.now(),
          });
          this._scheduleDrain();
        });
      }
      // Insert a real `meals` row so a coach can review + comment; persist the id for the thread.
      // A { dup: true } return means the 0062 photo-hash wall caught a reused photo that slipped
      // past the pre-check: the slot stays logged (honest record) but is flagged so it never
      // scores, and the flag is visible to athlete + coach.
      insertMeal(RT.userId, slot, macros, meta, photoPath).then((res) => {
        if (res && res.dup) {
          DAY.slotMacros[slot] = { ...(DAY.slotMacros[slot] || {}), flagged: 'dup' };
          pushDay(RT.userId);
          track(EVENTS.MEAL_DUP_BLOCKED, { stage: 'insert' });
          window.__render && window.__render();
        } else if (res) {
          DAY.slotMacros[slot] = { ...(DAY.slotMacros[slot] || {}), mealId: res };
          pushDay(RT.userId);
          // Automatic coach visibility (upgrade 2026-07-16): every confirmed meal notifies the
          // coach staff, urgency by classification — fires exactly once, on the FRESH insert
          // (a dup never notifies; a retry can't reach here twice for the same slot).
          this._notifyCoachMealLogged(slot, meta);
          // Background macro enrichment (fire-and-forget): resolve the foods the curated table
          // couldn't ground against USDA/OFF so FUTURE meals ground on real data + seed the eval
          // corpus. Fires once on the fresh insert (never a dup); never touches THIS logged meal.
          this._enrichMeal(meta);
        }
      });
    }
    // Reflect the just-logged meal into every RT flag the UI reads. Beyond the legacy
    // dinnerLogged/day0Breakfast flags, this recomputes RT.day0 — Progress gates on it, so it
    // must clear the moment a real meal lands. logMeal used to hand-set only the two flags, so
    // RT.day0 went stale-true and Progress showed the day-0 empty state for the rest of the
    // session after the first log.
    // A one-tap re-log of a saved Food Memory item: count it (fire-and-forget — memory can
    // never block logging). Guarded on source so a stale memoryId from an abandoned stage can
    // never miscount a photo log.
    if (source === 'memory' && MEAL.memoryId) {
      void bumpFoodMemoryItem(MEAL.memoryId, MEAL.memoryTimes);
      invalidateFoodMemory();
    }
    syncRtFromDay();
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: cap(slot) };
    save();
    track(EVENTS.MEAL_LOGGED, { slot, source: hasPhoto ? 'photo' : source });
    if (source === 'gallery') {
      track(EVENTS.MEAL_GALLERY_LOGGED, { slot });
      const age = photoAgeMinutes(MEAL.takenAt, Date.now());
      if (age != null && age >= 60) track(EVENTS.MEAL_STALE_PHOTO, { slot });
    }
    this.syncNotifications();
  },
  /* ---------------------------------------------------------------------------------------
     THE BACKGROUND MEAL JOB — everything that used to happen while the athlete watched a spinner.
     One durable outbox entry per logged meal (upload → insert → analyse), drained on demand, on
     foreground, and on reconnect. Serialized: one drain at a time, so a foreground event landing
     mid-drain can never double-run a job.
     --------------------------------------------------------------------------------------- */
  _draining: false,
  _drainTimer: null,

  async drainMealOutbox() {
    if (this._draining || typeof window === 'undefined') return;
    this._draining = true;
    try {
      for (const job of dueJobs(readQueue(), Date.now())) {
        if (!job.uid || job.uid !== RT.userId) continue;   // another account's queue — leave it
        await this._runMealJob(job);
      }
    } catch { /* never let a queue error break the app */ }
    finally { this._draining = false; this._scheduleDrain(); }
  },

  /**
   * Wake the queue back up on our OWN clock.
   *
   * Every attempt after the first used to depend on an event from outside the app: the tab being
   * backgrounded and foregrounded, or the network dropping and coming back. An athlete who logs a
   * meal and then stands there watching "Reading your plate…" generates neither — so a read that
   * failed once simply never ran again, and the bubble span until they left the app and returned.
   * That is the whole "it was loading for minutes" report. This timer is the missing half of the
   * outbox: after every drain, look at what is still owed and set an alarm for when it comes due.
   *
   * Idempotent and self-cancelling — an empty queue clears the timer rather than ticking forever.
   */
  /** A quota-stripped job can never run again (runnable() is false forever), and nothing else
   *  wrote that fact onto the slot — so the thread said "Reading your plate…" for good while
   *  the queue held a tombstone. Stamp those slots with the honest failed state: recoverable
   *  (photo made it to storage → generic failure, retry chip works via the storage rescue) or
   *  not (bytes died before upload → 'photo_lost', no false retry). */
  _reconcileDeadJobs() {
    try {
      for (const e of readQueue()) {
        if (!e || !e.dead || e.uid !== RT.userId || e.date !== DAY.date || !e.slot) continue;
        const m = DAY.slotMacros[e.slot];
        if (m && m.pending && !m.analysisFailed) {
          this._patchSlot(e.slot, { analysisFailed: e.lostPhoto ? 'photo_lost' : 'error' });
          window.__render && window.__render();
        }
      }
    } catch { /* reconcile is best-effort; never let it break the drain loop */ }
  },

  _scheduleDrain() {
    if (typeof window === 'undefined') return;
    this._reconcileDeadJobs();
    if (this._drainTimer) { clearTimeout(this._drainTimer); this._drainTimer = null; }
    const now = Date.now();
    const waiting = readQueue().filter((e) => e && e.uid === RT.userId && !e.dead
      && (e.needUpload || e.needInsert || e.needAnalysis)
      // An entry parked on the athlete's clarifying answers is not owed anything until they reply.
      && !(e.needAnalysis && e.pendingQuestions && !e.answers));
    if (!waiting.length) return;
    const soonest = Math.min(...waiting.map((e) => Math.max(0, (e.lastTryAt || 0) + backoffMs(e.tries || 0) - now)));
    // Floor so a run that finishes instantly can't spin; ceiling so a long backoff still gets
    // checked periodically (a device that slept through its alarm re-arms on the next tick).
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      void this.drainMealOutbox();
    }, Math.max(600, Math.min(soonest, 60_000)));
  },

  /* ---------------------------------------------------------------------------------------
     THE SMALL-WRITES OUTBOX (sync-queue.js) — the writes AROUND the primary log that used to die
     silently offline: roll-call RPCs (idempotent server-side) and meals-row patches (the mirror
     of a correction). Same three beats as the meal outbox: foreground, reconnect, own clock.
     Also the day-push healer: pushDay needs no queue (day.js re-derives the whole row + score
     from live DAY at push time — replaying a stale serialized row could only fight the 0041
     ceiling), so healing is simply "push again NOW that we're back".
     --------------------------------------------------------------------------------------- */
  _sqDraining: false,
  _sqTimer: null,

  async drainSyncQueue() {
    if (this._sqDraining || typeof window === 'undefined') return;
    this._sqDraining = true;
    try {
      for (const job of SQ.due(SQ.readQueue(), Date.now())) {
        if (!job.uid || job.uid !== RT.userId) continue;   // another account's queue — leave it
        const ok = await this._runSyncJob(job);
        if (ok) SQ.removeJob(SQ.keyOf(job));
        else SQ.patchJob(SQ.keyOf(job), { tries: (job.tries || 0) + 1, lastTryAt: Date.now() });
      }
    } catch { /* never let a queue error break the app */ }
    finally { this._sqDraining = false; this._scheduleSyncDrain(); }
  },

  _scheduleSyncDrain() {
    if (typeof window === 'undefined') return;
    if (this._sqTimer) { clearTimeout(this._sqTimer); this._sqTimer = null; }
    const now = Date.now();
    const waiting = SQ.readQueue().filter((e) => e && e.uid === RT.userId && (e.tries || 0) < SQ.MAX_TRIES);
    if (!waiting.length) return;
    const soonest = Math.min(...waiting.map((e) => Math.max(0, (e.lastTryAt || 0) + SQ.backoffMs(e.tries || 0) - now)));
    this._sqTimer = setTimeout(() => {
      this._sqTimer = null;
      void this.drainSyncQueue();
    }, Math.max(600, Math.min(soonest, 60_000)));
  },

  async _runSyncJob(job) {
    const sbc = typeof window !== 'undefined' ? window.sb : null;
    if (!sbc) return false;
    try {
      if (job.kind === 'rpc') {
        // Same deadline discipline as the meal outbox: one hung request behind the drain's
        // serialization would freeze every queued write for the session.
        const res = await Promise.race([
          sbc.rpc(job.rpc, job.args || {}),
          new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 12_000)),
        ]);
        if (!res || !res.error) return true;
        // A server "no" is terminal, not retryable — burn the remaining tries so it leaves the
        // queue instead of replaying a refusal (the next real load reconciles the local patch).
        if (!SQ.retryable(res.error.message, false, typeof navigator !== 'undefined' && navigator.onLine === false)) {
          SQ.patchJob(SQ.keyOf(job), { tries: SQ.MAX_TRIES, lastTryAt: Date.now() });
        }
        return false;
      }
      if (job.kind === 'meal-update') {
        const res = await Promise.race([
          sbc.from('meals').update(job.fields || {}).eq('id', job.ref).eq('athlete_id', job.uid),
          new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 12_000)),
        ]);
        return !res || !res.error;
      }
      return true; // unknown kind: drop it rather than jam the queue forever
    } catch { return false; }
  },

  /* The day-push healer, called on the same beats. SYNC.last === 'error' is day.js's own honest
     record of "the last push did not land" — a fresh immediate push recomputes everything from
     live DAY, so this can never resurrect stale data. */
  healDaySync() {
    if (RT.userId && SYNC.last === 'error') void pushDay(RT.userId, true);
  },

  async _runMealJob(job) {
    const slot = job.slot;
    // Self-heal: the day row can be a beat behind the queue if the app died before pushDay
    // flushed. The outbox entry is the durable record, so restore the slot from it.
    if (job.date === DAY.date && !DAY.meals[slot] && job.meta) {
      dayLogMeal(job.uid, slot, job.macros || { protein: 0, kcal: 0, carbs: 0, fat: 0 }, job.meta);
      syncRtFromDay();
    }

    // THE PHOTO UPLOAD IS PROOF, NOT AN INPUT. analyze-meal is handed the base64 straight off the
    // capture, and the `meals` row only stores the object PATH — so nothing below this line waits
    // on the bytes. Awaiting it here nonetheless put a ~200KB cell-network upload in front of every
    // read, which on a stadium connection is most of the time the athlete spends staring at
    // "Reading your plate…". It now runs alongside and is reconciled at the end of the job.
    const upload = (job.needUpload && job.base64)
      // uploadMealPhoto reports honestly now (true = confirmed store). The old `.then(() => true)`
      // laundered every failure into success, which cleared needUpload and permanently lost the
      // photo on the first transient blip — the retry machinery below never got to run.
      ? uploadMealPhoto(job.uid, slot, job.base64).then((ok) => !!ok).catch(() => false)
      : Promise.resolve(null);
    const settleUpload = async () => {
      const ok = await upload;
      if (ok === null) return;   // nothing was owed
      if (ok) { updateJob(job.k, { needUpload: false }); invalidateMealPhoto(job.photoPath); return; }
      // A FAILED upload has to cost a try. Nothing used to increment here, which was harmless only
      // because the queue was woken by foreground/reconnect events; now that it re-arms its own
      // timer, an entry whose read has landed but whose photo keeps failing would come due
      // instantly, fail, and come due instantly again — a retry loop with no backoff in it.
      const cur = readQueue().find((e) => e.k === job.k);
      if (cur) updateJob(job.k, { tries: (cur.tries || 0) + 1, lastTryAt: Date.now() });
    };

    if (job.needInsert) {
      const res = await insertMeal(job.uid, slot, job.macros, job.meta, job.photoPath).catch(() => null);
      if (res && res.dup) {
        // The 0062 photo-hash wall caught a reused photo. The slot stays logged (honest record)
        // but never scores. Stop here — there is nothing worth spending a vision call on.
        this._patchSlot(slot, { flagged: 'dup' });
        track(EVENTS.MEAL_DUP_BLOCKED, { stage: 'insert' });
        // The slot stays logged as an honest record, so the photo behind it still belongs in
        // storage — let the upload finish before the entry that carries it is dropped.
        await settleUpload();
        removeJob(job.k);
        window.__render && window.__render();
        return;
      }
      if (res) {
        this._patchSlot(slot, { mealId: res });
        updateJob(job.k, { needInsert: false, mealId: res });
        job = { ...job, needInsert: false, mealId: res };
        this._notifyCoachMealLogged(slot, job.meta);
        this._enrichMeal(job.meta);
      } else {
        await settleUpload();   // don't make the retry re-send bytes that already landed
        updateJob(job.k, { tries: (job.tries || 0) + 1, lastTryAt: Date.now() });
        return; // no row yet — analysis can still run later, but retry the insert first
      }
    }

    if (job.needAnalysis && job.base64) await this._runAnalysisJob(job);
    await settleUpload();
    const left = readQueue().find((e) => e.k === job.k);
    if (left && !left.needUpload && !left.needInsert && !left.needAnalysis) removeJob(job.k);
  },

  /** Merge fields into a slot's persisted macros and flush the day. */
  _patchSlot(slot, patch) {
    DAY.slotMacros[slot] = { ...(DAY.slotMacros[slot] || {}), ...patch };
    pushDay(RT.userId);
  },

  /** The analysis request, built from the OUTBOX ENTRY rather than live MEAL state — a capture for
   *  another slot must never poison a queued job. */
  _jobAnalysisBody(job) {
    const timing = analysisTiming(job.capturedAtMin, slotDeadline(job.slot));
    const dp = S.mealDayProgress;
    const avoid = (RT.allergies || []).map((x) => String(x).split('·')[0].trim()).filter(Boolean).slice(0, 8);
    return {
      mode: 'meal', mealType: job.mealType || cap(job.slot), goal: RT.primaryGoal || null,
      photoBase64: job.base64, ...(timing ? { timing } : {}),
      // The thread this read belongs to. The meals row is inserted before the analysis runs, so
      // by the time a job is drained it has one — that is what lets the finished read be posted
      // into the athlete's conversation instead of being derived and forgotten.
      ...(job.mealId ? { mealId: job.mealId } : {}),
      // "Do not post the opener from this response — I will post it myself once I have grounded
      // the read" (act._postMealOpener). Without this the edge function composes the bubble from
      // the model's RAW estimate, which groundResult() is about to replace, and the thread ends up
      // quoting numbers the breakdown card never shows. Older builds omit the flag and keep the
      // inline bubble, so the rollout has no window where nobody gets a message.
      deferOpener: true,
      // The day BEFORE this plate (the engine sums scored slots, and this one is still pending) —
      // which is what the analysis prompt wants. The opener's day sentence uses `dayAfter` instead;
      // do not cross the two.
      dayContext: {
        proteinSoFar: Math.max(0, Math.min(500, dp.proteinSoFar)),
        proteinTarget: Math.max(0, Math.min(500, dp.proteinTarget)),
        mealsRemaining: Math.max(0, Math.min(8, dp.mealsRemaining)),
      },
      ...(avoid.length ? { avoid } : {}),
      ...(job.userNote ? { athleteNote: job.userNote } : {}),
      // Saved meals + usual orders (0192) — same bounded context the live path sends. Reads
      // the cache only (warmed at the dup pre-check); an unwarmed cache just means no memory.
      ...((() => {
        const fm = foodMemory(job.uid);
        const memory = fm ? memoryContextForAnalysis(fm.items, fm.places) : [];
        return memory.length ? { foodMemory: memory } : {};
      })()),
    };
  },

  async _runAnalysisJob(job) {
    const sb = window.sb;
    if (!sb) return;
    const fail = (reason) => {
      const tries = (job.tries || 0) + 1;
      // 'capacity' is definitive for today (the spend ceiling or a daily cap): retrying now only
      // burns requests against a wall that will not move until UTC midnight.
      const done = reason === 'capacity' || tries >= 3;
      updateJob(job.k, { tries, lastTryAt: Date.now(), ...(done ? { needAnalysis: false } : {}) });
      if (done) { this._patchSlot(job.slot, { analysisFailed: reason }); window.__render && window.__render(); }
      track(EVENTS.MEAL_ANALYSIS_FAILED, { reason });
    };
    try {
      const phase = job.answers ? 'finalize' : 'analyze';
      const body = { ...this._jobAnalysisBody(job), phase };
      if (phase === 'finalize') body.clarifications = buildClarifications(job.pendingQuestions || [], job.answers || []);
      const { data, error } = await invokeWithDeadline('analyze-meal', body);
      if (error) {
        const msg = String((error && error.message) || '');
        return fail(/429|capacity|limit/i.test(msg) ? 'capacity' : 'error');
      }
      if (data && data.kind === 'questions') {
        const qs = Array.isArray(data.questions) ? data.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3) : [];
        if (qs.length) {
          // The clarifying moment, in the thread instead of a blocking screen: the meal is already
          // logged, so the athlete can answer now, later, or never.
          updateJob(job.k, { pendingQuestions: qs, tries: 0, lastTryAt: 0 });
          this._patchSlot(job.slot, { pendingQuestions: qs });
          window.__render && window.__render();
          return;
        }
        return this._runAnalysisJob({ ...job, answers: [] }); // asked but sent nothing usable
      }
      if (data && data.kind === 'result') {
        MEAL.result = groundResult(data);
        // An empty read is not a result. Landing one clears `pending` and leaves the athlete with
        // a permanently ~0g meal, so treat it exactly like a failed call: retry, then offer
        // "Read it again". (An older deploy can still return one; the server now 502s instead.)
        if (!isCompleteMealResult(MEAL.result)) { MEAL.result = null; return fail('unreadable'); }
        await this._maybeVerify();                       // same client + server verify budget
        this.applyAnalysisResult(job.slot, MEAL.result, job.photoHash);
        updateJob(job.k, { needAnalysis: false, pendingQuestions: null });
        return;
      }
      return fail('unreadable');
    } catch { return fail('error'); }
  },

  /**
   * Land a finished analysis onto an already-logged slot.
   *
   * Deliberately NOT correctMeal-shaped: this is the AI's first read arriving late, not the
   * athlete disagreeing with it, so it must never write `meta.orig` or append to
   * `meta.corrections` — that audit trail belongs to real corrections only.
   *
   * Three guards, all required:
   *   1. the slot must still be pending (never overwrite a settled meal),
   *   2. the result must come from THIS photo (kills the offline-relog / stale-photo race),
   *   3. never land on a slot the athlete has already corrected,
   *   4. and the read must actually carry numbers — an empty one would settle the slot at ~0g
   *      forever, which no correction can undo.
   */
  applyAnalysisResult(slot, r, photoHash) {
    const cur = DAY.slotMacros[slot] || {};
    if (!cur.pending) return false;
    if (photoHash && cur.pendingHash && photoHash !== cur.pendingHash) return false;
    if (cur.orig || (Array.isArray(cur.corrections) && cur.corrections.length)) return false;
    if (!r) return false;
    if (!isCompleteMealResult(r)) return false;

    const from = computeScore(componentsNow());
    const { pending, pendingHash, pendingQuestions, analysisFailed, ...keep } = cur;
    DAY.slotMacros[slot] = {
      ...keep,
      protein: r.protein || 0, kcal: r.kcal || 0, carbs: r.carbs || 0, fat: r.fat || 0,
      quality: r.quality, foods: r.detected, note: r.note,
      name: r.name || keep.name, fiber: r.fiber || 0,
      highlights: r.highlights || [], detectedRich: r.detectedRich || [],
      analysis: r.analysis || '', ...(r.styleApplied ? { styleApplied: r.styleApplied } : {}),
    };
    pushDay(RT.userId);
    syncRtFromDay();
    const to = computeScore(componentsNow());
    if (to > from) RT.lastMove = { from, to, gain: to - from, what: cap(slot) };
    save();

    // Bring the server row up to date with what the coach should see. No longer fire-and-forget:
    // a failure lands in the small-writes outbox, because a mirror that silently diverges is a
    // coach reading different numbers than the athlete — the exact bug class the grounded-card
    // work exists to prevent.
    const mealId = DAY.slotMacros[slot].mealId;
    if (mealId && window.sb) {
      const fields = {
        protein: r.protein || 0, carbs: r.carbs || 0, fat: r.fat || 0, kcal: r.kcal || 0,
        quality: r.quality, note: r.note || null,
      };
      try {
        window.sb.from('meals').update(fields).eq('id', mealId).eq('athlete_id', RT.userId)
          .then((res) => {
            if (res && res.error && RT.userId) {
              SQ.putJob({ uid: RT.userId, kind: 'meal-update', ref: mealId, fields, queuedAt: Date.now() });
              this._scheduleSyncDrain();
            }
          }, () => {
            if (RT.userId) {
              SQ.putJob({ uid: RT.userId, kind: 'meal-update', ref: mealId, fields, queuedAt: Date.now() });
              this._scheduleSyncDrain();
            }
          });
      } catch { /* the day row is the athlete's source of truth; the queue owns the mirror now */ }
    }
    track(EVENTS.MEAL_ANALYSIS_APPLIED, { slot });
    // Now — and only now — say it in the thread. The bubble is composed from the object written
    // just above, which is the one the breakdown card renders.
    void this._postMealOpener(slot, r);
    this.clearMeal();
    window.__render && window.__render();
    return true;
  },

  /**
   * Post the AI nutritionist's opening message, from the GROUNDED read.
   *
   * WHY THE CLIENT DRIVES THIS. analyze-meal used to compose and insert this bubble itself, inline
   * with the analysis — but the only numbers it has at that moment are the model's raw estimate,
   * and groundResult() then re-derives every macro against the food DB and recomputes the score.
   * The thread told the athlete 23g of protein while the card in front of them read 29g, and the
   * paragraph credited protein the card had just called low. The Meal Breakdown is the single
   * source of truth, so the message has to be built from it, and the client is what holds it.
   *
   * The insert still happens server-side under the service role: clients may never write role='ai'
   * (0046), and that boundary is the only reason an AI bubble can be trusted. Mode 'opener' makes
   * no model call, so this costs nothing and is exempt from every spend ceiling.
   *
   * Day numbers are read AFTER the landing above, so `proteinSoFar` now includes this plate — which
   * is exactly what the sentence needs to say and what the field name on the wire promises.
   *
   * Every failure is silent by design. The athlete already has their macros on screen; a missing
   * bubble is a quieter thread, not a broken log. postOpener is idempotent, so a retry is safe.
   */
  async _postMealOpener(slot, r) {
    try {
      const meta = DAY.slotMacros[slot] || {};
      const mealId = meta.mealId;
      if (!window.sb || !mealId || !RT.userId || !r) return;
      const loggedAt = DAY.mealLoggedAt ? DAY.mealLoggedAt[slot] : null;
      const timing = analysisTiming(loggedAt != null ? loggedAt : minutesNow(), slotDeadline(slot));
      const dp = S.mealDayProgress;
      // Real history for the opener ("3 of your last 4 dinners…") — same shared cache the meal
      // screen warms, computed with the same mealPatterns the fallback bubble uses. Best-effort:
      // an empty cache (first log of the session before the screen warmed it) just means no
      // pattern lines, never a blocked opener. Dynamic imports keep state.js cycle-free.
      let patterns = [];
      try {
        const [rm, roles, intel] = await Promise.all([
          import('./recent-meals.js'), import('./roles.js'), import('./meal-intel.js'),
        ]);
        const rows = (await rm.warmRecent(roles, RT.userId)) || [];
        patterns = intel.mealPatterns(rows, {
          slot,
          mealProteinBar: dp.proteinTarget > 0 ? Math.round(dp.proteinTarget / 4) : 0,
        }).slice(0, 2);
      } catch { /* no history, no pattern lines */ }
      // 15s, not 45s: mode 'opener' makes no model call at all — it composes from the read it is
      // handed and inserts one row. Anything past a cold start here is a network that has gone,
      // and the athlete already has their numbers, so there is nothing to wait around for.
      await invokeWithDeadline('analyze-meal', {
        mode: 'opener',
        mealId,
        mealType: slotTitle(slot),
        goal: RT.primaryGoal || null,
        // The finished read, exactly as the breakdown renders it. Nothing here is re-estimated.
        read: {
          name: r.name, quality: r.quality,
          protein: r.protein, kcal: r.kcal, carbs: r.carbs, fat: r.fat, fiber: r.fiber,
          detected: r.detectedRich || [],
          note: r.note, analysis: r.analysis, highlights: r.highlights || [],
        },
        ...(timing ? { timing } : {}),
        dayAfter: {
          proteinIncludingThisMeal: Math.max(0, Math.min(500, dp.proteinSoFar)),
          proteinTarget: Math.max(0, Math.min(500, dp.proteinTarget)),
          mealsRemaining: Math.max(0, Math.min(8, dp.mealsRemaining)),
        },
        ...(patterns.length ? { patterns } : {}),
      }, 15_000);
      window.__render && window.__render();
    } catch { /* a quieter thread, not a broken log */ }
  },

  /** Athlete answered the clarifying questions from inside the thread. */
  answerPendingQuestions(slot, answers) {
    const job = readQueue().find((e) => e.slot === slot && e.uid === RT.userId && e.date === DAY.date);
    if (!job) return;
    updateJob(job.k, { answers: answers || [], tries: 0, lastTryAt: 0 });
    this._patchSlot(slot, { pendingQuestions: null });
    window.__render && window.__render();
    void this.drainMealOutbox();
  },
  skipPendingQuestions(slot) { this.answerPendingQuestions(slot, []); },

  /** Manual retry after a terminal analysis failure. Always answers: local bytes when the
   *  queue still has them, otherwise the same storage rescue rereadMeal uses (the photo budget
   *  keeps only the two newest captures locally, but the upload usually made it). The old
   *  version returned silently when the bytes were gone, which made the "Read it again" chip
   *  a dead button for exactly the meals most likely to need it. */
  async retryAnalysis(slot) {
    const job = readQueue().find((e) => e.slot === slot && e.uid === RT.userId && e.date === DAY.date);
    if (job && job.base64) {
      updateJob(job.k, { needAnalysis: true, tries: 0, lastTryAt: 0 });
      this._patchSlot(slot, { analysisFailed: null, rereadError: null });
      window.__render && window.__render();
      void this.drainMealOutbox();
      return true;
    }
    return this.rereadMeal(slot);
  },

  /**
   * Rescue a meal that SETTLED at zero.
   *
   * Different problem from retryAnalysis, which recovers a read that openly failed. These meals
   * look finished — the slot is settled, the screen says "high confidence" — and every macro is 0,
   * because an older deploy accepted a truncated report. Nothing else can save them: a correction
   * scales the stored numbers, and every scale of zero is zero.
   *
   * So this puts the slot back into `pending` and re-queues the read. Clearing `orig`/`corrections`
   * is deliberate and safe: both describe adjustments made TO zeros, which is no information at
   * all, and leaving them set would make applyAnalysisResult refuse to land the new read (guard 3).
   */
  async rereadMeal(slot) {
    const cur = DAY.slotMacros[slot];
    if (!cur || !DAY.meals[slot]) return false;
    const job = readQueue().find((e) => e.slot === slot && e.uid === RT.userId && e.date === DAY.date);
    track(EVENTS.MEAL_REREAD, { slot, source: job && job.base64 ? 'queued' : 'storage' });

    const restage = (photoHash) => {
      // Drop the settled numbers and the dead audit trail; put the slot back in the pending state
      // the thread already knows how to render ("Reading the plate").
      const { orig, corrections, analysisFailed, rereadError, ...keep } = cur;
      DAY.slotMacros[slot] = { ...keep, pending: true, pendingHash: photoHash || null, protein: 0, kcal: 0, carbs: 0, fat: 0, fiber: 0 };
      pushDay(RT.userId);
      window.__render && window.__render();
    };

    if (job && job.base64) {
      restage(job.photoHash);
      updateJob(job.k, { needAnalysis: true, tries: 0, lastTryAt: 0, analysisFailed: null });
      void this.drainMealOutbox();
      return true;
    }

    // The queue only carries the two most recent photos (MAX_PHOTOS), so an older meal has to come
    // back from storage. Fetch the uploaded object, re-encode it, and queue a fresh job.
    try {
      const path = todayMealPhotoPath(RT.userId, DAY.date, slot);
      const url = path && await resolveMealPhoto(path);
      if (!url) { this._patchSlot(slot, { rereadError: 'photo' }); window.__render && window.__render(); return false; }
      const blob = await (await fetch(url)).blob();
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
        fr.onerror = () => rej(new Error('read failed'));
        fr.readAsDataURL(blob);
      });
      if (!base64) throw new Error('empty photo');
      let photoHash = null;
      try { photoHash = await sha256Hex(base64ToBytes(base64)); } catch { /* no WebCrypto — hash guard simply won't apply */ }
      restage(photoHash);
      putJob({
        k: jobKey(RT.userId, DAY.date, slot), uid: RT.userId, date: DAY.date, slot,
        mealType: cur.name || cap(slot), mealId: cur.mealId || null,
        base64, photoHash, uploaded: true, needAnalysis: true, tries: 0, lastTryAt: 0,
      });
      void this.drainMealOutbox();
      return true;
    } catch {
      // Nothing was changed — say so honestly rather than leaving the slot mid-restage.
      this._patchSlot(slot, { rereadError: 'photo' });
      window.__render && window.__render();
      return false;
    }
  },

  /* ---------------------------------------------------------------------------------------
     MEMORY. Turn corrections into durable facts about this athlete (0019, live on prod and — until
     now — read by nothing). Safety kinds land as `pending_confirmation` and only bind when the
     athlete confirms them in the thread; nothing inferred can put a word in the model's mouth.
     --------------------------------------------------------------------------------------- */

  /** At most this many fact writes per day, so a correction spree can't flood the table. */
  _memoryBudgetLeft() {
    const today = new Date().toISOString().slice(0, 10);
    if (RT.memDay !== today) return 5;
    return Math.max(0, 5 - (Number(RT.memUsed) || 0));
  },
  _memoryBudgetSpend() {
    const today = new Date().toISOString().slice(0, 10);
    if (RT.memDay !== today) { RT.memDay = today; RT.memUsed = 0; }
    RT.memUsed = (Number(RT.memUsed) || 0) + 1;
    save();
  },

  async _writeMemoryCandidates(cands) {
    if (!RT.userId || !window.sb || !cands || !cands.length) return;
    const existing = await fetchMyMemoryFacts(RT.userId).catch(() => null);
    // null = the dedupe read FAILED. Writing without it creates duplicate facts (the exact
    // thing the `prior` lookup below exists to prevent) — skip this round; candidates recur.
    if (existing === null) return;
    for (const c of cands) {
      if (!c || !c.value) continue;
      if (this._memoryBudgetLeft() <= 0) return;
      const prior = existing.find((e) => sameFact(e, c));
      const ok = await upsertMemoryFact(RT.userId, c, prior).catch(() => false);
      if (ok) this._memoryBudgetSpend();
    }
  },

  /** Pending facts awaiting the athlete's yes/no. Cached per render pass by the thread. */
  async pendingMemoryFacts() {
    if (!RT.userId || !window.sb) return [];
    const all = (await fetchMyMemoryFacts(RT.userId).catch(() => null)) || [];
    return all.filter((f) => f && f.status === 'pending_confirmation');
  },

  /** The confirmation itself — the ONLY thing that lets an inferred safety fact reach a prompt. */
  async confirmMemoryFact(id, keep) {
    if (!RT.userId) return false;
    const ok = await setMemoryFactStatus(RT.userId, id, keep ? 'active' : 'rejected').catch(() => false);
    if (ok) { track(EVENTS.MEMORY_FACT_CONFIRMED, { keep: !!keep }); window.__render && window.__render(); }
    return ok;
  },

  async _learnFromCorrection(correction) {
    try {
      const kind = correction && correction.kind;
      const value = correction && correction.value;
      await this._writeMemoryCandidates(factsFromCorrection(kind, value));
    } catch { /* never break a correction on memory */ }
  },

  /** Food-level edits made on the review screen, harvested once at log time (not per keystroke). */
  async _learnFromFoodEdits(result) {
    try {
      if (!result || !result.detectedRich) return;
      const after = result.detectedRich;
      const before = Array.isArray(result.origDetected) ? result.origDetected : null;
      if (!before) return;
      await this._writeMemoryCandidates(candidateFactsFromFoodChange(before, after));
    } catch { /* best-effort */ }
  },

  /* Post-log macro enrichment (background, fire-and-forget). Resolves the foods the curated table
     couldn't ground (gapFoods) against USDA/OFF via the enrich-meal function, so the NEXT time this
     population logs the same branded/restaurant food it grounds on real data — and seeds the
     de-identified eval corpus. Forward-only: it NEVER re-touches this logged meal or its score
     (post-log immutability; a silent retroactive score change is a trust break). De-identified —
     only food names + the AI's per-food macros leave the device. Best-effort; failure is silent. */
  _enrichMeal(meta) {
    try {
      const sb = window.sb;
      if (!sb || !sb.functions) return;
      const foods = gapFoods((meta && meta.detectedRich) || []);
      // Label-read packaged products warm the server's product cache (source 'product'): the
      // next photo of this exact product resolves from a READ claim even when its label is
      // turned away. Same de-identification bar as gap foods — brand/product/macros only.
      const products = labelProducts((meta && meta.detectedRich) || []);
      if (!foods.length && !products.length) return;
      void sb.functions.invoke('enrich-meal', {
        body: { foods, ...(products.length ? { products } : {}) },
      }).then(() => {}, () => {});
    } catch { /* enrichment is best-effort — it must never affect the logged meal */ }
  },
  /** Classified coach notification for a fresh meal insert (never for dups/retries).
   *  'logged' = quiet in-app record; 'review'/'action' also push. Copy per spec:
   *  normal → "Marcus logged Lunch · On time · Meal score 84"; flagged → "needs review". */
  _notifyCoachMealLogged(slot, meta) {
    try {
      if (!this._coachConnected()) return;
      const m = meta || {};
      const hits = restrictionConflicts(m.foods || [], RT.restrictions || null);
      const { cls, reasons } = classifyMealEvent({
        quality: m.quality, detected: m.detectedRich, source: m.source,
        restrictionHits: hits, minutesLate: m.minutesLate,
      });
      const first = (S.athlete.first || 'Your athlete');
      const title = cls === 'action' ? `${first}'s ${slotTitle(slot)} needs review`
        : cls === 'review' ? `${first}'s ${slotTitle(slot)} is worth a look`
        : `${first} logged ${slotTitle(slot)}`;
      const timing = m.minutesLate > 0 ? `${Math.round(m.minutesLate)} min late` : 'On time';
      const body = cls === 'logged'
        ? `${timing}${m.quality != null ? ` · Meal score ${m.quality}` : ''} · Tap to review the meal and join the conversation.`
        : `${reasons[0] ? reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1) : 'Worth a look'} · ${timing}${m.quality != null ? ` · Meal score ${m.quality}` : ''} · Tap to open the conversation.`;
      // The meal id rides the kind as a suffix (`meal_review:<id>`) so the coach's BELL row
      // deep-links to the meal, not just the push payload — a coach who dismissed the push
      // used to have no way back to the meal from the bell.
      const mealId = DAY.slotMacros[slot] && DAY.slotMacros[slot].mealId;
      const baseKind = cls === 'action' ? 'meal_action' : cls === 'review' ? 'meal_review' : 'meal_logged';
      void notifyMyCoach({
        kind: mealId ? `${baseKind}:${mealId}` : baseKind,
        title, body, urgent: cls === 'action',
        route: mealId ? `coach-meal/${mealId}` : undefined,
      });
    } catch { /* notification is best-effort — the log itself already landed */ }
  },
  _coachConnected() { return !!(RT.myCoach && RT.myCoach.teamId); },

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
  /* Set the athlete's plan style (0142). ALWAYS records their stated preference — that is theirs
     and it reaches their professional's roster either way. The effective style only moves when
     nobody else governs it; the server (set_my_plan_style) is the authority on that, and it
     returns the style that actually applies, so a governed athlete's optimistic paint is
     corrected by the real answer rather than left showing a switch that didn't happen. */
  async setPlanStyle(style) {
    const key = String(style || '');
    const p = RT.profile || (RT.profile = {});
    const prev = { planStyle: p.planStyle, preference: p.planStylePreference };
    p.planStylePreference = key;
    if (S.planStyle.canChoose) p.planStyle = key;   // `planStyle` is an S getter, not an act method
    applyPlanStyleToDay();
    save();
    track(EVENTS.PLAN_STYLE_SET, { style: key, owned: !!S.planStyle.canChoose });
    const sb = window.sb;
    if (!sb || !RT.userId) return true;                  // offline: the local choice stands and re-syncs
    try {
      const { data, error } = await sb.rpc('set_my_plan_style', { p_style: key, p_preference: key });
      if (error) {
        // The server said no (validation, RLS, outage). An optimistic paint left standing here
        // is a switch the athlete believes happened and the server never recorded: revert.
        p.planStyle = prev.planStyle;
        p.planStylePreference = prev.preference;
        applyPlanStyleToDay();
        save();
        window.__render && window.__render();
        return false;
      }
      if (data) {
        // The server's word, not ours: a governed athlete gets their standard back here. Their
        // own stored choice is left alone — it is what they fall back to if they ever leave the
        // team, not something a preference tap should destroy.
        if (S.planStyle.canChoose) p.planStyle = data;
        applyPlanStyleToDay();
        save();
        window.__render && window.__render();
      }
      return true;
    } catch { return true; /* offline — the local preference is kept and pushed on the next hydrate */ }
  },

  /* One-time "plan styles exist now" announcement (0142 release mechanics) — dismissed once,
     locally, and never shown again regardless of which button ended it (exploring the picker
     counts as having seen it too). Local-only like RT.theme/RT.notifsRead: this is a UI nag
     flag, not athlete data, so it doesn't need a server round trip or a fresh-device carry. */
  dismissPlanStylePrompt() { RT.planStylePromptSeen = true; save(); },
  // 50–500 lb rail: a typed-entry typo (8.4, 1834) must not mark the day logged or poison the
  // season trend. The weigh-in screen surfaces the same bounds before this is ever reached.
  logWeight(lb) { const v = parseFloat(lb); if (!isFinite(v) || v < 50 || v > 500) return; RT.weightLogged = true; RT.weightLoggedAt = minutesNow(); dayLogWeight(RT.userId, v); save(); track(EVENTS.WEIGHT_LOGGED); this.syncNotifications(); },
  readNotifs() {
    RT.notifsRead = true;
    // The ack expires with the day it acked. notifsRead alone was a one-way latch: after one
    // bell visit, "Lunch is overdue" / "your streak ends tonight" never raised the badge again
    // on this device, ever — the derived rows regenerate daily but the flag never did.
    RT.notifsReadDay = String(DAY.date);
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
    // null = the fetch FAILED. Diffing it in would overwrite AND PERSIST the cached feed as
    // empty — a coach escalation silently erased. Keep last-known and let the next tick retry.
    // The live-binding flag lets the bell screen say "couldn't check" instead of "all caught up"
    // when there is no cached feed to fall back on.
    notifsFetchFailed = rows === null;
    if (rows === null) { NOTIF_FETCH_AT = 0; return false; }
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
    // OPERATOR devices (coach AND trainer) schedule the roster-derived operator plan, NOT the
    // generic athlete meal reminders. A trainer used to fall through to the athlete path, which
    // meant their own phone scheduled "log your breakfast" reminders for a person who logs
    // nothing — the plan is built from entriesFor(), which is role-agnostic.
    if (RT.authRole === 'coach' || RT.authRole === 'trainer') { this._syncCoachNotifications(); return; }
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
  /* Coach-device notification sync (Task 5). Reached only from syncNotifications() when
     RT.authRole === 'coach'. Builds the plan from the coach's LIVE roster status (entriesFor)
     instead of the athlete meal catalog, then posts it over the SAME native bridge the athlete
     plan uses (deterministic cn-* ids so RT._lastPlan / samePlan() dedupe works identically).
     Coach data not loaded yet (entriesFor → null) → post NOTHING and leave _lastPlan unset so the
     next trigger (loadCoachRoster completion) retries — never wipes the still-scheduled plan from
     an earlier open (which carries its own tomorrow-briefing bridge). Best-effort. */
  _syncCoachNotifications() {
    try {
      const prefs = normalizeCoachPrefs(RT.coachNotifPrefs);
      // myRoomOnly → the coach's saved scope (defaults to their position room); else the whole team.
      const scope = prefs.myRoomOnly ? getScope() : { kind: 'team', value: null };
      const entries = entriesFor(scope);
      const plan = buildCoachSyncPlan({
        entries,
        interventions: (CD.extras && CD.extras.interventions) || [],
        prefs, nowMin: minutesNow(), dateISO: todayISO(),
        lastAlertKeys: RT._lastCoachAlertKeys || [],
        noun: RT.authRole === 'trainer' ? 'client' : 'athlete', // a trainer's pushes say "clients"
      });
      if (plan == null) return; // coach data still loading — post nothing, retry on the next trigger
      const [y, mo, d] = String(DAY.date).split('-').map(Number);
      // Dedupe by DAY too, exactly like the athlete path (a date-blind equality check would skip a
      // new day's post). alertKeys is persisted from the SAME entries snapshot the plan was built
      // from, keeping the immediate-critical NEW-key diff honest across syncs.
      const last = RT._lastPlan;
      if (last && last.date === String(DAY.date) && samePlan(plan, last.plan)) {
        RT._lastCoachAlertKeys = alertKeys(entries); save(); return;
      }
      const N = window.OnStandardNative;
      if (!N || !N.notify) return; // bridge not injected yet — retry on the next trigger (no key/plan advance)
      N.notify.sync(plan.map((p) => ({
        id: p.id,
        atISO: p.immediate ? null : new Date(y, mo - 1, d + (p.dayOffset || 0), Math.floor(p.fireAtMin / 60), p.fireAtMin % 60).toISOString(),
        title: p.title, body: p.body,
        route: p.route || null,
      })));
      RT._lastCoachAlertKeys = alertKeys(entries);
      RT._lastPlan = { date: String(DAY.date), plan }; save(); // recorded only once the post was handed to native
    } catch { /* delivery failed — leave _lastPlan unset so the next trigger retries */ }
  },
  /* Update COACH reminder prefs and resync (mirrors setNotifPrefs). The master switch is also
     written server-side (profiles.notifications_opt_out) — the SAME single opt-out column athletes
     use: one person, one opt-out, so a coach turning reminders off here also suppresses automated
     pushes for that account. Best-effort. */
  setCoachNotifPrefs(patch) {
    RT.coachNotifPrefs = { ...normalizeCoachPrefs(RT.coachNotifPrefs), ...(patch || {}) };
    save();
    this.syncNotifications();
    if (patch && 'enabled' in patch && window.sb && RT.userId) {
      try {
        void window.sb.from('profiles')
          .update({ notifications_opt_out: !RT.coachNotifPrefs.enabled })
          .eq('id', RT.userId);
      } catch { /* server pref is best-effort; local prefs already applied */ }
    }
  },
  /* First-run coach checklist (coach Home). Mark a setup step genuinely complete the moment the
     coach actually does it — the checklist then reads a real signal instead of a hardcoded
     "done". Persisted with RT and reset per-account by _wipeUserScopedState, so a new coach on
     the same device never inherits another coach's progress. Idempotent + best-effort. */
  markCoachSetup(key) {
    if (!key) return;
    if (!RT.coachSetup || typeof RT.coachSetup !== 'object') RT.coachSetup = {};
    if (RT.coachSetup[key]) return;
    RT.coachSetup[key] = true;
    save();
    // Best-effort server sync (0092 team arm, 0197 practice arm). Local RT stays the fast path; a
    // missing table (migration not applied yet) or offline just no-ops. onConflict keeps it
    // idempotent per (book, step). The practice arm is what makes a TRAINER's checklist durable —
    // this write used to be team-gated, so trainer progress never left the device (founder,
    // 2026-08-10).
    try {
      if (window.sb && RT.team && RT.team.id) {
        void window.sb.from('coach_setup_state').upsert(
          { team_id: RT.team.id, step: key, state: 'completed', updated_by: RT.userId || null, updated_at: new Date().toISOString() },
          { onConflict: 'team_id,step' });
      } else if (window.sb && RT.practice && RT.practice.id) {
        void window.sb.from('practice_setup_state').upsert(
          { practice_id: RT.practice.id, step: key, state: 'completed', updated_by: RT.userId || null, updated_at: new Date().toISOString() },
          { onConflict: 'practice_id,step' });
      }
    } catch { /* best-effort */ }
  },
  /* Coach Voice config (tone/accountability/approved phrases/prohibited words). Persisted with RT;
     the AI edge function reads it to reinforce the coach's standards in their tone once wired. */
  setCoachVoice(patch) {
    RT.coachVoice = { ...(RT.coachVoice || {}), ...(patch || {}) };
    save();
    // Best-effort server sync — local RT stays the fast path; a missing table or offline no-ops.
    // A coach's config lands on their team row (0094); a trainer's on their practice row (0187) —
    // before 0187 a trainer's edits saved locally and the server never heard about them, so the
    // AI Nutritionist page silently did nothing for a practice.
    try {
      const payload = { enabled: RT.coachVoice.enabled !== false, config: RT.coachVoice, updated_by: RT.userId || null, updated_at: new Date().toISOString() };
      if (window.sb && RT.team && RT.team.id) {
        void window.sb.from('coach_voice_config').upsert(
          { team_id: RT.team.id, ...payload }, { onConflict: 'team_id' });
      } else if (window.sb && RT.practice && RT.practice.id) {
        void window.sb.from('practice_voice_config').upsert(
          { practice_id: RT.practice.id, ...payload }, { onConflict: 'practice_id' });
      }
    } catch { /* best-effort */ }
  },
  /* Trust Pass policy (0196): per-book defaults the grant RPC reads (default_credits,
     default_window_days, eligibility_days, max_credits). Dual-owner like every 0136 table — a
     practice writes practice_id, a team writes team_id, never both, and the unique index is keyed
     on coalesce(team_id, practice_id) so two policies for one practice can never coexist. Local RT
     is the fast path for the editor; best-effort server upsert (staff RLS) — a missing table or
     offline no-ops. Values are clamped to the table's own bounds so the DB check can never reject
     them.

     The two credit fields also have to agree with EACH OTHER, which the table cannot express:
     0196's check constraints bound each to 1..14 independently, so `default_credits 10` next to
     `max_credits 3` is a perfectly legal row that no longer means anything. grant_pass refuses any
     pass over max, so the book's own default would be refused by the book's own ceiling — and
     pass-grant.js seeds the sheet from default_credits while resolveArgs() clamps to max_credits,
     which renders "10 camera-free meals / Max 3 per grant" and then quietly grants 3. Keep the
     ceiling authoritative: max is clamped to the table bounds first, then default is clamped to
     max. Lowering the ceiling pulls the default down with it, which is what "no grant on my book
     exceeds 3" plainly means. */
  setTrustPolicy(patch) {
    const cur = RT.passPolicy || { default_credits: 3, default_window_days: 2, eligibility_days: 7, max_credits: 5 };
    const clamp = (n, lo, hi, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const maxCredits = clamp(patch.max_credits != null ? patch.max_credits : cur.max_credits, 1, 14, 5);
    const next = {
      default_credits:     clamp(patch.default_credits     != null ? patch.default_credits     : cur.default_credits,     1, maxCredits, Math.min(3, maxCredits)),
      default_window_days: clamp(patch.default_window_days != null ? patch.default_window_days : cur.default_window_days, 1, 14, 2),
      eligibility_days:    clamp(patch.eligibility_days     != null ? patch.eligibility_days     : cur.eligibility_days,    1, 30, 7),
      max_credits:         maxCredits,
    };
    RT.passPolicy = next;
    save();
    try {
      const owner = RT.team && RT.team.id ? { team_id: RT.team.id }
        : RT.practice && RT.practice.id ? { practice_id: RT.practice.id }
        : null;
      if (window.sb && owner) {
        // 0196's unique index is on coalesce(team_id, practice_id), one column across both books
        // rather than two separate constraints — onConflict must name that exact expression, not
        // either bare column, or Postgres reports no matching arbiter index.
        void window.sb.from('trust_pass_policy').upsert(
          { ...owner, ...next, updated_by: RT.userId || null, updated_at: new Date().toISOString() },
          { onConflict: 'coalesce(team_id,practice_id)' });
      }
    } catch { /* best-effort */ }
  },
  /* Team weekly training/rest pattern (0100): set one weekday's type and persist. `dow` is 0=Sun..
     6=Sat (JS getDay()). Local RT drives the editor + the athlete's day-type resolution; best-effort
     staff upsert. Seeds an all-training week the first time a coach touches it. */
  setWeekPattern(dow, type) {
    if (dow < 0 || dow > 6) return;
    const t = (type === 'rest' || type === 'training') ? type : 'training';
    const next = Array.isArray(RT.weekPattern) && RT.weekPattern.length === 7
      ? RT.weekPattern.slice()
      : ['training', 'training', 'training', 'training', 'training', 'training', 'training'];
    next[dow] = t;
    RT.weekPattern = next;
    save();
    try {
      if (window.sb && RT.team && RT.team.id) {
        void window.sb.from('team_week_pattern').upsert(
          { team_id: RT.team.id, pattern: next, updated_by: RT.userId || null, updated_at: new Date().toISOString() },
          { onConflict: 'team_id' });
      }
    } catch { /* best-effort */ }
  },
  /* Cache the resolved Coach Voice nudge (0094 consumer) keyed by the slipping-state signature, so
     the model is asked at most once per distinct state per day. A null text (Voice off / no nudge)
     is cached too, to suppress repeat calls. Persisted with RT. */
  setVoiceNudge(sig, text) {
    RT.voiceNudge = { sig, text: text || null };
    save();
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
        // Any notification plan computed BEFORE this token landed included the local
        // commitment-reminder fallback (the PUSH_TOKEN_VALUE gate read null at the time) —
        // and the server path will now also fire. Re-sync once so the local duplicates are
        // cancelled and a 4:45 AM roll call rings once, not twice.
        try { this.syncNotifications(); } catch { /* best-effort */ }
      }
    } catch { /* best-effort — permission denied / no EAS project / offline */ }
  },
  setCommitment(ans) { daySetCommitment(RT.userId, ans); save(); track(EVENTS.COMMITMENT_SET, { answer: ans }); this.syncNotifications(); },
  saveDayFocus(text) { daySetFocus(RT.userId, (text || '').trim().slice(0, 80) || null); },

  /* ---- Phase 5: real meal capture → AI → real macros ---- */
  captureMeal(base64, dataUrl, slot, live = true, extra) {
    MEAL.photoBase64 = base64; MEAL.photoDataUrl = dataUrl; MEAL.result = null;
    MEAL.live = live !== false;
    MEAL.source = MEAL.live ? 'live' : 'gallery';
    MEAL.capturedAtMin = minutesNow();
    MEAL.takenAt = (extra && extra.takenAt) || null; // EXIF time of a gallery pick (or null)
    MEAL.photoQ = (extra && extra.stats) || null;    // measured brightness/sharpness (or null)
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
    // Warm the Food Memory cache alongside the free dup pre-check, so the paid analyze call
    // that follows can carry the athlete's saved meals as context. Fire-and-forget: a slow or
    // failed warm just means this one read goes without memory.
    void warmFoodMemory({ fetchFoodMemory }, RT.userId);
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
    // Real day context (upgrade 2026-07-16) so the AI's paragraph can connect the meal to
    // the athlete's actual day — protein so far, the real target, meals remaining. Pure
    // clamped numbers; the server only formats them. Older deploys ignore the extra field.
    const dp = S.mealDayProgress;
    const dayContext = {
      proteinSoFar: Math.max(0, Math.min(500, dp.proteinSoFar)),
      proteinTarget: Math.max(0, Math.min(500, dp.proteinTarget)),
      mealsRemaining: Math.max(0, Math.min(8, dp.mealsRemaining)),
    };
    // Confirmed avoid-list (restriction names only — the model must not identify these
    // unless unmistakable, and never suggest them).
    const avoid = (RT.allergies || []).map((s) => String(s).split('·')[0].trim()).filter(Boolean).slice(0, 8);
    // Saved meals + usual orders (0192): bounded, sanitized context so the read can match a
    // known plate — and ASK "your usual?" on a wrapped/closed meal instead of guessing.
    const fm = foodMemory(RT.userId);
    const memory = fm ? memoryContextForAnalysis(fm.items, fm.places) : [];
    return {
      mode: 'meal', mealType: MEAL.mealType || 'Dinner', goal: RT.primaryGoal || null,
      photoBase64: MEAL.photoBase64, ...(timing ? { timing } : {}),
      dayContext,
      ...(avoid.length ? { avoid } : {}),
      ...(memory.length ? { foodMemory: memory } : {}),
      // The athlete's review-step note (§5.5): what the camera can't see. The edge fn treats
      // it as context when present; an older deploy simply ignores the extra field.
      ...(MEAL.userNote ? { athleteNote: MEAL.userNote } : {}),
    };
  },
  /* Second-pass verifier (item 6). Runs PRE-LOG, best-effort: after the first grounded result,
     if a high-stakes trigger fires and the daily verify budget allows, ask the server for a
     focused re-check. An allergen catch is stored for the meal screen's severe alert; an accuracy
     re-detect replaces the pre-log estimate the athlete is about to review. NEVER throws — a
     failure just leaves the first read + the free deterministic guards in place. */
  async _maybeVerify() {
    try {
      const sb = window.sb;
      const r = MEAL.result;
      if (!sb || !r || !MEAL.photoBase64) return;
      const severe = (RT.allergies || [])
        .filter((n) => /severe/i.test(String(n)))
        .map((n) => String(n).split('·')[0].trim())
        .filter(Boolean).slice(0, 12);
      const gate = shouldVerify({
        detected: Array.isArray(r.detectedRich) ? r.detectedRich : r.detected,
        quality: r.quality,
        source: 'photo',
        severeRestrictions: severe,
        budgetLeft: this._verifyBudgetLeft(),
      });
      if (!gate.fire) return;
      this._verifyBudgetSpend();
      // Deadlined like every other read. This one is awaited from INSIDE _runAnalysisJob, so a
      // verify pass that never settled froze the whole outbox behind the drain lock — the first
      // read had already landed and the athlete still watched "Reading your plate…" indefinitely.
      const { data } = await invokeWithDeadline('analyze-meal', {
        ...this._analysisBody(),
        phase: 'verify',
        verifyTrigger: gate.trigger,
        severeRestrictions: severe,
        firstResult: { kcal: r.kcal, protein: r.protein },
      });
      if (!data || data.kind !== 'verify') return;
      if (data.trigger === 'allergen' && Array.isArray(data.allergensFound) && data.allergensFound.length) {
        MEAL.result.verifyAllergens = data.allergensFound.slice(0, 8);
        save(); saveMeal();
      } else if (data.trigger === 'accuracy' && typeof data.kcal === 'number') {
        MEAL.result = groundResult(data);
        save(); saveMeal();
      }
    } catch (e) { /* best-effort — never break the meal flow on verify */ }
  },
  /* Client-side daily verify counter (RT-backed). The SERVER enforces the real budget
     (VERIFY_DAILY_BUDGET, default 3); this just avoids pointless calls once it's spent. Falls
     back to "budget available" on any hiccup — the server is the authoritative gate. */
  _verifyBudgetLeft() {
    const today = new Date().toISOString().slice(0, 10);
    if (RT.verifyDay !== today) return 3;
    return Math.max(0, 3 - (Number(RT.verifyUsed) || 0));
  },
  _verifyBudgetSpend() {
    const today = new Date().toISOString().slice(0, 10);
    if (RT.verifyDay !== today) { RT.verifyDay = today; RT.verifyUsed = 0; }
    RT.verifyUsed = (Number(RT.verifyUsed) || 0) + 1;
    save();
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
      const { data, error } = await invokeWithDeadline('analyze-meal', { ...this._analysisBody(), phase: 'analyze' });
      if (error) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'error' }); return { ok: false, error: 'Analysis failed. Check your connection and retake.' }; }
      if (data && data.kind === 'questions') {
        const qs = Array.isArray(data.questions) ? data.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3) : [];
        if (qs.length) { MEAL.questions = qs; save(); saveMeal(); return { ok: true, kind: 'questions' }; }
        // Model asked but sent nothing usable — finalize straight through rather than dead-end.
        return this.finalizeAnalysis([]);
      }
      if (data && data.kind === 'result') {
        const grounded = groundResult(data);
        // Empty read: treat it as unreadable rather than staging a meal with no numbers in it.
        if (!isCompleteMealResult(grounded)) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'unreadable' }); return { ok: false, error: 'Could not read that meal. Try another angle.' }; }
        MEAL.result = grounded; save(); saveMeal(); await this._maybeVerify(); return { ok: true, kind: 'result' };
      }
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
      const { data, error } = await invokeWithDeadline('analyze-meal', { ...this._analysisBody(), phase: 'finalize', clarifications });
      if (error) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'error' }); return { ok: false, error: 'Analysis failed. Check your connection and retake.' }; }
      if (data && data.kind === 'result') {
        const grounded = groundResult(data);
        if (!isCompleteMealResult(grounded)) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'unreadable' }); return { ok: false, error: 'Could not read that meal. Try another angle.' }; }
        MEAL.result = grounded; MEAL.questions = null; save(); saveMeal(); await this._maybeVerify(); return { ok: true, kind: 'result' };
      }
      track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'unreadable' });
      return { ok: false, error: 'Could not read that meal. Try another angle.' };
    } catch (e) { track(EVENTS.MEAL_ANALYSIS_FAILED, { reason: 'exception' }); return { ok: false, error: 'Analysis failed. Retake and try again.' }; }
  },
  clearMeal() {
    MEAL.key = null; MEAL.mealType = null; MEAL.photoBase64 = null; MEAL.photoDataUrl = null;
    MEAL.result = null; MEAL.live = true; MEAL.questions = null;
    MEAL.photoHash = null; MEAL.source = null; MEAL.takenAt = null; MEAL.capturedAtMin = null;
    MEAL.userNote = null; MEAL.photoQ = null;
    MEAL.memoryId = null; MEAL.memoryTimes = null;
    saveMeal();
  },
  /** Review-step note (spec §5.5): what the photo can't show. Rides the analysis request and
   *  persists with the logged meal so the thread and the coach see the athlete's own words. */
  setMealNote(text) {
    MEAL.userNote = String(text || '').trim().slice(0, 240) || null;
    saveMeal();
  },
  /** Post-log correction (conversation upgrade 2026-07-16): fix what the photo couldn't show.
   *  Recalculates macros/score via the deterministic rules (meal-intel applyMealCorrection),
   *  keeps the ORIGINAL AI estimate frozen in the meta (audit trail), pushes the corrected day,
   *  and best-effort updates the meals row so the coach reads the same corrected numbers —
   *  with a "corrected by athlete" marker appended to the note. Returns the summary line. */
  /** opts.skipAiUpdate: the chat correction path (apply_correction tool) — the AI's
   *  acknowledgment row is ALREADY persisted server-side, so posting the correctionUpdate
   *  message too would say the same thing twice in the thread. */
  async correctMeal(slot, correction, opts = {}) {
    const meta = DAY.slotMacros[slot];
    if (!meta || !DAY.meals[slot]) return null;
    const r = applyMealCorrection(meta, correction);
    if (!r) return null;
    DAY.slotMacros[slot] = r.meta;
    pushDay(RT.userId);
    // Quality metrics (item 8b): counts-only signal that a photo read needed a fix — no macro
    // values, no free text. Feeds the correction-rate side of admin_meal_quality_metrics.
    track(EVENTS.MEAL_CORRECTED, { kind: String((correction && correction.kind) || 'other').slice(0, 24) });
    // TEACH THE MODEL. A correction is evidence about this athlete, not just about this plate:
    // "portion was double" repeated is a calibration prior worth more than any single fix.
    // Fire-and-forget — memory must never be able to break a correction.
    void this._learnFromCorrection(correction);
    // Mirror the corrected numbers onto the meals row the coach reads (athlete owns the row —
    // meals_update RLS). The original stays in the day meta's `orig`; the note carries the trail.
    // Skipped for a PRO-sourced correction (0199): the professional's device already wrote the
    // row through pro_correct_meal — mirroring again would only stamp an '[Athlete correction]'
    // marker over a correction the athlete didn't make.
    const sb = window.sb;
    const mealId = r.meta.mealId;
    if (!opts.fromPro && sb && RT.userId && mealId) {
      const marker = `[Athlete correction] ${r.summary}`;
      const note = `${r.meta.note ? r.meta.note + ' · ' : ''}${marker}`.slice(0, 500);
      const fields = {
        protein: r.meta.protein || 0, carbs: r.meta.carbs || 0, fat: r.meta.fat || 0,
        kcal: r.meta.kcal || 0, quality: r.meta.quality != null ? r.meta.quality : null,
        note,
      };
      // A lost mirror here was worse than elsewhere: the athlete corrected the numbers and the
      // coach kept reading the wrong ones, forever. Failure → the small-writes outbox.
      try {
        const { error } = await sb.from('meals').update(fields).eq('id', mealId).eq('athlete_id', RT.userId);
        if (error) {
          SQ.putJob({ uid: RT.userId, kind: 'meal-update', ref: mealId, fields, queuedAt: Date.now() });
          this._scheduleSyncDrain();
        }
      } catch {
        SQ.putJob({ uid: RT.userId, kind: 'meal-update', ref: mealId, fields, queuedAt: Date.now() });
        this._scheduleSyncDrain();
      }
    }
    track(EVENTS.MEAL_LOGGED, { slot, source: 'correction' });
    // Say so in the thread. A correction used to silently rewrite the numbers under a read that
    // still claimed the old ones — so the AI now posts a fresh read as a NEW message, leaving the
    // original where it was. The athlete sees they were heard; the coach sees both.
    // Fire-and-forget: the correction itself has already applied and been confirmed on screen.
    // (Skipped for chat corrections: apply_correction already persisted the acknowledgment.)
    if (!opts.skipAiUpdate) void this._postCorrectionUpdate(slot, r);
    // A correction that moved the numbers meaningfully is worth a coach look — once per meal.
    // (Not for a pro-sourced one: the professional made the correction; notifying them of
    // their own change would be a circular ping.)
    if (!opts.fromPro && this._coachConnected() && r.kcalDelta >= 120 && !r.meta.correctionNotified) {
      DAY.slotMacros[slot] = { ...r.meta, correctionNotified: true };
      pushDay(RT.userId);
      void notifyMyCoach({
        kind: 'meal_review',
        title: `${S.athlete.first || 'Your athlete'} corrected ${slotTitle(slot)}`,
        body: `${r.summary} · Tap to open the conversation.`,
        route: mealId ? `coach-meal/${mealId}` : undefined,
      });
    }
    return r;
  },
  /* Apply a PROFESSIONAL's correction found in the meal thread (0199). The pro's device already
     wrote the meals ROW through pro_correct_meal — but the athlete's copy of TODAY (slotMacros,
     and therefore the day score) lives on this device and only moves HERE, through the same
     deterministic engines every other correction uses. Applied exactly once per comment id
     (proApplied on the slot meta, which rides days.checkin like the rest of the audit trail);
     an unmatched correction is still marked consumed so it can never retry forever. */
  applyProCorrection(slot, comment) {
    try {
      if (!comment || !comment.id || comment.role !== 'coach') return false;
      if (!comment.meta || comment.meta.t !== 'pro_correction') return false;
      const meta = DAY.slotMacros && DAY.slotMacros[slot];
      if (!meta || !DAY.meals[slot]) return false;
      const done = Array.isArray(meta.proApplied) ? meta.proApplied : [];
      if (done.includes(comment.id)) return false;
      const c = comment.meta.c || {};
      let applied = false;
      if (c.edit && c.edit.kind === 'remove' && c.edit.name) {
        const r = applyFoodRemoval(meta, c.edit.name, { by: 'pro', minutesLate: meta.minutesLate || 0 });
        if (r) { DAY.slotMacros[slot] = r.meta; applied = true; }
      } else if (c.kind) {
        // Chip/portion corrections ride the normal reducer; fromPro skips the meals mirror
        // (the row is already corrected), the AI re-read (the pro's own bubble explains), and
        // the coach notification (the pro IS the coach).
        void this.correctMeal(slot, c, { skipAiUpdate: true, fromPro: true });
        applied = true;
      }
      const cur = DAY.slotMacros[slot];
      if (cur) { cur.proApplied = [...done, comment.id].slice(-12); }
      pushDay(RT.userId);
      save();
      return applied;
    } catch { return false; }
  },
  /** Ask the AI to re-read the plate out loud after the athlete corrected it.
   *
   *  The numbers sent are the CORRECTED ones — the deterministic kitchen math has already run and
   *  been persisted, so the model is describing a result, never computing one. The original read
   *  stays in the thread above; this lands underneath it as a new message.
   *
   *  Every failure is silent by design. The correction is already applied and already confirmed
   *  on screen; a missing acknowledgment is a quieter thread, not a broken one. */
  async _postCorrectionUpdate(slot, r) {
    try {
      const sb = window.sb;
      const mealId = r && r.meta && r.meta.mealId;
      if (!sb || !mealId || !RT.userId) return;
      const m = r.meta;
      const dp = S.mealDayProgress;
      const context = contextForChat({
        meal: {
          name: m.name || cap(slot), slot,
          protein: m.protein || 0, carbs: m.carbs || 0, fat: m.fat || 0, kcal: m.kcal || 0,
          fiber: m.fiber || 0, quality: m.quality != null ? m.quality : null,
          foods: (m.detectedRich || []).map((d) => d && d.name).filter(Boolean).slice(0, 8),
          // What the athlete actually told us, and what it used to say.
          correction: r.summary || null,
          wasBefore: m.orig ? { protein: m.orig.protein, kcal: m.orig.kcal } : null,
        },
        plan: { style: S.planStyle.key, proteinTarget: dp.proteinTarget },
        exec: { proteinSoFar: dp.proteinSoFar, mealsRemaining: dp.mealsRemaining },
      });
      await sb.functions.invoke('meal-chat', { body: { mealId, correctionUpdate: true, context } });
      // The thread screen refetches on its own tick; nudge a repaint so it lands promptly.
      window.__render && window.__render();
    } catch { /* a quieter thread, not a broken correction */ }
  },

  /* Pre-log edit propagation (Tier 1 session isolation, 2026-07-21): called right after every
     successful applyFoodEdit. A removed food must leave EVERYTHING — totals, score inputs, and
     prose — not just the food list. Totals + quality recompute deterministically from the
     remaining per-food grounded macros; possible only when every remaining food is priced
     (per-food AI attribution, or a DB match for a user-added item). When a food can't be
     priced (older edge payloads, unknown user adds) the AI totals stay and the UI keeps the
     honest "macros stay the AI's estimate" hint — recomputed=false says which world we're in. */
  recomputeStagedMeal(op) {
    const r = MEAL.result;
    if (!r) return;
    // Prose isolation runs regardless of pricing: text can never mention an absent food.
    if (op && op.kind === 'remove' && op.name) {
      r.analysis = stripFoodMentions(r.analysis, op.name);
      r.note = stripFoodMentions(r.note, op.name);
      r.highlights = (r.highlights || []).map((h) => stripFoodMentions(h, op.name)).filter(Boolean);
    }
    const g = groundMealFromFoods(r.detectedRich || []);
    const canRecompute = (r.detectedRich || []).length === 0 || (g.foods.length > 0 && g.unpriced === 0);
    if (canRecompute) {
      r.detectedRich = g.foods;
      r.detected = g.foods.map((f) => f.name);
      const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(v || 0)));
      r.protein = clampN(g.totals.protein, 120); r.carbs = clampN(g.totals.carbs, 250);
      r.fat = clampN(g.totals.fat, 150);
      r.kcal = clampN(g.totals.kcal || (4 * r.protein + 4 * r.carbs + 9 * r.fat), 2200);
      const timing = analysisTiming(MEAL.capturedAtMin != null ? MEAL.capturedAtMin : minutesNow(), slotDeadline(MEAL.key || 'dinner'));
      const gm = { protein: r.protein, carbs: r.carbs, fat: r.fat, kcal: r.kcal };
      r.quality = mealQualityScore({ macros: gm, fiber: r.fiber, detected: r.detectedRich, minutesLate: timing ? timing.minutesLate : 0 });
      // The score AND the macros moved — re-check that the surviving prose still agrees with both
      // the new band and the new numbers. An edited plate is the most likely place for prose to
      // start quoting figures the breakdown no longer shows: removing a food drops its macros but
      // a sentence about the REST of the plate survives stripFoodMentions with its old totals in it.
      const band = qualityBand(r.quality);
      const verdictInputs = { macros: gm, fiber: r.fiber, detected: r.detectedRich, minutesLate: timing ? timing.minutesLate : 0 };
      if (!analysisAgreesWithBand(r.analysis, band) || !analysisAgreesWithBand(r.note, band)
        || !analysisAgreesWithNumbers(r.analysis, { ...gm, fiber: r.fiber })
        || !analysisAgreesWithNumbers(r.note, { ...gm, fiber: r.fiber })
        || !analysisAgreesWithComponents(r.analysis, verdictInputs)
        || !analysisAgreesWithComponents(r.note, verdictInputs)) {
        r.analysis = '';
        r.note = qualityReason(gm, r.fiber, r.detectedRich) || 'Logged. The breakdown shows how this plate reads.';
      }
      r.recomputed = true;
    } else {
      r.recomputed = false;
    }
    save(); saveMeal();
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
    MEAL.memoryId = null; MEAL.memoryTimes = null; // never inherit a prior staged saved-meal
    MEAL.capturedAtMin = minutesNow();
    MEAL.result = {
      quality: null,
      protein: Math.round(macros.protein || 0), carbs: Math.round(macros.carbs || 0),
      fat: Math.round(macros.fat || 0), kcal: Math.round(macros.kcal || 0),
      detected: Array.isArray(foods) ? foods.slice(0, 8) : [], note: '',
    };
    saveMeal();
  },

  /* ---------------- Food Memory (0192): the Plan intelligence hub ---------------- */

  /** One-tap re-log: stage a saved meal/order into the next open slot and route through the
   *  SAME #meal-analysis confirm gate every other path uses (WS7: review before it counts).
   *  No photo, no AI call — the macros are the saved item's own, at its stored trust tier.
   *  Returns true when staged (caller navigates), false when the item is gone. */
  stageSavedMeal(itemId) {
    const fm = foodMemory(RT.userId);
    const item = fm && fm.items.find((x) => x.id === itemId && x.status !== 'archived');
    if (!item) return false;
    const comp = Array.isArray(item.items) ? item.items.filter((c) => c && c.name) : [];
    this.captureManual(
      { protein: item.protein, carbs: item.carbs, fat: item.fat, kcal: item.kcal },
      comp.length ? comp.map((c) => c.name) : [item.name],
      null, 'manual'
    );
    // captureManual stamps the shared fields; these three make it a MEMORY log, not a manual one.
    MEAL.source = 'memory';
    MEAL.memoryId = item.id; MEAL.memoryTimes = item.times_logged;
    MEAL.result.name = item.name;
    MEAL.result.fiber = item.fiber || 0;
    if (comp.length) MEAL.result.detectedRich = comp.slice(0, 8);
    saveMeal();
    return true;
  },

  /** Accept a passive "save it as your usual?" suggestion (or save straight from a logged meal).
   *  Best-effort — memory can never block logging. `placeName` (optional) files it under a place. */
  async saveMemorySuggestion(sug, placeName) {
    if (!RT.userId || !sug) return false;
    this._markMemoryHandled(sug.signature);
    let placeId = null;
    if (placeName) placeId = await upsertFoodMemoryPlace(RT.userId, placeName);
    const id = await insertFoodMemoryItem({
      athlete_id: RT.userId,
      name: String(sug.name || 'Saved meal').slice(0, 120),
      kind: placeId ? 'order' : 'meal',
      ...(placeId ? { place_id: placeId } : {}),
      items: (sug.foods || []).slice(0, 8).map((n) => ({ name: n })),
      protein: sug.protein || 0, kcal: sug.kcal || 0, carbs: sug.carbs || 0, fat: sug.fat || 0,
      fiber: sug.fiber || 0,
      basis: 'confirmed', source: 'auto', times_logged: sug.count || 1,
    });
    if (id) invalidateFoodMemory();
    return !!id;
  },

  /** Save an already-logged slot as a usual (from the meal thread / Plan). */
  async saveMealToMemory(slot, opts = {}) {
    const meta = DAY.slotMacros[slot];
    if (!RT.userId || !meta) return false;
    const draft = itemFromMeal(meta, opts);
    if (!draft) return false;
    this._markMemoryHandled(mealSignature((meta.foods && meta.foods.length) ? meta.foods : [meta.name]));
    let placeId = null;
    if (opts.placeName) placeId = await upsertFoodMemoryPlace(RT.userId, opts.placeName);
    const id = await insertFoodMemoryItem({
      athlete_id: RT.userId, ...draft, kind: placeId ? 'order' : draft.kind,
      ...(placeId ? { place_id: placeId } : {}), source: 'athlete_saved',
    });
    if (id) invalidateFoodMemory();
    return !!id;
  },

  /** Dismissed or saved — either way this signature never nags again. RT-persisted. */
  _markMemoryHandled(sig) {
    if (!sig) return;
    const seen = Array.isArray(RT.fmHandled) ? RT.fmHandled : [];
    if (!seen.includes(sig)) RT.fmHandled = [...seen, sig].slice(-80);
    save();
  },
  dismissMemorySuggestion(sig) { this._markMemoryHandled(sig); },

  /** "Forget" a memory (What OnStandard Knows): archived server-side, never deleted. */
  async forgetMemoryItem(id) {
    const ok = await archiveFoodMemoryItem(id);
    if (ok) invalidateFoodMemory();
    return ok;
  },

  /** Manual add/edit from the memory-edit sheet. `form` = {id?, name, kind, placeName?, macros}.
   *  The typed place name is authoritative: set → find-or-create that place; cleared → unlink. */
  async saveMemoryForm(form) {
    if (!RT.userId || !form || !form.name) return false;
    const clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(Number(v) || 0)));
    const placeId = form.placeName ? await upsertFoodMemoryPlace(RT.userId, form.placeName) : null;
    const row = {
      name: String(form.name).slice(0, 120),
      kind: ['meal', 'order', 'food', 'supplement'].includes(form.kind) ? form.kind : 'meal',
      place_id: placeId,
      protein: clampN(form.protein, 500), kcal: clampN(form.kcal, 5000),
      carbs: clampN(form.carbs, 1000), fat: clampN(form.fat, 500),
    };
    const ok = form.id
      ? await updateFoodMemoryItem(form.id, row)
      : !!(await insertFoodMemoryItem({ athlete_id: RT.userId, ...row, basis: 'confirmed', source: 'manual' }));
    if (ok) invalidateFoodMemory();
    return ok;
  },

  startDay0() { RT.lastMove = null; dayResetLocal(); applyGoalToDay(); this._applyStandardFromSets(); applyPlanStyleToDay(); syncRtFromDay(); pushDay(RT.userId, true); save(); this.syncNotifications(); },
  // Coach→athlete assignments: real rows (0055) sync completion to the server; local-only
  // items (injury-mode rehab) stay local. Optimistic — server truth reasserts on next hydrate.
  completeAssigned(id) {
    const a = RT.assigned.find(x => x.id === id);
    if (a && !a.done) {
      a.done = true; a.seen = true; save(); this.syncNotifications();
      if (a.real) completeAssignmentRemote(a.id); // best-effort; _loadAssignmentsIntoRt self-heals
    }
  },
  /* Complete/undo a standing NON-MEAL check requirement for today (coach lift/custom). Tracked, not
     scored: it rides into days.tasks for the coach but never touches the score. Optimistic + persisted. */
  completeCheck(id) {
    if (!id) return;
    const done = !(DAY.checkedTasks && DAY.checkedTasks[id]);
    dayCheckTask(RT.userId, id, done);
    save();
  },
  /* Idempotently mark a standing check requirement done (never toggles off) — used when logging a
     training session (0135), so re-logging an already-done session keeps it done, not flips it. */
  markCheckDone(id) {
    if (!id) return;
    dayCheckTask(RT.userId, id, true);
    save();
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

  /* Profile picture (0206). The server object at avatars/<uid>/avatar.jpg is the truth — it is
     what every CONNECTED surface (roster, threads, parent cards) paints from — and the local
     dataURL is only the instant-paint cache for this device. Before this existed the "upload"
     stored the dataURL in localStorage and nothing else: it vanished on sign-out and no other
     account ever saw it. Returns false when the server never got the photo, so the profile
     screen can say so instead of showing a success that isn't one. */
  async setAvatar(dataUrl) {
    const uid = RT.userId;
    const b64 = String(dataUrl || '').split(',')[1] || '';
    if (!uid || !b64) return false;
    const ok = await rpcUploadAvatar(uid, b64);
    if (!ok) return false;
    const p = RT.profile || (RT.profile = {});
    p.avatar = dataUrl;
    RT.avatarVer = String(Date.now());   // busts the session probe cache AND the CDN cache
    bustAvatar(uid);
    try { save(); } catch { /* localStorage full: the server copy is safe; next load hydrates */ }
    return true;
  },
  async removeAvatar() {
    const uid = RT.userId;
    if (!uid) return false;
    const ok = await rpcRemoveAvatar(uid);
    if (!ok) return false;
    const p = RT.profile || (RT.profile = {});
    p.avatar = null;
    RT.avatarVer = String(Date.now());
    bustAvatar(uid);
    try { save(); } catch { /* best-effort */ }
    return true;
  },
  /* Onboarding scratch: the athlete's real selections captured step-by-step (DOM is wiped
     between routes, so each interaction persists here rather than being read at the end). */
  captureOb(patch) { RT.ob = { ...(RT.ob || {}), ...patch }; save(); },
  clearJoin() { if (RT.ob) { delete RT.ob.join; save(); } },
  saveAllergies(list) { RT.allergies = list.slice(0, 8); save(); },
  /* Structured restrictions (spec §18.1): allergies carry per-allergen severity;
     intolerances and preferences are separate lists. The flat RT.allergies summary is
     derived so every existing consumer (meal guardian line, profile row) stays correct. */
  saveRestrictions(r) {
    const cleanName = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 30);
    RT.restrictions = {
      allergies: (Array.isArray(r.allergies) ? r.allergies : []).slice(0, 12)
        .map((a) => ({ name: cleanName(a.name), severity: a.severity === 'moderate' ? 'moderate' : 'severe' }))
        .filter((a) => a.name),
      intolerances: (Array.isArray(r.intolerances) ? r.intolerances : []).slice(0, 8).map(cleanName).filter(Boolean),
      preferences: (Array.isArray(r.preferences) ? r.preferences : []).slice(0, 8).map(cleanName).filter(Boolean),
    };
    RT.allergies = [
      ...RT.restrictions.allergies.map((a) => a.severity === 'severe' ? `${a.name} · severe` : a.name),
      ...RT.restrictions.intolerances,
      ...RT.restrictions.preferences,
    ].slice(0, 12);
    save();
  },
  setAuthRole(role) { RT.authRole = role; save(); },
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
    RT.email = email;
    /* Only claim a signed-in identity when Supabase actually handed us a SESSION.
       This used to set RT.userId + RT.authRole unconditionally. When the project requires email
       confirmation, signUp returns a user but NO session — so the app believed someone was signed
       in while Supabase disagreed. The next launch ran boot(), found no session, silently wiped
       the user-scoped state and redirected to Welcome. That is precisely the reported
       "I finish creating an account and I get signed out".
       No session now means: stay signed out, and remember whose confirmation is outstanding so
       the UI can say something true about it. */
    if (data.session) {
      RT.userId = data.user ? data.user.id : null;
      RT.authRole = role;
      RT.pendingConfirmEmail = null;
      // A brand-new row's email_verified column DEFAULTs to false (0176) — known without a
      // round trip, so the banner can render on the very first screen after signup instead of
      // waiting for hydrateDay()'s query (which only runs from boot(), not from onSession(true)).
      RT.emailVerified = false;
    } else {
      RT.userId = null;
      RT.authRole = null;
      RT.pendingConfirmEmail = email;
    }
    save();
    track(EVENTS.ONBOARDING_COMPLETED, { role });
    return { ok: true, session: !!data.session, email };
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
      const { data: prof } = await sb.from('profiles').select('full_name,committed_at,created_at').eq('id', userId).maybeSingle();
      // SETTLED sentinel: supabase-js resolves network/RLS failures into `{error}` without
      // throwing — destructure it so a real fetch failure is never misread as "no targets".
      // Weight visibility (0103): base_weight + targets left the direct SELECT grant — they come
      // through the athlete_plan_meta RPC (is_self always passes, so the athlete gets both in
      // full). Pre-apply fallback below keeps this client shippable AHEAD of the migration.
      const { data: ap, error: apErr } = await sb.from('athlete_profiles').select('sport,position,level,base_goal,season_goal,dob,standard').eq('athlete_id', userId).maybeSingle();
      let meta = null;
      try {
        const { data: pm, error: pmErr } = await sb.rpc('athlete_plan_meta', { athlete: userId });
        if (!pmErr && Array.isArray(pm) && pm[0]) meta = pm[0];
        else if (pmErr) {
          // Pre-0103: the RPC doesn't exist yet but the columns are still directly readable.
          const { data: legacy } = await sb.from('athlete_profiles').select('base_weight,targets').eq('athlete_id', userId).maybeSingle();
          if (legacy) meta = legacy;
        }
      } catch { /* offline — cached values survive untouched below */ }
      const patch = {};
      if (prof && prof.full_name) patch.name = prof.full_name;
      // Cross-device activation backstop: the server's committed_at is the first-day anchor when
      // this device never ran onboarding (RT.activationDate is local-only).
      if (prof && prof.committed_at) patch.committedAt = prof.committed_at;
      if (prof && prof.created_at) patch.createdAt = prof.created_at; // server birthday: the activation anchor
      if (ap) {
        if (ap.sport) patch.sport = ap.sport; if (ap.position) patch.position = ap.position; if (ap.level) patch.level = ap.level;
        if (ap.base_goal) patch.baseGoal = ap.base_goal;
        if (ap.season_goal && typeof ap.season_goal === 'object') patch.seasonGoal = ap.season_goal;
        if (ap.dob) patch.dob = ap.dob; // drives the client-side minor gate (mirrors 0050's is_provable_minor)
        if (ap.standard && typeof ap.standard === 'object') patch.standard = ap.standard; // solo personal standard (mealsPerDay)
      }
      if (meta) {
        if (meta.base_weight != null) patch.baseWeight = meta.base_weight;
        if (meta.targets && typeof meta.targets === 'object') patch.targets = meta.targets;
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
      // ...then the plan style (0142), which needs the hydrated targets/preference AND is
      // re-applied by _applyStandardFromSets once a governing team standard resolves.
      applyPlanStyleToDay();
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
      RT.practice = { id: identity.id, name: identity.name, code: identity.code, discipline: identity.discipline || 'training' };
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
    // Trust Pass policy (0196): a practice is now an equal grantor, so it needs the same
    // defaults-load a team already gets. Best-effort; never blocks practice load.
    if (RT.practice && RT.practice.id) {
      try {
        const pol = await fetchPassPolicy({ practiceId: RT.practice.id });
        // { error:true } = the read FAILED, and it is TRUTHY, so assigning it straight through
        // would install a policy whose every field is undefined. Keep last-known instead.
        if (!(pol && pol.error)) {
          RT.passPolicy = pol || (RT.passPolicy || { default_credits: 3, default_window_days: 2, eligibility_days: 7, max_credits: 5 });
          save();
        }
      } catch { /* best-effort */ }
      // Resume first-run setup on a practice book (0197) — the same T-21 union the team arm gets:
      // server-completed steps merged under anything marked locally this session, never
      // un-completing a step. Without this a trainer's checklist reset on every reinstall.
      try {
        const remote = await fetchPracticeSetupState(RT.practice.id);
        // null = FAILED: leave the checklist alone. Merging a fabricated {} is what re-opened
        // "Finish setting up your practice" for trainers who had finished (0197).
        if (remote) { RT.coachSetup = { ...remote, ...(RT.coachSetup || {}) }; save(); }
      } catch { /* best-effort */ }
    }
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
      RT.team = { id: identity.id, name: identity.name, code: identity.code, discipline: identity.discipline || 'training' };
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
    // Trust Pass policy (0196) into RT for the editor + grant copy. Best-effort; a missing row or
    // not-yet-applied table falls back to the shipped defaults. Never blocks team load.
    if (RT.team && RT.team.id) {
      try {
        const pol = await fetchPassPolicy({ teamId: RT.team.id });
        // { error:true } is truthy; assigning it would install an all-undefined policy.
        if (!(pol && pol.error)) {
          RT.passPolicy = pol || (RT.passPolicy || { default_credits: 3, default_window_days: 2, eligibility_days: 7, max_credits: 5 });
        }
        const wp = await fetchTeamWeekPattern(RT.team.id);
        // Array = a real pattern. The `if (wp)` alone would now also accept { error:true }.
        if (Array.isArray(wp)) RT.weekPattern = wp; // for the coach's weekly-pattern editor
        // T-21: resume first-run setup after a reinstall / on a new device. UNION the server's
        // completed steps with anything marked locally this session — never un-complete a step.
        const remote = await fetchCoachSetupState(RT.team.id);
        if (remote) RT.coachSetup = { ...remote, ...(RT.coachSetup || {}) };
        save();
      } catch { /* best-effort */ }
    }
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
  /* Spend a Trust Pass credit on today's `slot` (0196). The server is the only wall (spend_pass
     takes no athlete argument, so it cannot be pointed at anyone else) — this just relays intent
     and re-reads the ledger afterward. A re-read rather than a local patch: the server owns the
     count, and a refund trigger elsewhere (logging the meal mid-flight) can have already changed
     it without this device knowing. */
  async spendPass(slot) {
    const r = await rpcSpendPass(DAY.date, slot);
    if (!r.ok) return r;
    await reloadPassState(RT.userId);
    if (window.__render) window.__render();
    return r;
  },
  async requestGuardianConsent(email) {
    const addr = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return { ok: false, error: 'Enter your parent or guardian’s email.' };
    const r = await rpcRequestConsent(addr);
    if (!r.ok) return r;
    RT.consent = { status: 'pending', guardianEmail: addr };
    save();
    this._armSyncGate();
    // Pass `emailed` through so the guardian screen can be honest when the request was only
    // recorded (function unreachable / email vendor down) and no parent actually got an email.
    return { ok: true, emailed: r.emailed !== false };
  },
  /* Read the athlete's REAL linked coach (their team + the head coach's display name) into
     RT.myCoach. Confirmed "no team link" clears it (an athlete who left a team must not keep
     a stale coach); a fetch failure keeps the last-known link rather than wiping it. */
  async _loadCoachIntoRt(userId) {
    if (!userId) return;
    const res = await fetchMyCoach();
    if (res && res.error) return; // network/RLS hiccup — keep last-known
    RT.myCoach = res || null;
    // One-way marker: this account has BEEN coached. The confirmed transition hadRoster && no
    // link is the highest-intent consumer moment the product has — the athlete whose roster
    // ended (graduated, coach churned, removed) and whose record is about to go dormant. Home
    // renders the "your record stays yours" card off exactly this pair (keepRecordSeen gates it
    // to once). Set on a CONFIRMED link only, never on a fetch failure.
    if (RT.myCoach && RT.myCoach.teamId) RT.hadRoster = true;
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
    if (RT.myTrainer && RT.myTrainer.practiceId) RT.hadRoster = true;  // see _loadCoachIntoRt
    save();
  },
  /* The keep-your-record card was dismissed (or acted on) — never show it again. */
  markKeepRecordSeen() { RT.keepRecordSeen = true; save(); },
  /* The "you picked <plan> in onboarding" card was acted on / superseded — never show it again. */
  markObPlanCtaDone() { RT.obPlanCtaDone = true; save(); },
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
  /* The day-locked stamp has been shown for `date` (and, when given, for that streak milestone).
     Per-device and display-only: it records what this phone has SHOWN, never anything about the day
     itself, so it can never influence a score or a streak. */
  markLockSeen(date, milestone = null) {
    if (!date) return;
    RT.lastLockSeen = date;
    if (milestone != null) RT.lastMilestone = milestone;
    save();
  },
  /* The first-run tour (or a contextual tip) has been SHOWN. Marked when the first step paints,
     not when it is finished — someone who force-quits halfway is not ambushed again on next
     launch, and Settings still has "Replay app tour". Same choice lock-moment.js makes.

     The main tour also stamps profiles.tour_seen_at, so a reinstall six months later doesn't
     tutorialize a veteran. Best-effort and void: a pre-0165 DB or an offline device just keeps
     the local flag, which is the one that governs. Tips stay device-local — a repeated one-line
     tip on a new phone is a shrug, not worth a column each. */
  markTourSeen(id) {
    if (!id) return;
    if (!RT.tourSeen || typeof RT.tourSeen !== 'object') RT.tourSeen = {};
    if (RT.tourSeen[id]) return;
    RT.tourSeen[id] = new Date().toISOString();
    save();
    if (!String(id).startsWith('tour:')) return; // tips are device-local by design
    try {
      if (window.sb && RT.userId) {
        void window.sb.from('profiles').update({ tour_seen_at: RT.tourSeen[id] }).eq('id', RT.userId);
      }
    } catch { /* best-effort */ }
  },
  /* A store-rating prompt was actually SHOWN on this device (never: a review was left — no platform
     reports that). Only called when the OS agreed to show it, so a build where the prompt is
     unavailable never burns the athlete's next eligibility window. */
  markReviewAsked(at) {
    const t = Number(at);
    if (!Number.isFinite(t) || t <= 0) return;
    RT.reviewAskedAt = t;
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
    // Local date, not UTC — toISOString flips the "day" at ~5-8pm for US coaches, which cleared
    // the "Nudged ✓" state mid-evening and allowed a second nudge the same real day.
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    RT.coachNudged = { ...(RT.coachNudged || {}), [athleteId]: local };
    save();
  },
  setTheme(mode) {
    RT.theme = ['dark', 'light', 'system'].includes(mode) ? mode : 'dark';
    save(); applyTheme();
  },
  setHaptics(on) { RT.haptics = !!on; save(); },
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
    // null = the fetch FAILED. Splicing it in would wipe every real coach assignment out of
    // local state and render the athlete's plan as if the coach never assigned anything.
    // Keep last-known; the standard still resolves from whatever reqSets we already hold.
    if (rows === null) { this._applyStandardFromSets(); return; }
    // Even with no coach assignments, a solo athlete still needs their standard resolved (their
    // personal meal count governs the scored day) — apply it before the early return.
    if (!rows.length && !RT.assigned.some(a => a.real)) { this._applyStandardFromSets(); return; }
    const coachName = (RT.myCoach && RT.myCoach.name) || 'Coach';
    const prevSeen = new Set(RT.assigned.filter(a => a.seen).map(a => a.id));
    const real = rows.map(r => assignedFromRow(r, coachName)).filter(Boolean)
      .map(a => ({ ...a, seen: prevSeen.has(a.id) || a.done }));
    RT.assigned = [...RT.assigned.filter(a => !a.real), ...real];
    // The standing requirement sets that govern this athlete's scored day (WS3 slice 2). A
    // TEAM link also resolves the weekly pattern and the athlete's room; a PRACTICE link (0136)
    // has neither by design — rooms and week patterns are team concepts — so a trainer's client
    // resolves practice-default vs per-client scope only. Before 0136 a client loaded NO sets at
    // all, which is why plan.js used to attribute the app's built-in defaults to a named trainer.
    if (RT.myCoach && RT.myCoach.teamId) {
      // null = FAILED: keep last-known sets — a fabricated [] silently reverts the athlete's
      // scored day to the built-in catalog, dropping the coach's standard and deadlines.
      // Bounded read (0203): the RPC returns only the rows resolution can actually pick from;
      // it falls back to the full fetch on a pre-0203 server.
      const sets = await fetchRelevantRequirementSets(RT.myCoach.teamId, 'team');
      if (sets !== null) RT.reqSets = sets;
      // The team's weekly pattern (0100) resolves this athlete's day-type. A real null (no
      // pattern configured) leaves day-type 'any', which is correct. { error:true } means the
      // read FAILED, and assigning that dropped rest-day gating for the session: the athlete
      // was then scored on training-day items on their rest day. Keep last-known instead.
      try {
        const wp = await fetchTeamWeekPattern(RT.myCoach.teamId);
        if (!(wp && wp.error)) RT.weekPattern = wp;
      } catch { /* best-effort */ }
      // The athlete's assigned room label (0101): when set, their standard resolves against the ROOM
      // instead of their raw position. null (unassigned — every athlete until a coach assigns) = the
      // exact prior behavior; { error:true } = FAILED, which must not silently demote them to
      // position-based resolution (a different standard, scored the same day).
      try {
        const rl = await fetchMyRoomLabel(RT.myCoach.teamId);
        if (!(rl && rl.error)) RT.myRoomLabel = rl;
      } catch { /* best-effort */ }
    } else if (RT.myTrainer && RT.myTrainer.practiceId) {
      const sets = await fetchRelevantRequirementSets(RT.myTrainer.practiceId, 'practice');
      if (sets !== null) RT.reqSets = sets;
    }
    this._applyStandardFromSets();
    save();
  },
  /* Resolve the governing set (athlete > position room > team) into the DAY engine: slot
     list, deadlines, titles, and the nutrition denominator. No set → the classic day. */
  _applyStandardFromSets() {
    // Resolve the version governing the day being scored (DAY.date), so a coach's future-dated
    // standard edit never rescopes today or a past day (prospective effective dates, 0085).
    // Room-scoped standard (0101): an athlete assigned to a room resolves against the ROOM's label;
    // unassigned (RT.myRoomLabel null — every athlete until a coach assigns) falls back to their raw
    // position, byte-identical to before.
    const resolvePosition = RT.myRoomLabel || (RT.profile || {}).position;
    const set = resolveRequirementSet(RT.reqSets || [], RT.userId, resolvePosition, String(DAY.date));
    // Day-type gating (0100): with the team's weekly pattern, drop items that don't apply to the
    // type of the day being scored. No pattern → dayType 'any' → items pass through untouched, so
    // the scored day is byte-identical for every team without a pattern (parity contract).
    const dayType = dayTypeFor(RT.weekPattern, String(DAY.date));
    const govItems = set ? filterItemsByDayType(set.items, dayType) : null;
    let std = stdFromItems(govItems);
    // Independent (no governing coach set): a NEW solo athlete's chosen personal standard governs
    // their scored day. Gated on RT.activationDate — stamped only by this build's onboarding — so
    // EXISTING solo athletes are never silently re-scored against a different meal count (they
    // keep the classic 4-meal day). Coach-linked athletes always resolve `set` first, unaffected.
    if (!std && RT.activationDate) std = stdFromSolo((RT.profile && RT.profile.standard) || (RT.ob && RT.ob.standard));
    RT.stdMeals = std;
    // Raw governing items (all kinds) so execCatalog can surface the coach's NON-MEAL standing
    // requirements (lift/custom/etc). Null when no coach set governs — keeps execCatalog byte-identical.
    RT.stdItems = Array.isArray(govItems) ? govItems : null;
    setDayStandard(RT.stdMeals);
    // The governing set can also carry the team's PLAN STYLE (0142 kind:'plan_style'), which
    // outranks any self choice — so the style is re-resolved every time the standard does.
    applyPlanStyleToDay();
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
    if (!sb || !RT.userId) return { ok: false, error: 'You need a connection for this. Try again when you’re online.' };
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
    // Tear down any armed geofences: the OS keeps regions across sign-out, and the background
    // task would keep firing arrivals against a session that no longer exists (or, worse,
    // attribute crossings under whoever signs in next on this phone).
    try {
      const N = window.OnStandardNative;
      if (N && N.location) await N.location.disarm();
    } catch { /* best-effort */ }
    try { if (sb) await sb.auth.signOut(); } catch { /* ignore */ }
    this._wipeUserScopedState({ keepPendingOb: true });
  },

  /* Arrival check-in opt-out (0139 hardening 2026-08-19). The flag armIfPermitted() honors:
     without it, "Turn it off" survived exactly until the next Home load re-armed the regions. */
  setLocationOptOut(on) { RT.locationOptOut = !!on; save(); },

  /* Which confirmed-presence receipts have already been shown on Home (0208).
     The receipt is a MOMENT, not a standing banner: once the athlete has been told their stay was
     confirmed, the durable record lives on the commitment card and Home goes quiet again.
     Scoped to one day and REPLACED (not merged) when the day changes, so it can never grow without
     bound and yesterday's receipt can never resurrect after a rollover. */
  markPresenceSeen(day, id) {
    if (!day || !id) return;
    const same = RT.presenceSeen && RT.presenceSeen.day === day;
    const prev = same && Array.isArray(RT.presenceSeen.ids) ? RT.presenceSeen.ids : [];
    if (prev.indexOf(id) >= 0) return;
    RT.presenceSeen = { day, ids: prev.concat(id) };
    save();
  },
  presenceSeenIds(day) {
    const s = RT.presenceSeen;
    return (s && s.day === day && Array.isArray(s.ids)) ? s.ids : [];
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
  /* ---------- Parent (guardian) — scoped read + invite (migration 0081). A guardian reads ONLY
     score/grade/day via the guardian_* RPCs; the server (0081) blocks meals/photos/weight/checkins.
     guardianChildren answers null = FAILED (the fetcher contract): a parent opening the hub on a
     bad connection must see an honest error with retry, never "No athletes linked yet" over a
     real link (which reads as the link being gone and invites a needless re-invite). The old
     graceful-[] here targeted the pre-0081 "RPC not live yet" window, long past. [] stays the
     answer only for the no-client short-circuit and a server-confirmed empty roster. ---------- */
  async guardianChildren() {
    const sb = window.sb;
    if (!sb) return [];
    try { const { data, error } = await sb.rpc('guardian_children'); return error ? null : (data || []); }
    catch { return null; }
  },
  async guardianChildDays(child, daysBack = 30) {
    const sb = window.sb;
    if (!sb || !child) return [];
    try { const { data, error } = await sb.rpc('guardian_child_days', { child, days_back: daysBack }); return error ? [] : (data || []); }
    catch { return []; }
  },
  async createGuardianInvite(relationship) {
    const sb = window.sb;
    if (!sb) return { ok: false, error: 'Not ready yet. Try again in a moment.' };
    try { const { data, error } = await sb.rpc('create_guardian_invite', { relationship: relationship || null }); return error ? { ok: false, error: friendlyAuth(error.message) } : { ok: true, token: data }; }
    catch { return { ok: false, error: 'Could not create an invite. Try again.' }; }
  },
  async acceptGuardianInvite(token, rel) {
    const sb = window.sb;
    if (!sb) return { ok: false, error: 'Not ready yet. Try again in a moment.' };
    try { const { data, error } = await sb.rpc('accept_guardian_invite', { invite_token: (token || '').trim(), rel: rel || null }); return error ? { ok: false, error: friendlyAuth(error.message) } : { ok: true, athleteId: data }; }
    catch { return { ok: false, error: 'Could not link. Check the code and try again.' }; }
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
  /* REAL data export (spec §20.4/§23): every row the athlete owns, fetched under their own
     RLS session, as a downloadable JSON file. Returns {ok} or {ok:false, error}. */
  async exportMyData() {
    const sb = window.sb;
    if (!sb || !RT.userId) return { ok: false, error: 'Sign in and connect to export.' };
    try {
      // days/athlete_profiles carry COLUMN-LIST grants (0103's weight wall) — a select('*')
      // on them is 42501, which made this export silently ship empty arrays. Enumerate the
      // granted columns and pull the walled weight fields through their RPC doors, so the
      // athlete's export really contains their weights (it's their own data).
      //
      // supabase-js RESOLVES failures into {error} — it does not throw — so a catch-only
      // helper walked straight past every RLS rejection, timeout, and 5xx and shipped [] in
      // that table's place while exportMyData still answered { ok: true }: a privacy export
      // silently claiming "this is all your data". Any failed read now throws into the
      // outer catch below, which answers ok:false instead of downloading a hollow file.
      const grab = async (table, col, cols = '*') => {
        const { data, error } = await sb.from(table).select(cols).eq(col, RT.userId);
        if (error) throw error;
        return data || [];
      };
      const rpcRows = async (fn, args) => {
        const { data, error } = await sb.rpc(fn, args);
        if (error) throw error;
        return data || [];
      };
      const [profile, athleteProfile, days, meals, weights, planMeta] = await Promise.all([
        grab('profiles', 'id'),
        grab('athlete_profiles', 'athlete_id', 'athlete_id,level,sport,position,base_height,base_age,base_goal,season_goal,team_code,updated_at,dob,standard'),
        grab('days', 'athlete_id', DAY_SELECT_COLS),
        grab('meals', 'athlete_id'),
        rpcRows('weight_series', { athlete: RT.userId, days_back: 366 }),
        rpcRows('athlete_plan_meta', { athlete: RT.userId }),
      ]);
      const wByDate = new Map(weights.map((r) => [String(r.date), r.weight]));
      for (const d of days) if (wByDate.has(String(d.date))) d.current_weight = wByDate.get(String(d.date));
      if (athleteProfile[0] && planMeta[0]) Object.assign(athleteProfile[0], planMeta[0]);
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { id: RT.userId, email: RT.email },
        profile, athleteProfile, days, meals,
        note: 'Meal photos are stored privately; each meals row lists its photo_path. Contact support@onstandard.app for a full media export.',
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `onstandard-export-${String(DAY.date)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Export failed. Check your connection and try again.' };
    }
  },
  async saveAthleteProfile(fields) {
    const sb = window.sb;
    if (!sb || !RT.userId) return false;
    // base_weight rides the 0181 set_my_base_weight door, never the direct upsert: 0103's wall
    // removed its SELECT grant, and Postgres rejects an ON CONFLICT upsert that references an
    // ungranted column via `excluded.` — WITH base_weight in the row the whole save 42501'd,
    // which silently failed onboarding's profile sync (same root cause as the day-push bug).
    // dob rides the 0210 set_my_dob door for the same class of reason: its direct write is
    // revoked so a minor can't edit themselves into an adult on the consent gates.
    const { base_weight, dob, ...rest } = fields || {};
    try {
      let ok = true;
      if (Object.keys(rest).length) {
        const { error } = await sb.from('athlete_profiles').upsert({ athlete_id: RT.userId, ...rest });
        ok = !error;
      }
      if (base_weight != null) {
        const { error } = await sb.rpc('set_my_base_weight', { w: Math.round(Number(base_weight)) });
        ok = ok && !error;
      }
      if (dob) {
        const r = await this.setMyDob(dob);
        ok = ok && r.ok;
      }
      return ok;
    } catch { return false; }
  },
  /* dob writes go through the 0210 server door, which refuses to flip a provable minor to
     adult ("age locked") and refuses under-13 dates ("age floor"). Returns { ok, reason }
     with reason 'locked' | 'floor' | null so the UI can tell a refusal (say why) from a
     network failure (offer retry) instead of blaming the connection for both. Falls back to
     the legacy direct upsert ONLY when the server predates the door (PGRST202: no such
     function) — on a post-0210 server that path is revoked, so the fallback can't reopen it. */
  async setMyDob(dob) {
    const sb = window.sb;
    if (!sb || !RT.userId) return { ok: false, reason: null };
    try {
      const { error } = await sb.rpc('set_my_dob', { d: dob });
      if (!error) return { ok: true, reason: null };
      if (error.code === 'PGRST202') {
        const { error: e2 } = await sb.from('athlete_profiles').upsert({ athlete_id: RT.userId, dob });
        return { ok: !e2, reason: null };
      }
      const msg = String(error.message || '');
      return { ok: false, reason: /age locked/.test(msg) ? 'locked' : (/age floor/.test(msg) ? 'floor' : null) };
    } catch { return { ok: false, reason: null }; }
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
    // First-day activation anchor: stamped once, at signup, from the hold-to-commit moment (or now).
    // Everything scored before this instant is "Not required" — the athlete is never punished for
    // windows that closed before their account existed. Idempotent (set once; retries never move it).
    if (!RT.activationDate) {
      const c = ob.committedAt ? parseActivation(ob.committedAt) : null;
      RT.activationDate = (c && c.date === todayISO()) ? ob.committedAt : new Date().toISOString();
      save();
    }
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
      synced.stamps = await this._stampConsent(RT.activationDate || ob.committedAt);
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
          // Slice F: a joiner self-declares their INITIAL responsibility (0078 allows exactly
          // that once; widening later is head-coach-only).
          try { await this._applyCoachResponsibility(row.team_id, false); } catch { /* best-effort */ }
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
        // 0202: the dietitian flow (obd) rides this same rail with coach scratch carrying
        // discipline 'nutrition' — the team book then wears the nutrition lens for good.
        team_discipline: c.discipline === 'nutrition' ? 'nutrition' : 'training',
      });
      if (error || !code) return false;
      this.captureOb({ teamCode: code });
      // Slice F: land the responsibility + starting-standard choices on the fresh team.
      // Best-effort — the account/team/code above is the contract; these refine it.
      try { await this._finishCreatedTeamSetup(); } catch { /* editor can publish later */ }
      return true;
    } catch { return false; }
  },
  /* Create the team from INSIDE the app, after onboarding is over.
     This closes a hard dead end. persistCoachOnboarding() returns false when create_team fails
     (RLS, a dropped connection, a bad org insert) and every caller ignored that boolean, so the
     coach was marched onto the dashboard with no team. S.coachIdentity then reports state
     'minting' and the empty dashboard said "Creating your athlete code… reopen the app and it'll
     retry" — but NOTHING retried, and no act.* method could create a team outside onboarding.
     The coach could never get a join code, so no athlete could ever join: the product was over
     for them, with the UI blaming a mint that was never running.
     Returns {ok} or {ok:false, error} so the caller can say what actually went wrong. */
  async createTeamNow(name) {
    const sb = window.sb;
    if (!sb || !RT.userId) return { ok: false, error: "You're offline. Reconnect and try again." };
    const teamName = String(name || '').trim();
    if (!teamName) return { ok: false, error: 'Give your team a name first.' };
    const c = ((RT.ob || {}).coach) || {};
    try {
      const { data: code, error } = await sb.rpc('create_team', {
        team_name: teamName,
        team_sport: c.sport || (RT.profile && RT.profile.sport) || null,
        team_org: c.orgId || null,
        team_discoverable: c.discoverable !== false,
        team_discipline: c.discipline === 'nutrition' ? 'nutrition' : 'training',
      });
      if (error || !code) return { ok: false, error: friendlyTeamCreate(error) };
      this.captureOb({ teamCode: code });
      try { await this._finishCreatedTeamSetup(); } catch { /* editor can publish later */ }
      await this._loadTeamIntoRt(RT.userId);   // pull the real id/name/code back into RT
      return { ok: true, code };
    } catch (e) {
      return { ok: false, error: friendlyTeamCreate(e) };
    }
  },
  /* Slice F: after the team/staff link exists, apply the onboarding responsibility choice.
     A staff-code JOINER self-declares their initial narrowing via set_staff_scope (0078
     permits exactly that once). The team CREATOR is the head coach — the server keeps the
     head-coach row whole-team, so their choice seeds the client Home scope filter instead. */
  async _applyCoachResponsibility(teamId, isCreator) {
    const sb = window.sb;
    const c = ((RT.ob || {}).coach) || {};
    if (!sb || !teamId || !c.responsibility) return;
    const { scopeForResponsibility } = await import('./staff-access.js');
    const scope = scopeForResponsibility(c.responsibility, c.respRooms);
    if (isCreator) {
      if (scope.kind === 'position' && !String(scope.value || '').includes(',')) {
        try { const { setScope } = await import('./coach-data.js'); setScope({ kind: 'position', value: scope.value }); }
        catch { /* scope selector defaults to whole team */ }
      }
      return;
    }
    try {
      if (scope.kind === 'group') {
        // Mint the private group first (a readonly joiner can't insert one — skips silently;
        // the head coach can scope them from Staff later).
        const { data: g } = await sb.from('coach_groups')
          .insert({ team_id: teamId, name: 'My athletes', athlete_ids: [] }).select('id').maybeSingle();
        if (g && g.id) await sb.rpc('set_staff_scope', { p_team: teamId, p_staff: RT.userId, p_kind: 'group', p_value: g.id });
        return;
      }
      if (scope.kind === 'position') {
        await sb.rpc('set_staff_scope', { p_team: teamId, p_staff: RT.userId, p_kind: 'position', p_value: scope.value });
      }
    } catch { /* best-effort — never blocks onboarding */ }
  },
  /* Slice F, CREATE path only: resolve the fresh team's id, apply responsibility, and seed
     the chosen template as the team standard. Never runs on the staff-join path — joining
     must not stomp an existing team's standard. */
  async _finishCreatedTeamSetup() {
    const sb = window.sb;
    const c = ((RT.ob || {}).coach) || {};
    if (!sb) return;
    let teamId = null;
    try {
      const { data: t } = await sb.from('teams').select('id').limit(1).maybeSingle();
      teamId = t && t.id;
    } catch { return; }
    if (!teamId) return;
    await this._applyCoachResponsibility(teamId, true);
    if (c.standardTemplate && c.standardTemplate !== 'default') {
      try {
        const { seedTemplates } = await import('./templates.js');
        const tpl = seedTemplates().find((s) => s.kind === c.standardTemplate);
        if (tpl) {
          await sb.rpc('set_team_requirements', {
            p_team: teamId, p_scope_kind: 'team', p_scope_value: null, p_items: tpl.items,
          });
        }
      } catch { /* the standards editor can publish it later */ }
    }
  },
  /* Mint the trainer's real practice + client code. Idempotent via RT.ob.practiceCode.
     `discipline` (0197): 'training' (default) or 'nutrition' — the Nutrition Pro onboarding
     passes 'nutrition' so the dietitian/nutritionist identity survives server-side; before this
     the flow graduated into a practice indistinguishable from any trainer's. */
  async persistTrainerOnboarding(discipline) {
    const sb = window.sb;
    const ob = RT.ob || {};
    const t = ob.trainer || {};
    if (!sb || !RT.userId) return false;
    await this._stampConsent(null); // best-effort; never gates practice creation
    if (ob.practiceCode) return true;
    try {
      // is_discoverable carries the trainer's OWN answer from step 1's "Listed in client search"
      // toggle. It used to be a hardcoded `true`, which published every practice to the directory
      // with no consent moment at all. Absent (a session restored mid-flow from before the toggle
      // existed) keeps the historical default rather than silently un-listing anyone.
      const { data: code, error } = await sb.rpc('create_practice', {
        practice_name: t.practiceName || 'My Practice', practice_handle: null,
        is_discoverable: t.discoverable !== false,
        ...(discipline === 'nutrition' ? { p_discipline: 'nutrition' } : {}),
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
    // The queue is durable, so a launch can inherit work: a read killed mid-flight, a meal logged
    // last night in a dead zone. It used to wait for the athlete to background and foreground the
    // app before anything touched it. The moment there is a user to run it for, run it.
    void this.drainMealOutbox();
    void this.drainSyncQueue();
    if (!RT.authRole) {
      try {
        const { data: prof } = await window.sb.from('profiles').select('primary_role').eq('id', user.id).maybeSingle();
        if (prof && prof.primary_role) { RT.authRole = prof.primary_role; save(); }
      } catch { /* offline — routes as athlete until the next successful boot */ }
    }
    // Capture the device timezone once (0088) — powers coach-side, athlete-local overdue. Best-effort:
    // a not-yet-applied profiles.timezone column or offline just no-ops.
    try {
      const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
      if (tz && window.sb) void window.sb.from('profiles').update({ timezone: tz }).eq('id', user.id);
    } catch { /* best-effort */ }
  },
  /* Someone who already saw the tour on another device (or before a reinstall) must not be
     tutorialized again — seed the local flag from the server stamp (0165).

     Deliberately its OWN select rather than a column added to _loadProfileIntoRt's: prod runs
     ahead of the migrations on this branch, and a not-yet-existing column would fail that whole
     query, taking full_name and committed_at down with it. Isolated here, a pre-0165 DB costs
     one rejected request and the tour simply runs again on this device — the safe direction. */
  /* Own isolated select (2026-08-02), same reasoning as _loadTourSeenIntoRt just below: prod may
     run ahead of the migrations on this branch, and a not-yet-existing column would fail
     _loadProfileIntoRt's whole query, taking full_name and committed_at down with it. A rejected
     request here just leaves RT.emailVerified at its null default — no banner, no false claim. */
  async _loadEmailVerifiedIntoRt(userId) {
    if (!userId || !window.sb) return;
    try {
      const { data, error } = await window.sb.from('profiles').select('email_verified').eq('id', userId).maybeSingle();
      if (error || !data || data.email_verified == null) return;
      RT.emailVerified = !!data.email_verified;
      save();
    } catch { /* offline or pre-migration — banner stays hidden rather than guessing */ }
  },
  /* Fire-and-forget resend, called from the banner's Resend button. Never throws into the UI —
     the caller reads the returned {ok,error} and shows it inline. */
  async requestEmailVerification() {
    const sb = window.sb;
    if (!sb) return { ok: false, error: "You're offline. Reconnect and try again." };
    try {
      const { data, error } = await sb.functions.invoke('send-verify-email');
      if (error) {
        // On a non-2xx, supabase-js throws FunctionsHttpError and `data` is null — the real
        // body (our own "Wait N seconds…" text on a 429) lives on error.context.json() (same
        // idiom as roles.js's billing-checkout / meal-chat handling).
        const body = await (async () => { try { return await error.context?.json?.(); } catch { return null; } })();
        return { ok: false, error: (body && body.error) || 'Could not send the verification email. Try again.' };
      }
      if (data && data.ok === false) return { ok: false, error: data.error || 'Could not send the verification email. Try again.' };
      return { ok: true, emailed: !!(data && data.emailed) };
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection." };
    }
  },
  async _loadTourSeenIntoRt(userId) {
    const id = TOUR_IDS[RT.authRole];
    if (!userId || !id || !window.sb) return;
    if ((RT.tourSeen || {})[id]) return; // already known locally — no round trip at all
    try {
      const { data, error } = await window.sb.from('profiles').select('tour_seen_at').eq('id', userId).maybeSingle();
      if (error || !data || !data.tour_seen_at) return;
      RT.tourSeen = { ...(RT.tourSeen || {}), [id]: data.tour_seen_at };
      save();
    } catch { /* pre-0165 or offline — the tour runs, which is the safe failure */ }
  },
  // Load today's real day from Supabase and reflect it into the UI flags.
  async hydrateDay() {
    if (RT.userId) {
      await this._loadProfileIntoRt(RT.userId);
      await this._loadTourSeenIntoRt(RT.userId);
      // Re-check every boot until it's TRUE, then stop — the flip happens server-side (the user
      // clicks the emailed link in a browser, not in this app), so a cached `false` from an
      // earlier session must not freeze the banner on forever; a cached `true` never needs
      // asking again, same one-way logic as _loadTourSeenIntoRt just below.
      if (RT.emailVerified !== true) await this._loadEmailVerifiedIntoRt(RT.userId);
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
    // Coming BACK is when queued meal work gets its chance: the athlete may have logged in a dead
    // zone, or the app may have been killed mid-analysis. The queue is durable; this is its beat.
    // The small-writes queue and the day-push healer ride the same beat.
    if (document.visibilityState === 'visible' && RT.userId) {
      void act.drainMealOutbox();
      void act.drainSyncQueue();
      act.healDaySync();
    }
    // Re-stamp the daypart on resume. A phone put down at 4pm and picked up at 9pm would otherwise
    // greet you with "Good evening" over an afternoon canvas, which is exactly the disagreement
    // between copy and canvas this was built to remove.
    if (document.visibilityState === 'visible') applyDaypart();
  });
}
// Reconnect is the other beat. Both are best-effort and the drain is serialized, so overlapping
// events can never run a job twice.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => {
    if (!RT.userId) return;
    void act.drainMealOutbox();
    void act.drainSyncQueue();
    act.healDaySync();
  });
}
// The third beat is the app's own: act._scheduleDrain() re-arms after every drain, so a retry no
// longer depends on the athlete backgrounding the app to make it happen. Boot is covered by
// _syncSession, which drains the moment there is a signed-in user to drain for.

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
      initials: initialsOf(name, 'A'),
      sport: p.sport || '', position: p.position || '',
      school: p.school || '', level: p.level || '',
      avatar: p.avatar || null,
    };
  },
  // The athlete's REAL linked coach — from their active team membership + the head coach's
  /* ---------- PLAN STYLE (0142) — the ONE surface every screen reads ----------
     Style, its knobs, who set it, whether it's locked, and the athlete's own stated preference.
     `showCalories`/`showMacros` are the presentation gate an Intuitive plan turns off: the
     numbers are still COMPUTED and still visible to the professional (an under-fueling read is a
     safety signal), they are simply not shown to the athlete. Suppression is presentation, never
     data — no surface should ever skip computing a number because of a style. */
  get planStyle() {
    const res = RT.planStyle || resolveMyPlanStyle();
    const label = styleLabel(res.style);
    return {
      key: res.style,
      name: label.name,
      short: label.short,
      how: label.how,
      knobs: res.knobs,
      source: res.source,
      sourceLabel: styleSourceLabel(res, this.coach.noun),
      locked: res.locked,
      lockedBy: res.lockedBy,
      canChoose: res.canChoose,
      preference: res.preference,
      preferenceName: res.preference ? styleLabel(res.preference).name : null,
      // true when the athlete wants something other than what governs them — the honest signal
      // the professional's roster surfaces, and the reason the athlete sees "preference shared".
      preferenceDiffers: !!(res.preference && res.preference !== res.style),
      customized: !!(res.knobs && res.knobs.customized),
      showCalories: !!(res.knobs && res.knobs.surface.showCalories),
      showMacros: !!(res.knobs && res.knobs.surface.showMacros),
      tone: (res.knobs && res.knobs.surface.tone) || 'guidance',
    };
  },
  /** The nutrition component's real share of this athlete's score, as a whole percent. Every
   *  surface that explains the score reads this instead of hardcoding 50 — the share moves with
   *  the style x goal profile, and a number the athlete can check has to be the true one. */
  get nutritionWeightPct() { return Math.round(weightsForDay(DAY).nutrition * 100); },

  /* WHAT the nutrition sub-score is actually made of, for the athlete who has no targets and
     asks "then what am I being graded on?". Two engine paths, and this reports whichever one is
     really running (day.js nutritionScore): the `parts` composition for Guided/Intuitive/
     customized, or the shipped per-goal-profile formula for Structured. The numbers below are the
     engine's own — legacyNutritionScore's literals — so a change there that isn't mirrored here
     shows up as a contradiction on one screen rather than being invisible. */
  get nutritionFormula() {
    const PART_LABEL = {
      protein: 'Protein', calorie: 'Calories', timing: 'Meals on time',
      hydration: 'Hydration', quality: 'Meal quality', awareness: 'Body signals',
    };
    const knobs = this.planStyle.knobs;
    if (knobs && knobs.nutrition && knobs.nutrition.formula === 'parts' && knobs.parts) {
      const parts = Object.keys(PART_LABEL)
        .filter((k) => (knobs.parts[k] || 0) > 0)
        .map((k) => ({ key: k, label: PART_LABEL[k], pct: Math.round(knobs.parts[k]) }));
      return { mode: 'parts', parts };
    }
    const profile = DAY.scoringProfile || 'athlete';
    if (profile === 'general') {
      return { mode: 'legacy', parts: [
        { key: 'calorie', label: 'Calorie adherence', pct: 45 },
        { key: 'protein', label: 'Protein', pct: 25 },
        { key: 'timing', label: 'Meals logged', pct: 30 },
      ] };
    }
    if (profile === 'gain') {
      return { mode: 'legacy', parts: [
        { key: 'calorie', label: 'Calorie floor', pct: 40 },
        { key: 'protein', label: 'Protein', pct: 35 },
        { key: 'timing', label: 'Meals logged', pct: 25 },
      ] };
    }
    return { mode: 'legacy', parts: [
      { key: 'protein', label: 'Protein', pct: 65 },
      { key: 'timing', label: 'Meals on time', pct: 35 },
    ] };
  },

  /** The score timeline banded by the style that governed each stretch, newest last.
   *  [{ style, name, days, from, to, avg }] — Progress renders these so a trend break reads as
   *  "the plan changed here", never as an unexplained drop. Days with no stamp (pre-0142 history)
   *  are attributed to Structured, which is exactly how they were scored. Real rows only. */
  get styleBands() {
    const hist = Array.isArray(DAY.scoreHistory) ? DAY.scoreHistory : [];
    const rows = [...hist.map(h => ({ date: h.date, score: h.score || 0, style: h.planStyle || 'structured' })),
      { date: DAY.date, score: this.score, style: DAY.planStyle || 'structured' }];
    const bands = [];
    for (const r of rows) {
      const last = bands[bands.length - 1];
      if (last && last.style === r.style) { last.days++; last.to = r.date; last._sum += r.score; }
      else bands.push({ style: r.style, name: styleLabel(r.style).name, days: 1, from: r.date, to: r.date, _sum: r.score });
    }
    return bands.map(b => ({ ...b, avg: Math.round(b._sum / b.days) }));
  },

  /** Plain-English names of the body signals this plan tracks (for the Plan/Progress copy). */
  get trackedSignalLabels() {
    const knobs = this.planStyle.knobs;
    return SIGNAL_KEYS.filter(s => knobs && knobs.signals && knobs.signals[s.key]).map(s => s.label);
  },

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
    return {
      hasCoach: !!src,                  // a real coach (team) OR trainer (practice) link exists
      kind,                             // 'coach' | 'trainer' | null — lets copy pick the noun
      noun: kind === 'trainer' ? 'trainer' : 'coach',
      isNamed: !!name,                  // the mentor's real display name is known
      name: name || (kind === 'trainer' ? 'Your trainer' : 'Your coach'),   // sentence-start
      nameMid: name || (kind === 'trainer' ? 'your trainer' : 'your coach'), // mid-sentence
      initials: initialsOf(name, kind === 'trainer' ? 'T' : 'C'),
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
    const initials = initialsOf(realName, 'C');
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
    // 'training' | 'nutrition' (0197) — the dietitian/nutritionist lens key for HQ + vocab.
    const discipline = (RT.practice && RT.practice.discipline) === 'nutrition' ? 'nutrition' : 'training';
    // The neutral fallback follows the discipline: a nutrition practice with an un-hydrated
    // profile was greeting its owner as "Trainer" with a "T" monogram on the screen the obn
    // flow calls Practice HQ — the one word that role never chose for themselves.
    const fallbackName = discipline === 'nutrition' ? 'Dietitian' : 'Trainer';
    const initials = initialsOf(realName, discipline === 'nutrition' ? 'D' : 'T');
    const state = RT.practiceLoading ? 'loading' : RT.practiceOffline ? 'offline' : !code ? 'minting' : 'live';
    return {
      name: realName || fallbackName,
      initials,
      practiceName: realPractice || 'Your practice',
      code,
      discipline,
      hasIdentity: !!realName && !!realPractice,
      state,
    };
  },

  /* The signed-in OPERATOR's own identity — coach or trainer, ONE shape, so a shared operator
     screen greets the right person with the right noun instead of calling a trainer "Coach".
     Mirrors S.coach, which is the ATHLETE's view of their operator; this is the operator's view
     of themselves. `bookName` is the team or the practice — whichever they run. */
  get operatorIdentity() {
    if (RT.authRole === 'trainer') {
      const t = this.trainerIdentity;
      return { kind: 'practice', handle: t.name, initials: t.initials, bookName: t.practiceName, code: t.code, state: t.state, hasIdentity: t.hasIdentity };
    }
    const c = this.coachIdentity;
    return { kind: 'team', handle: c.handle, initials: c.initials, bookName: c.teamName, code: c.code, state: c.state, hasIdentity: c.hasIdentity };
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
  /* ONE ceiling engine. This was `computeScore(componentsDone())` — a projection that marks every
     remaining meal logged but never gives it protein, so with protein ~65% of nutrition it could
     answer "up to 63" while the breakdown's reach plan (which spreads the remaining protein
     across the open slots, sum-exact) answered "up to 100" ONE TAP AWAY, about the same day, at
     the same instant. Two ceilings 37 points apart on a product whose first principle is that the
     score is honest. The breakdown engine is the survivor: it is pure, sequential, and already
     the number every "how to climb" row sums to. Home's ring arc, the action hub, the meal chip
     and the coach nudge all read THIS getter, so the five surfaces can no longer disagree.
     (projectedDay keeps componentsNow/components alive for the in-progress bars; it just no
     longer gets to define the ceiling.) */
  get possible() { try { return Math.max(this.score, this.maxPossible); } catch { return this.score; } },
  get tier() { return tier(this.score); },
  // Yesterday's real score from history, or null if yesterday has no row (the ring then
  // hides the "vs yesterday" delta rather than comparing against a different day).
  get scoreYesterday() {
    const d = new Date(DAY.date + 'T00:00:00'); d.setDate(d.getDate() - 1);
    const yISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const y = (DAY.scoreHistory || []).find(h => h.date === yISO);
    return y ? y.score : null;
  },
  get streakDays() { return dayStreak(activationDateOnly()); },
  // First-day activation state (no retroactive failure). notYetScored is true for the whole
  // activation day: the athlete may log (and the coach sees it), but the day shows "Not scored
  // yet" and doesn't grade/streak — full scoring resumes the next local day.
  get activation() { return activationInfo(activationStamp(), String(DAY.date)); },
  get notYetScored() { return this.activation.notYetScored; },
  // A day is "decided" once no required window is still open on time — the point at which a
  // negative verdict (Off Standard / a red Missed pill) is honest. Derived from exec, no recompute.
  get dayDecided() { return this.exec.decided; },
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
    const info = streakInfo(activationDateOnly());
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
  /* The goal, fully decoded — what the Plan header's goal pill opens into.
     Every field is REAL or null; nothing here is a placeholder. In particular there is no stored
     "target rate", so this does not invent one: it reports the actual measured movement and
     whether that movement is heading toward the target (S.weight's own pace rule).
     Provenance is split because the two halves genuinely have different owners: base_goal and
     season_goal are written by the athlete's own onboarding, while athlete_profiles.targets is
     written only by coach_set_goals — a coach or trainer. */
  get planGoal() {
    const p = RT.profile || {};
    const key = p.baseGoal || null;
    const w = this.weight;
    const coachSet = !!this.planTargets;
    const bw = (p.baseWeight != null ? +p.baseWeight : 0) || (w.current != null ? +w.current : 0) || 0;
    // What the goal DOES: the scoring branch it selects and the numbers it derives when no
    // professional has set their own. This is the honest answer to "what's the strategy".
    const derived = key ? nutritionConfigForGoal(key, bw, null) : null;
    const STRATEGY = {
      lose: 'Calorie target below maintenance, protein held high.',
      lose_fat: 'Calorie target below maintenance, protein held high.',
      gain: 'Calorie surplus with protein scaled to bodyweight.',
      build: 'Calorie surplus with protein scaled to bodyweight.',
      maintain: 'Calories held near maintenance.',
      health: 'Calories held near maintenance.',
      perform: 'Fuel for training load: a performance formula, not a weight formula.',
      performance: 'Fuel for training load: a performance formula, not a weight formula.',
    };
    return {
      key,
      label: this.planGoalLabel,
      strategy: key ? (STRATEGY[key] || null) : null,
      current: w.current != null ? Number(w.current) : null,
      target: w.target,
      start: w.start,
      unit: w.unit,
      // The measured movement across the logged history, and whether it points at the target.
      // Null when there aren't two weigh-ins to compare — never a fabricated rate.
      moved: w.deltaMonth,
      pace: w.pace,
      // Weight is deliberately outside the daily score; the pill must never imply otherwise.
      weightScored: false,
      derivedProtein: derived ? derived.proteinTarget : null,
      derivedCalories: derived ? derived.calTarget : null,
      targetsAreCoachSet: coachSet,
      targetsSetBy: coachSet && this.coach.hasCoach && this.coach.isNamed ? this.coach.name : null,
      startedOn: activationDateOnly(),
    };
  },

  /* The requirement_set actually governing this athlete today — the provenance behind every row
     on Plan · Requirements. Null when no coach set governs (the OnStandard baseline), which is
     exactly the case where attributing rules to a named coach would be a lie. */
  get governingStandard() {
    const sets = RT.reqSets || [];
    if (!sets.length) return null;
    const set = resolveRequirementSet(sets, RT.userId, RT.myRoomLabel || (RT.profile || {}).position, String(DAY.date));
    if (!set) return null;
    return {
      name: (set.name || '').trim() || null,
      scopeKind: set.scope_kind || null,
      scopeLabel: set.scope_kind === 'athlete' ? 'Set for you'
        : set.scope_kind === 'position' ? `Set for ${set.scope_value || 'your room'}`
          : 'Your team standard',
      setBy: this.coach.hasCoach && this.coach.isNamed ? this.coach.name : null,
      effectiveDate: set.effective_date || null,
      updatedAt: set.updated_at || null,
    };
  },

  // Experience voice (mirrors roleVoice.experienceKind: general profile = lose/maintain →
  // the personal-client experience; athlete/gain keep the team frame). Gates recruiter/sport
  // copy that reads wrong aimed at an adult on a personal goal.
  get experience() {
    const g = RT.profile && RT.profile.baseGoal;
    return (g === 'lose' || g === 'maintain') ? 'client' : 'athlete';
  },

  /* Which SURFACES render — as opposed to `experience`, which only picks a tone. `experience`
     classifies on base_goal, a GOAL, to answer a RELATIONSHIP question, and gets it backwards in
     both directions: a client who hired a trainer to GAIN 15 lb reads as 'athlete' and gets asked
     for a sport/school; a team athlete cutting to make weight reads as 'client' and loses the
     team frame. The honest key is the LINK itself (S.coach.kind), which is already server truth.
     Unconnected (no coach, no trainer) falls back to the goal-derived voice — there's no link to
     be honest about yet. Coach-before-trainer mirrors S.coach's own precedence (state.js:2128):
     someone linked to both gets the higher-stakes team frame. */
  get audience() {
    const kind = this.coach.kind;
    if (kind === 'trainer') return 'client';
    if (kind === 'coach') return 'athlete';
    return this.experience;
  },

  // How many meals today's standard requires (coach standard 1–6, classic 3) — the one number
  // Plan copy should quote instead of a hardcoded "three" (WS7 audit fix).
  get mealsRequiredCount() { return reqMealSlots().length; },

  /* The rulebook rows Plan's Schedule tab renders: the classic CATALOG, or — when a coach
     standard governs (WS3 slice 2) — ITS meal slots (count/titles/windows) plus the non-meal
     catalog rows. Same mapping as the exec engine, so the rulebook can never contradict Home. */
  get scheduleCatalog() {
    // Classic baseline: the rulebook admits to the snack the engine already scores (denominator 4,
    // 5:00 PM deadline) instead of hiding a slot worth a quarter of the meals count. Display layer
    // only — exec.js keeps deriving Home from the unchanged CATALOG.
    if (!RT.stdMeals) return [...CATALOG, SNACK_BONUS];
    return [
      ...reqMealSlots().map((k) => {
        const base = CATALOG.find(c => c.id === k);
        return {
          id: k, title: (RT.stdMeals.titles && RT.stdMeals.titles[k]) || (base ? base.title : cap(k.replace('-', ' '))),
          icon: base ? base.icon : 'utensils', accent: base ? base.accent : 'g', proof: 'photo',
          freq: { type: 'daily' },
          // label dropped on purpose: the standard's deadline is the truth; a cached classic
          // label ("Due by 8:00 PM") would lie about a moved window.
          window: { ...(base ? base.window : {}), open: slotOpen(k), due: slotDeadline(k), label: null },
          required: true, impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
          note: base ? base.note : 'Photo proof is part of your room standard.',
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

  /* Home's score-bar segments. THIS USED TO BE a second, independent four-category formula
     (its own weights, its own copy) that could drift from the Score Breakdown screen — exactly
     what breakdown-model.js's opening comment forbids ("never a second formula that could
     drift"). It also credited `w.recovery * c.recovery` (raw answer quality) instead of
     `c.recoveryContribution` (what the score actually pays, which is zero with no check-in
     tonight), so it showed ~10 phantom points on every no-check-in day. Both bugs are gone
     because this is no longer a formula: it's the SAME `explain` getter the Score Breakdown
     screen renders (breakdown-model.js explainCategories) — two entries, Nutrition then
     Recovery, each carrying { key, accent, earned, possible, ... }. The two surfaces literally
     cannot disagree now. */
  get breakdown() { return this.explain; },

  /* ---------- SCORE EXPLANATION (spec §2) — the pure model over the live day ---------- */
  // One options object for every breakdown-model call, so the explanation can never use a
  // different slot list / denominator / clock than the engine that scored the day.
  get _explainOpts() {
    const std = RT.stdMeals;
    const slots = (std && Array.isArray(std.slots) && std.slots.length) ? std.slots : MEAL_KEYS;
    return {
      slots,
      denom: (std && std.mealsRequired) || 4,
      titles: Object.fromEntries(slots.map(k => [k, slotTitle(k)])),
      optional: std ? [] : ['snack'],
      nowMin: minutesNow(),
      fmtClock,
    };
  },
  get explain() { return explainCategories(DAY, this._explainOpts); },
  get reach() { return modelReachPlan(DAY, this._explainOpts); },
  get maxPossible() { return maxPossibleScore(DAY, this._explainOpts); },
  /** Best score movement one meal can cause right now — "up to +N" on the camera (§4.4). */
  mealUpTo(slot) {
    try { return mealMaxGain(DAY, slot, this._explainOpts); } catch { return 0; }
  },
  /** Real day math for the AI conversation (upgrade 2026-07-16): protein so far (the same
   *  evidence rule the score uses), the athlete's real target, and required meals remaining. */
  get mealDayProgress() {
    let soFar = 0;
    for (const k of Object.keys(DAY.meals)) {
      if (mealScored(DAY, k) && DAY.slotMacros[k]) soFar += DAY.slotMacros[k].protein || 0;
    }
    const remaining = reqMealSlots().filter(k => !mealScored(DAY, k)).length;
    return {
      proteinSoFar: Math.round(soFar),
      proteinTarget: DAY.proteinTarget > 0 ? DAY.proteinTarget : 180,
      mealsRemaining: remaining,
    };
  },
  /** Consumed-so-far for Plan's What-Should-I-Eat card — same evidence rule as the score
   *  (only scored slots count), kcal alongside protein. */
  get dayConsumed() {
    let protein = 0, kcal = 0;
    for (const k of Object.keys(DAY.meals)) {
      if (mealScored(DAY, k) && DAY.slotMacros[k]) {
        protein += DAY.slotMacros[k].protein || 0;
        kcal += DAY.slotMacros[k].kcal || 0;
      }
    }
    return { protein: Math.round(protein), kcal: Math.round(kcal) };
  },
  /** Engine-computed Daily Score credit for one logged slot (exposed for the AI opening). */
  mealScoreImpact(slot) {
    try { return mealImpact(slot); } catch { return 0; }
  },
  get weightLine() {
    if (RT.weightLogged) {
      return { label: 'Morning Weight', state: 'late', note: 'Logged late tonight. Counts for your season trend; never for the daily score.' };
    }
    return minutesNow() <= WEIGHT_DUE
      ? { label: 'Morning Weight', state: 'open', note: `Weigh in by ${fmtClock(WEIGHT_DUE)} to keep your season trend current.` }
      : { label: 'Morning Weight', state: 'missed', note: "Missed today. It doesn't affect your score. Weight only tracks your season trend." };
  },
  get reachPlan() {
    const plan = [];
    reqMealSlots().forEach(k => { if (!mealScored(DAY, k)) plan.push({ label: `Log ${cap(k)}`, gain: null, accent: 'g' }); });
    if (!DAY.ciSubmitted) { const g = checkinProjection().gain; plan.push({ label: 'Submit recovery check-in', gain: g || null, accent: 'p' }); }
    return plan;
  },

  get requirements() {
    /* ---- ENGINE-DERIVED: today's list from the catalog + REAL runtime (DAY) ----
       (A hardcoded day-0 branch used to sit here returning "Lunch · Upcoming · Due by 2:00 PM"
       regardless of the real clock or the athlete's standard. It had no consumer, so it never
       rendered — deleted rather than left as a landmine for whoever wires this up next.) */
    const lateMeal = (k) => DAY.mealLoggedAt[k] != null && DAY.mealLoggedAt[k] > slotDeadline(k);
    const resolve = (id) => {
      switch (id) {
        case 'breakfast': return { done: mealScored(DAY, 'breakfast'), late: lateMeal('breakfast') };
        case 'lunch':     return { done: mealScored(DAY, 'lunch'), late: lateMeal('lunch') };
        case 'dinner':    return { done: mealScored(DAY, 'dinner'), late: lateMeal('dinner') };
        case 'weight':    return { done: RT.weightLogged, late: RT.weightLogged };
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
          sub = "Logged, but this photo was already used, so it doesn't count";
          subColor = 'a';
        }
      } else if (d.id === 'weight') {
        meta = d.done ? 'Trend only' : 'Not scored'; route = 'weight';
      } else if (d.id === 'recovery') {
        meta = d.done ? 'Recovery in' : `Recovery · ${liveWeightPct('recovery')}%`; route = d.done ? 'recovery-confirm' : 'recovery';
      } else { meta = ''; route = 'home'; }
      return { ...d, meta, route, sub, subColor };
    };
    const now = minutesNow();
    // With no governing standard the classic catalog renders byte-identically. A coach
    // standard (0055) swaps the meal rows for ITS slots — count, titles, and windows —
    // while weight/recovery keep their catalog behavior.
    const effCatalog = !RT.stdMeals
      ? CATALOG.filter(r => runsToday(r) && r.id !== 'weekly')
      : [
        ...reqMealSlots().map((k) => {
          const base = CATALOG.find(c => c.id === k);
          const title = (RT.stdMeals.titles && RT.stdMeals.titles[k]) || (base ? base.title : cap(k.replace('-', ' ')));
          return {
            id: k, title, icon: base ? base.icon : 'utensils', accent: base ? base.accent : 'g', proof: 'photo',
            freq: { type: 'daily' }, window: { ...(base ? base.window : {}), open: slotOpen(k), due: slotDeadline(k) },
            required: !(RT.stdMeals.optional && RT.stdMeals.optional.includes(k)), // snack slot = optional
            impact: { kind: 'component', comp: 'nutrition' }, reminder: 'medium',
            note: base ? base.note : 'Photo proof is part of your room standard.',
          };
        }),
        ...CATALOG.filter(r => !REQ_MEAL_SLOTS.includes(r.id) && r.id !== 'weekly' && runsToday(r)),
      ];
    const rows = effCatalog.map(r => decorate(derive(r, resolve(r.id), now)));
    const assigned = RT.assigned.map(a => ({ ...deriveAssigned(a), meta: a.done ? 'Coach sees it' : 'From coach', route: `requirement/${a.id}` }));
    const fresh = assigned.filter(a => a.fresh);
    const rest = assigned.filter(a => !a.fresh);
    return [...fresh, ...rows, ...rest];
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
    for (const k of allMealSlots()) {
      if (!DAY.meals[k]) continue;
      const at = DAY.mealLoggedAt[k];
      const meta = DAY.slotMacros[k] || {};
      // Same lateness rule the score and the breakdown apply — deadline PLUS grace, both from
      // the governing standard. A raw DEADLINE lookup here called a meal on-time that the
      // breakdown was calling late on the very next screen.
      const late = at != null && at > slotDeadline(k) + slotGrace(k);
      // in-session photo for the just-captured slot, else the cached signed Storage URL
      // (photo-store) — the actual submitted image, never a stock plate (spec §7.1).
      const img = slotImage(k);
      a.push({
        noPhoto: !slotHasPhoto(k), // manual/label log: placeholder is honest (§7.2)
        time: at != null ? `Today · ${fmtClock(at)}${late ? ' · late' : ''}` : 'Today',
        // Named slots wear their own glyph; overflow slots (meal-5, meal-6) stay generic.
        type: slotTitle(k), icon: ['breakfast', 'lunch', 'dinner', 'snack'].includes(k) ? k : 'utensils',
        // Meal QUALITY is its own concept (the plate read) and never success-green at 58 —
        // tiers mirror the meal screen: 80+ green, 50+ amber, below red.
        value: meta.quality != null ? String(meta.quality) : 'Logged',
        unit: meta.quality != null ? '/100' : null,
        qualityLabel: meta.quality != null,
        vClass: meta.quality != null ? qualityAccent(meta.quality) : 'muted',
        // Honest Daily Score attribution (computed, never canned) — the accountability credit
        // this log actually earned, separate from how good the plate was.
        impact: mealImpact(k),
        img, route: `meal-detail/${k}`,
      });
    }
    if (RT.weightLogged && DAY.currentWeight != null) a.push({ time: 'Today', type: 'Morning Weight', icon: 'scale', value: `${DAY.currentWeight} lb`, vClass: 'muted', img: null, route: 'weight' });
    a.push(DAY.ciSubmitted
      ? { time: 'Today', type: 'Recovery Check-In', icon: 'moonStar', value: 'Submitted', vClass: 'g', img: null, route: 'recovery' }
      : { time: 'Tonight', type: 'Recovery Check-In', icon: 'moonStar', value: 'Upcoming', vClass: 'muted', img: null, dim: true, route: 'recovery' });
    return a;
  },

  get nextMove() {
    if (RT.day0) return RT.day0Breakfast
      ? { label: 'Log Lunch', gain: null, route: 'camera/lunch', accent: 'g' }
      : { label: 'Log First Meal', gain: null, route: 'camera', accent: 'g' };
    const openReq = reqMealSlots().filter(k => !mealScored(DAY, k));
    const openSlot = openReq.find(k => minutesNow() <= slotDeadline(k)) || openReq[0];
    // Meal gain depends on the plate, unknown until analyzed → no fabricated "+6".
    if (openSlot) return { label: `Log ${slotTitle(openSlot)}`, gain: null, route: `camera/${openSlot}`, accent: 'g' };
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

  // The athlete's own count toward the eligibility gate (0196: >= policy.eligibility_days
  // photo-logged days, lifetime). Primary source is DAY.photoDays — loadDay reads it from the
  // SAME rows grant_pass counts (meals where photo_path is not null, distinct days, lifetime),
  // so the number here is the number the server will actually check. The history sweep below is
  // the OFFLINE fallback only: it is bounded by the heavy-jsonb history window, so it can
  // understate lifetime truth — which is why it never wins over a fetched count. `source` is
  // set by day.js insertMeal from the real capture path ('live' | 'gallery' vs the no-photo
  // 'manual' | 'label'), the closest thing scoreHistory carries to "was there a photo".
  // Counts distinct DATES, since a day can log more than one photographed slot and the gate
  // counts days, not meals. */
  get passEligibleDays() {
    if (typeof DAY.photoDays === 'number') return DAY.photoDays;
    const dates = new Set();
    for (const r of DAY.scoreHistory || []) {
      const sm = r.checkin && r.checkin.slotMacros;
      if (sm && Object.values(sm).some((m) => m && (m.source === 'live' || m.source === 'gallery'))) {
        dates.add(r.date);
      }
    }
    return dates.size;
  },

  // The athlete's live pass (0196). Shape mirrors what the UI needs; no pass means honestly
  // inactive, never a fabricated "day 3 of 14".
  get pass() {
    const list = (DAY.passes || []).filter((p) => p && !p.ended_at && DAY.date <= p.expires_on);
    const p = list[0];
    if (!p) return { active: false, eligible: this.passEligibleDays };
    const left = creditsLeft(p, DAY.passSpends);
    const isWindow = p.credits_total == null;
    if (isWindow) {
      const start = new Date(p.covers_from + 'T00:00:00');
      const now = new Date(DAY.date + 'T00:00:00');
      const len = Math.round((new Date(p.covers_until + 'T00:00:00') - start) / 86400000) + 1;
      const day = Math.min(len, Math.max(1, Math.floor((now - start) / 86400000) + 1));
      return {
        active: true, kind: 'window', day, length: len, note: p.note || null,
        covers_from: p.covers_from, covers_until: p.covers_until,
      };
    }
    return {
      active: true, kind: 'credits', left, total: p.credits_total,
      expires: p.expires_on, note: p.note || null,
    };
  },

  /* ---------- EXECUTION ENGINE (one derivation for Home / Hub / FAB / notifications) ---------- */
  get exec() {
    const mstat = (k) => {
      const at = DAY.mealLoggedAt[k];
      // "late" for display must match scoring: a meal inside the grace window scored on-time,
      // so it reads "Logged", not "Logged late".
      return { done: mealScored(DAY, k), late: at != null && at > slotDeadline(k) + slotGrace(k), at: at != null ? fmtClock(at) : null };
    };
    const std = RT.stdMeals;
    const catalog = execCatalog();
    const status = {
      breakfast: mstat('breakfast'), lunch: mstat('lunch'), dinner: mstat('dinner'),
      // weight due comes from the catalog; late only when we actually know the log time
      weight: { done: RT.weightLogged, late: RT.weightLogged && RT.weightLoggedAt != null && RT.weightLoggedAt > WEIGHT_DUE },
      recovery: { done: DAY.ciSubmitted },
    };
    if (std) for (const k of reqMealSlots()) status[k] = mstat(k);
    // Standing check items (coach lift/custom) take their done-state from the per-day checked store —
    // tracked, not scored. Only fill ids not already sourced above (meals/weight/hydration/recovery).
    for (const it of catalog) {
      if (it && it.proof === 'check' && !(it.id in status)) status[it.id] = { done: !!(DAY.checkedTasks && DAY.checkedTasks[it.id]) };
    }
    return deriveExec({
      nowMin: minutesNow(),
      dow: new Date().getDay(),
      status,
      // A dated assignment (real due_at TODAY) gets a reminder; dateless ones stay list-only.
      assigned: RT.assigned.map((a) => ({ ...a, dueAtMin: dueAtMinToday(a.dueAtISO) })),
      pressure: mapPressure(RT.ob && RT.ob.standard && RT.ob.standard.pressure),
      score: this.score, possible: this.possible, streak: this.streakDays,
      // First-day activation: windows that closed before the athlete activated read "Not required".
      activationMin: this.activation.activationMin,
      catalog,
      dateISO: String(DAY.date),
      prefs: RT.notifPrefs,
      coachName: this.coach.hasCoach && this.coach.isNamed ? this.coach.name : null,
      // Verified Commitments. The SERVER owns commitment reminders (0140 + the
      // commitment-reminders function): a plan built here only exists once Home has been opened,
      // which is useless for the 4:45 AM roll call of an athlete who hasn't opened the app since
      // yesterday. This local plan is therefore a FALLBACK ONLY — scheduled when this device has
      // no push token registered, so a device that can't be reached by push still gets its
      // reminder, and one that can never gets two alarms at 4:45 AM.
      commitments: PUSH_TOKEN_VALUE ? [] : commitmentReminders(RT.vcRows || [], String(DAY.date)),
    });
  },

  get unreadNotifs() {
    // Derived rows keep the coarse all-read flag, scoped to the day it was set — a new day's
    // derived moments (overdue slots, streak defense) count as unread again. Server rows count
    // as unread until the server says read OR the bell was opened after they arrived.
    const readToday = RT.notifsRead && RT.notifsReadDay === String(DAY.date);
    const derived = readToday ? 0 : this.notifications.new.filter((n) => !n.server).length;
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
    // Coach-aware deadline label (mealDueLabel): honors the coach standard's per-slot window, so
    // this matches every other deadline surface (breakdown, requirement rows, timing pill) for
    // the SAME slot. Callers that already know their slot must pass it to mealDueLabel directly —
    // `slot` here is re-derived and is only right when nothing more specific is known.
    const dueLabel = mealDueLabel;
    if (MEAL.result) {
      const r = MEAL.result;
      return {
        name: MEAL.mealType || cap(slot),
        due: dueLabel(slot), remaining: 'Captured just now',
        img: MEAL.photoDataUrl || null, score: r.quality,
        foods: r.detected.length ? r.detected : ['Your meal'],
        macros: { protein: r.protein, carbs: r.carbs, fat: r.fat, cals: r.kcal },
        planMatch: { verdict: r.quality >= 75 ? 'Strong meal' : 'Logged', detail: r.note || 'Analyzed from your photo.', level: r.quality >= 75 ? 'g' : 'b' },
        ai: r.note || (MEAL.source === 'label' ? 'Exact numbers off the panel. No estimate needed.'
          : MEAL.source === 'manual' ? 'Entered by you: the plate you actually built.'
          : 'Logged from your photo.'),
        analysis: r.analysis || '',            // the ONE detailed AI read (0062); note is the fallback
        styleApplied: r.styleApplied || null,  // 0142 — which plan style the server wrote it for
        capturedAtMin: MEAL.capturedAtMin,     // for the timing pill on the analysis hero
        empty: false, live: MEAL.live !== false,
      };
    }
    // Already-logged slot being revisited: show its REAL persisted plate, not a demo meal.
    const meta = DAY.slotMacros[slot];
    if (meta && DAY.meals[slot]) {
      return {
        name: cap(slot), due: dueLabel(slot), remaining: 'Logged',
        img: slotImage(slot),
        score: meta.quality != null ? meta.quality : null,
        foods: Array.isArray(meta.foods) && meta.foods.length ? meta.foods : ['Your logged meal'],
        macros: { protein: meta.protein || 0, carbs: meta.carbs || 0, fat: meta.fat || 0, cals: meta.kcal || 0 },
        planMatch: { verdict: 'Logged', detail: meta.note || 'Analyzed from your photo.', level: 'b' },
        ai: meta.note || 'Logged from your photo.',
        analysis: meta.analysis || '', styleApplied: meta.styleApplied || null, capturedAtMin: null,
        empty: false,
      };
    }
    // Nothing captured or analyzed yet — honest empty state, never steak-and-potatoes constants.
    return {
      name: cap(slot), due: dueLabel(slot), remaining: 'Take a photo to analyze',
      img: null, score: null, foods: [],
      macros: { protein: 0, carbs: 0, fat: 0, cals: 0 },
      planMatch: { verdict: 'Not analyzed yet', detail: 'Capture your meal and the AI reads it: real macros from your photo, no guesses.', level: 'b' },
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
      return { iso: h.date, day: DOW[d.getDay()], date: `${MON[d.getMonth()]} ${d.getDate()}`, score: h.score || 0, weight: h.weight ?? null, tier: tier(h.score || 0).name, meals: [] };
    });
  },
  /* This calendar week, Monday→Sunday (spec §14.3): real scores, standard hit/missed,
     today, upcoming days, and the grace-used marker. Days before history are unknown. */
  get streakCalendar() {
    const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const today = new Date(DAY.date + 'T00:00:00');
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // back to Monday
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const byDate = {};
    for (const h of DAY.scoreHistory || []) byDate[h.date] = h.score;
    const graceDate = streakInfo().graceDate;
    return DOW.map((label, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dISO = iso(d);
      const isToday = dISO === String(DAY.date);
      const future = dISO > String(DAY.date);
      const s = isToday ? this.score : (typeof byDate[dISO] === 'number' ? byDate[dISO] : null);
      return {
        label, date: dISO, score: s,
        on: s != null && s >= ON_STANDARD,
        missed: !future && !isToday && (s == null || s < ON_STANDARD),
        today: isToday, future,
        grace: graceDate === dISO,
      };
    });
  },

  // Last 6 days incl. today, for the streak week strip — real scores, honest gaps.
  get streakWeek() {
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const past = (DAY.scoreHistory || []).slice(-5).map(h => {
      const d = new Date(h.date + 'T00:00:00');
      return { d: DOW[d.getDay()], s: h.score || 0, on: (h.score || 0) >= ON_STANDARD };
    });
    const today = new Date(DAY.date + 'T00:00:00');
    past.push({ d: DOW[today.getDay()], s: this.score, on: this.score >= ON_STANDARD, today: true });
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
      // Body signals (0142) — enabled by a Guided/Intuitive plan style, off for everyone else.
      { key: 'digestion',  k: 'Digestion',     lo: 'Rough',   hi: 'Comfortable' },
      { key: 'cravings',   k: 'Cravings',      lo: 'None',    hi: 'Constant' },
    ];
    // 5 chips map to the engine's 0–10 scale as 2/4/6/8/10.
    //
    // `val` is null until the check-in has actually been submitted, and that is the whole point.
    // It used to seed every chip from DAY.ci, which on an unsubmitted day is DEFAULT_CI —
    // energy 8, sleep 8, confidence 9. So the form opened with Energy 4/5, Sleep 4/5 and
    // Confidence 5/5 already lit, and an athlete who tapped Submit without touching anything
    // (the likely path at 10pm after practice) filed a flattering recovery score they never
    // claimed. daySubmitCheckin merges by key, so a PARTIAL answer set inherited those defaults
    // for every question they skipped. That is the score inflating itself, on the one screen
    // whose own copy says "what you enter here becomes your Recovery score, so keep it honest".
    // Nothing is pre-answered now; the screen gates Submit until the athlete has answered.
    const fields = ANCHORS.filter(a => DAY.ciConfig && DAY.ciConfig[a.key])
      .map(a => ({
        ...a,
        val: DAY.ciSubmitted ? Math.min(5, Math.max(1, Math.round((DAY.ci[a.key] ?? 6) / 2))) : null,
      }));
    return { fields };
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
    const monthConsistency = last30.length >= 5 ? Math.round(last30.filter(d => d.score >= ON_STANDARD).length / last30.length * 100) : null;
    let best = 0, run = 0;
    for (const d of series) { if (d.score >= ON_STANDARD) { run++; best = Math.max(best, run); } else run = 0; }
    // Best score ever recorded (incl. today) — the day-one baseline stat (spec §8.2).
    const bestScore = Math.max(...series.map(d => d.score));
    // Days with a real logged row (today counts once anything is logged).
    const daysLogged = hist.length + (RT.day0 ? 0 : 1);
    return {
      hasHistory: hist.length > 0,
      daysLogged, bestScore,
      // Exact trend-unlock rule (spec §8.3): 3 logged days unlock the first weekly trend.
      unlockNeed: 3, unlockHave: Math.min(3, daysLogged),
      weekScores, weekAvg, weekDelta,
      onDays: `${weekScores.filter(s => s >= ON_STANDARD).length} of ${weekScores.length}`,
      weekDayLabels: last7.map(d => 'SMTWTFS'[new Date(d.date + 'T00:00:00').getDay()]),
      // Raw ISO dates alongside weekScores/weekDayLabels — Progress uses this to place the
      // scoring-cutover divider on the real day it falls on, never a bar-index guess.
      weekDates: last7.map(d => d.date),
      monthConsistency, bestStreak: best,
    };
  },

  /* Real per-category trends (spec §8.5): the SAME computeComponents that scores today, run
     over reconstructed history rows. Rows saved before the jsonb ride-along are skipped —
     trends appear as real data accumulates, never fabricated. */
  get categoryTrends() {
    const rows = (DAY.scoreHistory || [])
      .map(r => ({ date: r.date, day: dayFromHistoryRow(r) }))
      .filter(r => r.day);
    const todayC = componentsNow();
    const comps = [...rows.map(r => {
      const c = realComponents(r.day);
      return { nutrition: c.nutrition, recovery: c.recoveryContribution, commitment: c.commitment, checkin: c.checkin };
    }), todayC];
    if (comps.length < 4) return null; // not enough real data for an honest direction
    const half = Math.floor(comps.length / 2);
    const avg = (arr, k) => Math.round(arr.reduce((a, b) => a + b[k], 0) / arr.length);
    const older = comps.slice(0, half), newer = comps.slice(half);
    const mk = (k, label, accent) => {
      const now = avg(newer, k), prev = avg(older, k);
      return { key: label, accent, now, delta: now - prev };
    };
    // Daily Commitment is deliberately NOT a row here: its weight is permanently 0, so its
    // "trend" is always a flat 0% with a delta of exactly 0 — a bar that can never say anything,
    // on the one chart whose whole point is to show real direction. See categoryTrends' own
    // header comment: trends appear as real data accumulates, never fabricated — and a
    // zero-weight category rendering here is a fabricated signal, not a real one.
    return [
      mk('nutrition', 'Nutrition', 'g'),
      mk('recovery', 'Recovery', 'p'),
    ];
  },

  /* ONE actionable insight (spec §8.5), computed from real data only. Priority:
     late-meal pattern → weakest trending category → consistency nudge. Null when there
     isn't enough data to say anything defensible. */
  get progressInsight() {
    const rows = (DAY.scoreHistory || []).map(dayFromHistoryRow).filter(Boolean);
    if (rows.length >= 3) {
      // Late-meal pattern: which slot is most often logged past its deadline?
      const lateBy = {};
      for (const d of rows) {
        for (const k of Object.keys(d.mealLoggedAt || {})) {
          // The athlete's governing deadline, not the classic map — advice that names a time
          // their coach never set is worse than no advice.
          const dl = slotDeadline(k);
          if (d.mealLoggedAt[k] != null && dl != null && d.mealLoggedAt[k] > dl + slotGrace(k)) lateBy[k] = (lateBy[k] || 0) + 1;
        }
      }
      const worst = Object.entries(lateBy).sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] >= 2) {
        const [slot, n] = worst;
        const name = slotTitle(slot).toLowerCase();
        return `Late ${name} logs are costing you nutrition points. It happened ${n} times recently. Logging ${name} before ${fmtClock(slotDeadline(slot))} is your biggest easy win.`;
      }
    }
    const trends = this.categoryTrends;
    if (trends) {
      const falling = trends.filter(t => t.delta < 0).sort((a, b) => a.delta - b.delta)[0];
      if (falling) return `${falling.key} is trending down (${falling.delta} vs your earlier average). One consistent day resets the direction.`;
      const weakest = trends.slice().sort((a, b) => a.now - b.now)[0];
      if (weakest && weakest.now < 70) return `${weakest.key} is your biggest opportunity. It's averaging ${weakest.now}%. Small daily wins there move your score fastest.`;
    }
    const p = this.progress;
    if (p.hasHistory && p.weekAvg != null && p.weekAvg < ON_STANDARD) {
      return `Your weekly average is ${p.weekAvg}. Hitting 80 today starts closing the gap to OnStandard.`;
    }
    return null;
  },

  // Squad board: shipped 2026-08-05 (0180 squad_board RPC + screens/squad.js), opt-in via
  // profiles.share_squad_score. No S getter on purpose — the screen owns its own load/cache the
  // way coach screens do; nothing here fabricates teammates. (teams.competition_mode remains
  // unused dead schema.)

  // ---------- NOTIFICATIONS (live) ----------
  get notifications() {
    // Operators get the SERVER feed only. Every derived row below is athlete-day material
    // (overdue requirements, streak-at-risk, celebration) built from this device's DAY — for a
    // signed-in coach that day is empty scaffolding, and any row it produced would be a
    // fabricated athlete moment in a coach's bell.
    if (RT.authRole === 'coach' || RT.authRole === 'trainer') {
      const srvOnly = splitServerRows(RT.serverNotifs, Date.now());
      return { new: srvOnly.unread, earlier: srvOnly.read };
    }
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
        body: `This week’s grace day is already used. Hit 80 before midnight or the streak resets.`,
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

// days.tasks writer: hand day.js this athlete's per-requirement done-ness at push time, from the
// ONE exec derivation Home/Hub/notifications already use — so the coach side finally sees non-meal
// completion (recovery, etc.) instead of the old never-written '[]'. Lazy: only invoked inside
// pushDay, so S/DAY are fully hydrated by the time it runs. Weekly check-in is excluded by
// deriveExec and stays on its own rollup column (checkin_done) — no double signal.
// Connected Standards (0155) ride the SAME lane, prefixed `cs:` so they can never collide with a
// requirement id. This is the whole coach-side integration for the tracked-not-scored surface:
// teamPulse and the roster status chips read days.tasks, so a verified step goal shows up there
// for free. It moves no score — 0041's evidence ceiling reads meals/checkin/trust_passes, never
// tasks — which is exactly why multi-domain completions (0112) were wired this way too.
//
// A period still waiting on a device is reported as NOT done rather than omitted: the coach's
// "who is outstanding" list should include them, and the board (not this lane) is where the
// difference between "hasn't walked" and "watch hasn't reported" is spelled out.
// Who the small-writes outbox queues FOR (commitment-data.js cannot import state.js — the same
// cycle hazard its header documents — so it asks us). Provider, not a snapshot: the queue must
// follow account switches.
setVcUidProvider(() => RT.userId);

setDayTaskProvider(() => {
  // Read the live CS cache, not RT.csRows: RT.csRows was only ever written by Home's paint, so
  // an athlete who logged a meal without visiting Home this session pushed a days.tasks payload
  // with no cs: entries at all — the roster status chip silently lost the standard signal. The
  // cache warm-up is fire-and-forget (30s-fresh, no-op when warm): the provider stays
  // synchronous, so a cold FIRST push still omits them, but every later push carries them.
  try { void loadCsMine(); } catch { /* best-effort */ }
  const csRows = (CS_DATA.mine && CS_DATA.mine.length) ? CS_DATA.mine
    : (Array.isArray(RT.csRows) ? RT.csRows : []);
  return [
    ...S.exec.items.map((i) => ({ id: i.id, done: i.state === 'done' || i.state === 'done_late' })),
    ...csRows
      .filter((r) => r && r.period === 'day' && r.period_start === DAY.date)
      .map((r) => ({
        id: `cs:${r.standard_id}`,
        done: r.status === 'verified_complete' || r.status === 'completed_manually',
      })),
  ];
});
