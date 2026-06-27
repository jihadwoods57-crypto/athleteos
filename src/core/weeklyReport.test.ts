import { weeklyReport, weeklyReportText, weeklyReportFromState, MOVE_THRESHOLD, type WeeklyReportInput } from './weeklyReport';
import type { DayScore } from './types';

const strong: WeeklyReportInput = {
  name: 'Marcus Cole',
  scores: [88, 90, 86, 91, 89],
  priorAvg: 84,
  compliance: 92,
};

const tough: WeeklyReportInput = {
  name: 'Jordan Vance',
  scores: [55, 48, 60, 52],
  priorAvg: 70,
  compliance: 50,
  proteinMissed: 4,
  checkinDaysAgo: 5,
};

describe('weeklyReport — score + headline', () => {
  it('averages the completed days and bands a strong week', () => {
    const r = weeklyReport(strong);
    expect(r.avgScore).toBe(89); // round(mean)
    expect(r.daysLogged).toBe(5);
    expect(r.headline).toBe('Strong week');
    expect(r.status).toBe('On standard');
    expect(r.scoreLine).toContain('89');
    expect(r.scoreLine).toContain('5 days');
  });
  it('bands a mixed and a tough week', () => {
    expect(weeklyReport({ ...strong, scores: [72, 75, 78] }).headline).toBe('Mixed week');
    expect(weeklyReport(tough).headline).toBe('Tough week');
  });
  it('handles a single logged day grammatically', () => {
    const r = weeklyReport({ ...strong, scores: [80] });
    expect(r.scoreLine).toContain('1 day');
    expect(r.scoreLine).not.toContain('1 days');
  });
});

describe('weeklyReport — what moved', () => {
  it('reports an improvement past the threshold', () => {
    expect(weeklyReport(strong).movedLine).toBe('Up 5 points from last week.'); // 89 - 84
  });
  it('reports a decline past the threshold', () => {
    expect(weeklyReport(tough).movedLine).toContain('Down'); // ~54 vs 70
  });
  it('reads "holding steady" inside the threshold band', () => {
    const r = weeklyReport({ ...strong, scores: [85], priorAvg: 85 });
    expect(r.movedLine).toBe('Holding steady from last week.');
    expect(Math.abs(r.avgScore - 85)).toBeLessThan(MOVE_THRESHOLD);
  });
  it('sets a baseline when there is no prior week', () => {
    expect(weeklyReport({ ...strong, priorAvg: null }).movedLine).toContain('baseline');
    expect(weeklyReport({ ...strong, priorAvg: undefined }).movedLine).toContain('baseline');
  });
});

describe('weeklyReport — the single flag', () => {
  it('is null on a clean strong week', () => {
    expect(weeklyReport(strong).flag).toBeNull();
  });
  it('leads with the protein signal, nutrition-first', () => {
    expect(weeklyReport(tough).flag).toBe('Protein behind on 4 of 7 days.');
  });
  it('falls to low-compliance when protein is fine but logging slips', () => {
    const r = weeklyReport({ ...strong, compliance: 50, proteinMissed: 0 });
    expect(r.flag).toContain('slipping');
  });
  it('flags a stale check-in when protein + compliance are fine', () => {
    const r = weeklyReport({ ...strong, checkinDaysAgo: 6 });
    expect(r.flag).toBe('No check-in in 6 days.');
  });
  it('flags a fully stalled (no days logged) week first', () => {
    const r = weeklyReport({ ...strong, scores: [], proteinMissed: 4 });
    expect(r.daysLogged).toBe(0);
    expect(r.headline).toBe('No data yet');
    expect(r.flag).toContain('stalled');
    expect(r.movedLine).toContain('nothing to compare');
  });
});

describe('weeklyReport — resilience', () => {
  it('drops non-finite scores and clamps compliance', () => {
    const r = weeklyReport({ ...strong, scores: [80, NaN, 90], compliance: 250 });
    expect(r.daysLogged).toBe(2);
    expect(r.avgScore).toBe(85);
    expect(r.complianceLine).toContain('100%'); // clamped
  });
});

describe('weeklyReportText', () => {
  it('renders an exportable digest with no em dash', () => {
    const text = weeklyReportText(weeklyReport(tough));
    expect(text).toContain('Weekly report: Jordan Vance');
    expect(text).toContain('Tough week');
    expect(text).toContain('Flag:');
    expect(text).not.toContain('—');
  });
  it('says "No flags" when the week is clean', () => {
    expect(weeklyReportText(weeklyReport(strong))).toContain('No flags this week.');
  });
});

describe('weeklyReportFromState', () => {
  const mkHist = (scores: number[]): DayScore[] =>
    scores.map((s, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, score: s }));

  it('builds the digest from persisted score history (recent 7 vs prior 7)', () => {
    const hist = mkHist([78, 80, 82, 79, 81, 80, 80, 88, 90, 86, 91, 89, 87, 90]);
    const r = weeklyReportFromState({ name: 'Marcus', scoreHistory: hist, liveScore: 90, now: new Date(2026, 5, 27) });
    expect(r.daysLogged).toBe(7);
    expect(r.avgScore).toBe(89);
    expect(r.movedLine).toContain('Up'); // 89 vs prior 80
  });

  it('a brand-new athlete with no history reads the honest "No data yet"', () => {
    const r = weeklyReportFromState({ name: 'New', scoreHistory: [], liveScore: 0, now: new Date(2026, 5, 27) });
    expect(r.headline).toBe('No data yet');
    expect(r.daysLogged).toBe(0);
  });
});
