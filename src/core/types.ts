// AthleteOS — core domain types (pure TS, no React/RN imports).
// Ported faithfully from the design prototype's state model.
import type { Units } from './units';

/** The 7 onboarding identities. Each maps onto one of the 4 dashboard flows
 *  (see ROLE_DEFS in constants) and personalizes copy/labels/goals. */
export type Role =
  | 'athlete'
  | 'parent'
  | 'personal_trainer'
  | 'sports_perf_coach'
  | 'nutritionist'
  | 'hs_coach'
  | 'college_coach';
export type Flow = 'onboarding' | 'app' | 'coach' | 'parent' | 'trainer';
export type BaseGoal = 'gain' | 'lose' | 'maintain' | 'performance';
export type MealKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type MealLabel = 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';
export type Tab = 'home' | 'tasks' | 'squad' | 'checkin' | 'profile' | 'nutrition';
export type MealStage = 'capture' | 'analyzing' | 'result';
export type CiStage = 'open' | 'done';
export type SquadMode = 'team' | 'position';
export type CompMode = 'position' | 'team' | 'off';
export type TrendDir = 'up' | 'down' | 'flat';

export interface Task {
  id: number;
  group: string | null;
  title: string;
  meta: string;
  done: boolean;
}

export type ChatWho = 'ai' | 'coach' | 'athlete' | 'me' | 'them';
export interface ChatMsg {
  who: ChatWho;
  text: string;
}

export interface CiConfig {
  energy: boolean;
  recovery: boolean;
  sleep: boolean;
  confidence: boolean;
  soreness: boolean;
  motivation: boolean;
}

export type CoachTrackKey = 'nutrition' | 'recovery' | 'hydration' | 'weight' | 'tasks';
export type CoachTrack = Record<CoachTrackKey, boolean>;

export interface Meals {
  breakfast: boolean;
  lunch: boolean;
  snack: boolean;
  dinner: boolean;
}

/** The single session state — mirrors the prototype's component state. */
export interface AppState {
  // ---- onboarding ----
  flow: Flow;
  obStep: number;
  role: Role | null;
  signinMode: boolean;
  athleteName: string;
  athleteEmail: string;
  level: string | null;
  sport: string | null;
  position: string | null;
  goals: string[];
  baseHeight: number;
  baseWeight: number;
  baseAge: number;
  baseGoal: BaseGoal;
  inviteWho: string[];
  parentFocus: string[];
  compMode: CompMode;
  coachTrack: CoachTrack;

  // ---- onboarding (redesign) ----
  /** Athlete primary goal key (e.g. 'get_faster'); drives AI coaching copy. */
  primaryGoal: string | null;
  /** Training frequency key: 'once' | 'twice' | 'three_plus'. */
  trainingFreq: string | null;
  /** Selected support roles (coach/trainer/nutritionist/parent) building the network. */
  supportTeam: string[];
  /** Optional invite/join code entered during onboarding. */
  inviteCode: string;
  // Baseline assessment answers — feed startingScore() AND seed engine state.
  baseNutritionConfidence: number; // 1-10
  baseMealsPerDay: number; // count (e.g. 2-6)
  baseWaterL: number; // liters/day
  baseSleepH: number; // hours/night
  baseProteinFreq: number; // 0=never 1=sometimes 2=often 3=always
  baseConsistency: number; // 1-10 week-to-week consistency
  /** The Starting Point Score (day-0), or null until the baseline is computed. */
  startScore: number | null;
  /** Role-specific onboarding answers (coach/trainer/nutritionist/parent) for
   *  personalization. Free-form bag so the 7 flows share one renderer. */
  obMeta: Record<string, string | string[] | number>;

  // ---- day ----
  dateStamp: string;
  /** Rolling log of prior days' final scores (oldest -> newest), capped to the
   *  last HISTORY_CAP days. Fed to the Home/role trend charts as real geometry. */
  scoreHistory: DayScore[];
  /** Rolling log of prior days' recorded body weight (oldest -> newest), capped
   *  to the last HISTORY_CAP days. Feeds the Parent weight-trend chart. */
  weightHistory: WeightPoint[];
  /** Rolling log of prior days' nutrition sub-score (oldest -> newest), capped
   *  to the last HISTORY_CAP days. Feeds the Parent nutrition-trend bars. */
  nutritionHistory: DayScore[];
  meals: Meals;
  hydrationL: number;
  tasks: Task[];
  quickAdded: boolean[];
  /** Names of at-risk athletes the overseer has nudged today. Day-scoped (clears
   *  on rollover) so a coach/trainer can act again tomorrow. Backs the dashboard
   *  "Nudged" confirmation state on the Needs-Attention / follow-up rows. */
  nudged: string[];

  // ---- check-in ----
  ciStage: CiStage;
  ciWeight: number;
  currentWeight: number;
  /** The athlete's starting weight, the anchor the season-goal progress measures
   *  from. Defaults to WEIGHT_START for the seeded demo; a real athlete's is seeded
   *  from their onboarding baseWeight at activation so "gained since start" is honest. */
  startWeight: number;
  ciEnergy: number;
  ciRecovery: number;
  ciSleep: number;
  ciConfidence: number;
  ciSoreness: number;
  ciMotivation: number;
  ciSubmitted: boolean;
  ciConfig: CiConfig;

  // ---- nav / overlays ----
  tab: Tab;
  squadMode: SquadMode;
  mealOpen: boolean;
  mealStage: MealStage;
  mealType: MealLabel;
  mealDetailOpen: boolean;
  selectedMeal: string | null;
  notifOpen: boolean;
  personDetail: PersonDetail | null;
  accountOpen: boolean;
  msgOpen: boolean;

  // ---- misc ----
  weeklyGoalLb: number;
  /** Athlete-editable daily nutrition targets. Feed scoring (protein) + the
   *  Nutrition/Profile screens; default to the PROTEIN_TARGET/CAL_TARGET constants. */
  proteinTarget: number;
  calTarget: number;
  /** Athlete-editable season weight goal (lb). Single source of truth for the
   *  Home season-goal card, Check-In + Parent weight trends, and Profile.
   *  Defaults to the WEIGHT_TARGET constant. */
  weightTarget: number;
  visibility: string;
  notif: boolean;
  /** Athlete-chosen display unit system. Body weights are stored in lb and
   *  converted at the edge; defaults to imperial. */
  units: Units;
  mealDesc: string;
  chatDraft: string;
  msgDraft: string;

  // ---- chat / memory ----
  coachNote: string;
  mealChat: ChatMsg[];
  msgThread: ChatMsg[];
}

/** A single day's final accountability score, stamped with its local ISO date. */
export interface DayScore {
  /** ISO date (YYYY-MM-DD) the score is for. */
  date: string;
  score: number;
}

/** A single day's recorded body weight (lb), stamped with its local ISO date.
 *  Feeds the Parent weight-trend chart from real data instead of a static path. */
export interface WeightPoint {
  /** ISO date (YYYY-MM-DD) the weight is for. */
  date: string;
  weight: number;
}

export interface PersonDetail {
  name: string;
  initials: string;
  pos?: string;
  score: number;
  org?: string;
  /** Real book/roster compliance % for this person, when the caller has it. */
  comp?: number;
}

export interface Grade {
  g: string;
  bg: string;
  c: string;
}

/** Everything derived from state for rendering — the single selector output. */
export interface Derived {
  // scoring
  athleteScore: number;
  grade: Grade;
  ringOffset: number;
  scoreDelta: number;
  deltaStr: string;
  deltaColor: string;
  nutritionScore: number;
  recoveryScore: number;
  weightScore: number;
  tasksScore: number;
  checkinScore: number;
  // nutrition
  proteinToday: number;
  proteinTarget: number;
  proteinGap: number;
  proteinPct: number;
  proteinRingOffset: number;
  kcalToday: number;
  calTarget: number;
  carbsToday: number;
  carbTarget: number;
  carbPct: number;
  fatToday: number;
  fatTarget: number;
  fatPct: number;
  mealsLoggedCount: number;
  // hydration / tasks
  hydrationPct: number;
  tasksDone: number;
  tasksTotal: number;
}

export interface LeaderRow {
  rank: number;
  name: string;
  initials: string;
  pos: string;
  score: number;
  you: boolean;
  dir: TrendDir;
}
