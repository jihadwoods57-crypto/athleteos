// AthleteOS — core domain types (pure TS, no React/RN imports).
// Ported faithfully from the design prototype's state model.
import type { Units } from './units';
import type { MealResult } from './content';
import type { EditableFood } from './mealEdit';
import type { GuardianStatus } from './guardianConsent';
import type { NudgeRecord } from './nudge';
import type { PerfEntry } from './performance';
import type { ReminderSettings } from './reminders';

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
/** Which platform-owned scoring formula measures an account's execution. The coach picks the
 *  profile + sets the targets; the platform owns the weights (Constitution Rule #13). */
export type ScoringProfile = 'athlete' | 'general';
export type MealKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type MealLabel = 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';

/** The minimal slice of a stored `meals` row the history view model reads. A
 *  MealRow (lib/supabase/database.types) satisfies it structurally, so core never
 *  imports the lib type and stays pure. Defined here (not in mealHistory) so
 *  AppState can hold StoredMeal[] without an import cycle. */
export interface StoredMeal {
  type: string | null;
  name: string | null;
  protein: number | null;
  kcal: number | null;
  quality: number | null;
  photo_path: string | null;
  day_date: string;
  logged_at: string;
}
export type Tab = 'home' | 'tasks' | 'squad' | 'checkin' | 'profile' | 'nutrition' | 'performance' | 'reminders';
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
  /** Overseer-editable org/team/practice name (OverseerProfile). When set it wins
   *  over the onboarding school/sport in the dashboard title + Account role line.
   *  Empty by default, so demo + un-edited accounts read exactly as before. */
  orgName: string;
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
  /** Optional invite/join code entered during onboarding (athlete joining a team). */
  inviteCode: string;
  /** The real, server-generated team code an overseer shares to recruit (set by
   *  createTeamLive when the backend is live; '' in demo/flag-off, where the UI
   *  falls back to the EAGLES24 showcase code). */
  teamCode: string;
  /** Verifiable parental consent (VPC): the guardian's email and approval status. A
   *  minor's real data stays on-device until guardianStatus is 'verified'. */
  guardianEmail: string;
  guardianStatus: GuardianStatus;
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

  // ---- backend session (Phase 1 go-live, gated behind isBackendLive) ----
  /** The authenticated Supabase user id, or null in the offline/mock build. Set
   *  only by the live auth seam when EXPO_PUBLIC_BACKEND_LIVE is on; null keeps the
   *  whole sync path inert, so flag-OFF behaviour is identical to today. */
  userId: string | null;
  /** Whether the athlete (or a guardian, for a minor) granted real-data sharing
   *  consent. The hard gate the live data path checks before any real pushDay
   *  (see core/consent.ts realDataConsent). Defaults false: fail-closed. */
  realDataConsent: boolean;
  /** Last live-auth error message for the sign-in / sign-up screen to surface, or
   *  null. Ephemeral (not persisted); only ever set when isBackendLive. */
  authError: string | null;
  /** True once a password-reset email has been requested, so the reset screen shows
   *  its neutral confirmation. Ephemeral (not persisted). */
  passwordResetSent: boolean;
  /** Athlete pressed "Pause all sharing" (Profile data-sharing controls). While true
   *  the push gate fails closed — nothing leaves the device. Persisted. */
  sharingPaused: boolean;

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
  /** The athlete's logged performance results (PRs) — lifts, sprints, jumps,
   *  body weight, custom metrics. Cross-day, persisted, capped to PERF_ENTRY_CAP.
   *  A SEPARATE development track from the daily Accountability Score (see
   *  core/performance.ts); never folded into the day score. */
  perfEntries: PerfEntry[];
  meals: Meals;
  /** Saved, edited per-meal plates (real per-food macros). A slot is present here
   *  once the athlete edits + saves its Meal Detail; the daily score then reads
   *  these real macros for that slot instead of the MEAL_MACROS constant. Day-scoped
   *  (resets on rollover). Absent slots fall back to the constant, so the seeded
   *  demo — which has none — is unchanged. */
  mealFoods: Partial<Record<MealKey, EditableFood[]>>;
  /** Local minutes-from-midnight when each slot was logged, for on-time accountability.
   *  Day-scoped. Absent = treated as on-time, so the seeded demo + legacy days are
   *  unchanged; only a meal logged AFTER its window deadline is scored as late. */
  mealLoggedAt: Partial<Record<MealKey, number>>;
  hydrationL: number;
  tasks: Task[];
  quickAdded: boolean[];
  /** Names of at-risk athletes the overseer has nudged today. Day-scoped (clears
   *  on rollover) so a coach/trainer can act again tomorrow. Backs the dashboard
   *  "Nudged" confirmation state on the Needs-Attention / follow-up rows. */
  nudged: string[];
  /** Structured record of each nudge sent today, capturing the athlete's
   *  compliance/score at send-time so the dashboard can read whether anything
   *  has moved since (see core/nudge.ts). Day-scoped alongside `nudged`. */
  nudgeLog: NudgeRecord[];

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
  /** Real AI analysis of the captured meal (Claude vision), or null to use the
   *  deterministic prototype result. Ephemeral; never persisted. */
  mealAnalysis: MealResult | null;
  /** The last captured meal photo (base64 JPEG, no data: prefix), held only long
   *  enough to upload it to the meal-photos bucket on log. Ephemeral; never
   *  persisted (kept out of partialize so a multi-MB blob never hits AsyncStorage). */
  mealPhoto: string | null;
  mealDetailOpen: boolean;
  /** Overseer (coach/trainer/parent) self-profile overlay. */
  overseerProfileOpen: boolean;
  /** Client meal-history overlay (past uploads). */
  mealHistoryOpen: boolean;
  /** Meals fetched from the backend for the history overlay (null = not fetched /
   *  backend off, so the overlay falls back to today's locally-logged meals).
   *  Ephemeral; never persisted. */
  mealHistory: StoredMeal[] | null;
  /** Restaurant Coach overlay ("what should I eat?"). */
  foodCoachOpen: boolean;
  /** Coach Plan editor overlay. */
  planEditorOpen: boolean;
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
  /** Which scoring profile measures this account's execution (the coach/trainer sets it;
   *  AI recommends it). Absent = 'athlete', so every existing user/test is unchanged.
   *  The platform owns these formulas (Constitution Rule #13); the coach owns the targets. */
  scoringProfile?: ScoringProfile;
  /** Coach/overseer standing instructions for the plan ("Pre-bed protein shake",
   *  "No sugary drinks"). Read by activePlan() so both engines reflect them. */
  planInstructions: string[];
  /** Athlete-editable season weight goal (lb). Single source of truth for the
   *  Home season-goal card, Check-In + Parent weight trends, and Profile.
   *  Defaults to the WEIGHT_TARGET constant. */
  weightTarget: number;
  visibility: string;
  notif: boolean;
  /** Per-reminder settings (enabled + local hour) for the P3 reminder schedule.
   *  Persisted; defaults from defaultReminderSettings(). The master `notif` flag
   *  still gates whether any reminder is scheduled at all. */
  reminderSettings: ReminderSettings;
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
  /** The linked athlete's backend id, when the roster came from real `days` rows.
   *  Drives the coach/trainer "Recent Meals" history read (RLS-scoped). Absent on
   *  the seeded demo roster, so that surface shows its honest not-connected state. */
  athleteId?: string;
  /** Real book/roster compliance % for this person, when the caller has it. */
  comp?: number;
  /** Human "last logged" label (trainer book recency, e.g. "5 days ago"), when
   *  the caller has it. Drives the honest "Last active" chip in the overlay. */
  last?: string;
  /** A compact performance/PR summary line (see core/performance.ts
   *  topPerformanceLine), e.g. "Bench Press · 225 lb PR (+15 lb)". Present only
   *  when the caller has real PR data for this person — the coach roster will
   *  carry it once per-athlete performance syncs through the backend (P0). Absent
   *  on the demo roster rather than fabricated. */
  perf?: string;
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
