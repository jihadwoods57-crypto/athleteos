// OnStandard — project real `days` rows into the coach roster view model (Stage D).
// Pure TS, no RN and no Supabase import: it takes a STRUCTURAL day shape so core stays
// independent of the lib layer (a DayRow satisfies LinkedDay). When the backend is live
// the coach dashboard maps fetchLinkedDays(today) through this instead of the seeded
// ROSTER; with the flag off it is never called and the seeded showcase is unchanged.
import type { RosterRow } from './constants';

/** The minimal slice of a `days` row this projection needs. DayRow matches it. */
export interface LinkedDay {
  athlete_id: string;
  score: number | null;
  meals?: Record<string, boolean> | null;
  hydration_l?: number | null;
  tasks?: Array<{ done: boolean }> | null;
  current_weight?: number | null;
}

/** Per-athlete display facts the days table does not carry (name/position come from
 *  the profile; dir needs history). Supplied by the caller; all optional. */
export interface AthleteMeta {
  name?: string;
  initials?: string;
  pos?: string;
  /** The athlete's prior recorded score, to derive a trend direction. */
  prevScore?: number;
}

/** Initials from a display name ("D. Brooks" -> "DB", "Jihad" -> "J"). */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

/** Day compliance %: the share of the day's tasks completed, 0..100. Falls back to
 *  the day's score when there are no tasks yet (a brand-new day), so an athlete who
 *  logged but has no task list still reads a sensible number rather than 0. */
export function dayCompliance(day: LinkedDay): number {
  const tasks = day.tasks ?? [];
  if (tasks.length === 0) return clampPct(day.score ?? 0);
  const done = tasks.filter((t) => t.done).length;
  return clampPct(Math.round((done / tasks.length) * 100));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function trendDir(score: number, prev?: number): RosterRow['dir'] {
  if (prev == null) return 'flat';
  if (score > prev) return 'up';
  if (score < prev) return 'down';
  return 'flat';
}

/**
 * Map the linked `days` rows (RLS already scoped them to this coach's roster) into the
 * dashboard's RosterRow[]. A row's mere presence for the queried date means the athlete
 * logged today (loggedToday: true); an athlete with no row is not in `days` at all, so
 * the caller adds "not logged" entries from the team membership list (a separate read).
 * Order is preserved; the Phase-5 filters and risk ranking then run on real rows.
 */
export function mapLinkedDaysToRoster(
  days: LinkedDay[],
  meta: (athleteId: string) => AthleteMeta | undefined = () => undefined,
): RosterRow[] {
  return days.map((d) => {
    const m = meta(d.athlete_id) ?? {};
    const name = m.name?.trim() || shortId(d.athlete_id);
    const score = clampPct(d.score ?? 0);
    return {
      name,
      initials: m.initials?.trim() || initialsFromName(name),
      pos: m.pos?.trim() || '',
      comp: dayCompliance(d),
      score,
      dir: trendDir(score, m.prevScore),
      loggedToday: true,
      athleteId: d.athlete_id,
    };
  });
}

/** A stable, human-ish fallback label from a uuid when no profile name is available. */
function shortId(id: string): string {
  return id ? `#${id.slice(0, 4)}` : '#????';
}

/** One active team member as the `team_roster` RPC returns it (0040). */
export interface RosterMember {
  athlete_id: string;
  athlete_name: string | null;
  position: string | null;
}

/**
 * The honest live roster: the ACTIVE MEMBERSHIP ∪ today's day rows. Every member
 * appears — an athlete who hasn't logged today renders `loggedToday: false` with
 * zeroes instead of vanishing (the silent athlete is the whole point of the
 * accountability read), and members carry their real name/position instead of a
 * uuid stub. Day rows from links outside the member list (e.g. a trainer's
 * practice client) are kept with the uuid fallback so nothing RLS granted us is
 * dropped. Trend direction compares today's score to yesterday's day row.
 */
export function buildLiveRoster(
  members: RosterMember[],
  today: LinkedDay[],
  yesterday: LinkedDay[],
): RosterRow[] {
  const todayById = new Map(today.map((d) => [d.athlete_id, d]));
  const prevById = new Map(yesterday.map((d) => [d.athlete_id, d]));

  const memberRows: RosterRow[] = members.map((m) => {
    const d = todayById.get(m.athlete_id);
    const name = m.athlete_name?.trim() || shortId(m.athlete_id);
    const prev = prevById.get(m.athlete_id)?.score;
    const score = d ? clampPct(d.score ?? 0) : 0;
    return {
      name,
      initials: initialsFromName(name),
      pos: m.position?.trim() || '',
      comp: d ? dayCompliance(d) : 0,
      score,
      dir: d ? trendDir(score, prev ?? undefined) : 'flat',
      loggedToday: d != null,
      athleteId: m.athlete_id,
    };
  });

  const memberIds = new Set(members.map((m) => m.athlete_id));
  const extraRows = mapLinkedDaysToRoster(
    today.filter((d) => !memberIds.has(d.athlete_id)),
    (id) => ({ prevScore: prevById.get(id)?.score ?? undefined }),
  );
  return [...memberRows, ...extraRows];
}
