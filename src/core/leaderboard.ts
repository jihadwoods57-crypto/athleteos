// AthleteOS — leaderboard selector (pure). The athlete's own row score is live.
import { POS_BOARD, POS_BOARD_SCORES, TEAM_BOARD, TEAM_BOARD_SCORES } from './constants';
import type { LeaderRow, SquadMode } from './types';

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
export function buildLeaderboard(mode: SquadMode, athleteScore: number): LeaderRow[] {
  const base = mode === 'team' ? TEAM_BOARD : POS_BOARD;
  const scores = mode === 'team' ? TEAM_BOARD_SCORES : POS_BOARD_SCORES;
  // 1. Inject live score (other rows keep their static score by ORIGINAL rank).
  const rows = base.map((r) => ({
    ...r,
    score: r.you ? athleteScore : scores[r.rank],
  }));
  // 2. Sort by score DESC into a new array; tie-break on original rank ascending.
  // 3. Reassign rank from the re-sorted index.
  return rows
    .slice()
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
