// AthleteOS — roster filtering for the coach/trainer dashboard at scale.
// Pure helpers so a 40+ athlete roster can be sliced by position group, searched
// by name, and narrowed to "who hasn't logged today" without any UI-side logic.
import type { RosterRow } from './constants';

/** Distinct position groups present in a roster, in first-seen order. */
export function rosterGroups(roster: RosterRow[]): string[] {
  const seen: string[] = [];
  for (const r of roster) {
    const g = r.pos.trim();
    if (g && !seen.includes(g)) seen.push(g);
  }
  return seen;
}

export interface RosterFilter {
  /** Position group to keep, or null/undefined for all groups. */
  group?: string | null;
  /** Case-insensitive name search; blank/whitespace matches everyone. */
  query?: string;
  /** Keep only athletes who have not logged today. */
  notLoggedOnly?: boolean;
}

/**
 * Apply a group + search + not-logged filter to a roster, preserving order.
 * `loggedToday === false` means "has not logged today"; an undefined flag is
 * treated as logged (so real rows without the field are never falsely flagged).
 */
export function filterRoster(roster: RosterRow[], f: RosterFilter): RosterRow[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return roster.filter((r) => {
    if (f.group && r.pos !== f.group) return false;
    if (f.notLoggedOnly && r.loggedToday !== false) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Count of athletes who have not logged today (`loggedToday === false`). */
export function notLoggedCount(roster: RosterRow[]): number {
  return roster.filter((r) => r.loggedToday === false).length;
}

export interface RosterGroupStat {
  group: string;
  count: number;
  avgScore: number;
  avgCompliance: number;
}

/**
 * Per-position-group rollup (count, average Execution Score, average compliance) for the coach
 * Reports position-comparison. Groups in first-seen order; averages rounded to whole numbers.
 * Pure: no UI logic, reads only the roster rows the dashboard already has.
 */
export function rosterGroupStats(roster: RosterRow[]): RosterGroupStat[] {
  return rosterGroups(roster).map((group) => {
    const rows = roster.filter((r) => r.pos === group);
    const n = rows.length || 1;
    const avg = (sel: (r: RosterRow) => number) => Math.round(rows.reduce((sum, r) => sum + sel(r), 0) / n);
    return { group, count: rows.length, avgScore: avg((r) => r.score), avgCompliance: avg((r) => r.comp) };
  });
}
