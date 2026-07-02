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
