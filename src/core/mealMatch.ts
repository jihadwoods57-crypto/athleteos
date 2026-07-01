// OnStandard — "your usuals" matcher (pure TS, no RN / no Supabase import).
//
// Real athletes eat the same 10-15 meals on repeat ("Garvey plate", "double chicken bowl from
// Chipotle", "the post-lift shake"). When they're logging one of those again, the most accurate
// number isn't a fresh photo estimate — it's the macros THEY already confirmed last time. This
// groups the athlete's own recent stored meals into repeat "usuals" so the capture screen can
// offer a one-tap reuse that skips the model call (and its daily-cap slot) entirely.
//
// Deterministic and explainable: group by normalized name, prefer the current slot, then
// frequency, then recency. Lives in core (the projection authority) so it's unit-tested.
import type { MealLabel, StoredMeal } from './types';
import type { MealResult } from './content';

export interface UsualMeal {
  /** Display name, taken from the most recent logging of this meal. */
  name: string;
  /** The slot this meal is most often logged in. */
  slot: MealLabel;
  protein: number;
  kcal: number;
  carbs: number;
  fat: number;
  quality: number;
  /** How many times it appears in the recent window (frequency). */
  count: number;
  /** day_date of the most recent logging (recency). */
  lastLogged: string;
}

const SLOT_LABEL: Record<string, MealLabel> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

/** Normalize a meal name for grouping: lowercase, strip punctuation, collapse whitespace. */
function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nn(x: number | null | undefined): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
}

interface Group extends UsualMeal {
  slotCounts: Record<string, number>;
}

/**
 * The athlete's repeat meals ("usuals"), ranked for `slot`. Groups `recent` stored meals by
 * normalized name; each group's macros come from its MOST RECENT logging (the latest confirmed
 * portion). Ranking: meals usually eaten in the current slot first, then most frequent, then
 * most recent. Meals seen only once are excluded (not yet a "usual"). Pure.
 */
export function matchUsuals(recent: StoredMeal[], slot: MealLabel, limit = 3): UsualMeal[] {
  const groups = new Map<string, Group>();
  for (const m of recent) {
    const name = (m.name ?? '').trim();
    const key = normName(name);
    if (!key) continue; // unnamed rows can't be matched
    const slotLabel = SLOT_LABEL[(m.type ?? '').toLowerCase()] ?? 'Dinner';
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        name,
        slot: slotLabel,
        protein: nn(m.protein),
        kcal: nn(m.kcal),
        carbs: nn(m.carbs),
        fat: nn(m.fat),
        quality: nn(m.quality),
        count: 1,
        lastLogged: m.day_date,
        slotCounts: { [slotLabel]: 1 },
      });
      continue;
    }
    g.count++;
    g.slotCounts[slotLabel] = (g.slotCounts[slotLabel] ?? 0) + 1;
    // Keep the most recent logging as the representative macros/name (latest confirmed portion).
    if (m.day_date >= g.lastLogged) {
      g.lastLogged = m.day_date;
      g.name = name;
      g.protein = nn(m.protein);
      g.kcal = nn(m.kcal);
      g.carbs = nn(m.carbs);
      g.fat = nn(m.fat);
      g.quality = nn(m.quality);
    }
  }

  return [...groups.values()]
    .filter((g) => g.count >= 2) // a "usual" is something eaten more than once
    .map((g) => {
      const topSlot = (Object.entries(g.slotCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.slot) as MealLabel;
      const { slotCounts: _slotCounts, ...usual } = g;
      return { ...usual, slot: topSlot };
    })
    .sort((a, b) => {
      const aInSlot = a.slot === slot ? 1 : 0;
      const bInSlot = b.slot === slot ? 1 : 0;
      if (aInSlot !== bInSlot) return bInSlot - aInSlot; // current slot first
      if (a.count !== b.count) return b.count - a.count; // more frequent
      return a.lastLogged < b.lastLogged ? 1 : -1; // more recent
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Build a MealResult from a usual so picking it flows through the SAME log path as a fresh
 * analysis (mealResultToFood -> saveMeal), reusing the athlete's own confirmed macros with no
 * model call. Confidence is 'high' — these are numbers they already logged.
 */
export function usualToResult(u: UsualMeal): MealResult {
  return {
    name: u.name,
    quality: u.quality,
    protein: u.protein,
    kcal: u.kcal,
    carbs: u.carbs,
    fat: u.fat,
    detected: [u.name],
    note: `Reused from your history. Same numbers you logged before.`,
    confidence: 'high',
    descriptionSignal: 'match',
  };
}
