// OnStandard — core domain types (pure TS, no React/RN imports).
// Ported faithfully from the design prototype's state model.
import type { Units } from './units';

/** App appearance preference: an explicit light/dark, or 'auto' to follow the OS. */
export type ThemeMode = 'light' | 'dark' | 'auto';
import type { MealResult } from './content';
import type { EditableFood } from './mealEdit';
import type { LabelFacts } from './nutritionLabel';
import type { RosterRow } from './constants';
import type { GuardianStatus } from './guardianConsent';
import type { NudgeRecord } from './nudge';
import type { CommitmentAnswer } from './commitment';
import type { TrustPass } from './trustPass';
import type { PerfEntry } from './performance';
import type { ReminderSettings } from './reminders';
import type { OverseerAlerts } from './overseerAlerts';
import type { Entitlement } from './subscription';
import type { PlanSlot } from './coachPlan';

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
 *  profile + sets the targets; the platform owns the weights (Constitution Rule #13).
 *  Auto-assigned from the user's GOAL at signup (profileForGoal): performance -> athlete,
 *  lose/maintain -> general (calorie-target led), gain -> gain (surplus + protein led). */
export type ScoringProfile = 'athlete' | 'general' | 'gain';
export type MealKey = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type MealLabel = 'Breakfast' | 'Lunch' | 'Snack' | 'Dinner';

/** The minimal slice of a stored `meals` row the history view model reads. A
 *  MealRow (lib/supabase/database.types) satisfies it structurally, so core never
 *  imports the lib type and stays pure. Defined here (not in mealHistory) so
 *  AppState can hold StoredMeal[] without an import cycle. */
export interface StoredMeal {
  /** Server row uuid (backend rows via select *). The key the per-meal comment thread
   *  (0046) hangs on; optional so local/test constructors can omit it. */
  id?: string;
  type: string | null;
  name: string | null;
  protein: number | null;
  kcal: number | null;
  /** The AI's coach-voiced read for this meal (backend rows only) — shown in the review. */
  note?: string | null;
  /** Present on backend rows (select *); optional so local/test constructors can omit them.
   *  Used by the "usuals" matcher to reuse a repeat meal's confirmed macros. */
  carbs?: number | null;
  fat?: number | null;
  /** How the athlete's note related to the photo ('match'|'photo_heavier'|'photo_lighter'|'no_photo').
   *  Backend rows only (select *); feeds the coach's description-bias pattern signal. */
  description_signal?: string | null;
  quality: number | null;
  photo_path: string | null;
  day_date: string;
  logged_at: string;
}
/** One in-app notification (core-level shape; the store maps a backend NotificationRow to
 *  this so core stays free of lib/supabase types). */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

export type Tab =
  | 'home'
  | 'tasks'
  | 'squad'
  | 'checkin'
  | 'profile'
  | 'nutrition'
  | 'performance'
  | 'progress'
  | 'reminders'
  // Redesign routes (proto breakdown.js / weight.js / recovery.js) — reached from Home,
  // not the tab bar, so the bar simply shows no active tab while one is open.
  | 'breakdown'
  | 'weight'
  | 'recovery';
/** Coach dashboard destinations (the 5-tab bar): one Home, one Work area, one Action,
 *  one Insights, one Admin. Mirrors the athlete tab model. */
export type CoachTab = 'dashboard' | 'roster' | 'attention' | 'reports' | 'profile';
/** Trainer / Parent bottom-tab destinations (so every role has a tab bar + Profile). */
export type TrainerTab = 'dashboard' | 'profile';
export type ParentTab = 'overview' | 'profile';
export type MealStage = 'capture' | 'analyzing' | 'questions' | 'result' | 'unavailable';
/** Live day-sync status to the server. 'error' means the last push failed, so the athlete's logged
 *  day may not have reached their coach — surfaced honestly instead of failing silently. */
export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';
/** Why a photo analysis couldn't run. 'rate_limited' = the athlete hit the daily cap (429);
 *  'error' = any other failure (network, timeout, 5xx); 'consent' = the fail-closed egress
 *  gate blocked the photo (unverified minor / no consent / sharing paused); 'not_configured'
 *  = this build has no AI endpoint. Drives the honest 'unavailable' stage — we never
 *  fabricate a plate/label for a real user, whatever the reason the model couldn't answer. */
export type MealErrorReason = 'rate_limited' | 'error' | 'consent' | 'not_configured';
/** Which flow the meal overlay is in: estimate a plate (photo), transcribe a label, or search a
 *  food by name (USDA) and pick exact macros from the ranked results. */
export type MealCaptureMode = 'meal' | 'label' | 'search';
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
  /** Landing gate: the branded Welcome/landing screen shows until the user taps
   *  "Get Started" (sets this true), which reveals the existing onboarding steps.
   *  Cross-day / persisted, so a returning mid-onboarding user isn't sent back to it. */
  welcomeDone: boolean;
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
  /** Selected support roles (coach/trainer/nutritionist/parent) building the network. */
  supportTeam: string[];
  /** Optional invite/join code entered during onboarding (athlete joining a team). */
  inviteCode: string;
  /** The real, server-generated team code an overseer shares to recruit (set by
   *  createTeamLive when the backend is live; '' in demo/flag-off, where the UI
   *  falls back to the EAGLES24 showcase code). */
  teamCode: string;
  /** Coach's opt-in: whether the team they create is discoverable by athletes at their
   *  school (drives `teams.discoverable`). The selected school's id + name ride in
   *  `obMeta.orgId` / `obMeta.school`. Default false (privacy-safe, code-only). */
  teamDiscoverable: boolean;
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
  /** ISO timestamp of when the user accepted the Terms of Service + Privacy Policy at
   *  account creation, or null if not yet accepted. A required, explicit affirmative
   *  agreement (App Store 5.1.1 + legal cover for health data from minors). Persisted,
   *  so the record survives across sessions. */
  termsAcceptedAt: string | null;
  /** Last live-auth error message for the sign-in / sign-up screen to surface, or
   *  null. Ephemeral (not persisted); only ever set when isBackendLive. */
  authError: string | null;
  /** Subscription entitlement (coach/org pays per athlete). Defaults to free
   *  preview; a Stripe webhook flips the backend row, refreshEntitlement reads it.
   *  Persisted so the plan shows offline. INERT until monetization is wired. */
  entitlement: Entitlement;
  /** An active earned Trust Pass (coach-granted camera-free reward), or null. Cross-day: a
   *  multi-day grant survives calendar rollover. Client state for the pilot; server-authoritative
   *  at go-live. See docs/council/2026-07-02-trust-pass.md. */
  trustPass: TrustPass | null;
  /** True once a password-reset email has been requested, so the reset screen shows
   *  its neutral confirmation. Ephemeral (not persisted). */
  passwordResetSent: boolean;
  /** True when a just-created account actually needs email confirmation (the live project has
   *  confirm-ON and Supabase returned no session yet). Drives the honest "check your email" copy:
   *  with confirm-OFF this stays false and the panel doesn't claim a link was sent. Ephemeral. */
  emailConfirmPending: boolean;
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
  /** The REAL AI coach note from each slot's analysis, kept so MealDetail can show the
   *  model's actual coaching instead of a canned showcase note. Day-scoped (resets on
   *  rollover). Absent for slots logged without an AI result — surfaces render nothing
   *  rather than fabricate. */
  mealNotes: Partial<Record<MealKey, string>>;
  hydrationL: number;
  tasks: Task[];
  /** The daily plan-commitment one-tap ("did you hit your plan today?"). Day-scoped
   *  (resets on rollover); null = not answered yet. Carries the 0.15 behavioral score slot. */
  dailyCommitment: CommitmentAnswer | null;
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
  /** ISO date (YYYY-MM-DD) the athlete last logged a weight, or null. Drives the weigh-in nudge. */
  weighInStamp: string | null;
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
  /** The latest REAL check-in submission (its date + earned recovery sub-score).
   *  Cross-day (survives rollover, persisted): the ritual is branded WEEKLY, so
   *  scoring credits this snapshot for 7 days — before it existed the credit
   *  vanished at midnight and an honest perfect day capped at 65. Null until the
   *  first real submission; never written by an unsubmitted day. */
  ciLast: { date: string; recovery: number } | null;

  // ---- nav / overlays ----
  tab: Tab;
  coachTab: CoachTab;
  trainerTab: TrainerTab;
  parentTab: ParentTab;
  squadMode: SquadMode;
  // ---- day-sync status (audit item 12: a failed push must not be silent) ----
  /** Status of the debounced day push to the server. 'error' surfaces an honest "not synced" pill
   *  so an athlete logging on a dead connection isn't invisibly out of sync with their coach.
   *  Ephemeral; never persisted (recomputed on the next push). */
  syncState: SyncState;
  /** ISO timestamp of the last SUCCESSFUL day push, or null. Ephemeral; never persisted. */
  lastSyncedAt: string | null;
  // ---- overseer read-cache (snappy paint, revalidated on mount) ----
  /** Last real roster fetched for the signed-in overseer, so their dashboard paints instantly
   *  instead of flashing the seeded sample. Namespaced by cachedRosterUserId; purged on sign-out. */
  cachedRoster: RosterRow[] | null;
  cachedRosterUserId: string | null;
  // ---- Assistant Nutritionist (2026-07-04) ----
  /** The AI-narrated daily brief, cached ONCE PER DAY (the cost model): { date, text } or null.
   *  The deterministic brief always renders regardless; this only swaps the phrasing. Persisted
   *  so reopening the app does not re-spend a narration. */
  briefNarration: { date: string; text: string } | null;
  /** ISO timestamp of the previous dashboard open, driving the "since you last looked" delta.
   *  Two-slot dance: on open, prevDashboardOpenedAt <- lastDashboardOpenedAt <- now. */
  lastDashboardOpenedAt: string | null;
  prevDashboardOpenedAt: string | null;
  // ---- meal review (a stored meal opened from PersonDetail or MealHistory) ----
  /** The stored meal (server uuid) under review, plus the display card captured at
   *  open (photo path, macros, the AI read). Null when closed. Ephemeral. */
  mealReview: {
    mealId: string;
    athleteId: string;
    athleteName: string;
    card: { label: string; name: string; protein: number; kcal: number; quality: number; thumb: string; photoPath: string | null; note: string | null };
    /** Demo/sample review (seeded roster, no real backend meal): the plate + AI read show
     *  so the flow is visible, but the conversation reads an honest sample state instead of
     *  querying/posting to a meal that does not exist. */
    demo: boolean;
  } | null;
  mealOpen: boolean;
  mealStage: MealStage;
  /** 'meal' = photograph a plate (estimated); 'label' = scan a Nutrition Facts panel (exact). */
  mealCaptureMode: MealCaptureMode;
  mealType: MealLabel;
  /** The transcribed Nutrition Facts from the last label scan, or null. Ephemeral; never
   *  persisted (it's re-scanned each time, and carries no value across sessions). */
  labelFacts: LabelFacts | null;
  /** How many servings of the scanned label the athlete ate (¼-step, default 1). */
  labelServings: number;
  /** Real AI analysis of the captured meal (Claude vision), or null to use the
   *  deterministic prototype result. Ephemeral; never persisted. */
  mealAnalysis: MealResult | null;
  /** Clarifying questions the AI asked about the current meal (1-3), or empty. Non-empty means
   *  the capture flow is on the 'questions' stage awaiting answers. Ephemeral; never persisted. */
  mealQuestions: string[];
  /** Why the last CONFIGURED analysis failed, when mealStage is 'unavailable'. Drives the honest
   *  "couldn't analyze" panel (retry / enter manually); null otherwise. Ephemeral; never persisted. */
  mealError: MealErrorReason | null;
  /** The last captured meal photo (base64 JPEG, no data: prefix), held only long
   *  enough to upload it to the meal-photos bucket on log. Ephemeral; never
   *  persisted (kept out of partialize so a multi-MB blob never hits AsyncStorage). */
  mealPhoto: string | null;
  mealDetailOpen: boolean;
  /** Overseer (coach/trainer/parent) self-profile overlay. */
  overseerProfileOpen: boolean;
  /** Plans / checkout overlay (pricing + compliant terms). */
  plansOpen: boolean;
  /** Coach per-athlete targets + scoring editor overlay (from PersonDetail). */
  coachGoalsOpen: boolean;
  /** Client meal-history overlay (past uploads). */
  mealHistoryOpen: boolean;
  /** Nutrition Memory overlay (longitudinal "what the OnStandard remembers" insights). */
  nutritionMemoryOpen: boolean;
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
  /** The athlete's "Connect your coach" overlay (two doors: code / find-my-coach). */
  connectOpen: boolean;
  /** A join code carried in from an invite deep link, prefilled into the Connect
   *  overlay's code door. Null when opened normally. */
  connectPrefillCode: string | null;
  /** Athlete dismissed the first-run "Connect your coach" Home card ("not now"). The
   *  card also hides automatically once they're linked (supportTeam includes 'coach'). */
  connectCardDismissed: boolean;
  /** The user's in-app notification feed (fetched from the backend; empty offline). */
  notifications: AppNotification[];

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
  /** Structured prescribed-meal slots for the Meal Plans feature (gated by
   *  isMealPlansEnabled). Empty until generated/set; persisted so an in-progress
   *  plan survives an app restart. */
  planSlots: PlanSlot[];
  /** Athlete-editable season weight goal (lb). Single source of truth for the
   *  Home season-goal card, Check-In + Parent weight trends, and Profile.
   *  Defaults to the WEIGHT_TARGET constant. */
  weightTarget: number;
  /** True once the athlete has adjusted the target weight themselves. While false, the
   *  About You step displays and seeds from the goal-derived default (so a Lose Fat athlete
   *  never sees a target above their weight), and activation applies the derived value. */
  weightTargetTouched: boolean;
  visibility: string;
  notif: boolean;
  /** Per-reminder settings (enabled + local hour) for the P3 reminder schedule.
   *  Persisted; defaults from defaultReminderSettings(). The master `notif` flag
   *  still gates whether any reminder is scheduled at all. */
  reminderSettings: ReminderSettings;
  /** Per-event notification preferences for an overseer (coach/trainer/parent). The
   *  master `notif` flag still gates whether any fire. Persisted; defaults from
   *  defaultOverseerAlerts(). Delivery rides the backend alert pipeline at go-live. */
  overseerAlerts: OverseerAlerts;
  /** Athlete-chosen display unit system. Body weights are stored in lb and
   *  converted at the edge; defaults to imperial. */
  units: Units;
  /** Appearance: light, dark, or follow the OS. Defaults to 'auto'. */
  themeMode: ThemeMode;
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

export type TierKey = 'off' | 'building' | 'lockedin' | 'onstandard';

/** The redesign's status band over the same 0–100 score (see core/tiers.ts). */
export interface Tier {
  key: TierKey;
  /** "Off Standard" | "Building" | "Locked In" | "OnStandard" */
  name: string;
  /** Status color class: 'r' | 'a' | 'b' | 'g' (see ui/tokens tierChip). */
  short: 'r' | 'a' | 'b' | 'g';
}

/** Everything derived from state for rendering — the single selector output. */
export interface Derived {
  // scoring
  athleteScore: number;
  grade: Grade;
  /** Redesign status tier (Off Standard / Building / Locked In / OnStandard) over the same score. */
  tier: Tier;
  ringOffset: number;
  scoreDelta: number;
  deltaStr: string;
  deltaColor: string;
  /** True on day 0 (no real prior day yet) — the UI says "starting today" instead of a fake trend. */
  isDay0: boolean;
  nutritionScore: number;
  /** The photo-EARNED nutrition sub-score before any trust-pass credit floors it.
   *  This — never the credited value — is what nutritionHistory archives, so the
   *  trailing median can only ever be built from real camera evidence. */
  earnedNutritionScore: number;
  recoveryScore: number;
  /** True only once a real check-in backs the recovery number (else it's the 86 fallback). */
  recoveryScoreIsReal: boolean;
  /** True when today's nutrition was credited from an active Trust Pass (camera-free) rather
   *  than a logged photo — drives the honest "Trust Pass" vs "photo verified" render. */
  nutritionIsTrustCredited: boolean;
  weightScore: number;
  tasksScore: number;
  /** 0..100 daily plan-commitment sub-score (yes=100/partial=60/no=0/unanswered=0). */
  commitmentScore: number;
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
