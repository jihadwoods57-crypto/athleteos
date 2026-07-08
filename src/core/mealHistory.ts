// OnStandard — meal history view model (pure TS, no RN / no Supabase import).
// Turns either the locally-logged day (demo / offline) or stored `meals` rows
// (backend live) into a single MealCard[] the client-history and coach-history
// surfaces both render, so the two screens stay byte-identical in look. Core stays
// the single projection authority; the screens only paint what this returns.
import type { AppState, MealKey, MealLabel, StoredMeal } from './types';
import { mealRowsFor } from './content';

export type { StoredMeal };

/** One rendered meal, identical shape whether it came from local state or the backend. */
export interface MealCard {
  /** Stable React key (date + slot, unique per meal). */
  id: string;
  label: string;
  name: string;
  protein: number;
  kcal: number;
  quality: number;
  /** Color-token fallback thumbnail (the app's existing per-slot colors). */
  thumb: string;
  /** Storage path of the photo, when one was uploaded; null otherwise. The screen
   *  resolves it to a signed URL (a lib concern) and falls back to `thumb`. */
  photoPath: string | null;
  /** Server row uuid (backend rows only) — present means the card can open the meal
   *  review + comment thread (0046). Null on local-only cards. */
  serverId: string | null;
  /** The AI's coach-voiced read for this meal (backend rows only). */
  note: string | null;
}

/** Meals for one calendar day, newest day first, with a friendly heading. */
export interface MealHistoryDay {
  dateKey: string;
  dayLabel: string;
  cards: MealCard[];
}

const SLOT_THUMB: Record<MealKey, string> = {
  breakfast: '#F59E0B',
  lunch: '#22C55E',
  snack: '#8B5CF6',
  dinner: '#EF4444',
};

const TYPE_TO_KEY: Record<string, MealKey> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'snack',
  dinner: 'dinner',
};

const LABELS: Record<MealKey, MealLabel> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a 'YYYY-MM-DD' stamp into a local Date (no UTC shift), or null if malformed. */
function parseStamp(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Friendly heading for a day stamp relative to `today`: "Today" / "Yesterday" /
 * "Mon, Jun 23". Pure: both stamps are passed in (today defaults via the caller).
 */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = parseStamp(date);
  const t = parseStamp(today);
  if (d && t) {
    const diffDays = Math.round((t.getTime() - d.getTime()) / 86_400_000);
    if (diffDays === 1) return 'Yesterday';
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  return date;
}

/** Map a stored meal row into a card. Missing macros read 0; an unknown slot type
 *  falls back to the dinner color so the row still renders (honest, never crashes). */
export function storedMealToCard(m: StoredMeal): MealCard {
  const key = TYPE_TO_KEY[(m.type ?? '').toLowerCase()] ?? 'dinner';
  return {
    id: `${m.day_date}-${m.type ?? 'meal'}`,
    label: LABELS[key],
    name: m.name?.trim() || LABELS[key],
    protein: Math.max(0, Math.round(m.protein ?? 0)),
    kcal: Math.max(0, Math.round(m.kcal ?? 0)),
    quality: Math.max(0, Math.round(m.quality ?? 0)),
    thumb: SLOT_THUMB[key],
    photoPath: m.photo_path,
    serverId: m.id ?? null,
    note: m.note ?? null,
  };
}

/**
 * Group stored meals into days, newest day first and, within a day, in slot order
 * (breakfast → dinner via logged_at). RLS already scoped the rows to the viewer.
 */
export function groupMealsByDay(meals: StoredMeal[], today: string): MealHistoryDay[] {
  const byDay = new Map<string, StoredMeal[]>();
  for (const m of meals) {
    const list = byDay.get(m.day_date) ?? [];
    list.push(m);
    byDay.set(m.day_date, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest day first
    .map(([dateKey, rows]) => ({
      dateKey,
      dayLabel: dayLabel(dateKey, today),
      cards: rows
        .slice()
        .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1))
        .map(storedMealToCard),
    }));
}

/**
 * The demo / offline client view: today's locally-logged meals as cards, from the
 * same source the Nutrition list uses (so the numbers agree). Only logged slots
 * appear; an unlogged day yields an empty list (honest empty state, no fabrication).
 */
export function localTodayCards(state: AppState): MealCard[] {
  return mealRowsFor(state)
    .filter((r) => r.logged)
    .map((r) => ({
      id: `local-${r.key}`,
      label: r.label,
      name: r.name,
      protein: r.protein,
      kcal: r.kcal,
      quality: r.quality,
      thumb: r.thumb,
      photoPath: null,
      serverId: null, // local-only card: no server row, so no comment thread to open
      note: null,
    }));
}
