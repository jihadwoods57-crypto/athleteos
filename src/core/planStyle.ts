// OnStandard — nutrition PLAN STYLE (pure TS, no RN imports).
//
// A plan style is HOW MUCH STRUCTURE a person is held to, on one spectrum:
//
//   Structured  exact calorie/macro/timing targets — completion + adherence led.
//   Guided      flexible ranges, meal quality, fueling guidance, light body-signal awareness.
//   Intuitive   no calorie/macro surface for the athlete — hunger, fullness, satisfaction,
//               energy, digestion, recovery and cravings; scored on AWARENESS, adequate fueling,
//               hydration and consistency. Never on restriction.
//
// It is ORTHOGONAL to the goal-derived scoring profile (scoringProfiles.ts): the GOAL sets the
// direction (which way the calorie curve leans, what the targets are), the STYLE sets the
// structure (how tightly that direction is measured, and what the athlete sees). Full 3x3 matrix.
//
// ------------------------------------------------------------------------------------------
// THE INTEGRITY INVARIANT (enforced by planStyleCaps.test.ts — do not break it)
// ------------------------------------------------------------------------------------------
// Migration 0041 clamps a written day score to an evidence ceiling built from the MAXIMUM weight
// each component carries across all profiles (nutrition 55 / recovery 25 / commitment 15 /
// checkin 10), mirrored here by scoreIntegrity.ts's MAX_SUBSCORE_WEIGHT. Neither knows about
// styles, and neither should have to: NO style may push a component above its cap.
//
// Because the four weights must also sum to 1, the caps pin nutrition into [0.50, 0.55]:
//   min nutrition = 1 - 0.25 - 0.15 - 0.10 = 0.50      max nutrition = 0.55 (its own cap)
// The `athlete` profile already sits at that 0.50 floor with recovery at its 0.25 cap, so it has
// NO headroom — every style scores an athlete on the same headline mix. That is by design: the
// real differentiation lives in what the NUTRITION SUB-SCORE MEASURES (NUTRITION_PARTS), not in
// the headline mix. `general` and `gain` carry a little slack, spent moving nutrition -> recovery.
//
// MIRRORED BY proto/redesign-2026-07/js/plan-style.js — planStyleParity.test.ts locks the two together.
import type { ScoringProfile } from './types';

export type PlanStyle = 'structured' | 'guided' | 'intuitive';
export type StyleSource = 'team' | 'pro' | 'preference' | 'self' | 'legacy' | 'default';
export type StyleControl = 'assign' | 'self' | 'propose' | 'preference';

export const STYLE_KEYS: PlanStyle[] = ['structured', 'guided', 'intuitive'];

/** New accounts land here (founder decision: Guided is the default for most people). */
export const DEFAULT_STYLE: PlanStyle = 'guided';
/** Accounts with pre-release history are grandfathered here — see resolvePlanStyle({ hasHistory }). */
export const LEGACY_STYLE: PlanStyle = 'structured';

/** The onboarding answer -> recommended style. "not sure" is a real answer, not a null. */
export const STRUCTURE_ANSWERS: { id: string; label: string; style: PlanStyle }[] = [
  { id: 'numbers', label: 'I want clear numbers and expectations', style: 'structured' },
  { id: 'flexible', label: 'I want guidance with flexibility', style: 'guided' },
  { id: 'signals', label: 'I want to focus on body signals', style: 'intuitive' },
  { id: 'unsure', label: "I'm not sure yet", style: 'guided' },
];

export function styleForStructureAnswer(answer: string | null | undefined): PlanStyle {
  const hit = STRUCTURE_ANSWERS.find((a) => a.id === answer);
  return hit ? hit.style : DEFAULT_STYLE;
}

/** Coerce anything to a known style key; unknown/absent -> null (callers decide the default). */
export function resolveStyleKey(x: unknown): PlanStyle | null {
  const k = String(x == null ? '' : x).trim().toLowerCase();
  return (STYLE_KEYS as string[]).includes(k) ? (k as PlanStyle) : null;
}

/* ---------------------------------------------------------------- weights */

export interface StyleWeights {
  nutrition: number;
  recovery: number;
  commitment: number;
  checkin: number;
}

/** Per-component ceiling, mirroring migration 0041's slots. NOTHING may exceed these. */
export const WEIGHT_CAPS: StyleWeights = { nutrition: 0.55, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

/**
 * Headline mix per (style x goal profile). The `structured` row is BYTE-IDENTICAL to
 * PROFILE_WEIGHTS — that identity is what makes grandfathered accounts provably unchanged
 * (scoreParity.test.ts passes unmodified).
 */
export const STYLE_WEIGHTS: Record<PlanStyle, Record<ScoringProfile, StyleWeights>> = {
  structured: {
    athlete: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 },
    general: { nutrition: 0.55, recovery: 0.2, commitment: 0.15, checkin: 0.1 },
    gain: { nutrition: 0.55, recovery: 0.25, commitment: 0.1, checkin: 0.1 },
  },
  guided: {
    athlete: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 }, // no headroom
    general: { nutrition: 0.52, recovery: 0.23, commitment: 0.15, checkin: 0.1 },
    gain: { nutrition: 0.53, recovery: 0.25, commitment: 0.12, checkin: 0.1 },
  },
  intuitive: {
    athlete: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 }, // no headroom
    general: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 },
    gain: { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 },
  },
};

export function weightsFor(style: unknown, profile: unknown): StyleWeights {
  const s = resolveStyleKey(style) || LEGACY_STYLE;
  const p: ScoringProfile = profile === 'general' || profile === 'gain' ? (profile as ScoringProfile) : 'athlete';
  return STYLE_WEIGHTS[s][p];
}

/** True when every component is within its 0041 cap AND the mix sums to 1 (within float slop). */
export function weightsWithinCaps(w: Partial<StyleWeights> | null | undefined): boolean {
  if (!w) return false;
  const keys: (keyof StyleWeights)[] = ['nutrition', 'recovery', 'commitment', 'checkin'];
  let sum = 0;
  for (const k of keys) {
    const v = w[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) return false;
    if (v > WEIGHT_CAPS[k] + 1e-9) return false;
    sum += v;
  }
  return Math.abs(sum - 1) < 1e-9;
}

/* ---------------------------------------------------------------- signals */

export type SignalKey = 'hunger' | 'fullness' | 'satisfaction' | 'digestion' | 'cravings';

export interface SignalSpec {
  key: SignalKey;
  label: string;
  where: 'meal' | 'checkin';
  lo: string;
  hi: string;
  inverse?: boolean;
}

/** The body signals a style can track. `where` decides which surface captures it.
 *  `inverse` marks a signal whose HIGH value is the negative pole (like soreness today). */
export const SIGNAL_KEYS: SignalSpec[] = [
  { key: 'hunger', label: 'Hunger before', where: 'meal', lo: 'Not hungry', hi: 'Very hungry' },
  { key: 'fullness', label: 'Fullness after', where: 'meal', lo: 'Still hungry', hi: 'Very full' },
  { key: 'satisfaction', label: 'Satisfaction', where: 'meal', lo: 'Not satisfied', hi: 'Very satisfied' },
  { key: 'digestion', label: 'Digestion', where: 'checkin', lo: 'Rough', hi: 'Comfortable' },
  { key: 'cravings', label: 'Cravings', where: 'checkin', lo: 'None', hi: 'Constant', inverse: true },
];

export const MEAL_SIGNAL_KEYS = SIGNAL_KEYS.filter((s) => s.where === 'meal').map((s) => s.key);
export const CHECKIN_SIGNAL_KEYS = SIGNAL_KEYS.filter((s) => s.where === 'checkin').map((s) => s.key);

/* ---------------------------------------------------------------- presets */

export interface NutritionParts {
  protein: number;
  calorie: number;
  timing: number;
  hydration: number;
  quality: number;
  awareness: number;
}

/**
 * Nutrition sub-score composition per style. Each column sums to 100; the result rides the
 * headline nutrition weight.
 *
 *   Structured  protein 40 + calorie adherence 25 + on-time meals 25 + hydration 10
 *   Guided      calorie-in-range 30 + protein-in-range 20 + consistency 25 + quality 15 + hydration 10
 *   Intuitive   fueling adequacy 40 + signal awareness 35 + hydration 25
 *
 * IMPORTANT — Structured's row is the CUSTOMIZATION STARTING POINT, not the default engine path.
 * By default Structured scores on `formula: 'legacy'`: the shipped per-goal-profile formula, byte
 * for byte (athlete protein 65 + meals 35; general cal 45 + protein 25 + meals 30; gain floor 40 +
 * protein 35 + meals 25). That identity is what grandfathers every existing account (decision 8)
 * — scoring hydration on Structured by default would move every one of their scores on release
 * day. A professional who customizes Structured opts INTO this composition. See knobsFor().
 */
export const NUTRITION_PARTS: Record<PlanStyle, NutritionParts> = {
  structured: { protein: 40, calorie: 25, timing: 25, hydration: 10, quality: 0, awareness: 0 },
  guided: { protein: 20, calorie: 30, timing: 25, hydration: 10, quality: 15, awareness: 0 },
  intuitive: { protein: 0, calorie: 40, timing: 0, hydration: 25, quality: 0, awareness: 35 },
};

/** Which engine path scores the nutrition sub-score:
 *   'legacy' — the shipped per-goal-profile formula, untouched (Structured's default).
 *   'parts'  — the NUTRITION_PARTS composition above (Guided, Intuitive, customized Structured). */
export const FORMULAS = ['legacy', 'parts'];

export interface StyleKnobs {
  nutrition: {
    formula: 'legacy' | 'parts';
    calorie: 'exact' | 'range' | 'adequacy' | 'off';
    calorieBand: number;
    protein: 'exact' | 'range' | 'off';
    proteinBand: number;
    timingScored: boolean;
    hydrationScored: boolean;
    qualityScored: boolean;
    awarenessScored: boolean;
  };
  parts: NutritionParts;
  signals: Record<SignalKey, boolean>;
  surface: { showCalories: boolean; showMacros: boolean; tone: 'targets' | 'guidance' | 'signals' };
  style?: PlanStyle;
  customized?: boolean;
}

export const PRESETS: Record<PlanStyle, StyleKnobs> = {
  structured: {
    nutrition: {
      formula: 'legacy',                       // the shipped per-profile formula — see NUTRITION_PARTS
      calorie: 'exact', calorieBand: 0.1,
      protein: 'exact', proteinBand: 0.1,
      timingScored: true, hydrationScored: true, qualityScored: false, awarenessScored: false,
    },
    parts: NUTRITION_PARTS.structured,
    signals: { hunger: false, fullness: false, satisfaction: false, digestion: false, cravings: false },
    surface: { showCalories: true, showMacros: true, tone: 'targets' },
  },
  guided: {
    nutrition: {
      formula: 'parts',
      calorie: 'range', calorieBand: 0.12,
      protein: 'range', proteinBand: 0.15,
      timingScored: true, hydrationScored: true, qualityScored: true, awarenessScored: false,
    },
    parts: NUTRITION_PARTS.guided,
    signals: { hunger: true, fullness: true, satisfaction: false, digestion: false, cravings: false },
    surface: { showCalories: true, showMacros: true, tone: 'guidance' },
  },
  intuitive: {
    nutrition: {
      formula: 'parts',
      calorie: 'adequacy', calorieBand: 0,
      protein: 'off', proteinBand: 0,
      timingScored: false, hydrationScored: true, qualityScored: false, awarenessScored: true,
    },
    parts: NUTRITION_PARTS.intuitive,
    signals: { hunger: true, fullness: true, satisfaction: true, digestion: true, cravings: true },
    surface: { showCalories: false, showMacros: false, tone: 'signals' },
  },
};

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : fallback;

const PART_KEYS: (keyof NutritionParts)[] = ['protein', 'calorie', 'timing', 'hydration', 'quality', 'awareness'];

/** Re-normalize a parts object to sum to 100 (a pro override can leave it lopsided). */
function normalizeParts(parts: Partial<NutritionParts> | undefined, style: PlanStyle): NutritionParts {
  const safe = {} as NutritionParts;
  let total = 0;
  for (const k of PART_KEYS) {
    const v = num(parts && parts[k], 0, 100, 0);
    safe[k] = v; total += v;
  }
  if (total <= 0) return { ...NUTRITION_PARTS[style] };
  if (Math.abs(total - 100) < 1e-9) return safe;
  const out = {} as NutritionParts;
  for (const k of PART_KEYS) out[k] = (safe[k] / total) * 100;
  return out;
}

/**
 * The effective knobs for a style, with an optional professional override patch applied.
 * Overrides are shallow-merged per section and range-checked, so a malformed override can widen
 * or narrow the plan but can never produce an invalid engine input. `parts` re-normalizes to 100.
 */
export function knobsFor(style: unknown, overrides?: any): StyleKnobs {
  const s = resolveStyleKey(style) || DEFAULT_STYLE;
  const base = clone(PRESETS[s]);
  const o = overrides && typeof overrides === 'object' ? overrides : null;
  if (o) {
    // A pro who customizes HOW nutrition is measured opts out of the legacy passthrough and into
    // the parts composition — otherwise their band/flag edits would be silently ignored by an
    // engine path that doesn't read them. An explicit `formula` always wins over this inference.
    const touchesComposition = !!(o.parts && typeof o.parts === 'object' && Object.keys(o.parts).length)
      || (o.nutrition && typeof o.nutrition === 'object' && [
        'calorie', 'protein', 'calorieBand', 'proteinBand',
        'timingScored', 'hydrationScored', 'qualityScored', 'awarenessScored',
      ].some((k) => o.nutrition[k] !== undefined));
    if (touchesComposition) base.nutrition.formula = 'parts';
    if (o.nutrition && typeof o.nutrition === 'object') {
      const n = o.nutrition;
      if (FORMULAS.includes(n.formula)) base.nutrition.formula = n.formula;
      if (['exact', 'range', 'adequacy', 'off'].includes(n.calorie)) base.nutrition.calorie = n.calorie;
      if (['exact', 'range', 'off'].includes(n.protein)) base.nutrition.protein = n.protein;
      base.nutrition.calorieBand = num(n.calorieBand, 0, 0.5, base.nutrition.calorieBand);
      base.nutrition.proteinBand = num(n.proteinBand, 0, 0.5, base.nutrition.proteinBand);
      for (const k of ['timingScored', 'hydrationScored', 'qualityScored', 'awarenessScored'] as const) {
        if (typeof n[k] === 'boolean') base.nutrition[k] = n[k];
      }
    }
    if (o.parts && typeof o.parts === 'object') base.parts = { ...base.parts, ...o.parts };
    if (o.signals && typeof o.signals === 'object') {
      for (const { key } of SIGNAL_KEYS) if (typeof o.signals[key] === 'boolean') base.signals[key] = o.signals[key];
    }
    if (o.surface && typeof o.surface === 'object') {
      for (const k of ['showCalories', 'showMacros'] as const) {
        if (typeof o.surface[k] === 'boolean') base.surface[k] = o.surface[k];
      }
      if (['targets', 'guidance', 'signals'].includes(o.surface.tone)) base.surface.tone = o.surface.tone;
    }
  }
  base.parts = normalizeParts(base.parts, s);
  // A part can only earn credit when its knob is on — otherwise a pro could weight `quality` on a
  // style that never measures it and silently cap the athlete's nutrition score below 100.
  if (!base.nutrition.timingScored) base.parts.timing = 0;
  if (!base.nutrition.hydrationScored) base.parts.hydration = 0;
  if (!base.nutrition.qualityScored) base.parts.quality = 0;
  if (!base.nutrition.awarenessScored) base.parts.awareness = 0;
  if (base.nutrition.protein === 'off') base.parts.protein = 0;
  if (base.nutrition.calorie === 'off') base.parts.calorie = 0;
  base.parts = normalizeParts(base.parts, s);
  base.style = s;
  base.customized = !!o && Object.keys(o).length > 0;
  return base;
}

/* ---------------------------------------------------------------- resolution + permission */

/** Who may DECIDE the style, by role. Everyone may always state a preference. */
export const STYLE_CONTROL: Record<string, StyleControl> = {
  athlete: 'preference',   // team athlete — the assigned coach/trainer/nutrition pro decides
  client: 'propose',       // trainer client — proposes; the trainer confirms or adjusts
  solo: 'self',            // independent adult — chooses freely
  parent: 'preference',
  coach: 'assign',
  trainer: 'assign',
  nutrition: 'assign',
};

export function styleControlFor(role: string | null | undefined): StyleControl {
  return STYLE_CONTROL[role as string] || 'self';
}

export interface StyleAssignment { style?: unknown; overrides?: any; styleOverrides?: any; setBy?: string | null }

export interface ResolveStyleInput {
  role?: string | null;
  teamStandard?: StyleAssignment | null;
  proAssignment?: StyleAssignment | null;
  selfChoice?: unknown;
  selfOverrides?: any;
  preference?: unknown;
  hasHistory?: boolean;
}

export interface ResolvedStyle {
  style: PlanStyle;
  knobs: StyleKnobs;
  source: StyleSource;
  locked: boolean;
  lockedBy: string | null;
  canChoose: boolean;
  preference: PlanStyle | null;
}

/**
 * The ONE answer to "what style governs this person, who set it, and can they change it".
 * Precedence: team standard -> professional assignment -> self choice -> default.
 * `preference` is ALWAYS carried through, even when locked — that is what the pro's roster
 * surfaces, so a locked athlete is never a dead end.
 */
export function resolvePlanStyle(input: ResolveStyleInput): ResolvedStyle {
  const i = input || {};
  const preference = resolveStyleKey(i.preference);
  const control = styleControlFor(i.role);

  const team = i.teamStandard && resolveStyleKey(i.teamStandard.style);
  if (team) {
    return {
      style: team, knobs: knobsFor(team, i.teamStandard!.overrides),
      source: 'team', locked: true, lockedBy: i.teamStandard!.setBy || null,
      canChoose: false, preference,
    };
  }

  const pro = i.proAssignment && resolveStyleKey(i.proAssignment.style);
  if (pro) {
    return {
      style: pro, knobs: knobsFor(pro, i.proAssignment!.styleOverrides),
      source: 'pro', locked: control !== 'assign', lockedBy: i.proAssignment!.setBy || null,
      canChoose: control === 'assign', preference,
    };
  }

  // A trainer client with no confirmed assignment runs on their own stated preference
  // PROVISIONALLY — not blocked waiting on the trainer, and the trainer sees it pending.
  if (control === 'propose' && preference) {
    return {
      style: preference, knobs: knobsFor(preference, null),
      source: 'preference', locked: false, lockedBy: null, canChoose: true, preference,
    };
  }

  const self = resolveStyleKey(i.selfChoice);
  if (self && (control === 'self' || control === 'assign')) {
    return {
      style: self, knobs: knobsFor(self, i.selfOverrides),
      source: 'self', locked: false, lockedBy: null, canChoose: true, preference,
    };
  }

  // Grandfather: an account that already has scored history keeps today's exact scoring.
  if (i.hasHistory) {
    return {
      style: LEGACY_STYLE, knobs: knobsFor(LEGACY_STYLE, null),
      source: 'legacy', locked: false, lockedBy: null, canChoose: control !== 'preference', preference,
    };
  }

  const fallback = (control === 'self' || control === 'propose') && preference ? preference : DEFAULT_STYLE;
  return {
    style: fallback, knobs: knobsFor(fallback, null),
    source: 'default', locked: control === 'preference', lockedBy: null,
    canChoose: control !== 'preference', preference,
  };
}

/* ---------------------------------------------------------------- adherence curves */

/**
 * Range credit (0..1) for a Guided target: FULL anywhere inside +/- band, then linear falloff to 0
 * at 4x the band. Wider and more forgiving than the Structured curve by construction — a range is
 * a range, not a tighter target. band <= 0 collapses to exact-match behavior.
 */
export function rangeAdherence(value: number, target: number, band: number): number {
  if (!(target > 0)) return 0;
  const b = typeof band === 'number' && isFinite(band) && band > 0 ? band : 0;
  const dev = Math.abs(value - target) / target;
  if (dev <= b) return 1;
  const outer = b > 0 ? b * 4 : 0.3;
  if (dev >= outer) return 0;
  return (outer - dev) / (outer - b);
}

/**
 * Fueling adequacy (0..1) for Intuitive: full credit at or above 85% of target, linear to 0 at
 * 45%. Deliberately GENEROUS and strictly one-sided — eating more is NEVER penalized on a style
 * whose whole point is that food is not a debt. The only calorie-derived number Intuitive scores,
 * and it exists to catch genuine under-fueling, not to police intake.
 */
export function fuelingAdequacy(kcal: number, target: number): number {
  if (!(target > 0)) return 0;
  const ratio = kcal / target;
  if (ratio >= 0.85) return 1;
  if (ratio <= 0.45) return 0;
  return (ratio - 0.45) / 0.4;
}

/**
 * Signal-awareness credit (0..1): did they NOTICE, not what they noticed.
 *
 * A 1/5 satisfaction scores exactly the same as a 5/5 — the value is never judged, only the act
 * of answering. Blends today (60%) with the trailing-week answer rate (40%) so a single skipped
 * day barely moves the number, which keeps an awareness practice from becoming another streak to
 * fail. `weekRate` absent -> today stands in for it (pure tests need no history).
 */
export function awarenessScore(
  answered: Set<string> | string[] | null | undefined,
  knobs: StyleKnobs | null | undefined,
  weekRate?: number,
): number {
  const enabled = SIGNAL_KEYS.filter((s) => knobs && knobs.signals && knobs.signals[s.key]).map((s) => s.key);
  if (!enabled.length) return 1; // nothing to be aware of — never punish an empty config
  const set = answered instanceof Set ? answered : new Set(Array.isArray(answered) ? answered : []);
  let hit = 0;
  for (const k of enabled) if (set.has(k)) hit++;
  const today = hit / enabled.length;
  const week = typeof weekRate === 'number' && isFinite(weekRate) && weekRate >= 0 ? Math.min(1, weekRate) : today;
  return Math.max(0, Math.min(1, today * 0.6 + week * 0.4));
}

/** The signal keys with a real answer on this day, across both capture surfaces. */
export function answeredSignals(day: any, checkinBacked: boolean): Set<string> {
  const out = new Set<string>();
  const bySlot = (day && day.signals) || {};
  for (const slot of Object.keys(bySlot)) {
    const v = bySlot[slot] || {};
    for (const k of MEAL_SIGNAL_KEYS) if (typeof v[k] === 'number' && isFinite(v[k])) out.add(k);
  }
  if (checkinBacked) {
    const ci = (day && day.ci) || {};
    for (const k of CHECKIN_SIGNAL_KEYS) if (typeof ci[k] === 'number' && isFinite(ci[k])) out.add(k);
  }
  return out;
}

/* ---------------------------------------------------------------- disclosure copy */

/** Plain-English disclosure — the athlete should never wonder what their number measures. */
export function styleLabel(style: unknown): { name: string; short: string; how: string } {
  switch (resolveStyleKey(style) || DEFAULT_STYLE) {
    case 'structured':
      return {
        name: 'Structured',
        short: 'Clear numbers and expectations',
        how: 'Exact calorie, protein, meal-timing and hydration targets. Your score leans on completing them.',
      };
    case 'intuitive':
      return {
        name: 'Intuitive',
        short: 'Focused on body signals',
        how: 'No calorie or macro targets. Your score measures awareness of hunger, fullness and energy, fueling enough, hydration and consistency — never restriction.',
      };
    case 'guided':
    default:
      return {
        name: 'Guided',
        short: 'Guidance with flexibility',
        how: 'Flexible ranges instead of exact numbers, plus meal quality and light hunger and energy awareness. Your score balances consistency, quality and flexibility.',
      };
  }
}

/** How a style's source reads on the athlete's own screen. */
export function styleSourceLabel(res: ResolvedStyle | null, proNoun?: string): string {
  const who = proNoun || 'coach';
  if (!res) return '';
  if (res.source === 'team' || res.source === 'pro') return `Set by your ${res.lockedBy || who}`;
  if (res.source === 'preference') return 'Your preference — pending confirmation';
  if (res.source === 'legacy') return 'Your original plan style';
  if (res.source === 'self') return 'You chose this';
  return 'Recommended for you';
}
