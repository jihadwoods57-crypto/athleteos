// AthleteOS — single session store (Zustand) + AsyncStorage persistence.
// Mirrors the prototype's component state + methods; the day slice persists
// under key `aos_day`, exactly like the prototype's localStorage usage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createInitialState,
  HYDRATION_TARGET,
  MEAL_MACROS,
  PROTEIN_TARGET,
  QUICK_FOODS,
  recordDayScore,
  rollDayIfStale,
  todayStamp,
} from '@/core';
import type {
  AppState,
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

  // nav
  setTab: (t: Tab) => void;
  goHome: () => void;
  goTasks: () => void;
  goSquad: () => void;
  goCheckin: () => void;
  goProfile: () => void;
  goNutrition: () => void;
  setSquadMode: (m: SquadMode) => void;
  toggleNotif: () => void;
  goalStep: (d: number) => void;
  adjustProteinTarget: (d: number) => void;
  adjustCalTarget: (d: number) => void;
  signOut: () => void;

  // overlays
  openMeal: () => void;
  closeMeal: () => void;
  setMealType: (m: MealLabel) => void;
  capture: () => void;
  addMeal: () => void;
  addWater: () => void;
  openMealDetail: (meal: string) => void;
  closeMealDetail: () => void;
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

  // tasks
  toggleTask: (id: number) => void;

  // check-in
  wStep: (d: number) => void;
  setCi: (key: CiSliderKey, value: number) => void;
  toggleCiQ: (k: keyof CiConfig) => void;
  submitCi: () => void;

  // dev
  resetDemo: () => void;
}

export type Store = AppState & Actions;

let mealTimer: ReturnType<typeof setTimeout> | undefined;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Mirror of core computeDerived's proteinToday formula (meal macros + quick-add
// grams). Used only to flip the visible "Hit 180g protein" task row (id 2) in
// store actions for immediate UI feedback — core scoring remains the authority.
const computeProteinToday = (meals: AppState['meals'], quickAdded: AppState['quickAdded']): number => {
  let proteinBase = 0;
  (Object.keys(meals) as (keyof AppState['meals'])[]).forEach((k) => {
    if (meals[k]) proteinBase += MEAL_MACROS[k].p;
  });
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
        const r = get().role ?? 'athlete';
        if (r === 'parent') set({ flow: 'parent' });
        else if (r === 'coach') set({ flow: 'coach' });
        else if (r === 'trainer') set({ flow: 'trainer' });
        else set({ flow: 'app', tab: 'home' });
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

      // ---- nav ----
      setTab: (t) => set({ tab: t }),
      goHome: () => set({ flow: 'app', tab: 'home' }),
      goTasks: () => set({ tab: 'tasks' }),
      goSquad: () => set({ tab: 'squad' }),
      goCheckin: () => set({ flow: 'app', tab: 'checkin', ciStage: 'open' }),
      goProfile: () => set({ flow: 'app', tab: 'profile' }),
      goNutrition: () => set({ flow: 'app', tab: 'nutrition' }),
      setSquadMode: (m) => set({ squadMode: m }),
      toggleNotif: () => set((s) => ({ notif: !s.notif })),
      goalStep: (d) => set((s) => ({ weeklyGoalLb: +clamp(s.weeklyGoalLb + d, 0.5, 2).toFixed(1) })),
      // Editable daily nutrition targets. Protein feeds scoring + the id-2 task row,
      // so re-derive that visible flag here (mirrors addMeal/toggleQuick) to keep the
      // Plan row honest the instant the target moves. Calories feed the Nutrition/Profile
      // labels + bars. Clamped to sane ranges; stepped by the UI's ± controls.
      adjustProteinTarget: (d) =>
        set((s) => {
          const proteinTarget = clamp(s.proteinTarget + d, 80, 320);
          const protein = computeProteinToday(s.meals, s.quickAdded);
          const tasks = s.tasks.map((x) => (x.id === 2 ? { ...x, done: protein >= proteinTarget } : x));
          return { proteinTarget, tasks };
        }),
      adjustCalTarget: (d) => set((s) => ({ calTarget: clamp(s.calTarget + d, 1200, 6000) })),
      signOut: () => set({ flow: 'onboarding', obStep: 0, role: null, accountOpen: false }),

      // ---- overlays ----
      openMeal: () => set({ mealOpen: true, mealStage: 'capture' }),
      closeMeal: () => set({ mealOpen: false }),
      setMealType: (m) => set({ mealType: m }),
      capture: () => {
        set({ mealStage: 'analyzing' });
        if (mealTimer) clearTimeout(mealTimer);
        mealTimer = setTimeout(() => set({ mealStage: 'result' }), 2300);
      },
      addMeal: () =>
        set((s) => {
          const key = (s.mealType || 'Dinner').toLowerCase() as keyof typeof s.meals;
          const meals = { ...s.meals, [key]: true };
          const protein = computeProteinToday(meals, s.quickAdded);
          const tasks = s.tasks.map((x) => {
            if (x.id === 2) return { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) };
            if (x.id === 3 && key === 'dinner') return { ...x, done: true };
            return x;
          });
          return { mealOpen: false, mealStage: 'capture', meals, tasks };
        }),
      addWater: () =>
        set((s) => {
          const h = Math.min(HYDRATION_TARGET, +(s.hydrationL + 0.3).toFixed(1));
          const tasks = s.tasks.map((x) => (x.id === 4 ? { ...x, done: h >= HYDRATION_TARGET } : x));
          return { hydrationL: h, tasks };
        }),
      openMealDetail: (meal) => set({ mealDetailOpen: true, selectedMeal: meal }),
      closeMealDetail: () => set({ mealDetailOpen: false }),
      toggleQuick: (i) =>
        set((s) => {
          const q = [...s.quickAdded];
          q[i] = !q[i];
          const protein = computeProteinToday(s.meals, q);
          const tasks = s.tasks.map((x) => (x.id === 2 ? { ...x, done: protein >= (s.proteinTarget ?? PROTEIN_TARGET) } : x));
          return { quickAdded: q, tasks };
        }),
      openPerson: (p) => set({ personDetail: p }),
      closePerson: () => set({ personDetail: null }),
      openAccount: () => set({ accountOpen: true }),
      closeAccount: () => set({ accountOpen: false }),
      openMsg: () => set({ msgOpen: true }),
      closeMsg: () => set({ msgOpen: false }),
      setMsgDraft: (v) => set({ msgDraft: v }),
      sendMsg: () =>
        set((s) => {
          const t = (s.msgDraft || '').trim();
          if (!t) return {};
          return { msgThread: [...s.msgThread, { who: 'me', text: t }], msgDraft: '' };
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

      // ---- tasks ----
      toggleTask: (id) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),

      // ---- check-in ----
      wStep: (d) => set((s) => ({ ciWeight: clamp(s.ciWeight + d, 70, 350) })),
      setCi: (key, value) => set({ [key]: value } as Partial<AppState>),
      toggleCiQ: (k) => set((s) => ({ ciConfig: { ...s.ciConfig, [k]: !s.ciConfig[k] } })),
      submitCi: () => set((s) => ({ ciStage: 'done', ciSubmitted: true, currentWeight: s.ciWeight })),

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
        compMode: s.compMode,
        goals: s.goals,
        inviteWho: s.inviteWho,
        parentFocus: s.parentFocus,
        coachTrack: s.coachTrack,
        // day / check-in slice
        dateStamp: s.dateStamp,
        scoreHistory: s.scoreHistory,
        meals: s.meals,
        hydrationL: s.hydrationL,
        tasks: s.tasks,
        quickAdded: s.quickAdded,
        ciStage: s.ciStage,
        ciSubmitted: s.ciSubmitted,
        ciWeight: s.ciWeight,
        currentWeight: s.currentWeight,
        ciEnergy: s.ciEnergy,
        ciRecovery: s.ciRecovery,
        ciSleep: s.ciSleep,
        ciConfidence: s.ciConfidence,
        ciSoreness: s.ciSoreness,
        ciMotivation: s.ciMotivation,
        ciConfig: s.ciConfig,
        visibility: s.visibility,
        notif: s.notif,
      }),
      // Roll the persisted day forward BEFORE the first UI/selector read: on a new
      // calendar day the stale day slice resets to fresh defaults; same-day restores
      // as-is. Cross-day fields (weight, prefs) survive. A brand-new install (no
      // persisted blob) is treated as stale and simply stamped with today.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const today = todayStamp();
        // Record the prior day's final score BEFORE the slice resets, using the
        // full pre-roll state (persisted day data over current defaults).
        const scoreHistory = recordDayScore({ ...current, ...p } as AppState, today);
        const rolled = rollDayIfStale(p, today);
        const merged = { ...current, ...rolled, scoreHistory } as Store;
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
