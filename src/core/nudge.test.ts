// OnStandard — pure tests for the overseer nudge acknowledgement read. The model
// is deterministic + offline: it records the athlete's compliance at send-time
// and derives "did anything move since" honestly from live data, never inventing
// an athlete response. See core/nudge.ts.
import { findNudge, nudgeOutcome, nudgeTrail, type NudgeRecord } from './nudge';

const rec = (over: Partial<NudgeRecord> = {}): NudgeRecord => ({
  name: 'Andre Silva',
  day: '2026-06-24',
  comp: 64,
  score: 71,
  ...over,
});

describe('nudgeTrail', () => {
  it('reads "Nudged today" with no note', () => {
    expect(nudgeTrail(rec())).toBe('Nudged today');
  });
  it('includes the attached note in quotes', () => {
    expect(nudgeTrail(rec({ note: 'Eat before practice' }))).toBe('Nudged today: “Eat before practice”');
  });
  it('treats a blank note as no note', () => {
    expect(nudgeTrail(rec({ note: '   ' }))).toBe('Nudged today');
  });
});

describe('findNudge', () => {
  it('returns the matching record', () => {
    const log = [rec({ name: 'Marcus Cole' }), rec({ name: 'Andre Silva' })];
    expect(findNudge(log, 'Andre Silva')?.name).toBe('Andre Silva');
  });

  it('returns undefined when the athlete was not nudged', () => {
    expect(findNudge([rec()], 'Nobody')).toBeUndefined();
  });

  it('returns undefined on an empty log', () => {
    expect(findNudge([], 'Andre Silva')).toBeUndefined();
  });
});

describe('nudgeOutcome', () => {
  it('reads an honest "no change yet" when live compliance equals the baseline', () => {
    const o = nudgeOutcome(rec({ comp: 64 }), 64);
    expect(o.improved).toBe(false);
    expect(o.compDelta).toBe(0);
    expect(o.label).toMatch(/no change yet/i);
    expect(o.label).toMatch(/follow up/i);
  });

  it('reports improvement once live compliance has risen', () => {
    const o = nudgeOutcome(rec({ comp: 64 }), 71);
    expect(o.improved).toBe(true);
    expect(o.compDelta).toBe(7);
    expect(o.label).toBe('Up 7% compliance since your nudge');
  });

  it('reports a decline as a follow-up, not as improvement', () => {
    const o = nudgeOutcome(rec({ comp: 64 }), 60);
    expect(o.improved).toBe(false);
    expect(o.compDelta).toBe(-4);
    expect(o.label).toMatch(/down 4%/i);
    expect(o.label).toMatch(/follow up/i);
  });

  it('rounds fractional compliance movement to whole points', () => {
    const o = nudgeOutcome(rec({ comp: 64 }), 66.4);
    expect(o.compDelta).toBe(2);
    expect(o.improved).toBe(true);
  });

  it('never claims movement the data does not show (static demo stays honest)', () => {
    // The static demo roster: live compliance never differs from the baseline.
    for (const comp of [40, 55, 64, 80, 95]) {
      expect(nudgeOutcome(rec({ comp }), comp).improved).toBe(false);
    }
  });
});

describe('nudgeMessageFor (one-tap outreach default)', () => {
  const { nudgeMessageFor } = require('./nudge');
  it('speaks to the silent athlete without guilt', () => {
    const msg = nudgeMessageFor({ comp: 0 });
    expect(msg).toContain('start with your next meal');
    expect(msg).not.toContain('—');
  });
  it('names the protein signal supportively', () => {
    expect(nudgeMessageFor({ comp: 55, proteinMissed: 3 })).toContain('Protein');
  });
  it('asks for the overdue check-in', () => {
    expect(nudgeMessageFor({ comp: 62, checkinDaysAgo: 4 })).toContain('check-in');
  });
  it('defaults to a near-goal encouragement', () => {
    expect(nudgeMessageFor({ comp: 74 })).toContain('back on standard');
  });
});
