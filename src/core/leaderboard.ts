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

/** Build the active leaderboard, injecting the athlete's live score into their row. */
export function buildLeaderboard(mode: SquadMode, athleteScore: number): LeaderRow[] {
  const base = mode === 'team' ? TEAM_BOARD : POS_BOARD;
  const scores = mode === 'team' ? TEAM_BOARD_SCORES : POS_BOARD_SCORES;
  return base.map((r) => ({
    ...r,
    score: r.you ? athleteScore : scores[r.rank],
  }));
}
