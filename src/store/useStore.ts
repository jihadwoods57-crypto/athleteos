// AthleteOS — single session store (Zustand) + AsyncStorage persistence.
// Mirrors the prototype's component state + methods; the day slice persists
// under key `aos_day`, exactly like the prototype's localStorage usage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { analyzeLabel, analyzeMeal, isAiConfigured } from '@/lib/ai';
import { capturePhotoBase64, isCameraAvailable } from '@/lib/capture';
import { isEnginesEnabled } from '@/lib/features';
import { auth, db, isBackendLive } from '@/lib/supabase';
import { refreshReminderSchedule } from '@/lib/notify';
import { consentContextFromState, hydrateDay, pushDay } from './sync';
import { recordMeal } from './mealSync';
import {
  addPerfEntry,
  removePerfEntry,
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
  realDataConsent,
  reminderNotifySpecs,
  reminderSnapshotFromState,
  sampleScannedLabel,
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
  PersonDetail,
  Role,
  RosterRow,
  SquadMode,
  Tab,
  CoachTab,
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
  /** Toggle a single reminder on/off (P3). */
  toggleReminder: (kind: ReminderKind) => void;
  /** Set a reminder's local fire hour (0-23, clamped) (P3). */
  setReminderHour: (kind: ReminderKind, hour: number) => void;
  toggleUnits: () => void;
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
  capture: () => void;
  /** Switch the meal overlay between photographing a plate and scanning a label. */
  setMealCaptureMode: (mode: MealCaptureMode) => void;
  /** Scan a Nutrition Facts label (transcribe). Honors the same photo-egress consent gate. */
  captureLabel: () => void;
  /** Set how many servings of the scanned label were eaten (¼-step). */
  setLabelServings: (n: number) => void;
  /** Log the scanned label (scaled by servings) into the selected meal slot. */
  addScannedLabel: () => void;
  addMeal: () => void;
  addWater: () => void;
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
  saveMeal: (key: MealKey, foods: EditableFood[]) => void;
  openFoodCoach: () => void;
  closeFoodCoach: () => void;
  openPlanEditor: () => void;
  closePlanEditor: () => void;
  /** Add a standing coach instruction (trimmed, deduped, capped). */
  addPlanInstruction: (text: string) => void;
  removePlanInstruction: (index: number) => void;
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
  sendNudge: (name: string, baseline?: { score: number; comp: number }, note?: string) => void;

  // tasks
  toggleTask: (id: number) => void;

  // check-in
  wStep: (d: number) => void;
  setCi: (key: CiSliderKey, value: number) => void;
  toggleCiQ: (k: keyof CiConfig) => void;
  submitCi: () => void;

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
  createTeamLive: (name: string, sport?: string) => Promise<string | null>;
  setGuardianEmail: (v: string) => void;
  /** Minor guardian consent: email a minor's guardian an approval request. Gated, sends only
   *  when the backend is live; marks status 'pending' on a valid email. Returns success. */
  requestGuardianConsent: () => Promise<boolean>;
  recordConsent: (given: boolean) => void;
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
const MEAL_HISTORY_DAYS = 14;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDaySync(get: () => Store): void {
  if (!isBackendLive) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const s = get();
    if (s.userId) void pushDay(s, s.userId).catch(() => undefined);
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
  });
  void refreshReminderSchedule(reminderNotifySpecs(s.reminderSettings, snapshot), s.notif);
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
        const flow = flowForRole(get().role);
        set(flow === 'app' ? { flow, tab: 'home' } : { flow });
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
      startSignin: () => set({ signinMode: true }),
      exitSignin: () => set({ signinMode: false }),
      signinDone: () => set({ signinMode: false, flow: 'app', tab: 'home' }),

      // ---- onboarding (redesign) ----
      setPrimaryGoal: (k) => set({ primaryGoal: k }),
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
      // Activation: leave onboarding into the app and open the first-meal capture.
      // Swap the SEEDED DEMO day for a genuinely empty day so a brand-new athlete's
      // first Home is honest — nothing pre-logged, every task open, score building
      // up from the Starting Point Score anchor and rising the moment they log their
      // first meal (the activation reward). The seeded demo is untouched because only
      // the athlete activation path calls this (other roles use finishOb).
      startFirstMealChallenge: () =>
        set((s) => ({
          ...emptyDaySlice(),
          flow: 'app',
          tab: 'home',
          mealOpen: true,
          mealStage: 'capture',
          // Surface the weight the athlete entered in onboarding: it anchors the
          // season-goal progress (start) and is their live current weight (no
          // progress yet, so "gained since start" honestly reads 0). Check-in
          // starts from the same number. Only the activation path runs this, so
          // the seeded demo's 171/178 stays intact.
          startWeight: s.baseWeight,
          currentWeight: s.baseWeight,
          ciWeight: s.baseWeight,
        })),

      // ---- nav ----
      setTab: (t) => set({ tab: t }),
      setCoachTab: (t) => set({ coachTab: t }),
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
        set((s) => ({ weightTarget: clamp((s.weightTarget ?? WEIGHT_TARGET) + d, 120, 350) })),
      signOut: () => {
        // Terminate the real Supabase session (clears the persisted refresh token) AND
        // clear the sensitive session state (userId / consent / entitlement) via the
        // signOutLive primitive, THEN reset navigation back to onboarding. The buttons
        // wired here must do both: a nav-only reset would leave a live, signed-in session
        // (and its token in AsyncStorage) behind once the backend is on. auth.signOut runs
        // in the background; local state still resets even if the network call fails.
        void get().signOutLive();
        set({ flow: 'onboarding', obStep: 0, role: null, accountOpen: false });
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
      openMeal: () => set({ mealOpen: true, mealStage: 'capture', mealCaptureMode: 'meal', mealAnalysis: null, labelFacts: null, labelServings: 1, mealPhoto: null }),
      closeMeal: () => set({ mealOpen: false }),
      setMealType: (m) => set({ mealType: m }),
      capture: () => {
        set({ mealStage: 'analyzing', mealAnalysis: null });
        if (mealTimer) clearTimeout(mealTimer);
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
          (isCameraAvailable ? capturePhotoBase64() : Promise.resolve<string | undefined>(undefined))
            .catch(() => undefined)
            .then((photoBase64) => {
              // Hold the captured photo so addMeal/saveMeal can upload it to the
              // meal-photos bucket on log (recordMeal). Ephemeral, never persisted.
              if (photoBase64) set({ mealPhoto: photoBase64 });
              return analyzeMeal({ mealType: st.mealType, goal: st.primaryGoal, description: st.mealDesc || undefined, photoBase64 });
            })
            .then((res) => set({ mealAnalysis: res, mealStage: 'result' }))
            // analyzeMeal already degrades to a deterministic result internally, but a
            // failure anywhere in the chain must NEVER strand the user on the "analyzing"
            // spinner. Fall through to the result stage (the UI fills the deterministic
            // estimate when mealAnalysis is null).
            .catch(() => set({ mealAnalysis: null, mealStage: 'result' }));
        } else {
          mealTimer = setTimeout(() => set({ mealStage: 'result' }), 2300);
        }
      },
      setMealCaptureMode: (mode) => set({ mealCaptureMode: mode, mealStage: 'capture', mealAnalysis: null, labelFacts: null }),
      setLabelServings: (n) => set({ labelServings: Math.min(20, Math.max(0.25, Math.round(n * 4) / 4)) }),
      captureLabel: () => {
        set({ mealStage: 'analyzing', mealAnalysis: null });
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
            // Any failure degrades to the deterministic sample; never strand the spinner.
            .catch(() => set({ labelFacts: sampleScannedLabel(), labelServings: 1, mealStage: 'result' }));
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
        set({ mealOpen: false, mealStage: 'capture', mealCaptureMode: 'meal', labelFacts: null, labelServings: 1, mealAnalysis: null });
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
          return { mealOpen: false, mealStage: 'capture', mealAnalysis: null, meals, mealFoods, mealLoggedAt, tasks };
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
      saveMeal: (key, foods) => {
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
      openNotif: () => set({ notifOpen: true }),
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
      sendNudge: (name, baseline, note) =>
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
        ),

      // ---- tasks ----
      toggleTask: (id) => {
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
        scheduleDaySync(get);
      },

      // ---- check-in ----
      wStep: (d) => set((s) => ({ ciWeight: clamp(s.ciWeight + d, 70, 350) })),
      setCi: (key, value) => set({ [key]: value } as Partial<AppState>),
      toggleCiQ: (k) => set((s) => ({ ciConfig: { ...s.ciConfig, [k]: !s.ciConfig[k] } })),
      submitCi: () => {
        set((s) => ({ ciStage: 'done', ciSubmitted: true, currentWeight: s.ciWeight }));
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
        // Keep the email for the account/verify panels (password is never stored).
        set({ userId: res.userId, athleteEmail: email.trim(), authError: null });
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
      createTeamLive: async (name, sport) => {
        if (!isBackendLive) return null;
        try {
          const code = await db.createTeam(name.trim() || 'My Team', sport?.trim() || undefined);
          if (code) set({ teamCode: code, authError: null });
          return code;
        } catch (e) {
          set({ authError: e instanceof Error ? e.message : 'Could not create team' });
          return null;
        }
      },
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
      setAuthError: (msg) => set({ authError: msg }),
      togglePauseSharing: () => {
        // Flipping OFF pause resumes syncing, so push the current day right away
        // (the pure consent gate still has the final say). Flipping ON just stops.
        set((s) => ({ sharingPaused: !s.sharingPaused }));
        scheduleDaySync(get);
      },
      removeViewer: (key) =>
        set((s) => ({ supportTeam: s.supportTeam.filter((k) => k !== key) })),

      // ---- dev ----
      resetDemo: () => set({ ...createInitialState() }),
    }),
    {
      name: 'aos_day',
      storage: createJSONStorage(() => AsyncStorage),
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
        calTarget: s.calTarget,
        weightTarget: s.weightTarget,
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
        sharingPaused: s.sharingPaused,
        entitlement: s.entitlement,
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
        quickAdded: s.quickAdded,
        nudged: s.nudged,
        nudgeLog: s.nudgeLog,
        ciStage: s.ciStage,
        ciSubmitted: s.ciSubmitted,
        ciWeight: s.ciWeight,
        currentWeight: s.currentWeight,
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
