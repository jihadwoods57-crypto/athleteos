// OnStandard — single session store (Zustand) + AsyncStorage persistence.
// Mirrors the prototype's component state + methods; the day slice persists
// under key `aos_day`, exactly like the prototype's localStorage usage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AiUnavailableError, analyzeLabel, analyzeMeal, isAiConfigured } from '@/lib/ai';
import { fetchMemoryFacts, insertMemoryFacts } from '@/lib/ai/memory';
import { capturePhotoBase64, pickMealPhotoBase64, isCameraAvailable } from '@/lib/capture';
import { isEnginesEnabled, isMealPlansEnabled } from '@/lib/features';
import { auth, db, isBackendLive } from '@/lib/supabase';
import { refreshReminderSchedule, getPushToken } from '@/lib/notify';
import { Platform } from 'react-native';
import { consentContextFromState, hydrateDay, hydrateHistory, pushDay } from './sync';
import { recordMeal } from './mealSync';
import {
  addPerfEntry,
  removePerfEntry,
  admitCandidate,
  avoidFoodsFromFacts,
  candidateFactsFromFoodChange,
  clampHour,
  CUSTOM_METRIC_KEY,
  appendDayScore,
  createInitialState,
  emptyDaySlice,
  flowForRole,
  HYDRATION_TARGET,
  MIN_SIGNUP_AGE,
  PROTEIN_TARGET,
  QUICK_FOODS,
  recordDayNutrition,
  recordDayScore,
  recordDayWeight,
  scoreAfterFirstMeal,
  sleepHoursToSlider,
  startingScore,
  WEIGHT_TARGET,
  rollDayIfStale,
  todayStamp,
  daysAgoStamp,
  appendMessage,
  loggedDayMacros,
  entitlementFromRow,
  exportUserDataText,
  guardianStatusFromRequests,
  isValidGuardianEmail,
  labelToFood,
  mealResultToFood,
  usualToResult,
  snackToFood,
  appendSnack,
  baseGoalForPrimary,
  goalConfig,
  deriveTargetsFromGoal,
  realDataConsent,
  reminderNotifySpecs,
  reminderSnapshotFromState,
  sampleScannedLabel,
  activePlan,
  parsePlanSlots,
  buildPlanDraft,
  applySlotPatch,
  toggleMode,
} from '@/core';
import type {
  AppState,
  EditableFood,
  MealKey,
  PerfDir,
  PerfEntry,
  ReminderKind,
  OverseerAlertKey,
  BaseGoal,
  CiConfig,
  CoachTrackKey,
  CompMode,
  MealCaptureMode,
  MealLabel,
  UsualMeal,
  SnackPreset,
  PersonDetail,
  Role,
  RosterRow,
  SquadMode,
  Tab,
  CoachTab,
  TrainerTab,
  ParentTab,
  PlanSlot,
  EngineGoal,
} from '@/core';

type CiSliderKey = 'ciEnergy' | 'ciRecovery' | 'ciSleep' | 'ciConfidence' | 'ciSoreness' | 'ciMotivation';
export type BaselineKey =
  | 'baseNutritionConfidence'
  | 'baseMealsPerDay'
  | 'baseWaterL'
  | 'baseSleepH'
  | 'baseProteinFreq'
  | 'baseConsistency';

/** What the UI hands `logPr`. The store fills in the stable id + clamps the
 *  value; custom* fields are only read when `metricKey` is the custom key. */
export interface PrInput {
  metricKey: string;
  value: number;
  /** ISO date (YYYY-MM-DD); defaults to today when omitted. */
  date?: string;
  customLabel?: string;
  customUnit?: string;
  customDir?: PerfDir;
}

/** Next collision-free PR id: one past the max existing `pr_<n>` suffix, so it
 *  stays unique across restarts (persisted entries carry their ids) without
 *  needing a clock or RNG in the store. */
function nextPerfId(entries: PerfEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = /^pr_(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `pr_${max + 1}`;
}

export interface Actions {
  // onboarding
  obNext: () => void;
  obBack: () => void;
  finishOb: () => void;
  setRole: (r: Role) => void;
  toggleInvite: (k: string) => void;
  toggleFocus: (k: string) => void;
  toggleTrack: (k: CoachTrackKey) => void;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setLevel: (l: string) => void;
  setSport: (s: string) => void;
  setPosition: (p: string) => void;
  toggleGoal: (g: string) => void;
  setBaseGoal: (g: BaseGoal) => void;
  setCompMode: (m: CompMode) => void;
  hStep: (d: number) => void;
  bwStep: (d: number) => void;
  ageStep: (d: number) => void;
  setBaseWeight: (n: number) => void;
  setBaseAge: (n: number) => void;
  setWeightTarget: (n: number) => void;
  startSignin: () => void;
  exitSignin: () => void;
  signinDone: () => void;

  // onboarding (redesign)
  setPrimaryGoal: (k: string) => void;
  setTrainingFreq: (k: string) => void;
  toggleSupport: (k: string) => void;
  /** Athlete joins a coach/trainer by team code: stores the code, marks a coach connected in the
   *  local model (so coach guidance + visibility activate), and when the backend is live actually
   *  joins their roster via the join_team RPC. Inert/best-effort when off. */
  connectCoach: (code: string) => void;
  /** Client joins a trainer's practice by code (mirror of connectCoach): marks the
   *  trainer in the local support network and joins via join_practice when live. */
  connectTrainer: (code: string) => void;
  /** Open/close the athlete "Connect your coach" overlay; openConnect may carry an
   *  invite-link code to prefill the code door. */
  openConnect: (prefillCode?: string | null) => void;
  closeConnect: () => void;
  /** Athlete dismissed the first-run Home connect card ("not now"). */
  dismissConnectCard: () => void;
  /** Athlete-first request to join a discoverable team → a pending row the coach
   *  approves. Returns true on success; inert (false) when the backend is off. */
  requestJoinTeamLive: (teamId: string, position?: string) => Promise<boolean>;
  setInviteCode: (v: string) => void;
  setBaseAnswer: (key: BaselineKey, value: number) => void;
  setObMeta: (key: string, value: string | string[] | number) => void;
  toggleObMetaItem: (key: string, item: string) => void;
  /** Compute + store the Starting Point Score and seed engine state from the baseline. */
  commitStartingScore: () => void;
  /** Activation: leave onboarding into the app and open the first-meal challenge. */
  startFirstMealChallenge: () => void;

  // nav
  setTab: (t: Tab) => void;
  setCoachTab: (t: CoachTab) => void;
  setTrainerTab: (t: TrainerTab) => void;
  setParentTab: (t: ParentTab) => void;
  /** Cache the overseer's freshly-fetched roster (namespaced by userId) so their dashboard
   *  paints instantly next time before revalidating. Inert path; purged on sign-out. */
  setCachedRoster: (roster: RosterRow[], userId: string) => void;
  goHome: () => void;
  goTasks: () => void;
  goSquad: () => void;
  goCheckin: () => void;
  goProfile: () => void;
  goNutrition: () => void;
  goPerformance: () => void;
  /** Open the Reminders settings screen (P3). */
  goReminders: () => void;
  /** Log a performance result (PR). The store assigns a stable id + persists it.
   *  A separate development track from the daily score (never folds into it). */
  logPr: (spec: PrInput) => void;
  /** Remove a logged performance result by id. */
  deletePr: (id: string) => void;
  setSquadMode: (m: SquadMode) => void;
  toggleNotif: () => void;
  /** Request notification permission + schedule today's reminders. Call once on app launch. */
  initReminders: () => void;
  /** Toggle a single reminder on/off (P3). */
  toggleReminder: (kind: ReminderKind) => void;
  /** Set a reminder's local fire hour (0-23, clamped) (P3). */
  setReminderHour: (kind: ReminderKind, hour: number) => void;
  toggleUnits: () => void;
  /** Set the appearance preference (light/dark/auto). Persisted. */
  setThemeMode: (mode: 'light' | 'dark' | 'auto') => void;
  goalStep: (d: number) => void;
  adjustProteinTarget: (d: number) => void;
  adjustCalTarget: (d: number) => void;
  adjustWeightTarget: (d: number) => void;
  signOut: () => void;
  /** Apple 5.1.1(v) + GDPR/CCPA erasure: permanently delete the account. Deletes
   *  server-side when connected, then wipes ALL local data back to a fresh install. */
  deleteAccount: () => Promise<void>;
  /** GDPR/CCPA portability: a JSON snapshot of the user's own data, for a share/save. */
  exportMyData: () => string;

  // overlays
  openMeal: () => void;
  closeMeal: () => void;
  setMealType: (m: MealLabel) => void;
  capture: (fromLibrary?: boolean) => void;
  /** Answer the AI's clarifying questions and get the finalized analysis (the 2nd call). */
  finalizeMeal: (answers: string[]) => void;
  /** Reuse a past "usual" meal's confirmed macros — skips the model call and the daily-cap slot. */
  pickUsual: (u: UsualMeal) => void;
  /** Switch the meal overlay between photographing a plate and scanning a label. */
  setMealCaptureMode: (mode: MealCaptureMode) => void;
  /** Scan a Nutrition Facts label (transcribe). Honors the same photo-egress consent gate. */
  captureLabel: () => void;
  /** Set how many servings of the scanned label were eaten (¼-step). */
  setLabelServings: (n: number) => void;
  /** Log the scanned label (scaled by servings) into the selected meal slot. */
  addScannedLabel: () => void;
  /** Log a food picked from name search (USDA, exact macros) into the selected meal slot. */
  addSearchedFood: (food: EditableFood) => void;
  addMeal: () => void;
  addWater: () => void;
  /** Log a snack/shake preset into the day's snack slot (persists + scores, like a meal). */
  addSnack: (preset: SnackPreset) => void;
  openMealDetail: (meal: string) => void;
  closeMealDetail: () => void;
  openMealHistory: () => void;
  closeMealHistory: () => void;
  openNutritionMemory: () => void;
  closeNutritionMemory: () => void;
  openOverseerProfile: () => void;
  closeOverseerProfile: () => void;
  openPlans: () => void;
  closePlans: () => void;
  openCoachGoals: () => void;
  closeCoachGoals: () => void;
  /** Toggle one overseer per-event alert preference (OverseerProfile). */
  toggleOverseerAlert: (key: OverseerAlertKey) => void;
  /** Refresh the subscription entitlement from the backend (gated). Inert when off
   *  or signed out; falls back to free preview on no row / error. */
  refreshEntitlement: () => Promise<void>;
  /** Read the user's profile (display name / org name / email) back from the backend
   *  after sign-in, so a fresh device shows their real identity, not the seeded demo.
   *  Gated; soft-fails to the local cache. */
  hydrateProfile: () => Promise<void>;
  hydrateRecord: () => Promise<void>;
  /** Read the athlete's guardian-consent status back from the backend after sign-in, so a
   *  server-VERIFIED guardian actually unblocks the minor (the client only ever wrote
   *  'pending'). Server value only — never client-writable to 'verified'. Gated; soft-fails. */
  hydrateGuardianConsent: () => Promise<void>;
  /** Coach sets a roster athlete's targets via the coach_set_goals RPC (gated). The
   *  coach owns the plan (Constitution Rule #13). Returns success; inert when off. */
  pushAthleteGoals: (athleteId: string, targets: { protein: number; calories: number; weight: number }) => Promise<boolean>;
  /** Overseer self-profile edits (coach/trainer/parent). Update the display name +
   *  org/team name; when live they also push to the profiles row (gated seam). */
  setDisplayName: (v: string) => void;
  setOrgName: (v: string) => void;
  /** Persist an edited meal's foods into the day slice and mark the slot logged, so
   *  reopening shows the saved plate and the daily score reflects its real macros. */
  saveMeal: (key: MealKey, foods: EditableFood[], learn?: boolean) => void;
  openFoodCoach: () => void;
  closeFoodCoach: () => void;
  openPlanEditor: () => void;
  closePlanEditor: () => void;
  /** Add a standing coach instruction (trimmed, deduped, capped). */
  addPlanInstruction: (text: string) => void;
  removePlanInstruction: (index: number) => void;
  /** Replace the plan's slot list wholesale (sanitized through parsePlanSlots), e.g. after
   *  a model-generated plan comes back. */
  setPlanSlots: (slots: PlanSlot[]) => void;
  /** Patch one meal slot (note/photoRequired/macros/etc.) without touching the others. */
  updatePlanSlot: (key: MealKey, patch: Partial<PlanSlot>) => void;
  /** Flip one slot between 'pinned' (locked to the prescribed meal) and 'open' (athlete's choice). */
  togglePlanSlotMode: (key: MealKey) => void;
  /** Fill planSlots from the deterministic offline draft builder for the given goal. */
  generatePlanDraftLocal: (goal: EngineGoal) => void;
  /** Clear the plan back to empty (e.g. coach resets it). */
  clearPlan: () => void;
  toggleQuick: (i: number) => void;
  openPerson: (p: PersonDetail) => void;
  closePerson: () => void;
  openAccount: () => void;
  closeAccount: () => void;
  openMsg: () => void;
  closeMsg: () => void;
  setMsgDraft: (v: string) => void;
  sendMsg: () => void;
  openNotif: () => void;
  closeNotif: () => void;
  /** Load the user's in-app notification feed (inert offline). */
  fetchNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  setMealDesc: (v: string) => void;
  setChatDraft: (v: string) => void;
  sendChat: () => void;

  // role entry
  enterCoach: () => void;
  enterParent: () => void;
  enterTrainer: () => void;

  // overseer action (coach/trainer/nutritionist): the lightweight nudge. The
  // optional baseline captures the athlete's compliance/score at send-time so
  // the dashboard can later read whether anything moved (see core/nudge.ts).
  sendNudge: (name: string, baseline?: { score: number; comp: number }, note?: string, athleteId?: string) => void;
  /** Coach grants / ends a linked athlete's Trust Pass via the server RPC (backend-live). */
  coachGrantTrustPass: (athleteId: string, lengthDays: number) => Promise<void>;
  coachEndTrustPass: (athleteId: string) => Promise<void>;
  /** Capture + register this device's push token (native, backend-live only). No-op elsewhere. */
  initPush: () => Promise<void>;

  // tasks
  toggleTask: (id: number) => void;

  // daily plan-commitment (yes/partial/no one-tap)
  setDailyCommitment: (answer: AppState['dailyCommitment']) => void;

  // Trust Pass (earned camera-free reward) — coach-granted at go-live; pilot grant is client-side
  grantTrustPass: (lengthDays: number) => void;
  endTrustPass: () => void;

  // check-in
  wStep: (d: number) => void;
  setCi: (key: CiSliderKey, value: number) => void;
  toggleCiQ: (k: keyof CiConfig) => void;
  submitCi: () => void;
  /** Log today's body weight (quick weigh-in). Clears the weigh-in nudge; feeds the goal read. */
  logWeight: (lb: number) => void;

  // backend auth (go-live, gated behind isBackendLive; no-ops when off so the
  // mock onboarding flow is untouched)
  signUpLive: (email: string, password: string, fullName: string) => Promise<boolean>;
  signInLive: (email: string, password: string) => Promise<boolean>;
  signOutLive: () => Promise<void>;
  /** Send a password-reset email. Gated; sets passwordResetSent on success so the
   *  reset screen can show its neutral confirmation. Inert without a backend. */
  requestPasswordReset: (email: string) => Promise<boolean>;
  /** Exchange an Apple identity token (from expo-apple-authentication) for a session.
   *  Gated; the obtaining button is iOS + isBackendLive only. */
  signInWithApple: (identityToken: string) => Promise<boolean>;
  /** Coach/overseer creates a real team via the create_team RPC and stores the
   *  server-generated join code in teamCode. Inert (returns null) when the flag
   *  is off, so the onboarding invite step keeps its EAGLES24 showcase code. */
  createTeamLive: (name: string, sport?: string, orgId?: string | null, discoverable?: boolean) => Promise<string | null>;
  /** Trainer/overseer creates a real practice via the create_practice RPC (mirror of
   *  createTeamLive) with an optional @handle; stores the join code in teamCode. */
  createPracticeLive: (name: string, handle?: string | null, discoverable?: boolean) => Promise<string | null>;
  /** Coach/trainer sets a custom vanity join code (validated + uniqueness-checked server-side).
   *  Returns {ok} or {ok:false, error} with a friendly message (e.g. "code already taken"). */
  setInviteCodeCustom: (code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Coach/trainer regenerates a random join code. Returns the new code or null. */
  regenerateInviteCode: () => Promise<string | null>;
  setTeamDiscoverable: (v: boolean) => void;
  setGuardianEmail: (v: string) => void;
  /** Minor guardian consent: email a minor's guardian an approval request. Gated, sends only
   *  when the backend is live; marks status 'pending' on a valid email. Returns success. */
  requestGuardianConsent: () => Promise<boolean>;
  recordConsent: (given: boolean) => void;
  /** Record Terms + Privacy acceptance. Pass an ISO timestamp to accept, or null to clear. */
  acceptTerms: (at: string | null) => void;
  setAuthError: (msg: string | null) => void;
  /** Athlete data-sharing controls (Profile). Pause stops every push immediately;
   *  removeViewer revokes a linked role from the accountability circle. */
  togglePauseSharing: () => void;
  removeViewer: (key: string) => void;

  // dev
  resetDemo: () => void;
}

export type Store = AppState & Actions;

let mealTimer: ReturnType<typeof setTimeout> | undefined;

// Stage C day-sync: a debounced write-through of the day slice to Postgres after a
// mutating action. Gated HARD on isBackendLive so that with the flag OFF no timer is
// ever scheduled and the action behaves exactly as today (flag-OFF identical). pushDay
// itself enforces realDataConsent + fails closed, so a scheduled push still never
// writes a non-consenting (or minor) athlete's data. AsyncStorage stays the cache.
const SYNC_DEBOUNCE_MS = 1200;
// How far back the client meal-history overlay pulls (one stored meal per slot/day).
const MEAL_HISTORY_DAYS = 30;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDaySync(get: () => Store): void {
  if (!isBackendLive) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const s = get();
    if (!s.userId) return;
    // Track the push so a failure is surfaced (audit item 12) instead of silently swallowed — an
    // athlete logging on a dead connection must not believe their coach can see the day. Only a real
    // write flips to 'synced'; a consent/backend gate (pushed:false) is intentional, not an error.
    useStore.setState({ syncState: 'syncing' });
    pushDay(s, s.userId)
      .then((r) => {
        if (r.pushed) useStore.setState({ syncState: 'synced', lastSyncedAt: new Date().toISOString() });
        else useStore.setState({ syncState: 'idle' });
      })
      .catch(() => useStore.setState({ syncState: 'error' }));
  }, SYNC_DEBOUNCE_MS);
}

// Persist the individual meal (macros + photo) to the `meals` table when a slot is
// logged. Gated HARD on isBackendLive (flag OFF -> nothing armed, the photo is just
// dropped as today); recordMeal itself enforces realDataConsent + fails closed, so a
// scheduled record still never writes a non-consenting (or minor) athlete's meal.
// Read off the state at log-time so the upload sees the captured photo before addMeal
// clears it.
function scheduleMealRecord(get: () => Store, key: MealKey): void {
  if (!isBackendLive) return;
  const s = get();
  if (!s.userId) return;
  void recordMeal(s, s.userId, key).catch(() => undefined);
}

// The WRITE half of the AI memory flywheel (audit item 13): when the athlete CORRECTS an AI-detected
// plate (removes a food), infer a candidate 'dislike' and store it — a SAFETY kind, so admitCandidate
// routes it to 'pending_confirmation' and MemoryConfirm asks the athlete before it ever binds. Only
// fires on a genuine correction of an existing plate; fails closed for a non-consenting/minor athlete
// (no inferred facts leave the device) and is fully fire-and-forget (a meal always logs regardless).
// v1 learns dislikes only (favorites are noisier and deferred); deduped against existing facts so the
// same food is never re-asked.
async function learnFromCorrection(get: () => Store, beforeNames: string[], after: EditableFood[]): Promise<void> {
  if (!isBackendLive) return;
  const s = get();
  if (!s.userId) return;
  if (!realDataConsent(consentContextFromState(s, isBackendLive)).ok) return; // fail closed
  const candidates = candidateFactsFromFoodChange(beforeNames, after)
    .map(admitCandidate)
    .filter((f) => f.status === 'pending_confirmation'); // safety dislikes the athlete will confirm
  if (candidates.length === 0) return;
  const existing = await fetchMemoryFacts().catch(() => []);
  const have = new Set(existing.map((f) => `${f.kind}:${String(f.value).toLowerCase()}`));
  const fresh = candidates.filter((f) => !have.has(`${f.kind}:${String(f.value).toLowerCase()}`));
  if (fresh.length) await insertMemoryFacts(fresh).catch(() => undefined);
}

// Debounced write-through of the overseer's editable profile (display name +
// org/team name) to the profiles row. Gated on isBackendLive: flag OFF -> nothing
// armed, the edit stays local exactly as today.
let profileTimer: ReturnType<typeof setTimeout> | undefined;
function pushProfile(get: () => Store): void {
  if (!isBackendLive) return;
  if (profileTimer) clearTimeout(profileTimer);
  profileTimer = setTimeout(() => {
    const s = get();
    if (s.userId) {
      void db
        .updateProfile(s.userId, { full_name: s.athleteName.trim() || null, org_name: s.orgName.trim() || null })
        .catch(() => undefined);
    }
  }, SYNC_DEBOUNCE_MS);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Mirror of core computeDerived's proteinToday formula (meal macros + quick-add
// grams). Used only to flip the visible "Hit 180g protein" task row (id 2) in
// store actions for immediate UI feedback — core scoring remains the authority.
const computeProteinToday = (
  meals: AppState['meals'],
  mealFoods: AppState['mealFoods'],
  quickAdded: AppState['quickAdded'],
): number => {
  // Mirror core scoring: saved edited plates win over the slot constant, so the
  // task row's optimistic protein matches the authoritative computeDerived value.
  const proteinBase = loggedDayMacros({ meals, mealFoods }).protein;
  const quickGrams = QUICK_FOODS.reduce((a, f, i) => a + (quickAdded[i] ? f.g : 0), 0);
  return proteinBase + quickGrams;
};

/** Hand the device notification seam the day's active reminders. No-op today (the seam in
 *  src/lib/notify is inert until expo-notifications is installed + isNotifyAvailable flips
 *  on a device, and only fires when the master `notif` flag is on) — wired here so the
 *  call site is complete and the founder's remaining work is the device install, not glue. */
const syncReminders = (s: AppState): void => {
  const proteinToday = computeProteinToday(s.meals, s.mealFoods, s.quickAdded);
  const snapshot = reminderSnapshotFromState({
    proteinToday,
    proteinTarget: s.proteinTarget,
    hydrationL: s.hydrationL,
    meals: s.meals,
    ciSubmitted: s.ciSubmitted,
    weighedToday: s.weighInStamp === todayStamp(),
  });
  void refreshReminderSchedule(reminderNotifySpecs(s.reminderSettings, snapshot), s.notif);
};

/** The active plan slot's macro target for the athlete's CURRENT meal type (Meal Plans feature),
 *  when the flag is on and a matching slot exists. Feeds analyze-meal's slotTarget so the model
 *  can offer a supportive "closest compliant swap" when the plate misses it. Flag-off or no
 *  matching slot: undefined, so analyze-meal behaves exactly as it does today. */
const slotTargetFor = (s: AppState): { kcal: number; protein: number } | undefined => {
  if (!isMealPlansEnabled) return undefined;
  const key = s.mealType.toLowerCase() as MealKey;
  const slot = s.planSlots.find((p) => p.key === key);
  return slot ? { kcal: slot.macros.kcal, protein: slot.macros.protein } : undefined;
};

/** Local minutes-from-midnight, stamped when a meal is logged for on-time accountability. */
const nowMinutes = (): number => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      // ---- onboarding ----
      obNext: () => set((s) => ({ obStep: s.obStep + 1 })),
      obBack: () => set((s) => ({ obStep: Math.max(0, s.obStep - 1) })),
      finishOb: () => {
        const s = get();
        const flow = flowForRole(s.role);
        if (flow === 'app') {
          // A solo executor has no coach, so derive their scoring profile + daily targets from their
          // GOAL + bodyweight (and disclose the profile in Profile). Never override a coach's profile
          // or a target the user already edited on the about-you step.
          const cfg = goalConfig(s.baseGoal, s.baseWeight, s.scoringProfile, {
            proteinTarget: s.proteinTarget,
            calTarget: s.calTarget,
            weightTarget: s.weightTarget,
          });
          set({ flow, tab: 'home', ...cfg });
        } else {
          set({ flow });
        }
      },
      setRole: (r) => set({ role: r }),
      toggleInvite: (k) =>
        set((s) => ({ inviteWho: s.inviteWho.includes(k) ? s.inviteWho.filter((x) => x !== k) : [...s.inviteWho, k] })),
      toggleFocus: (k) =>
        set((s) => ({ parentFocus: s.parentFocus.includes(k) ? s.parentFocus.filter((x) => x !== k) : [...s.parentFocus, k] })),
      toggleTrack: (k) => set((s) => ({ coachTrack: { ...s.coachTrack, [k]: !s.coachTrack[k] } })),
      setName: (v) => set({ athleteName: v }),
      setEmail: (v) => set({ athleteEmail: v }),
      setLevel: (l) => set({ level: l }),
      setSport: (sp) => set({ sport: sp, position: null }),
      setPosition: (p) => set({ position: p }),
      toggleGoal: (g) =>
        set((s) => ({ goals: s.goals.includes(g) ? s.goals.filter((x) => x !== g) : [...s.goals, g] })),
      setBaseGoal: (g) => set({ baseGoal: g }),
      setCompMode: (m) => set({ compMode: m }),
      hStep: (d) => set((s) => ({ baseHeight: clamp(s.baseHeight + d, 54, 84) })),
      bwStep: (d) => set((s) => ({ baseWeight: clamp(s.baseWeight + d, 70, 350) })),
      // Floor at MIN_SIGNUP_AGE (13): the app does not sign up under-13s, keeping it out of
      // COPPA scope. 13-17 still flow through the minor guardian-consent gate (consent.ts).
      ageStep: (d) => set((s) => ({ baseAge: clamp(s.baseAge + d, MIN_SIGNUP_AGE, 24) })),
      // Absolute setters for tap-to-type on the steppers (same clamps as the delta actions),
      // so a big change is one typed number instead of dozens of taps. NaN is ignored upstream.
      setBaseWeight: (n) => set({ baseWeight: clamp(Math.round(n), 70, 350) }),
      setBaseAge: (n) => set({ baseAge: clamp(Math.round(n), MIN_SIGNUP_AGE, 24) }),
      setWeightTarget: (n) => set({ weightTarget: clamp(Math.round(n), 120, 350), weightTargetTouched: true }),
      startSignin: () => set({ signinMode: true }),
      exitSignin: () => set({ signinMode: false }),
      signinDone: () => set({ signinMode: false, flow: 'app', tab: 'home' }),

      // ---- onboarding (redesign) ----
      // Map the rich onboarding goal to the 4-bucket BaseGoal that drives scoring (lose_fat -> 'lose',
      // gain_muscle -> 'gain', ...). Before this the goal was collected but never reached the engine.
      setPrimaryGoal: (k) => set({ primaryGoal: k, baseGoal: baseGoalForPrimary(k) }),
      setTrainingFreq: (k) => set({ trainingFreq: k }),
      toggleSupport: (k) =>
        set((s) => {
          if (k === 'none') return { supportTeam: [] };
          const has = s.supportTeam.includes(k);
          return { supportTeam: has ? s.supportTeam.filter((x) => x !== k) : [...s.supportTeam, k] };
        }),
      setInviteCode: (v) => set({ inviteCode: v }),
      connectCoach: (code) => {
        const c = code.trim().toUpperCase();
        if (!c) return;
        set((s) => ({ inviteCode: c, supportTeam: s.supportTeam.includes('coach') ? s.supportTeam : [...s.supportTeam, 'coach'] }));
        // When live + signed in, join the coach's roster by code; inert + best-effort when off.
        if (isBackendLive) void db.joinTeam(c).catch(() => undefined);
      },
      connectTrainer: (code) => {
        const c = code.trim().toUpperCase();
        if (!c) return;
        set((s) => ({ inviteCode: c, supportTeam: s.supportTeam.includes('trainer') ? s.supportTeam : [...s.supportTeam, 'trainer'] }));
        if (isBackendLive) void db.joinPractice(c).catch(() => undefined);
      },
      createPracticeLive: async (name, handle, discoverable) => {
        if (!isBackendLive) return null;
        try {
          const code = await db.createPractice(name.trim() || 'My Practice', handle?.trim() || null, discoverable ?? false);
          if (code) set({ teamCode: code, authError: null });
          return code;
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : 'Could not create practice' });
          return null;
        }
      },
      openConnect: (prefillCode) => set({ connectOpen: true, connectPrefillCode: prefillCode ?? null }),
      closeConnect: () => set({ connectOpen: false, connectPrefillCode: null }),
      dismissConnectCard: () => set({ connectCardDismissed: true }),
      requestJoinTeamLive: async (teamId, position) => {
        if (!isBackendLive) return false;
        try {
          await db.requestJoinTeam(teamId, position);
          return true;
        } catch {
          return false;
        }
      },
      setBaseAnswer: (key, value) => set({ [key]: value } as Partial<AppState>),
      setObMeta: (key, value) => set((s) => ({ obMeta: { ...s.obMeta, [key]: value } })),
      toggleObMetaItem: (key, item) =>
        set((s) => {
          const cur = Array.isArray(s.obMeta[key]) ? (s.obMeta[key] as string[]) : [];
          const next = cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item];
          return { obMeta: { ...s.obMeta, [key]: next } };
        }),
      commitStartingScore: () =>
        set((s) => {
          const score = startingScore({
            nutritionConfidence: s.baseNutritionConfidence,
            mealsPerDay: s.baseMealsPerDay,
            waterL: s.baseWaterL,
            sleepH: s.baseSleepH,
            proteinFreq: s.baseProteinFreq,
            consistency: s.baseConsistency,
          });
          // Seed the in-app check-in sleep slider so the recovery score continues
          // sensibly from self-report instead of a flat default.
          //
          // Day-0 reconcile: write the Starting Point Score as the day-0 anchor in
          // scoreHistory so the in-app Athlete Score TREND continues FROM the reveal
          // instead of contradicting it. Only when no real history exists yet (never
          // clobber a returning user or the seeded demo). The first calendar rollover
          // overwrites this provisional anchor (same date key) with the real completed
          // day-0 score, so it self-heals into honest history.
          const scoreHistory =
            s.scoreHistory.length === 0 ? appendDayScore([], s.dateStamp, score) : s.scoreHistory;
          return { startScore: score, ciSleep: sleepHoursToSlider(s.baseSleepH), scoreHistory };
        }),
      // Activation: leave onboarding into the app, landing on Daily HQ (NOT the camera).
      // A brand-new user has no meal in front of them at signup, so auto-opening the camera was a
      // dead-end first impression; instead Home's "Log breakfast" mission is the prompt they tap WHEN
      // they actually eat. Swap the SEEDED DEMO day for a genuinely empty day so the first Home is
      // honest — nothing pre-logged, every task open, score building from the Starting Point anchor
      // and rising the moment they log. The seeded demo is untouched (only this path runs here).
      startFirstMealChallenge: () =>
        set((s) => ({
          ...emptyDaySlice(),
          flow: 'app',
          tab: 'home',
          // The activation CTA is "Upload your first meal" — so it must land ON the camera,
          // not drop the athlete on Home to hunt for it (the audit's broken-promise deep-link).
          // Mirror openMeal's capture-overlay reset so "Start now" opens straight into capture.
          mealOpen: true,
          mealStage: 'capture',
          mealCaptureMode: 'meal',
          mealAnalysis: null,
          mealQuestions: [],
          labelFacts: null,
          labelServings: 1,
          mealPhoto: null,
          // Surface the weight the athlete entered in onboarding: it anchors the
          // season-goal progress (start) and is their live current weight (no
          // progress yet, so "gained since start" honestly reads 0). Check-in
          // starts from the same number. Only the activation path runs this, so
          // the seeded demo's 171/178 stays intact.
          startWeight: s.baseWeight,
          currentWeight: s.baseWeight,
          ciWeight: s.baseWeight,
          // Apply the SAME goal-derived scoring profile + targets finishOb applies, so an athlete
          // who finishes via the challenge is scored on their goal (not the performance default) and
          // their weight target points the right way (a Lose Fat user no longer defaults to a gain).
          // Preserve a target the user already edited on the about-you step (don't clobber it).
          ...goalConfig(s.baseGoal, s.baseWeight, s.scoringProfile, {
            proteinTarget: s.proteinTarget,
            calTarget: s.calTarget,
            weightTarget: s.weightTarget,
          }),
        })),

      // ---- nav ----
      setTab: (t) => set({ tab: t }),
      setCoachTab: (t) => set({ coachTab: t }),
      setTrainerTab: (t) => set({ trainerTab: t }),
      setParentTab: (t) => set({ parentTab: t }),
      setCachedRoster: (roster, userId) => set({ cachedRoster: roster, cachedRosterUserId: userId }),
      goHome: () => set({ flow: 'app', tab: 'home' }),
      goTasks: () => set({ tab: 'tasks' }),
      goSquad: () => set({ tab: 'squad' }),
      goCheckin: () => set({ flow: 'app', tab: 'checkin', ciStage: 'open' }),
      goProfile: () => set({ flow: 'app', tab: 'profile' }),
      goNutrition: () => set({ flow: 'app', tab: 'nutrition' }),
      goPerformance: () => set({ flow: 'app', tab: 'performance' }),
      goReminders: () => set({ flow: 'app', tab: 'reminders' }),

      // ---- performance (P1) — a separate development track; never folds into
      // the daily Accountability Score. Persisted locally; when the backend goes
      // live (P0) this list is what a future `pushPerf` seam would sync.
      logPr: (spec) =>
        set((s) => {
          const value = Number(spec.value);
          if (!Number.isFinite(value)) return {}; // ignore a non-numeric entry
          const isCustom = spec.metricKey === CUSTOM_METRIC_KEY;
          const entry: PerfEntry = {
            id: nextPerfId(s.perfEntries),
            metricKey: spec.metricKey,
            value: clamp(value, 0, 100000),
            date: spec.date ?? todayStamp(),
            ...(isCustom
              ? {
                  customLabel: spec.customLabel,
                  customUnit: spec.customUnit,
                  customDir: spec.customDir ?? 'higher',
                }
              : {}),
          };
          return { perfEntries: addPerfEntry(s.perfEntries, entry) };
        }),
      deletePr: (id) => set((s) => ({ perfEntries: removePerfEntry(s.perfEntries, id) })),

      setSquadMode: (m) => set({ squadMode: m }),
      toggleNotif: () => { set((s) => ({ notif: !s.notif })); syncReminders(get()); },
      // On launch, (re)schedule today's reminders — this also triggers the one-time permission
      // request inside refreshReminderSchedule. No-op on web / when the master flag is off.
      initReminders: () => { syncReminders(get()); },
      initPush: async () => {
        if (!isBackendLive) return;
        const token = await getPushToken();
        if (token) await db.registerDeviceToken(token, Platform.OS).catch(() => undefined);
      },
      toggleReminder: (kind) => {
        set((s) => ({
          reminderSettings: {
            ...s.reminderSettings,
            [kind]: { ...s.reminderSettings[kind], enabled: !s.reminderSettings[kind].enabled },
          },
        }));
        syncReminders(get());
      },
      setReminderHour: (kind, hour) => {
        set((s) => ({
          reminderSettings: {
            ...s.reminderSettings,
            [kind]: { ...s.reminderSettings[kind], hour: clampHour(hour) },
          },
        }));
        syncReminders(get());
      },
      toggleUnits: () => set((s) => ({ units: s.units === 'metric' ? 'imperial' : 'metric' })),
      setThemeMode: (mode) => set({ themeMode: mode }),
      goalStep: (d) => set((s) => ({ weeklyGoalLb: +clamp(s.weeklyGoalLb + d, 0.5, 2).toFixed(1) })),
      // Editable daily nutrition targets. Protein feeds scoring + the id-2 task row,
      // so re-derive that visible flag here (mirrors addMeal/toggleQuick) to keep the
      // Plan row honest the instant the target moves. Calories feed the Nutrition/Profile
      // labels + bars. Clamped to sane ranges; stepped by the UI's ± controls.
      adjustProteinTarget: (d) =>
        set((s) => {
          const proteinTarget = clamp(s.proteinTarget + d, 80, 320);
          const protein = computeProteinToday(s.meals, s.mealFoods, s.quickAdded);
          const tasks = s.tasks.map((x) => (x.id === 2 ? { ...x, done: protein >= proteinTarget } : x));
          return { proteinTarget, tasks };
        }),
      adjustCalTarget: (d) => set((s) => ({ calTarget: clamp(s.calTarget + d, 1200, 6000) })),
      adjustWeightTarget: (d) =>
        // On the FIRST adjust of an untouched target, seed from the goal-derived value (which
        // points the right way for the chosen goal) so a Lose Fat athlete steps from ~164, not
        // from the gain-shaped 184 constant. Once touched it steps purely from the athlete's
        // own value. `weightTargetTouched` also drives the About You display, so the shown
        // default and the first step agree, and nothing silently flips later.
        set((s) => {
          const base = s.weightTargetTouched
            ? (s.weightTarget ?? WEIGHT_TARGET)
            : deriveTargetsFromGoal(s.baseGoal, s.baseWeight).weightTarget;
          return { weightTarget: clamp(base + d, 120, 350), weightTargetTouched: true };
        }),
      signOut: () => {
        // Terminate the real Supabase session (clears the persisted refresh token) AND
        // clear the sensitive session state (userId / consent / entitlement) via the
        // signOutLive primitive, THEN reset navigation back to onboarding. The buttons
        // wired here must do both: a nav-only reset would leave a live, signed-in session
        // (and its token in AsyncStorage) behind once the backend is on. auth.signOut runs
        // in the background; local state still resets even if the network call fails.
        void get().signOutLive();
        // Full reset to defaults (not just a nav reset) so the next person to onboard on this device
        // does NOT inherit the prior user's goal / targets / sport / name. A nav-only reset left
        // stale targets behind, which the goal-config clobber-guard then preserved as if user-edited.
        set({ ...createInitialState(), flow: 'onboarding', obStep: 0, role: null, accountOpen: false });
      },
      deleteAccount: async () => {
        // Delete server-side when connected; wipe local data either way so the in-app
        // deletion always completes (Apple requires it to actually work, not just sign out).
        if (isBackendLive) {
          try { await db.deleteAccount(); } catch { /* still wipe locally below */ }
          // End the local Supabase session too, so the (now-deleted) account's refresh
          // token doesn't linger in AsyncStorage after erasure.
          try { await auth.signOut(); } catch { /* best effort */ }
        }
        try { await AsyncStorage.removeItem('aos_day'); } catch { /* best effort */ }
        set({ ...createInitialState() });
      },
      exportMyData: () => exportUserDataText(get()),

      // ---- overlays ----
      openMeal: () => {
        set({ mealOpen: true, mealStage: 'capture', mealCaptureMode: 'meal', mealAnalysis: null, mealQuestions: [], labelFacts: null, labelServings: 1, mealPhoto: null });
        // Pull the athlete's recent meals so the capture screen can offer their "usuals" (one-tap
        // reuse of confirmed macros). Own-data read, backend-gated; offline it simply shows none.
        if (!isBackendLive) return;
        const s = get();
        if (!s.userId) return;
        void db
          .fetchRecentMeals(s.userId, daysAgoStamp(MEAL_HISTORY_DAYS))
          .then((rows) => set({ mealHistory: rows }))
          .catch(() => undefined);
      },
      closeMeal: () => set({ mealOpen: false }),
      setMealType: (m) => set({ mealType: m }),
      capture: (fromLibrary = false) => {
        set({ mealStage: 'analyzing', mealAnalysis: null, mealQuestions: [], mealError: null });
        if (mealTimer) clearTimeout(mealTimer);
        // The shutter opens the camera; the gallery button (fromLibrary) opens the photo library.
        const pickPhoto = fromLibrary ? pickMealPhotoBase64 : capturePhotoBase64;
        // Sending the meal photo to the AI endpoint is REAL athlete data leaving the
        // device to a third party (Anthropic), so it must clear the SAME consent gate as
        // pushDay/recordMeal and FAIL CLOSED: an un-consented athlete, an unverified
        // minor, or an athlete who paused sharing never has a photo egress. The gate keys
        // on isAiConfigured (the egress switch) rather than isBackendLive, because the AI
        // endpoint can be live while the database backend is still staged ("shared-project
        // flag trap"). When it fails, we degrade to the deterministic on-device analysis
        // exactly like the no-AI branch, so nothing leaves the device.
        const photoConsent = realDataConsent(consentContextFromState(get(), isAiConfigured));
        if (isAiConfigured && photoConsent.ok) {
          // Real Claude-vision analysis via the backend; on any failure analyzeMeal
          // resolves the deterministic result, so logging never blocks on the AI.
          const st = get();
          // Capture a real meal photo when a camera is wired (device only); on web /
          // cancel / denial this resolves undefined and the model infers from context.
          (isCameraAvailable ? pickPhoto() : Promise.resolve<string | undefined>(undefined))
            .catch(() => undefined)
            .then(async (photoBase64) => {
              // Hold the captured photo so addMeal/saveMeal can upload it to the
              // meal-photos bucket on log (recordMeal). Ephemeral, never persisted.
              if (photoBase64) set({ mealPhoto: photoBase64 });
              // Memory flywheel READ half (audit item 13): tell the model the athlete's CONFIRMED
              // allergies/dislikes so it won't identify a plate item as one of them. Fail-safe: an
              // empty avoid list on any error, so analysis is never blocked by the memory read.
              const avoid = avoidFoodsFromFacts(await fetchMemoryFacts('active').catch(() => []));
              return analyzeMeal({ mealType: st.mealType, goal: st.primaryGoal, description: st.mealDesc || undefined, photoBase64, slotTarget: slotTargetFor(st), avoid });
            })
            .then((res) => {
              // The analyze call returns a finished result, 1-3 clarifying questions, or — when a
              // configured model couldn't answer — an honest 'unavailable' signal (never a fake plate).
              if (res.kind === 'questions') set({ mealQuestions: res.questions, mealStage: 'questions' });
              else if (res.kind === 'unavailable') set({ mealError: res.reason, mealStage: 'unavailable' });
              else set({ mealAnalysis: res.result, mealStage: 'result' });
            })
            // A failure anywhere in the chain must NEVER strand the user on the "analyzing" spinner.
            // Route to the honest 'unavailable' stage (retry / enter manually) — we do not fabricate.
            .catch(() => set({ mealError: 'error', mealStage: 'unavailable' }));
        } else {
          mealTimer = setTimeout(() => set({ mealStage: 'result' }), 2300);
        }
      },
      finalizeMeal: (answers) => {
        const st = get();
        const clarifications = st.mealQuestions.map((q, i) => ({ question: q, answer: (answers[i] ?? '').trim() }));
        set({ mealStage: 'analyzing', mealError: null });
        if (mealTimer) clearTimeout(mealTimer);
        // Second call: same photo + note, now WITH the athlete's answers, forced to report (the
        // finalize phase can't ask again). Consent + photo egress already cleared on the analyze
        // call, and finalize does not claim another daily slot. Never strands the spinner.
        analyzeMeal({
          mealType: st.mealType,
          goal: st.primaryGoal,
          description: st.mealDesc || undefined,
          photoBase64: st.mealPhoto ?? undefined,
          phase: 'finalize',
          clarifications,
          slotTarget: slotTargetFor(st),
        })
          .then((res) => {
            if (res.kind === 'result') set({ mealAnalysis: res.result, mealQuestions: [], mealStage: 'result' });
            else if (res.kind === 'unavailable') set({ mealError: res.reason, mealQuestions: [], mealStage: 'unavailable' });
            // A finalize that somehow still asks can't be answered again; treat as unavailable
            // rather than fabricate a deterministic plate for the athlete's real photo.
            else set({ mealError: 'error', mealQuestions: [], mealStage: 'unavailable' });
          })
          .catch(() => set({ mealError: 'error', mealQuestions: [], mealStage: 'unavailable' }));
      },
      pickUsual: (u) => {
        // Reuse the athlete's own confirmed macros — no photo, no model call, no daily slot.
        set({ mealAnalysis: usualToResult(u), mealQuestions: [], mealPhoto: null, mealStage: 'result' });
      },
      setMealCaptureMode: (mode) => set({ mealCaptureMode: mode, mealStage: 'capture', mealAnalysis: null, mealQuestions: [], mealError: null, labelFacts: null }),
      setLabelServings: (n) => set({ labelServings: Math.min(20, Math.max(0.25, Math.round(n * 4) / 4)) }),
      captureLabel: () => {
        set({ mealStage: 'analyzing', mealAnalysis: null, mealError: null });
        if (mealTimer) clearTimeout(mealTimer);
        // Same fail-closed photo-egress gate as capture()/pushDay: a label photo is real
        // data leaving the device to Anthropic, so an un-consented athlete, unverified minor,
        // or paused athlete NEVER egresses — they get the deterministic sample on-device.
        // Keyed on isAiConfigured (the egress switch), not isBackendLive.
        const photoConsent = realDataConsent(consentContextFromState(get(), isAiConfigured));
        if (isAiConfigured && photoConsent.ok) {
          (isCameraAvailable ? capturePhotoBase64() : Promise.resolve<string | undefined>(undefined))
            .catch(() => undefined)
            .then((photoBase64) => {
              if (photoBase64) set({ mealPhoto: photoBase64 });
              return analyzeLabel({ photoBase64 });
            })
            .then((facts) => set({ labelFacts: facts, labelServings: 1, mealStage: 'result' }))
            // A configured scan that fails must NOT present the deterministic sample as a real
            // reading ("exact, off the label") — that fabricates the athlete's actual photo. Show
            // the honest 'unavailable' stage (retry) instead; never strand the spinner.
            .catch((e) => set({ mealError: e instanceof AiUnavailableError ? e.reason : 'error', mealStage: 'unavailable' }));
        } else {
          // Gate blocked or no endpoint: deterministic sample, nothing leaves the device.
          mealTimer = setTimeout(() => set({ labelFacts: sampleScannedLabel(), labelServings: 1, mealStage: 'result' }), 1400);
        }
      },
      addScannedLabel: () => {
        const { labelFacts, labelServings, mealType } = get();
        if (!labelFacts) return;
        const key = (mealType || 'Dinner').toLowerCase() as MealKey;
        // Log via saveMeal as a single EditableFood so the EXACT label macros (not a slot
        // constant) feed the day score; saveMeal handles meals/score/recordMeal/daySync.
        get().saveMeal(key, [labelToFood(labelFacts, labelServings)]);
        set({ mealOpen: false, mealStage: 'capture', mealCaptureMode: 'meal', labelFacts: null, labelServings: 1, mealAnalysis: null, mealQuestions: [] });
      },
      addSearchedFood: (food) => {
        // Append the picked food (EXACT USDA macros) to the selected slot, alongside anything
        // already logged there — same saveMeal path as a label scan or a snack, so it persists,
        // scores, and counts toward the coach's logging-completeness read.
        const { mealType, mealFoods } = get();
        const key = (mealType || 'Dinner').toLowerCase() as MealKey;
        get().saveMeal(key, [...(mealFoods[key] ?? []), food]);
        set({ mealOpen: false, mealStage: 'capture', mealCaptureMode: 'meal', mealAnalysis: null, mealQuestions: [] });
      },
      addMeal: () => {
        set((s) => {
          const key = (s.mealType || 'Dinner').toLowerCase() as keyof typeof s.meals;
          const meals = { ...s.meals, [key]: true };
          // When a REAL AI analysis is present (mealAnalysis is non-null only on a live AI
          // result; the deterministic path leaves it null), log its grounded macros as the
          // slot's foods so the SCORE reflects the actual meal, not the generic slot constant
          // — the same path the label scan and an edited plate use. No AI result -> unchanged.
          const mealFoods = s.mealAnalysis ? { ...s.mealFoods, [key]: [mealResultToFood(s.mealAnalysis)] } : s.mealFoods;
          const protein = computeProteinToday(meals, mealFoods, s.quickAdded);
          const tasks = s.tasks.map((x) => {
            if (x.id === 2) return { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) };
            if (x.id === 3 && key === 'dinner') return { ...x, done: true };
            return x;
          });
          // On-time stamping is the Accountability Engine's punctuality signal (Feature 8),
          // and it feeds the Development Score — so it's gated by the engines master switch.
          // With engines OFF (the first-beta config) we record NO timestamp: every meal counts
          // on-time and the score stays byte-for-byte untouched, per the ratified keystone
          // ("engines off -> score untouched"). Engines ON: stamp -> late logging lowers it.
          const mealLoggedAt = isEnginesEnabled ? { ...s.mealLoggedAt, [key]: nowMinutes() } : s.mealLoggedAt;
          return { mealOpen: false, mealStage: 'capture', mealAnalysis: null, mealQuestions: [], meals, mealFoods, mealLoggedAt, tasks };
        });
        // Persist the meal (macros + photo) BEFORE clearing the captured photo —
        // recordMeal reads the photo off current state. No-op unless backend live.
        const key = (get().mealType || 'Dinner').toLowerCase() as MealKey;
        scheduleMealRecord(get, key);
        set({ mealPhoto: null });
        scheduleDaySync(get);
      },
      addWater: () => {
        set((s) => {
          const h = Math.min(HYDRATION_TARGET, +(s.hydrationL + 0.3).toFixed(1));
          const tasks = s.tasks.map((x) => (x.id === 4 ? { ...x, done: h >= HYDRATION_TARGET } : x));
          return { hydrationL: h, tasks };
        });
        scheduleDaySync(get);
      },
      addSnack: (preset) => {
        // Log the snack/shake as a real EditableFood in the day's snack slot (append, don't
        // replace), so it persists to the meals table, scores, and counts toward the coach's
        // logging-completeness read — unlike the ephemeral quick-add toggles.
        const s = get();
        s.saveMeal('snack', appendSnack(s.mealFoods.snack, snackToFood(preset)));
      },
      openMealDetail: (meal) => set({ mealDetailOpen: true, selectedMeal: meal }),
      closeMealDetail: () => set({ mealDetailOpen: false }),
      openMealHistory: () => {
        set({ mealHistoryOpen: true });
        // Pull the athlete's own stored meals when the backend is live; otherwise the
        // overlay falls back to today's locally-logged meals (mealHistory stays null).
        // Reading own data needs only the flag gate (consent gates collecting, not
        // resuming) — mirrors hydrateDay.
        if (!isBackendLive) return;
        const s = get();
        if (!s.userId) return;
        void db
          .fetchRecentMeals(s.userId, daysAgoStamp(MEAL_HISTORY_DAYS))
          .then((rows) => set({ mealHistory: rows }))
          .catch(() => undefined); // keep the local fallback on error
      },
      closeMealHistory: () => set({ mealHistoryOpen: false }),
      openNutritionMemory: () => {
        set({ nutritionMemoryOpen: true });
        // Pull the athlete's own stored meals so memory runs on REAL per-slot history when
        // live; offline it falls back to the sample seed (the view flags it). Same own-data
        // read as openMealHistory — only the flag gate applies.
        if (!isBackendLive) return;
        const s = get();
        if (!s.userId) return;
        void db
          .fetchRecentMeals(s.userId, daysAgoStamp(MEAL_HISTORY_DAYS))
          .then((rows) => set({ mealHistory: rows }))
          .catch(() => undefined);
      },
      closeNutritionMemory: () => set({ nutritionMemoryOpen: false }),
      openOverseerProfile: () => set({ overseerProfileOpen: true }),
      closeOverseerProfile: () => set({ overseerProfileOpen: false }),
      openPlans: () => set({ plansOpen: true }),
      closePlans: () => set({ plansOpen: false }),
      openCoachGoals: () => set({ coachGoalsOpen: true }),
      closeCoachGoals: () => set({ coachGoalsOpen: false }),
      toggleOverseerAlert: (key) =>
        set((s) => ({ overseerAlerts: { ...s.overseerAlerts, [key]: !s.overseerAlerts[key] } })),
      refreshEntitlement: async () => {
        if (!isBackendLive) return;
        const uid = get().userId;
        if (!uid) return;
        try {
          const row = await db.fetchEntitlement(uid);
          set({ entitlement: entitlementFromRow(row) });
        } catch {
          /* keep the cached/preview entitlement on error */
        }
      },
      hydrateProfile: async () => {
        if (!isBackendLive) return;
        const uid = get().userId;
        if (!uid) return;
        try {
          const p = await db.fetchProfile(uid);
          if (!p) return;
          // Prefer the backend's stored values; fall back to whatever's local so an
          // empty column never blanks a name the user just typed.
          set((s) => ({
            athleteName: p.full_name?.trim() || s.athleteName,
            orgName: p.org_name?.trim() || s.orgName,
            athleteEmail: p.email?.trim() || s.athleteEmail,
          }));
        } catch {
          /* keep the local identity on error */
        }
      },
      hydrateRecord: async () => {
        // Rebuild the athlete's full score + weight record from the server (audit item 14) so a new
        // device / returning athlete sees their season, not just the local 14-day cache. Gated +
        // soft-fail: never blocks sign-in, and an offline/empty read leaves the local cache intact.
        if (!isBackendLive) return;
        const uid = get().userId;
        if (!uid) return;
        try {
          const slice = await hydrateHistory(uid);
          if (slice) set(slice);
        } catch {
          /* keep the AsyncStorage-cached history on error */
        }
      },
      hydrateGuardianConsent: async () => {
        if (!isBackendLive) return;
        const uid = get().userId;
        if (!uid) return;
        try {
          const rows = await db.fetchGuardianRequests(uid);
          // Server value only: a minor stays gated unless the backend actually wrote 'verified'.
          set({ guardianStatus: guardianStatusFromRequests(rows) });
        } catch {
          /* keep the local (fail-closed) status on error */
        }
      },
      pushAthleteGoals: async (athleteId, targets) => {
        if (!isBackendLive || !athleteId) return false;
        try {
          await db.coachSetGoals(athleteId, targets, null);
          set({ authError: null });
          return true;
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : 'Could not save goals' });
          return false;
        }
      },
      setDisplayName: (v) => {
        set({ athleteName: v });
        pushProfile(get);
      },
      setOrgName: (v) => {
        set({ orgName: v });
        pushProfile(get);
      },
      openFoodCoach: () => set({ foodCoachOpen: true }),
      closeFoodCoach: () => set({ foodCoachOpen: false }),
      openPlanEditor: () => set({ planEditorOpen: true }),
      closePlanEditor: () => set({ planEditorOpen: false }),
      addPlanInstruction: (text) =>
        set((s) => {
          const t = text.trim();
          if (!t || s.planInstructions.includes(t) || s.planInstructions.length >= 8) return {};
          return { planInstructions: [...s.planInstructions, t] };
        }),
      removePlanInstruction: (index) =>
        set((s) => ({ planInstructions: s.planInstructions.filter((_, i) => i !== index) })),
      setPlanSlots: (slots) => set({ planSlots: parsePlanSlots(slots) }),
      updatePlanSlot: (key, patch) => set((s) => ({ planSlots: applySlotPatch(s.planSlots, key, patch) })),
      togglePlanSlotMode: (key) => set((s) => ({ planSlots: toggleMode(s.planSlots, key) })),
      generatePlanDraftLocal: (goal) => set((s) => ({ planSlots: buildPlanDraft(activePlan(s), goal) })),
      clearPlan: () => set({ planSlots: [] }),
      saveMeal: (key, foods, learn = false) => {
        // Capture the plate BEFORE this save so a genuine correction (a removed food) can be learned.
        const beforeNames = (get().mealFoods[key] ?? []).map((f) => f.name);
        set((s) => {
          // Saving a meal's edited plate logs the slot AND records its real foods.
          const meals = { ...s.meals, [key]: true };
          const mealFoods = { ...s.mealFoods, [key]: foods };
          const protein = computeProteinToday(meals, mealFoods, s.quickAdded);
          const tasks = s.tasks.map((x) => {
            if (x.id === 2) return { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) };
            if (x.id === 3 && key === 'dinner') return { ...x, done: true };
            return x;
          });
          // Punctuality stamp gated by the engines switch — see addMeal above (keystone:
          // engines off -> Development Score untouched).
          const mealLoggedAt = isEnginesEnabled ? { ...s.mealLoggedAt, [key]: nowMinutes() } : s.mealLoggedAt;
          return { meals, mealFoods, mealLoggedAt, tasks, mealDetailOpen: false };
        });
        // Persist the corrected plate (edited macros + photo). No-op unless backend live.
        scheduleMealRecord(get, key);
        set({ mealPhoto: null });
        scheduleDaySync(get);
        // Learn from a genuine plate correction (the MealDetail edit passes learn=true). Fire-and-
        // forget: a meal always logs even if learning is off, unconfigured, or fails.
        if (learn) void learnFromCorrection(get, beforeNames, foods);
      },
      toggleQuick: (i) => {
        set((s) => {
          const q = [...s.quickAdded];
          q[i] = !q[i];
          const protein = computeProteinToday(s.meals, s.mealFoods, q);
          const tasks = s.tasks.map((x) => (x.id === 2 ? { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) } : x));
          return { quickAdded: q, tasks };
        });
        scheduleDaySync(get);
      },
      openPerson: (p) => set({ personDetail: p }),
      closePerson: () => set({ personDetail: null }),
      openAccount: () => set({ accountOpen: true }),
      closeAccount: () => set({ accountOpen: false }),
      openMsg: () => set({ msgOpen: true }),
      closeMsg: () => set({ msgOpen: false }),
      setMsgDraft: (v) => set({ msgDraft: v }),
      sendMsg: () =>
        set((s) => {
          const next = appendMessage(s.msgThread, 'me', s.msgDraft);
          if (next === s.msgThread) return {}; // empty draft, nothing sent
          return { msgThread: next, msgDraft: '' };
        }),
      openNotif: () => { set({ notifOpen: true }); void get().fetchNotifications(); },
      fetchNotifications: async () => {
        if (!isBackendLive) return;
        const rows = await db.fetchNotifications().catch(() => []);
        set({ notifications: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, createdAt: r.created_at, readAt: r.read_at })) });
      },
      markNotificationRead: async (id) => {
        const now = new Date().toISOString();
        set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n)) }));
        if (isBackendLive) await db.markNotificationRead(id).catch(() => undefined);
      },
      markAllNotificationsRead: async () => {
        const now = new Date().toISOString();
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, readAt: n.readAt ?? now })) }));
        if (isBackendLive) await db.markAllNotificationsRead().catch(() => undefined);
      },
      closeNotif: () => set({ notifOpen: false }),
      setMealDesc: (v) => set({ mealDesc: v }),
      setChatDraft: (v) => set({ chatDraft: v }),
      sendChat: () =>
        set((s) => {
          const t = (s.chatDraft || '').trim();
          if (!t) return {};
          return { mealChat: [...s.mealChat, { who: 'athlete', text: t }], chatDraft: '' };
        }),

      // ---- role entry ----
      enterCoach: () => set({ flow: 'coach' }),
      enterParent: () => set({ flow: 'parent' }),
      enterTrainer: () => set({ flow: 'trainer' }),

      // ---- overseer action ----
      // The only overseer action this phase (product spec): a lightweight nudge
      // to an at-risk athlete. Deterministic + offline — it records the athlete as
      // nudged today (idempotent), which flips the dashboard button to "Nudged",
      // and logs the athlete's compliance/score at send-time (the baseline the
      // "did anything move since the nudge" read compares against, core/nudge.ts).
      // Day-scoped via rollover so the coach can nudge again tomorrow.
      sendNudge: (name, baseline, note, athleteId) => {
        set((s) =>
          s.nudged.includes(name)
            ? {}
            : {
                nudged: [...s.nudged, name],
                nudgeLog: [
                  ...s.nudgeLog,
                  { name, day: s.dateStamp, comp: baseline?.comp ?? 0, score: baseline?.score ?? 0, note: note?.trim() || undefined },
                ],
              },
        );
        // When live + we know the athlete's id, deliver the nudge for real: the send-push
        // edge function records an in-app notification and pushes to their device(s).
        if (isBackendLive && athleteId) {
          const body = note?.trim() || 'Your coach nudged you — jump back in and log your next win.';
          void db.nudgePush(athleteId, 'Your coach sent a nudge', body).catch(() => undefined);
        }
      },

      // Coach grants / ends a linked athlete's Trust Pass via the server RPC (RLS + server-side
      // eligibility enforce it). Throws on unauthorized/ineligible so the UI can surface it.
      coachGrantTrustPass: async (athleteId, lengthDays) => {
        if (isBackendLive) await db.grantTrustPass(athleteId, lengthDays);
      },
      coachEndTrustPass: async (athleteId) => {
        if (isBackendLive) await db.endTrustPass(athleteId);
      },

      // ---- tasks ----
      toggleTask: (id) => {
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
        scheduleDaySync(get);
      },

      setDailyCommitment: (answer) => {
        set({ dailyCommitment: answer });
        scheduleDaySync(get);
      },

      grantTrustPass: (lengthDays) => set({ trustPass: { grantedDate: todayStamp(), lengthDays } }),
      endTrustPass: () => set({ trustPass: null }),

      // ---- check-in ----
      wStep: (d) => set((s) => ({ ciWeight: clamp(s.ciWeight + d, 70, 350) })),
      setCi: (key, value) => set({ [key]: value } as Partial<AppState>),
      toggleCiQ: (k) => set((s) => ({ ciConfig: { ...s.ciConfig, [k]: !s.ciConfig[k] } })),
      submitCi: () => {
        set((s) => ({ ciStage: 'done', ciSubmitted: true, currentWeight: s.ciWeight, weighInStamp: todayStamp() }));
        syncReminders(get());
        scheduleDaySync(get);
      },
      logWeight: (lb) => {
        const w = Math.max(60, Math.min(500, Math.round(lb)));
        set({ currentWeight: w, ciWeight: w, weighInStamp: todayStamp() });
        syncReminders(get()); // clears the weigh-in nudge once logged
        scheduleDaySync(get);
      },

      // ---- backend auth (go-live) ----
      // All gated behind isBackendLive: with the flag off they are inert no-ops and
      // the screens keep their mock auth path, so flag-OFF behaviour is identical.
      // On success the userId is stored; routing stays with the caller (the screen),
      // which falls back to the mock router when the flag is off.
      signUpLive: async (email, password, fullName) => {
        if (!isBackendLive) return false;
        const res = await auth.signUp(email.trim(), password, fullName.trim() || undefined);
        if (!res.ok) {
          set({ authError: res.error });
          return false;
        }
        // Keep the email for the account/verify panels (password is never stored). Record whether
        // the project actually requires confirmation, so the "check your email" panel is honest
        // (and silent when confirm is OFF — no false "we sent a link" claim).
        set({ userId: res.userId, athleteEmail: email.trim(), emailConfirmPending: res.needsConfirmation ?? false, authError: null });
        return true;
      },
      requestPasswordReset: async (email) => {
        if (!isBackendLive) {
          // Neutral local confirmation so the screen behaves the same flag-off.
          set({ passwordResetSent: true, authError: null });
          return true;
        }
        const res = await auth.resetPassword(email);
        // Never leak whether the email exists: surface the same confirmation unless
        // the request itself errored on the network.
        if (!res.ok && res.error !== 'notConfigured') {
          set({ authError: res.error });
          return false;
        }
        set({ passwordResetSent: true, authError: null });
        return true;
      },
      signInWithApple: async (identityToken) => {
        if (!isBackendLive) return false;
        const res = await auth.signInWithAppleToken(identityToken);
        if (!res.ok) {
          set({ authError: res.error });
          return false;
        }
        set({ userId: res.userId, authError: null });
        try {
          const slice = await hydrateDay(res.userId);
          if (slice) set(slice);
        } catch {
          /* keep the AsyncStorage-cached day */
        }
        // Read the real identity (name/org/email) + entitlement back from the backend
        // so a fresh device isn't stuck on the seeded demo identity. Both gated + soft-fail.
        void get().hydrateProfile();
        void get().hydrateRecord();
        void get().refreshEntitlement();
        void get().hydrateGuardianConsent();
        return true;
      },
      signInLive: async (email, password) => {
        if (!isBackendLive) return false;
        const res = await auth.signIn(email.trim(), password);
        if (!res.ok) {
          set({ authError: res.error });
          return false;
        }
        set({ userId: res.userId, authError: null });
        // Resume the athlete's real day from Postgres. A hydrate failure (offline,
        // no row yet) must never block sign-in: fall back to the local cache.
        try {
          const slice = await hydrateDay(res.userId);
          if (slice) set(slice);
        } catch {
          /* keep the AsyncStorage-cached day */
        }
        // Read the real identity (name/org/email) + entitlement back from the backend
        // so a fresh device isn't stuck on the seeded demo identity. Both gated + soft-fail.
        void get().hydrateProfile();
        void get().hydrateRecord();
        void get().refreshEntitlement();
        void get().hydrateGuardianConsent();
        return true;
      },
      signOutLive: async () => {
        if (isBackendLive) await auth.signOut();
        // Purge the overseer read-cache on sign-out so the next user never sees the prior
        // user's roster (cross-user paint guard, cache do-NOT list).
        set({ userId: null, realDataConsent: false, authError: null, entitlement: entitlementFromRow(null), cachedRoster: null, cachedRosterUserId: null });
      },
      createTeamLive: async (name, sport, orgId, discoverable) => {
        if (!isBackendLive) return null;
        try {
          const code = await db.createTeam(name.trim() || 'My Team', sport?.trim() || undefined, orgId ?? null, discoverable ?? false);
          if (code) set({ teamCode: code, authError: null });
          return code;
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : 'Could not create team' });
          return null;
        }
      },
      setInviteCodeCustom: async (code) => {
        if (!isBackendLive) return { ok: false, error: 'Available once your backend is live' };
        const isTrainer = get().flow === 'trainer';
        try {
          const saved = isTrainer ? await db.setMyPracticeCode(code) : await db.setMyTeamCode(code);
          if (saved) {
            set({ teamCode: saved, authError: null });
            return { ok: true };
          }
          return { ok: false, error: 'Could not update code' };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : 'Could not update code' };
        }
      },
      regenerateInviteCode: async () => {
        if (!isBackendLive) return null;
        const isTrainer = get().flow === 'trainer';
        try {
          const code = isTrainer ? await db.regenerateMyPracticeCode() : await db.regenerateMyTeamCode();
          if (code) set({ teamCode: code, authError: null });
          return code;
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : 'Could not regenerate code' });
          return null;
        }
      },
      setTeamDiscoverable: (v) => set({ teamDiscoverable: v }),
      setGuardianEmail: (v) => set({ guardianEmail: v }),
      requestGuardianConsent: async () => {
        const email = get().guardianEmail.trim();
        if (!isValidGuardianEmail(email)) {
          set({ authError: 'Enter a valid parent or guardian email.' });
          return false;
        }
        if (isBackendLive) {
          try {
            await db.requestGuardianConsent(email);
          } catch (e) {
            set({ authError: e instanceof Error ? e.message : 'Could not send the request.' });
            return false;
          }
        }
        // 'pending' until the guardian confirms server-side; a real minor's data stays
        // on-device (guardianConsentRequired) until guardianStatus becomes 'verified'.
        set({ guardianStatus: 'pending', authError: null });
        return true;
      },
      recordConsent: (given) => set({ realDataConsent: given }),
      acceptTerms: (at) => set({ termsAcceptedAt: at }),
      setAuthError: (msg) => set({ authError: msg }),
      togglePauseSharing: () => {
        // Flipping OFF pause resumes syncing, so push the current day right away
        // (the pure consent gate still has the final say). Flipping ON just stops.
        set((s) => ({ sharingPaused: !s.sharingPaused }));
        scheduleDaySync(get);
      },
      removeViewer: (key) => {
        set((s) => ({ supportTeam: s.supportTeam.filter((k) => k !== key) }));
        // When live, actually revoke that viewer kind's server access (security G1) so a removed
        // coach/parent loses can_view, not just the local label. Best-effort, gated; inert until
        // the revoke_viewer RPC is applied at go-live (see docs/specs/2026-06-29-g1-revoke-viewer.md).
        if (isBackendLive) void db.revokeViewer(key).catch(() => undefined);
      },

      // ---- dev ----
      resetDemo: () => set({ ...createInitialState() }),
    }),
    {
      name: 'aos_day',
      storage: createJSONStorage(() => AsyncStorage),
      // Versioned persistence (audit item 17): establishes the migrate hook so a future change to a
      // PERSISTED field's shape has ONE clean upgrade path instead of scattered read-site guards.
      // zustand shallow-merges the persisted slice over createInitialState(), so any newly-persisted
      // key missing from an older blob already falls back to its default — the passthrough is safe.
      // v0 = the pre-versioning blob (same persisted shape as v1). When a persisted field's shape
      // changes incompatibly, bump this and branch on `from` here.
      version: 1,
      migrate: (persisted, _from) => persisted as Partial<Store>,
      // Persist the day/check-in slice PLUS the session-identity fields (flow, role,
      // onboarding identity) so a reload lands the user back where they were instead of
      // dumping them at onboarding. Identity/flow fields are cross-day: they are NOT in
      // DAY_DEFAULT_KEYS, so they survive a calendar rollover.
      partialize: (s) => ({
        // session / flow + onboarding identity (cross-day)
        flow: s.flow,
        role: s.role,
        obStep: s.obStep,
        signinMode: s.signinMode,
        athleteName: s.athleteName,
        athleteEmail: s.athleteEmail,
        orgName: s.orgName,
        level: s.level,
        sport: s.sport,
        position: s.position,
        baseGoal: s.baseGoal,
        baseHeight: s.baseHeight,
        baseWeight: s.baseWeight,
        baseAge: s.baseAge,
        weeklyGoalLb: s.weeklyGoalLb,
        proteinTarget: s.proteinTarget,
        planInstructions: s.planInstructions,
        planSlots: s.planSlots,
        calTarget: s.calTarget,
        weightTarget: s.weightTarget,
        weightTargetTouched: s.weightTargetTouched,
        scoringProfile: s.scoringProfile,
        compMode: s.compMode,
        goals: s.goals,
        inviteWho: s.inviteWho,
        parentFocus: s.parentFocus,
        coachTrack: s.coachTrack,
        // onboarding (redesign) — cross-day identity + baseline
        primaryGoal: s.primaryGoal,
        trainingFreq: s.trainingFreq,
        supportTeam: s.supportTeam,
        inviteCode: s.inviteCode,
        teamCode: s.teamCode,
        teamDiscoverable: s.teamDiscoverable,
        connectCardDismissed: s.connectCardDismissed,
        guardianEmail: s.guardianEmail,
        guardianStatus: s.guardianStatus,
        baseNutritionConfidence: s.baseNutritionConfidence,
        baseMealsPerDay: s.baseMealsPerDay,
        baseWaterL: s.baseWaterL,
        baseSleepH: s.baseSleepH,
        baseProteinFreq: s.baseProteinFreq,
        baseConsistency: s.baseConsistency,
        startScore: s.startScore,
        obMeta: s.obMeta,
        // backend session (cross-day; inert unless isBackendLive). authError is
        // ephemeral and deliberately NOT persisted.
        userId: s.userId,
        realDataConsent: s.realDataConsent,
        termsAcceptedAt: s.termsAcceptedAt,
        sharingPaused: s.sharingPaused,
        entitlement: s.entitlement,
        trustPass: s.trustPass,
        // overseer read-cache (snappy paint); namespaced by cachedRosterUserId, purged on sign-out
        cachedRoster: s.cachedRoster,
        cachedRosterUserId: s.cachedRosterUserId,
        // day / check-in slice
        dateStamp: s.dateStamp,
        scoreHistory: s.scoreHistory,
        weightHistory: s.weightHistory,
        nutritionHistory: s.nutritionHistory,
        perfEntries: s.perfEntries,
        meals: s.meals,
        mealFoods: s.mealFoods,
        mealLoggedAt: s.mealLoggedAt,
        hydrationL: s.hydrationL,
        tasks: s.tasks,
        dailyCommitment: s.dailyCommitment,
        quickAdded: s.quickAdded,
        nudged: s.nudged,
        nudgeLog: s.nudgeLog,
        ciStage: s.ciStage,
        ciSubmitted: s.ciSubmitted,
        ciWeight: s.ciWeight,
        currentWeight: s.currentWeight,
        weighInStamp: s.weighInStamp,
        startWeight: s.startWeight,
        ciEnergy: s.ciEnergy,
        ciRecovery: s.ciRecovery,
        ciSleep: s.ciSleep,
        ciConfidence: s.ciConfidence,
        ciSoreness: s.ciSoreness,
        ciMotivation: s.ciMotivation,
        ciConfig: s.ciConfig,
        visibility: s.visibility,
        notif: s.notif,
        reminderSettings: s.reminderSettings,
        overseerAlerts: s.overseerAlerts,
        units: s.units,
        themeMode: s.themeMode,
        // Cross-day (not a DAY_DEFAULT_KEY): a coach<->athlete message must leave a
        // record that survives reload, not vanish with the in-memory session.
        msgThread: s.msgThread,
      }),
      // Roll the persisted day forward BEFORE the first UI/selector read: on a new
      // calendar day the stale day slice resets to fresh defaults; same-day restores
      // as-is. Cross-day fields (weight, prefs) survive. A brand-new install (no
      // persisted blob) is treated as stale and simply stamped with today.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const today = todayStamp();
        // Record the prior day's final score + body weight BEFORE the slice
        // resets, using the full pre-roll state (persisted day data over current
        // defaults).
        const preRoll = { ...current, ...p } as AppState;
        const scoreHistory = recordDayScore(preRoll, today);
        const weightHistory = recordDayWeight(preRoll, today);
        const nutritionHistory = recordDayNutrition(preRoll, today);
        const rolled = rollDayIfStale(p, today);
        const merged = { ...current, ...rolled, scoreHistory, weightHistory, nutritionHistory } as Store;
        // New install / legacy pre-fix blob: a persisted blob with no `flow` (either a
        // brand-new install or a blob written before session persistence existed) must
        // start clean at onboarding step 0. When `flow` IS present, `...rolled` already
        // carried flow/role/identity (preserved through the roll), so restore is verbatim.
        if (p.flow == null) {
          merged.flow = 'onboarding';
          merged.obStep = 0;
        }
        return merged;
      },
    },
  ),
);
