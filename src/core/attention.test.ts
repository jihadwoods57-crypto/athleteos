import {
  riskValue,
  riskTone,
  atRiskReason,
  needsAttention,
  rankByRisk,
  scoreLanguage,
} from './attention';
import { ROSTER, TRAINER_CLIENTS } from './constants';
import { COACH_ALERT_THRESHOLD } from './leaderboard';

describe('riskValue', () => {
  it('ranks a lower score / lower compliance as more at risk (smaller value)', () => {
    const worse = { name: 'a', score: 60, comp: 50, dir: 'flat' as const };
    const better = { name: 'b', score: 78, comp: 72, dir: 'flat' as const };
    expect(riskValue(worse)).toBeLessThan(riskValue(better));
  });

  it('a downward trend pulls an athlete up the list vs an identical upward one', () => {
    const base = { name: 'x', score: 75, comp: 70 };
    expect(riskValue({ ...base, dir: 'down' })).toBeLessThan(riskValue({ ...base, dir: 'up' }));
  });
});

describe('riskTone', () => {
  it('is a deep alert for a low score or low compliance, else a warning', () => {
    expect(riskTone({ name: 'a', score: 68, comp: 58, dir: 'down' })).toBe('alert'); // both low
    expect(riskTone({ name: 'b', score: 79, comp: 71, dir: 'down' })).toBe('warning'); // borderline
    expect(riskTone({ name: 'c', score: 65, comp: 90, dir: 'flat' })).toBe('alert'); // score < 70
  });
});

describe('atRiskReason', () => {
  it('leads with a compliance clause and is nutrition-first', () => {
    expect(atRiskReason({ name: 'a', score: 68, comp: 58, dir: 'down' })).toContain('58% compliant');
    expect(atRiskReason({ name: 'b', score: 74, comp: 0, dir: 'down' })).toContain('No meals logged');
  });

  it('adds a "days quiet" clause from the trainer recency label', () => {
    expect(atRiskReason({ name: 'a', score: 74, comp: 64, dir: 'down', last: '5 days ago' })).toContain('5 days quiet');
  });

  it('falls back to a trend clause when there is no stale recency', () => {
    const r = atRiskReason({ name: 'a', score: 79, comp: 71, dir: 'down' });
    expect(r).toContain('trending down');
    expect(r).not.toContain('quiet');
  });

  it('never contains an em dash (design ban)', () => {
    expect(atRiskReason({ name: 'a', score: 60, comp: 40, dir: 'down', last: '3 days ago' })).not.toContain('—');
  });
});

describe('needsAttention', () => {
  it('returns only athletes below the alert threshold, most-at-risk first', () => {
    const list = needsAttention(ROSTER);
    expect(list.every((a) => a.score < COACH_ALERT_THRESHOLD)).toBe(true);
    // M. Cole (68) is more at risk than A. Silva (79) -> sorts first.
    expect(list[0].name).toBe('M. Cole');
    expect(list[1].name).toBe('A. Silva');
  });

  it('length always equals the alerts/follow-ups KPI count (same predicate)', () => {
    const rosterAlerts = ROSTER.filter((r) => r.score < COACH_ALERT_THRESHOLD).length;
    expect(needsAttention(ROSTER).length).toBe(rosterAlerts);
    const bookFollowUps = TRAINER_CLIENTS.filter((c) => c.score < COACH_ALERT_THRESHOLD).length;
    expect(needsAttention(TRAINER_CLIENTS).length).toBe(bookFollowUps);
  });

  it('only surfaces real roster members (no phantom rows)', () => {
    const names = needsAttention(TRAINER_CLIENTS).map((a) => a.name);
    for (const n of names) expect(TRAINER_CLIENTS.some((c) => c.name === n)).toBe(true);
  });

  it('includes the live athlete once their own score drops below the line', () => {
    const tanked = ROSTER.map((r) => (r.you ? { ...r, score: 64 } : r));
    expect(needsAttention(tanked).some((a) => a.name === 'Jihad')).toBe(true);
  });

  it('carries a derived reason + tone on each row', () => {
    const row = needsAttention(ROSTER)[0];
    expect(row.reason.length).toBeGreaterThan(5);
    expect(['warning', 'alert']).toContain(row.tone);
  });
});

describe('rankByRisk', () => {
  it('orders a full roster worst-first (most at-risk leading)', () => {
    const ranked = rankByRisk(ROSTER);
    const values = ranked.map((r) => riskValue(r));
    // non-decreasing riskValue == worst (smallest) first
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    // the lowest-scoring at-risk athlete leads both the roster and Needs-Attention
    expect(ranked[0].name).toBe(needsAttention(ROSTER)[0].name);
  });

  it('keeps every member (a sort, not a filter) and does not mutate the input', () => {
    const before = [...TRAINER_CLIENTS];
    const ranked = rankByRisk(TRAINER_CLIENTS);
    expect(ranked.length).toBe(TRAINER_CLIENTS.length);
    expect(new Set(ranked.map((c) => c.name))).toEqual(new Set(TRAINER_CLIENTS.map((c) => c.name)));
    expect(TRAINER_CLIENTS).toEqual(before); // original order untouched
  });
});

describe('scoreLanguage', () => {
  it('matches the number to the spec language at 95 / 75 / 60', () => {
    expect(scoreLanguage(95)).toBe('On standard');
    expect(scoreLanguage(75)).toBe('On the bubble');
    expect(scoreLanguage(60)).toBe('Needs intervention');
  });

  it('is monotonic across the band edges', () => {
    expect(scoreLanguage(85)).toBe('On standard');
    expect(scoreLanguage(84)).toBe('On the bubble');
    expect(scoreLanguage(70)).toBe('On the bubble');
    expect(scoreLanguage(69)).toBe('Needs intervention');
  });
});
