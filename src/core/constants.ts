// AthleteOS — domain constants, ported verbatim from the prototype.
import type { BaseGoal, Flow, LeaderRow, MealKey, Role } from './types';

/** App version string, surfaced in Account / Profile footers + Help row. */
export const APP_VERSION = 'v1.0';

export const PROTEIN_TARGET = 180;
export const CAL_TARGET = 3200;
/** Daily carb + fat targets (g) for the Nutrition macro rings. Not athlete-editable
 *  (protein + calories carry the scoring); shown so all three rings read live. */
export const CARB_TARGET = 300;
export const FAT_TARGET = 80;
export const HYDRATION_TARGET = 3.8; // liters (≈1 gallon)

/** Season weight goal anchors. WEIGHT_START is the (historical) starting weight
 *  the progress bar measures from; WEIGHT_TARGET is the athlete-editable goal. */
export const WEIGHT_START = 171;
export const WEIGHT_TARGET = 184;

/** Per-meal macro contributions (protein g / kcal / carbs g / fat g). The carb +
 *  fat grams are calorie-consistent with kcal (≈ 4·p + 4·c + 9·f) so the Macros
 *  rings tell the same story as the calorie bar. */
export const MEAL_MACROS: Record<MealKey, { p: number; k: number; c: number; f: number }> = {
  breakfast: { p: 42, k: 520, c: 48, f: 16 },
  lunch: { p: 51, k: 680, c: 62, f: 24 },
  snack: { p: 49, k: 300, c: 12, f: 6 },
  dinner: { p: 52, k: 680, c: 60, f: 25 },
};

/** AI quick-add foods on the Nutrition screen (index-aligned with quickAdded[]).
 *  g = protein grams; c/f = carb/fat grams (calorie-consistent with k). */
export const QUICK_FOODS = [
  { n: 'Greek yogurt cup', g: 18, k: 150, c: 12, f: 4 },
  { n: 'Protein shake', g: 30, k: 160, c: 6, f: 2 },
  { n: 'Turkey roll-ups', g: 22, k: 120, c: 4, f: 2 },
];

export const SPORTS = [
  'Football', 'Basketball', 'Baseball', 'Soccer',
  'Wrestling', 'Track & Field', 'Volleyball', 'Hockey',
];

export const POSITION_MAP: Record<string, string[]> = {
  Football: ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'],
  Basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
  Baseball: ['P', 'C', 'IF', 'OF'],
  Soccer: ['GK', 'DEF', 'MID', 'FWD'],
  'Track & Field': ['Sprints', 'Distance', 'Jumps', 'Throws'],
  Wrestling: ['Lightweight', 'Middleweight', 'Heavyweight'],
  Volleyball: ['OH', 'MB', 'S', 'L', 'OPP'],
  Hockey: ['G', 'D', 'C', 'W'],
  default: ['Starter', 'Reserve', 'Captain'],
};

// ---------------------------------------------------------------- onboarding (redesign)
/** The 7 onboarding roles. `flow` is the dashboard archetype each routes onto;
 *  `archetype` distinguishes personalization variants that share a flow
 *  (e.g. nutritionist vs personal_trainer both ride the trainer/client dash). */
export interface RoleDef {
  key: Role;
  title: string;
  sub: string;
  icon: string;
  flow: Flow;
  archetype: 'athlete' | 'parent' | 'client' | 'team' | 'nutrition';
}
export const ROLE_DEFS: RoleDef[] = [
  { key: 'athlete', title: 'Athlete', sub: 'Track nutrition, stay accountable', icon: 'bolt', flow: 'app', archetype: 'athlete' },
  { key: 'parent', title: 'Parent', sub: "Follow your athlete's progress", icon: 'user', flow: 'parent', archetype: 'parent' },
  { key: 'personal_trainer', title: 'Personal Trainer', sub: 'Coach clients beyond sessions', icon: 'plan', flow: 'trainer', archetype: 'client' },
  { key: 'sports_perf_coach', title: 'Sports Performance Coach', sub: 'Develop a roster of athletes', icon: 'checkin', flow: 'coach', archetype: 'team' },
  { key: 'nutritionist', title: 'Nutritionist', sub: 'Drive client nutrition compliance', icon: 'utensils', flow: 'trainer', archetype: 'nutrition' },
  { key: 'hs_coach', title: 'High School Coach', sub: 'Manage your team & leaderboards', icon: 'checkin', flow: 'coach', archetype: 'team' },
  { key: 'college_coach', title: 'College Coach', sub: 'Run your program', icon: 'checkin', flow: 'coach', archetype: 'team' },
];

/** Map any role to its dashboard flow. New roles fall back to the athlete app. */
export function flowForRole(role: Role | null): Flow {
  return ROLE_DEFS.find((r) => r.key === role)?.flow ?? 'app';
}

/** Athlete Step 1 — primary goal, grouped. Single-select; drives AI coaching copy. */
export interface GoalOption { key: string; label: string }
export const GOAL_GROUPS: { group: string; options: GoalOption[] }[] = [
  {
    group: 'Performance',
    options: [
      { key: 'get_faster', label: 'Get Faster' },
      { key: 'get_stronger', label: 'Get Stronger' },
      { key: 'improve_recovery', label: 'Improve Recovery' },
      { key: 'improve_endurance', label: 'Improve Endurance' },
    ],
  },
  {
    group: 'Body Composition',
    options: [
      { key: 'gain_weight', label: 'Gain Weight' },
      { key: 'gain_muscle', label: 'Gain Muscle' },
      { key: 'lose_fat', label: 'Lose Fat' },
      { key: 'maintain', label: 'Maintain Weight' },
    ],
  },
  {
    group: 'Athletic Development',
    options: [
      { key: 'playing_time', label: 'Earn More Playing Time' },
      { key: 'prep_season', label: 'Prepare For Season' },
      { key: 'scholarship', label: 'Earn A Scholarship' },
      { key: 'next_level', label: 'Reach The Next Level' },
    ],
  },
];

/** Flat goal lookup (key -> label) for personalized copy. */
export const GOAL_LABELS: Record<string, string> = Object.fromEntries(
  GOAL_GROUPS.flatMap((g) => g.options.map((o) => [o.key, o.label])),
);

export const TRAIN_FREQ: GoalOption[] = [
  { key: 'once', label: 'Once per day' },
  { key: 'twice', label: 'Twice per day' },
  { key: 'three_plus', label: 'Three or more per day' },
];

export const SUPPORT_OPTIONS: GoalOption[] = [
  { key: 'coach', label: 'Coach' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'nutritionist', label: 'Nutritionist' },
  { key: 'parent', label: 'Parent' },
];

/** Protein-target frequency answer (index = stored baseProteinFreq 0-3). */
export const PROTEIN_FREQ: GoalOption[] = [
  { key: '0', label: 'Rarely' },
  { key: '1', label: 'Sometimes' },
  { key: '2', label: 'Often' },
  { key: '3', label: 'Almost always' },
];

export const ATHLETE_GOALS = [
  'Performance', 'Scholarship', 'Body composition', 'Playing time', 'NIL opportunities',
];

export const LEVELS = ['College', 'High School', 'Youth'];

export const BASE_GOAL_CHIPS: { key: BaseGoal; label: string }[] = [
  { key: 'gain', label: 'Gain' },
  { key: 'lose', label: 'Lose' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'performance', label: 'Performance' },
];

export const INVITE_DATA = [
  { key: 'coach', name: 'Coach', desc: 'Eastside HS staff' },
  { key: 'parent', name: 'Parent / Guardian', desc: 'Shares weekly reports' },
  { key: 'trainer', name: 'Personal Trainer', desc: 'Optional' },
  { key: 'nutritionist', name: 'Nutritionist', desc: 'Optional' },
];

export const PARENT_FOCUS = [
  'Visibility', 'Performance', 'Scholarship prep', 'Recovery & health', 'Confidence',
];

export const COMP_MODES: { key: 'position' | 'team' | 'off'; label: string }[] = [
  { key: 'position', label: 'Position Group' },
  { key: 'team', label: 'Full Team' },
  { key: 'off', label: 'Off' },
];

export const TRACK_DATA = [
  { key: 'nutrition', name: 'Nutrition', desc: 'Meals, protein, calories' },
  { key: 'recovery', name: 'Recovery', desc: 'Sleep & readiness' },
  { key: 'hydration', name: 'Hydration', desc: 'Daily water intake' },
  { key: 'weight', name: 'Weight', desc: 'Body composition goals' },
  { key: 'tasks', name: 'Tasks', desc: 'Daily accountability' },
] as const;

/** Coach-configurable weekly check-in questions. */
export const CHECKIN_QUESTIONS = [
  { key: 'energy', label: 'Energy' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'soreness', label: 'Soreness' },
  { key: 'motivation', label: 'Motivation' },
] as const;

export const ONBOARDING_SEQS: Record<string, string[]> = {
  athlete: ['account', 'level', 'sport', 'baseline', 'connect', 'success'],
  parent: ['account', 'link', 'focus', 'success'],
  coach: ['account', 'team', 'roster', 'track', 'success'],
  trainer: ['account', 'practice', 'clients', 'success'],
};

/** Static leaderboard rows; the "you" row's score is injected live from the engine. */
export const TEAM_BOARD: Omit<LeaderRow, 'score'>[] = [
  { rank: 1, name: 'Mike Reyes', initials: 'MR', pos: 'Running Back', you: false, dir: 'up' },
  { rank: 2, name: 'Jihad', initials: 'J', pos: 'Linebacker', you: true, dir: 'up' },
  { rank: 3, name: 'Jordan Lee', initials: 'JL', pos: 'Wide Receiver', you: false, dir: 'flat' },
  { rank: 4, name: 'Chris Patel', initials: 'CP', pos: 'Safety', you: false, dir: 'up' },
  { rank: 5, name: 'A. Silva', initials: 'AS', pos: 'Linebacker', you: false, dir: 'down' },
  { rank: 6, name: 'M. Cole', initials: 'MC', pos: 'Linebacker', you: false, dir: 'down' },
];
export const TEAM_BOARD_SCORES: Record<number, number> = { 1: 96, 3: 89, 4: 86, 5: 79, 6: 68 };

export const POS_BOARD: Omit<LeaderRow, 'score'>[] = [
  { rank: 1, name: 'Jihad', initials: 'J', pos: 'Linebacker', you: true, dir: 'up' },
  { rank: 2, name: 'A. Silva', initials: 'AS', pos: 'Linebacker', you: false, dir: 'down' },
  { rank: 3, name: 'M. Cole', initials: 'MC', pos: 'Linebacker', you: false, dir: 'down' },
];
export const POS_BOARD_SCORES: Record<number, number> = { 2: 79, 3: 68 };

/** Coach roster (the athlete's own score is injected live). */
export interface RosterRow {
  name: string;
  initials: string;
  pos: string;
  comp: number;
  score: number;
  dir: 'up' | 'down' | 'flat';
  you?: boolean;
  /** Specific at-risk signals for the Needs-Attention reason (see AtRiskInput). */
  proteinMissed?: number;
  hydrationLow?: boolean;
  weightStalled?: boolean;
  checkinDaysAgo?: number;
}
export const ROSTER: RosterRow[] = [
  { name: 'Jihad', initials: 'J', pos: 'LB', comp: 96, score: 92, dir: 'up', you: true },
  { name: 'D. Brooks', initials: 'DB', pos: 'LB', comp: 92, score: 88, dir: 'up' },
  { name: 'T. Nguyen', initials: 'TN', pos: 'LB', comp: 90, score: 85, dir: 'flat' },
  { name: 'R. Okafor', initials: 'RO', pos: 'LB', comp: 84, score: 82, dir: 'up' },
  { name: 'A. Silva', initials: 'AS', pos: 'LB', comp: 71, score: 79, dir: 'down', proteinMissed: 3, weightStalled: true },
  { name: 'M. Cole', initials: 'MC', pos: 'LB', comp: 58, score: 68, dir: 'down', proteinMissed: 4, hydrationLow: true, checkinDaysAgo: 4 },
];

/** Trainer client book (multi-org). */
export interface ClientRow {
  name: string;
  initials: string;
  org: string;
  sport: string;
  score: number;
  comp: number;
  last: string;
  dir: 'up' | 'down' | 'flat';
  /** Specific at-risk signals for the Needs-Follow-Up reason (see AtRiskInput). */
  proteinMissed?: number;
  hydrationLow?: boolean;
  weightStalled?: boolean;
  checkinDaysAgo?: number;
}
export const TRAINER_CLIENTS: ClientRow[] = [
  { name: 'Jihad Carter', initials: 'JC', org: 'Eastside HS', sport: 'Linebacker', score: 92, comp: 96, last: 'Today', dir: 'up' },
  { name: 'Maya Lopez', initials: 'ML', org: 'Westlake Club', sport: 'Soccer', score: 88, comp: 90, last: 'Today', dir: 'up' },
  { name: 'Eli Brooks', initials: 'EB', org: 'Independent', sport: 'Basketball', score: 85, comp: 88, last: 'Yesterday', dir: 'flat' },
  { name: 'Sofia Reyes', initials: 'SR', org: 'Eastside HS', sport: 'Volleyball', score: 81, comp: 78, last: '2 days ago', dir: 'down' },
  { name: 'Andre Silva', initials: 'AS', org: 'Westlake Club', sport: 'Linebacker', score: 74, comp: 64, last: '5 days ago', dir: 'down', proteinMissed: 4, hydrationLow: true, checkinDaysAgo: 5 },
];

/** Org tag colors for the trainer client book. */
export const ORG_COLORS: Record<string, { bg: string; c: string }> = {
  'Eastside HS': { bg: '#EFF6FF', c: '#2563EB' },
  'Westlake Club': { bg: '#F5F3FF', c: '#7C3AED' },
  Independent: { bg: '#F1F5F9', c: '#64748B' },
};
