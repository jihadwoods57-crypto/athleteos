// OnStandard — sanitize arbitrary plan-slot input (model output or a DB jsonb blob) into a
// trusted PlanSlot[]. House style: a hand-written guard, next to the scoring authority, so no
// unvalidated shape ever reaches the compliance read or the UI. No zod dependency.
import type { MealKey } from './types';
import type { PlanMeal, PlanSlot } from './coachPlan';

const KEYS: MealKey[] = ['breakfast', 'lunch', 'snack', 'dinner'];
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function parseMeal(raw: unknown, fallbackSource: PlanMeal['source']): PlanMeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const m = (r.macros ?? {}) as Record<string, unknown>;
  const source = r.source === 'template' || r.source === 'restaurant' || r.source === 'ai' ? r.source : fallbackSource;
  return {
    name: str(r.name),
    items: strList(r.items),
    macros: { kcal: num(m.kcal), protein: num(m.protein), carbs: num(m.carbs), fat: num(m.fat) },
    source,
  };
}

function parseMeals(raw: unknown, fallbackSource: PlanMeal['source']): PlanMeal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => parseMeal(m, fallbackSource)).filter((m): m is PlanMeal => m !== null);
}

/** Conservative whole-day calorie floors for an AI-drafted plan. Deterministic code,
 *  not a prompt: the constitution's "the LLM never invents safety-bounded numbers
 *  (especially minors' calorie targets)" line, enforced where it can't be jailbroken.
 *  Floors are deliberately below any sane recommendation (they catch drafts that are
 *  WRONG, they don't practice nutrition) — an active teen needs far more than 2000. */
export const PLAN_DAY_KCAL_FLOOR_MINOR = 2000;
export const PLAN_DAY_KCAL_FLOOR_ADULT = 1400;

/**
 * Deterministic safety pass over an AI-drafted (or DB-loaded) plan:
 * - Whole-day calorie floor: when the slots carry kcal targets summing below the
 *   age floor, every slot scales up proportionally to reach it (ratios preserved).
 *   A day with NO kcal targets asserts nothing and is left alone.
 * - Confirmed avoid foods (allergies/dislikes from memory): any pinned meal or
 *   option whose name/items match an avoid token is dropped — an AI plan must never
 *   pin a confirmed allergen. Slot kcal/protein targets are unaffected.
 * Run AFTER parsePlanSlots on every model-drafted plan, before setPlanSlots.
 */
export function clampPlanSlots(slots: PlanSlot[], opts: { isMinor: boolean; avoid?: string[] }): PlanSlot[] {
  const avoid = (opts.avoid ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const mealMatchesAvoid = (m: PlanMeal | null): boolean => {
    if (!m || avoid.length === 0) return false;
    const hay = [m.name, ...m.items].join(' ').toLowerCase();
    return avoid.some((a) => hay.includes(a));
  };

  let out = slots.map((s) => {
    if (avoid.length === 0) return s;
    const pinnedMeal = mealMatchesAvoid(s.pinnedMeal) ? null : s.pinnedMeal;
    const options = s.options.filter((o) => !mealMatchesAvoid(o));
    const restaurantAlts = s.restaurantAlts.filter((o) => !mealMatchesAvoid(o));
    if (pinnedMeal === s.pinnedMeal && options.length === s.options.length && restaurantAlts.length === s.restaurantAlts.length) return s;
    // A pinned slot whose meal was dropped falls back to open (targets stand).
    return { ...s, pinnedMeal, mode: pinnedMeal ? s.mode : 'open' as const, options, restaurantAlts };
  });

  const floor = opts.isMinor ? PLAN_DAY_KCAL_FLOOR_MINOR : PLAN_DAY_KCAL_FLOOR_ADULT;
  const total = out.reduce((t, s) => t + (s.macros.kcal > 0 ? s.macros.kcal : 0), 0);
  if (total > 0 && total < floor) {
    const scale = floor / total;
    out = out.map((s) =>
      s.macros.kcal > 0 ? { ...s, macros: { ...s.macros, kcal: Math.ceil(s.macros.kcal * scale) } } : s,
    );
  }
  return out;
}

export function parsePlanSlots(raw: unknown): PlanSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!KEYS.includes(r.key as MealKey)) continue;
    const macros = (r.macros ?? {}) as Record<string, unknown>;
    out.push({
      key: r.key as MealKey,
      mode: r.mode === 'pinned' ? 'pinned' : 'open',
      macros: { kcal: num(macros.kcal), protein: num(macros.protein), ...(macros.carbs != null ? { carbs: num(macros.carbs) } : {}), ...(macros.fat != null ? { fat: num(macros.fat) } : {}) },
      pinnedMeal: parseMeal(r.pinnedMeal, 'ai'),
      options: parseMeals(r.options, 'ai'),
      restaurantAlts: parseMeals(r.restaurantAlts, 'restaurant'),
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
      photoRequired: r.photoRequired === true,
    });
  }
  return out;
}
