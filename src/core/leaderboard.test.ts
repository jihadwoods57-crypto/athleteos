// AthleteOS — leaderboard selector tests. The athlete's own row reflects the live
// score, and the whole board is RE-RANKED by score so the medal + position are
// truthful (no more pinning the "you" row at its static rank).
import { buildLeaderboard, medalColor, trendInfo } from './leaderboard';
import {
  POS_BOARD,
  POS_BOARD_SCORES,
  TEAM_BOARD,
  TEAM_BOARD_SCORES,
} from './constants';

describe('medalColor', () => {
  it('gives gold/silver/bronze for the podium', () => {
    expect(medalColor(1)).toBe('#F59E0B');
    expect(medalColor(2)).toBe('#94A3B8');
    expect(medalColor(3)).toBe('#D97706');
  });

  it('falls back to slate for ranks off the podium', () => {
    expect(medalColor(4)).toBe('#CBD5E1');
    expect(medalColor(99)).toBe('#CBD5E1');
  });
});

describe('trendInfo', () => {
  it('maps direction to glyph + color', () => {
    expect(trendInfo('up')).toEqual({ t: '↑', c: '#22C55E' });
    expect(trendInfo('down')).toEqual({ t: '↓', c: '#EF4444' });
    expect(trendInfo('flat')).toEqual({ t: '→', c: '#94A3B8' });
  });
});

describe('buildLeaderboard — team mode', () => {
  // Static team scores: 96, 89, 86, 79, 68 (you-row filled live). With a live 73
  // the true standing is 96, 89, 86, 79, 73, 68 -> the athlete is rank 5.
  const board = buildLeaderboard('team', 73);

  it('keeps every row', () => {
    expect(board).toHaveLength(TEAM_BOARD.length);
  });

  it('injects the live score into the "you" row only; others keep static scores', () => {
    const you = board.find((r) => r.you)!;
    expect(you.score).toBe(73);
    // rank is now recomputed, so check non-you scores as a multiset, not by rank.
    expect(board.filter((r) => !r.you).map((r) => r.score).sort()).toEqual(
      Object.values(TEAM_BOARD_SCORES).sort(),
    );
  });

  it('reranks by live score — a 73 is NOT silver and sits below 89 & 86', () => {
    const you = board.find((r) => r.you)!;
    expect(you.rank).not.toBe(2);
    expect(you.rank).toBe(5);
    const r89 = board.find((r) => r.score === 89)!;
    const r86 = board.find((r) => r.score === 86)!;
    expect(r89.rank).toBeLessThan(you.rank);
    expect(r86.rank).toBeLessThan(you.rank);
  });

  it('ranks are contiguous 1..N in score-descending order', () => {
    expect(board.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    board.forEach((r, i) => {
      if (i > 0) expect(r.score).toBeLessThanOrEqual(board[i - 1].score);
    });
  });

  it('a perfect score floats the athlete to rank 1 / gold', () => {
    const b = buildLeaderboard('team', 100);
    const you = b.find((r) => r.you)!;
    expect(you.rank).toBe(1);
    expect(medalColor(you.rank)).toBe('#F59E0B');
  });

  it('a floor score drops the athlete to last / off-podium', () => {
    const b = buildLeaderboard('team', 0);
    const you = b.find((r) => r.you)!;
    expect(you.rank).toBe(TEAM_BOARD.length);
    expect(medalColor(you.rank)).toBe('#CBD5E1');
  });

  it('tie-break is deterministic: tied athlete (lower original rank) ranks above teammate', () => {
    // Athlete (original rank 2) ties Chris Patel (original rank 4) at 86.
    // Documented rule: lower original rank wins -> athlete ranks ABOVE Patel.
    // Standing: 96, 89, you=86, Patel=86, 79, 68 -> you.rank 3, Patel.rank 4.
    const b = buildLeaderboard('team', 86);
    const you = b.find((r) => r.you)!;
    const patel = b.find((r) => r.name === 'Chris Patel')!;
    expect(you.rank).toBeLessThan(patel.rank);
    expect(you.rank).toBe(3);
    expect(patel.rank).toBe(4);
  });

  it('returns a new array and does not mutate the source constant', () => {
    expect(buildLeaderboard('team', 73)).not.toBe(TEAM_BOARD);
    expect(TEAM_BOARD.every((r) => !('score' in r))).toBe(true);
  });
});

describe('buildLeaderboard — position mode', () => {
  // Static teammate scores: 79, 68 (you-row filled live).
  it('uses the smaller position board', () => {
    expect(buildLeaderboard('position', 88)).toHaveLength(POS_BOARD.length);
  });

  it('injects the live score for the athlete', () => {
    expect(buildLeaderboard('position', 88).find((r) => r.you)!.score).toBe(88);
  });

  it('keeps teammates on the position board scores', () => {
    const b = buildLeaderboard('position', 88);
    expect(b.filter((r) => !r.you).map((r) => r.score).sort()).toEqual(
      Object.values(POS_BOARD_SCORES).sort(),
    );
  });

  it('a low score drops the athlete below higher teammates', () => {
    // Standing: 79, 68, you=50 -> you.rank 3 (last); ranks contiguous.
    const b = buildLeaderboard('position', 50);
    const you = b.find((r) => r.you)!;
    expect(you.rank).toBe(3);
    expect(b.find((r) => r.score === 79)!.rank).toBeLessThan(you.rank);
    expect(b.find((r) => r.score === 68)!.rank).toBeLessThan(you.rank);
    expect(b.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('a perfect score floats to rank 1 + gold', () => {
    const b = buildLeaderboard('position', 100);
    const you = b.find((r) => r.you)!;
    expect(you.rank).toBe(1);
    expect(medalColor(you.rank)).toBe('#F59E0B');
  });

  it('does not mutate POS_BOARD', () => {
    expect(POS_BOARD.every((r) => !('score' in r))).toBe(true);
  });
});
