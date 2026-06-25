// AthleteOS — editable meal estimate (pure TS, no RN imports).
// The persona review's nutritionist flagged that the meal's macros/quality look
// authoritative but can't be corrected (dead steppers). This makes the estimate
// editable and self-consistent: each food carries a numeric per-serving share of
// the meal's estimate, so adjusting a portion recomputes the macros, the quality,
// and the calorie composition live. Honest by construction — every number on the
// screen derives from the portions the user can change. Per-ingredient precision
// (a real food database) is deferred; this is an adjustable estimate, labeled as one.

export interface MacroSet {
  protein: number;
  kcal: number;
  carbs: number;
  fat: number;
}

export interface EditableFood {
  name: string;
  /** Original portion label from the photo estimate (e.g. "7 oz"). */
  portion: string;
  /** Serving multiplier the user adjusts (1 = the original estimate). */
  servings: number;
  /** This food's per-serving share of the meal's estimated macros. */
  per: MacroSet;
}

const round = (n: number) => Math.round(n);

/**
 * Even-split a meal's estimated macros across its foods so each portion has a
 * numeric contribution the user can adjust. Servings start at 1, so the initial
 * totals equal the meal's estimate; stepping a portion recomputes from there.
 */
export function toEditableFoods(meal: {
  protein: number;
  kcal: number;
  carbs: number;
  fat: number;
  foods: { n: string; p: string }[];
}): EditableFood[] {
  const n = meal.foods.length || 1;
  return meal.foods.map((f) => ({
    name: f.n,
    portion: f.p,
    servings: 1,
    per: { protein: meal.protein / n, kcal: meal.kcal / n, carbs: meal.carbs / n, fat: meal.fat / n },
  }));
}

/** Sum the (servings × per-serving) macros across all foods, rounded for display. */
export function mealMacros(foods: EditableFood[]): MacroSet {
  const t = foods.reduce(
    (a, f) => ({
      protein: a.protein + f.servings * f.per.protein,
      kcal: a.kcal + f.servings * f.per.kcal,
      carbs: a.carbs + f.servings * f.per.carbs,
      fat: a.fat + f.servings * f.per.fat,
    }),
    { protein: 0, kcal: 0, carbs: 0, fat: 0 },
  );
  return { protein: round(t.protein), kcal: round(t.kcal), carbs: round(t.carbs), fat: round(t.fat) };
}

/**
 * Calories contributed by each macro as a share of the macro-derived total —
 * a factual composition (protein/carbs ×4, fat ×9), not an invented quality
 * sub-score. Always sums to ~100; an empty meal reads all zeros.
 */
export function macroComposition(m: MacroSet): { label: string; pct: number }[] {
  const pc = m.protein * 4;
  const cc = m.carbs * 4;
  const fc = m.fat * 9;
  const total = pc + cc + fc;
  const pct = (cal: number) => (total > 0 ? round((cal / total) * 100) : 0);
  return [
    { label: 'Protein', pct: pct(pc) },
    { label: 'Carbs', pct: pct(cc) },
    { label: 'Fat', pct: pct(fc) },
  ];
}

/**
 * A single, transparent meal-quality estimate driven by protein density (share of
 * calories from protein), the lever that matters most for an athlete's plate.
 * Recomputes on every edit; clamped 0-100. Deliberately simple and explainable
 * rather than a fabricated multi-factor "lab" score.
 */
export function mealQuality(m: MacroSet): number {
  const total = m.protein * 4 + m.carbs * 4 + m.fat * 9;
  if (total <= 0) return 0;
  const proteinShare = (m.protein * 4) / total;
  return Math.max(0, Math.min(100, round(40 + proteinShare * 160)));
}

/** Adjust a serving multiplier by delta, clamped to a sane 0-10 range, half steps. */
export function stepServings(current: number, delta: number): number {
  const next = Math.round((current + delta) * 2) / 2;
  return Math.max(0, Math.min(10, next));
}
