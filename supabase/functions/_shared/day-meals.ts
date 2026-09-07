// WHAT THE ATHLETE ALREADY ATE TODAY — the foods, not just a protein total.
//
// The read has always been handed `proteinSoFar`, a single number, and nothing else about the day.
// So it could judge one photograph in isolation and call that coaching. It could never say the
// thing an actual nutritionist says across a day: "you had eggs at breakfast too, vary it",
// "that's the second fried plate today", "you finally got some vegetables in". Measured on 13 real
// reads (2026-09-07), every one of them treated the plate as the athlete's whole nutritional life.
//
// This is the missing input. It is also the cheapest one: the client already stores each logged
// slot's food names in `DAY.slotMacros[slot].foods` and has since the meal detail screen was built.
//
// Same rules as every other block in analyze-meal's userContent(): athlete-derived strings, so
// treated as data — stripped, capped, bounded in count — never as instructions. Absent or garbage
// input renders '' and the prompt is byte-identical to a request that never carried it, which is
// what makes it safe to send from a client an older deploy will ignore.

export type EarlierMeal = { slot?: unknown; foods?: unknown; protein?: unknown };

const MAX_MEALS = 4;
const MAX_FOODS = 6;

/** Slot labels we will echo. Anything else is dropped rather than printed into the prompt. */
const SLOTS = new Set(['breakfast', 'lunch', 'snack', 'dinner']);

const food = (v: unknown): string =>
  typeof v === 'string'
    ? v.replace(/[^A-Za-z0-9 ,'&()\/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase()
    : '';

/**
 * Render the earlier-meals line, or '' when there is nothing honest to say.
 *
 * Deliberately NOT given the macros of each earlier meal beyond protein: the day's protein total
 * already reaches the prompt through Day context, and a second set of per-meal numbers is the
 * thing that makes the model start doing day arithmetic out loud (see day-context.ts).
 */
export function earlierMealsLine(meals: unknown): string {
  if (!Array.isArray(meals) || !meals.length) return '';
  const parts: string[] = [];
  for (const m of meals.slice(0, MAX_MEALS)) {
    if (!m || typeof m !== 'object') continue;
    const e = m as EarlierMeal;
    const slot = typeof e.slot === 'string' && SLOTS.has(e.slot.toLowerCase()) ? e.slot.toLowerCase() : '';
    if (!slot) continue;
    const foods = (Array.isArray(e.foods) ? e.foods : [])
      .map(food).filter(Boolean).slice(0, MAX_FOODS);
    if (!foods.length) continue;
    const p = Math.round(Number(e.protein));
    const protein = Number.isFinite(p) && p >= 0 && p <= 300 ? ` (about ${p}g protein)` : '';
    parts.push(`${slot}: ${foods.join(', ')}${protein}`);
  }
  if (!parts.length) return '';
  return ` Earlier today the athlete logged ${parts.join('; ')}. This is what their day has actually looked like, so use it: notice genuine repetition ("eggs again"), a food group that has been missing all day, or an adjustment they have already made, and let it shape the ONE thing you tell them. Do NOT list it back to them or summarise their day, they were there; reference an earlier meal only when it changes your advice.`;
}
