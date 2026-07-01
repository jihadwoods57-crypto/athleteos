// OnStandard — leaderboard selector (pure). The athlete's own row score is live.
import { POS_BOARD, POS_BOARD_SCORES, TEAM_BOARD, TEAM_BOARD_SCORES } from './constants';
import type { ClientRow, RosterRow } from './constants';
import type { LeaderRow, SquadMode, TrendDir } from './types';

const MEDAL: Record<number, string> = { 1: '#F59E0B', 2: '#94A3B8', 3: '#D97706' };

export function medalColor(rank: number): string {
  return MEDAL[rank] ?? '#CBD5E1';
}

export interface Trend {
  t: string;
  c: string;
}
export function trendInfo(dir: LeaderRow['dir']): Trend {
  if (dir === 'up') return { t: '↑', c: '#22C55E' };
  if (dir === 'down') return { t: '↓', c: '#EF4444' };
  return { t: '→', c: '#94A3B8' };
}

/**
 * Build the active leaderboard, injecting the athlete's live score into their row
 * and then RE-RANKING every row by score so the medal + position tell the truth.
 *
 * Steps:
 *  1. Map the base board to rows, injecting the live score into the you-row and
 *     keeping every other row on its static score keyed by its ORIGINAL rank.
 *  2. Sort all rows by score DESCENDING into a NEW array (source constants are
 *     never mutated — map() already produced fresh objects, and .slice() makes
 *     the no-mutate intent explicit). Tie-break: PRESERVE ORIGINAL RANK ORDER
 *     (lower original rank wins on equal score). This is deterministic and means
 *     a tied athlete lands ABOVE an equal-scoring teammate of higher original
 *     rank and BELOW one of lower original rank. The comparator reads a.rank /
 *     b.rank, which are still the ORIGINAL ranks here because reassignment (step
 *     3) runs only after the sort.
 *  3. Reassign rank = index + 1 across the sorted array so rank reflects the
 *     live standing. medalColor keeps keying off rank, so the medal follows the
 *     true standing automatically.
 */
/** Score at/below which a roster athlete is flagged as "needs attention". */
export const COACH_ALERT_THRESHOLD = 80;

export interface CoachKpis {
  /** Mean roster accountability score, rounded. */
  avgScore: number;
  /** Mean roster compliance %, rounded. */
  compliance: number;
  /** Count of athletes scoring below COACH_ALERT_THRESHOLD. */
  alerts: number;
}

/**
 * Pure Coach-dashboard KPIs over the LIVE roster (the you-row already carries the
 * athlete's live score). Team average + compliance react when the athlete's own
 * number moves, and the alerts count tracks how many athletes sit below the
 * attention threshold — so the header KPIs can never drift from the roster below.
 */
export function coachRosterKpis(roster: RosterRow[]): CoachKpis {
  if (roster.length === 0) return { avgScore: 0, compliance: 0, alerts: 0 };
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    avgScore: avg(roster.map((r) => r.score)),
    compliance: avg(roster.map((r) => r.comp)),
    alerts: roster.filter((r) => r.score < COACH_ALERT_THRESHOLD).length,
  };
}

export interface TrainerKpis {
  /** Number of active clients in the book. */
  clients: number;
  /** Mean client book-compliance %, rounded. */
  avgCompliance: number;
  /** Count of clients scoring below COACH_ALERT_THRESHOLD (retention risks). */
  followUps: number;
}

/**
 * Pure Trainer-dashboard KPIs over the client book. The header CLIENTS count, the
 * AVG COMPLY KPI, and the Book Compliance headline all derive from TRAINER_CLIENTS
 * so they can never drift from the client list rendered below (the same discipline
 * applied to the Coach roster KPIs). RETENTION is a business metric with no per-row
 * source, so it stays a presentation constant in the view.
 */
export function trainerBookKpis(clients: ClientRow[]): TrainerKpis {
  if (clients.length === 0) return { clients: 0, avgCompliance: 0, followUps: 0 };
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    clients: clients.length,
    avgCompliance: avg(clients.map((c) => c.comp)),
    followUps: clients.filter((c) => c.score < COACH_ALERT_THRESHOLD).length,
  };
}

/** Live identity for the athlete's own leaderboard row (their display name +
 *  avatar monogram). When omitted, the you-row keeps its seed name/initials. */
export interface YouIdentity {
  name?: string;
  initials?: string;
}

export function buildLeaderboard(
  mode: SquadMode,
  athleteScore: number,
  youDir?: TrendDir,
  youIdentity?: YouIdentity,
): LeaderRow[] {
  const base = mode === 'team' ? TEAM_BOARD : POS_BOARD;
  const scores = mode === 'team' ? TEAM_BOARD_SCORES : POS_BOARD_SCORES;
  // 1. Inject the athlete's live score AND, when supplied, their live trend
  //    direction + display identity into the you-row (the other rows keep their
  //    static demo score, trend, and name by ORIGINAL rank). Passing `youDir`
  //    lets the you-row's arrow track the same real score history the Home trend
  //    draws; `youIdentity` keeps the name + monogram in sync with the athlete's
  //    onboarded profile instead of the frozen "Jihad" / "J" seed.
  const rows = base.map((r) => ({
    ...r,
    score: r.you ? athleteScore : scores[r.rank],
    dir: r.you && youDir ? youDir : r.dir,
    name: r.you && youIdentity?.name ? youIdentity.name : r.name,
    initials: r.you && youIdentity?.initials ? youIdentity.initials : r.initials,
  }));
  // 2. Sort by score DESC into a new array; tie-break on original rank ascending.
  // 3. Reassign rank from the re-sorted index.
  return rows
    .slice()
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
