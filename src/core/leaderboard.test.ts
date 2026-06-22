// AthleteOS — leaderboard selector tests. The athlete's own row must reflect
// the live score; everyone else stays on the static board.
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
  const board = buildLeaderboard('team', 73);

  it('keeps every row and preserves order', () => {
    expect(board).toHaveLength(TEAM_BOARD.length);
    expect(board.map((r) => r.rank)).toEqual(TEAM_BOARD.map((r) => r.rank));
  });

  it('injects the live score into the "you" row only', () => {
    const you = board.find((r) => r.you)!;
    expect(you.score).toBe(73);
  });

  it('leaves other rows on their static scores', () => {
    board
      .filter((r) => !r.you)
      .forEach((r) => expect(r.score).toBe(TEAM_BOARD_SCORES[r.rank]));
  });

  it('does not mutate the source constant', () => {
    expect(TEAM_BOARD.every((r) => !('score' in r))).toBe(true);
  });
});

describe('buildLeaderboard — position mode', () => {
  const board = buildLeaderboard('position', 88);

  it('uses the smaller position board', () => {
    expect(board).toHaveLength(POS_BOARD.length);
  });

  it('injects the live score for the athlete', () => {
    expect(board.find((r) => r.you)!.score).toBe(88);
  });

  it('keeps teammates on the position board scores', () => {
    board
      .filter((r) => !r.you)
      .forEach((r) => expect(r.score).toBe(POS_BOARD_SCORES[r.rank]));
  });
});
