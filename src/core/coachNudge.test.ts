// Pure tests for the client half of the Coach Voice nudge (0094 consumer). Locks the "when to ask"
// gate, the once-per-state signature, and that the payload only carries already-computed data.
// @ts-nocheck — importing an untyped proto ESM engine, same pattern as firstDayActivation.test.ts.
import { shouldNudge, nudgeSignature, nudgeData } from '../../proto/redesign-2026-07/js/coach-nudge.js';

const exec = (over) => ({
  met: 1, total: 4, score: 62, possible: 100,
  overdue: over ?? [{ id: 'lunch', title: 'Lunch', why: 'Closed at 2:00 **-8**' }],
  now: { id: 'dinner', title: 'Dinner', countdown: '3h 12m' },
});

describe('shouldNudge', () => {
  it('nudges when slipping (day not met + an overdue item)', () => {
    expect(shouldNudge(exec())).toBe(true);
  });
  it('no nudge on a fully met day', () => {
    expect(shouldNudge({ met: 4, total: 4, overdue: [] })).toBe(false);
  });
  it('no nudge when nothing overdue', () => {
    expect(shouldNudge({ met: 1, total: 4, overdue: [] })).toBe(false);
  });
  it('guards missing/garbage exec', () => {
    expect(shouldNudge(null)).toBe(false);
    expect(shouldNudge({})).toBe(false);
  });
});

describe('nudgeSignature', () => {
  it('is stable for the same state and order-independent on overdue ids', () => {
    const a = nudgeSignature('2026-07-20', exec([{ id: 'lunch' }, { id: 'weight' }]));
    const b = nudgeSignature('2026-07-20', exec([{ id: 'weight' }, { id: 'lunch' }]));
    expect(a).toBe(b);
  });
  it('changes when the met/total or date changes', () => {
    const base = nudgeSignature('2026-07-20', exec());
    expect(nudgeSignature('2026-07-21', exec())).not.toBe(base);
    expect(nudgeSignature('2026-07-20', { ...exec(), met: 2 })).not.toBe(base);
  });
});

describe('nudgeData', () => {
  it('carries only already-computed fields and strips why markers', () => {
    const d = nudgeData(exec(), '2026-07-20');
    expect(d.date).toBe('2026-07-20');
    expect(d.remaining).toBe(3);
    expect(d.overdue[0]).toEqual({ title: 'Lunch', why: 'Closed at 2:00 -8' });
    expect(d.now).toEqual({ title: 'Dinner', dueIn: '3h 12m' });
  });
  it('now is null when there is no current item', () => {
    expect(nudgeData({ ...exec(), now: null }, '2026-07-20').now).toBeNull();
  });
});
