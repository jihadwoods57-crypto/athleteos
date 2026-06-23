// AthleteOS — core domain types (pure TS, no React/RN imports).
// Ported faithfully from the design prototype's state model.
import type { Units } from './units';

export type Role = 'athlete' | 'parent' | 'coach' | 'trainer';
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

  // ---- check-in ----
  ciStage: CiStage;
  ciWeight: number;
  currentWeight: number;
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
