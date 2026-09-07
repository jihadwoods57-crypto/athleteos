// The absence half of accountability. Every one of these is about NOT sending: a false "you
// missed breakfast" costs far more than a miss we quietly let go, because it is the message that
// teaches an athlete the notifications are wrong.
import { missedTasks, missBody, coachDigestBody, GRACE_MIN } from './meal-miss';

const NOW = Date.parse('2026-09-07T18:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const ahead = (min: number) => new Date(NOW + min * 60000).toISOString();

describe('missedTasks', () => {
  it('reports a requirement whose window closed and was never done', () => {
    const out = missedTasks([{ id: 'lunch', done: false, dueAt: ago(90) }], NOW);
    expect(out).toEqual([{ id: 'lunch', dueAt: ago(90), minutesLate: 90 }]);
  });

  it('never reports something still ahead of its deadline', () => {
    expect(missedTasks([{ id: 'dinner', done: false, dueAt: ahead(120) }], NOW)).toEqual([]);
  });

  it('holds its tongue through the grace period', () => {
    expect(missedTasks([{ id: 'lunch', done: false, dueAt: ago(GRACE_MIN - 1) }], NOW)).toEqual([]);
    expect(missedTasks([{ id: 'lunch', done: false, dueAt: ago(GRACE_MIN) }], NOW)).toHaveLength(1);
  });

  it('never reports a requirement that was done, however late', () => {
    expect(missedTasks([{ id: 'lunch', done: true, dueAt: ago(300) }], NOW)).toEqual([]);
  });

  it('WITHOUT a deadline it says nothing — an older client must not produce false misses', () => {
    expect(missedTasks([{ id: 'lunch', done: false }], NOW)).toEqual([]);
    expect(missedTasks([{ id: 'lunch', done: false, dueAt: null }], NOW)).toEqual([]);
    expect(missedTasks([{ id: 'lunch', done: false, dueAt: 'sometime' }], NOW)).toEqual([]);
    expect(missedTasks([{ id: 'lunch', done: false, dueAt: 12345 }], NOW)).toEqual([]);
  });

  it('will not wake up after an outage and push about a whole forgotten day', () => {
    // Horizon bounds how far back a late cron may reach. Six meals from this morning are the
    // athlete's yesterday by now; naming them is noise, not accountability.
    const stale = missedTasks([{ id: 'breakfast', done: false, dueAt: ago(11 * 60) }], NOW);
    expect(stale).toEqual([]);
    expect(missedTasks([{ id: 'breakfast', done: false, dueAt: ago(5 * 60) }], NOW)).toHaveLength(1);
  });

  it('names the longest-neglected one first', () => {
    const out = missedTasks([
      { id: 'lunch', done: false, dueAt: ago(60) },
      { id: 'breakfast', done: false, dueAt: ago(240) },
    ], NOW);
    expect(out.map((m) => m.id)).toEqual(['breakfast', 'lunch']);
  });

  it('ignores junk rather than throwing on it', () => {
    expect(missedTasks(null, NOW)).toEqual([]);
    expect(missedTasks('breakfast', NOW)).toEqual([]);
    expect(missedTasks([null, 42, {}, { id: '' }], NOW)).toEqual([]);
  });
});

describe('missBody — an invitation to close the day, never a scolding', () => {
  it('names the thing and what is still open', () => {
    expect(missBody('Lunch', 45, 2)).toBe('Lunch is 45 minutes past its window. You still have 2 to go today.');
  });

  it('switches to hours once minutes stop being readable', () => {
    expect(missBody('Breakfast', 180, 1)).toContain('3 hours past');
  });

  it('when nothing else is open, it still says the log counts', () => {
    expect(missBody('Dinner', 60, 0)).toContain('It still counts if you log it.');
  });
});

describe('coachDigestBody — a count, never a push per miss', () => {
  it('says nothing when nobody missed', () => {
    expect(coachDigestBody([], 0)).toBe('');
  });

  it('names one, names a few, and counts the rest', () => {
    expect(coachDigestBody(['Marcus'], 1)).toBe('Marcus missed a requirement today.');
    expect(coachDigestBody(['Marcus', 'Dani'], 2)).toBe('Marcus, Dani missed requirements today.');
    expect(coachDigestBody(['Marcus', 'Dani', 'Ty', 'Sam', 'Jo'], 5))
      .toBe('Marcus, Dani, Ty and 2 more missed requirements today.');
  });
});
