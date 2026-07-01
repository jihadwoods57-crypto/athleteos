// OnStandard — leaderboard selector tests. The athlete's own row reflects the live
// score, and the whole board is RE-RANKED by score so the medal + position are
// truthful (no more pinning the "you" row at its static rank).
import { buildLeaderboard, coachRosterKpis, medalColor, trainerBookKpis, trendInfo } from './leaderboard';
import {
  POS_BOARD,
  POS_BOARD_SCORES,
  ROSTER,
  TEAM_BOARD,
  TEAM_BOARD_SCORES,
  TRAINER_CLIENTS,
} from './constants';
import type { ClientRow, RosterRow } from './constants';

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

describe('coachRosterKpis', () => {
  const mk = (score: number, comp: number): RosterRow => ({
    name: 'x', initials: 'X', pos: 'LB', comp, score, dir: 'flat',
  });

  it('averages score + compliance and counts athletes below the alert threshold', () => {
    const roster = [mk(90, 100), mk(80, 80), mk(70, 60), mk(60, 40)];
    // avg score (90+80+70+60)/4 = 75; compliance (100+80+60+40)/4 = 70.
    // below 80: 70 and 60 -> 2 alerts (80 is NOT below the threshold).
    expect(coachRosterKpis(roster)).toEqual({ avgScore: 75, compliance: 70, alerts: 2 });
  });

  it('reacts to the live you-score (lower score drops the avg and can add an alert)', () => {
    const base = ROSTER.map((r) => (r.you ? { ...r, score: 92 } : r));
    const tanked = ROSTER.map((r) => (r.you ? { ...r, score: 55 } : r));
    const a = coachRosterKpis(base);
    const b = coachRosterKpis(tanked);
    expect(b.avgScore).toBeLessThan(a.avgScore);
    expect(b.alerts).toBe(a.alerts + 1); // the athlete crosses below 80
  });

  it('is safe on an empty roster', () => {
    expect(coachRosterKpis([])).toEqual({ avgScore: 0, compliance: 0, alerts: 0 });
  });
});

describe('trainerBookKpis', () => {
  const mk = (score: number, comp: number): ClientRow => ({
    name: 'x', initials: 'X', org: 'Independent', sport: 'LB', comp, score, last: 'Today', dir: 'flat',
  });

  it('counts the book, averages compliance, and flags below-threshold clients', () => {
    const book = [mk(90, 96), mk(85, 80), mk(74, 64), mk(60, 40)];
    // clients = 4; compliance (96+80+64+40)/4 = 70; below 80 by score: 74 and 60 -> 2.
    expect(trainerBookKpis(book)).toEqual({ clients: 4, avgCompliance: 70, followUps: 2 });
  });

  it('matches the real client fixture (header can never drift from the list)', () => {
    const k = trainerBookKpis(TRAINER_CLIENTS);
    expect(k.clients).toBe(TRAINER_CLIENTS.length);
    // compliance is the mean of the fixture comps, rounded.
    const mean = Math.round(TRAINER_CLIENTS.reduce((a, c) => a + c.comp, 0) / TRAINER_CLIENTS.length);
    expect(k.avgCompliance).toBe(mean);
    expect(k.followUps).toBe(TRAINER_CLIENTS.filter((c) => c.score < 80).length);
  });

  it('is safe on an empty book', () => {
    expect(trainerBookKpis([])).toEqual({ clients: 0, avgCompliance: 0, followUps: 0 });
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

describe('buildLeaderboard — live you-row trend (youDir)', () => {
  it('overrides ONLY the you-row arrow when a live direction is supplied', () => {
    // TEAM_BOARD seeds the you-row at dir 'up'; force it 'down'.
    const b = buildLeaderboard('team', 73, 'down');
    expect(b.find((r) => r.you)!.dir).toBe('down');
  });

  it('leaves every other row on its static demo trend', () => {
    const live = buildLeaderboard('team', 73, 'down');
    const base = buildLeaderboard('team', 73);
    // Match non-you rows by name so a re-rank can not confuse the comparison.
    for (const row of live.filter((r) => !r.you)) {
      const same = base.find((r) => r.name === row.name)!;
      expect(row.dir).toBe(same.dir);
    }
  });

  it('falls back to the constant you-row trend when no direction is passed', () => {
    const you = buildLeaderboard('position', 88).find((r) => r.you)!;
    expect(you.dir).toBe(POS_BOARD.find((r) => r.you)!.dir);
  });

  it('passes a flat live trend straight through to the you-row', () => {
    expect(buildLeaderboard('position', 88, 'flat').find((r) => r.you)!.dir).toBe('flat');
  });
});

describe('buildLeaderboard — live you-row identity (youIdentity)', () => {
  it('overrides ONLY the you-row name + initials when an identity is supplied', () => {
    const b = buildLeaderboard('team', 73, undefined, { name: 'Jihad Woods', initials: 'JW' });
    const you = b.find((r) => r.you)!;
    expect(you.name).toBe('Jihad Woods');
    expect(you.initials).toBe('JW');
  });

  it('leaves every other row on its seed name + initials', () => {
    const live = buildLeaderboard('team', 73, undefined, { name: 'Jihad Woods', initials: 'JW' });
    const base = buildLeaderboard('team', 73);
    // Other rows keep their demo identity; the you-row is the only one renamed.
    const baseOthers = base.filter((r) => !r.you).map((r) => r.initials).sort();
    const liveOthers = live.filter((r) => !r.you).map((r) => r.initials).sort();
    expect(liveOthers).toEqual(baseOthers);
  });

  it('falls back to the seed identity when no identity is passed', () => {
    const you = buildLeaderboard('position', 88).find((r) => r.you)!;
    const seed = POS_BOARD.find((r) => r.you)!;
    expect(you.name).toBe(seed.name);
    expect(you.initials).toBe(seed.initials);
  });

  it('ignores partial/blank identity fields and keeps the seed for them', () => {
    const you = buildLeaderboard('team', 73, undefined, { name: '', initials: 'ZZ' }).find((r) => r.you)!;
    const seed = TEAM_BOARD.find((r) => r.you)!;
    expect(you.name).toBe(seed.name); // empty name ignored
    expect(you.initials).toBe('ZZ');
  });
});
