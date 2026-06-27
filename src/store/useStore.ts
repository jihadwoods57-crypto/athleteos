// AthleteOS — single session store (Zustand) + AsyncStorage persistence.
// Mirrors the prototype's component state + methods; the day slice persists
// under key `aos_day`, exactly like the prototype's localStorage usage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { analyzeMeal, isAiConfigured } from '@/lib/ai';
import { auth, db, isBackendLive } from '@/lib/supabase';
import { hydrateDay, pushDay } from './sync';
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
  appendMessage,
  loggedDayMacros,
  exportUserDataText,
} from '@/core';
import type {
  AppState,
  EditableFood,
  MealKey,
  PerfDir,
  PerfEntry,
  ReminderKind,
  BaseGoal,
  CiConfig,
  CoachTrackKey,
  CompMode,
  MealLabel,
  PersonDetail,
  Role,
  SquadMode,
  Tab,
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
  addMeal: () => void;
  addWater: () => void;
  openMealDetail: (meal: string) => void;
  closeMealDetail: () => void;
  /** Persist an edited meal's foods into the day slice and mark the slot logged, so
   *  reopening shows the saved plate and the daily score reflects its real macros. */
  saveMeal: (key: MealKey, foods: EditableFood[]) => void;
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
  /** Coach/overseer creates a real team via the create_team RPC and stores the
   *  server-generated join code in teamCode. Inert (returns null) when the flag
   *  is off, so the onboarding invite step keeps its EAGLES24 showcase code. */
  createTeamLive: (name: string, sport?: string) => Promise<string | null>;
  recordConsent: (given: boolean) => void;
  setAuthError: (msg: string | null) => void;

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
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDaySync(get: () => Store): void {
  if (!isBackendLive) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const s = get();
    if (s.userId) void pushDay(s, s.userId).catch(() => undefined);
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
      ageStep: (d) => set((s) => ({ baseAge: clamp(s.baseAge + d, 8, 24) })),
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
      toggleNotif: () => set((s) => ({ notif: !s.notif })),
      toggleReminder: (kind) =>
        set((s) => ({
          reminderSettings: {
            ...s.reminderSettings,
            [kind]: { ...s.reminderSettings[kind], enabled: !s.reminderSettings[kind].enabled },
          },
        })),
      setReminderHour: (kind, hour) =>
        set((s) => ({
          reminderSettings: {
            ...s.reminderSettings,
            [kind]: { ...s.reminderSettings[kind], hour: clampHour(hour) },
          },
        })),
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
      signOut: () => set({ flow: 'onboarding', obStep: 0, role: null, accountOpen: false }),
      deleteAccount: async () => {
        // Delete server-side when connected; wipe local data either way so the in-app
        // deletion always completes (Apple requires it to actually work, not just sign out).
        if (isBackendLive) {
          try { await db.deleteAccount(); } catch { /* still wipe locally below */ }
        }
        try { await AsyncStorage.removeItem('aos_day'); } catch { /* best effort */ }
        set({ ...createInitialState() });
      },
      exportMyData: () => exportUserDataText(get()),

      // ---- overlays ----
      openMeal: () => set({ mealOpen: true, mealStage: 'capture', mealAnalysis: null }),
      closeMeal: () => set({ mealOpen: false }),
      setMealType: (m) => set({ mealType: m }),
      capture: () => {
        set({ mealStage: 'analyzing', mealAnalysis: null });
        if (mealTimer) clearTimeout(mealTimer);
        if (isAiConfigured) {
          // Real Claude-vision analysis via the backend; on any failure analyzeMeal
          // resolves the deterministic result, so logging never blocks on the AI.
          const st = get();
          analyzeMeal({ mealType: st.mealType, goal: st.primaryGoal, description: st.mealDesc || undefined })
            .then((res) => set({ mealAnalysis: res, mealStage: 'result' }))
            // analyzeMeal already degrades to a deterministic result internally, but a
            // failure in the .then or an unexpected throw must NEVER strand the user on
            // the "analyzing" spinner. Fall through to the result stage (the UI fills
            // the deterministic estimate when mealAnalysis is null).
            .catch(() => set({ mealAnalysis: null, mealStage: 'result' }));
        } else {
          mealTimer = setTimeout(() => set({ mealStage: 'result' }), 2300);
        }
      },
      addMeal: () => {
        set((s) => {
          const key = (s.mealType || 'Dinner').toLowerCase() as keyof typeof s.meals;
          const meals = { ...s.meals, [key]: true };
          const protein = computeProteinToday(meals, s.mealFoods, s.quickAdded);
          const tasks = s.tasks.map((x) => {
            if (x.id === 2) return { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) };
            if (x.id === 3 && key === 'dinner') return { ...x, done: true };
            return x;
          });
          return { mealOpen: false, mealStage: 'capture', mealAnalysis: null, meals, tasks };
        });
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
          return { meals, mealFoods, tasks, mealDetailOpen: false };
        });
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
        set({ userId: res.userId, authError: null });
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
        return true;
      },
      signOutLive: async () => {
        if (isBackendLive) await auth.signOut();
        set({ userId: null, realDataConsent: false, authError: null });
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
      recordConsent: (given) => set({ realDataConsent: given }),
      setAuthError: (msg) => set({ authError: msg }),

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
        level: s.level,
        sport: s.sport,
        position: s.position,
        baseGoal: s.baseGoal,
        baseHeight: s.baseHeight,
        baseWeight: s.baseWeight,
        baseAge: s.baseAge,
        weeklyGoalLb: s.weeklyGoalLb,
        proteinTarget: s.proteinTarget,
        calTarget: s.calTarget,
        weightTarget: s.weightTarget,
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
        // day / check-in slice
        dateStamp: s.dateStamp,
        scoreHistory: s.scoreHistory,
        weightHistory: s.weightHistory,
        nutritionHistory: s.nutritionHistory,
        perfEntries: s.perfEntries,
        meals: s.meals,
        mealFoods: s.mealFoods,
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
