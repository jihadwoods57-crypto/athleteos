/**
 * The meal outbox: the queue that makes a logged meal survive a closed app.
 *
 * These test the PURE half (queue math), which is where the decisions live — what may run, when a
 * retry is allowed, and which photo gets dropped when localStorage is full. The storage half is a
 * thin localStorage wrapper.
 *
 * The quota rule matters most: a capture is 150-250KB of base64 and localStorage is ~5MB, so
 * photos are the one thing that can genuinely overflow. When it does we must drop the OLDEST
 * photo, never the newest — the newest is the meal the athlete is looking at right now.
 */
const path = require('path');
const OUTBOX = path.join(__dirname, '..', '..', 'proto', 'redesign-2026-07', 'js', 'meal-outbox.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { jobKey, backoffMs, runnable, enqueue, dropJob, patchJob, trimPhotos, due } = require(OUTBOX);

const job = (over: Record<string, unknown> = {}) => ({
  k: 'u/2026-07-28/dinner', uid: 'u', date: '2026-07-28', slot: 'dinner',
  base64: 'xxx', needUpload: true, needInsert: true, needAnalysis: true,
  tries: 0, lastTryAt: 0, ...over,
});

describe('jobKey', () => {
  it('is one job per athlete-day-slot, so re-logging replaces rather than duplicates', () => {
    expect(jobKey('u', '2026-07-28', 'dinner')).toBe('u/2026-07-28/dinner');
    expect(enqueue([job()], job({ base64: 'yyy' })).length).toBe(1);
  });
});

describe('backoff', () => {
  it('doubles and then holds at 32 minutes', () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(1)).toBe(2 * 60_000);
    expect(backoffMs(5)).toBe(32 * 60_000);
    expect(backoffMs(50)).toBe(32 * 60_000);   // never runs away
  });
});

describe('runnable', () => {
  const NOW = 1_000_000_000;
  it('runs a fresh job immediately', () => {
    expect(runnable(job(), NOW)).toBe(true);
  });
  it('respects backoff after a failed try', () => {
    expect(runnable(job({ tries: 1, lastTryAt: NOW - 60_000 }), NOW)).toBe(false);
    expect(runnable(job({ tries: 1, lastTryAt: NOW - 3 * 60_000 }), NOW)).toBe(true);
  });
  it('does not run a job with nothing left to do', () => {
    expect(runnable(job({ needUpload: false, needInsert: false, needAnalysis: false }), NOW)).toBe(false);
  });
  it('does not run a dead job', () => {
    expect(runnable(job({ dead: 'quota' }), NOW)).toBe(false);
  });
  it('waits for the athlete when the model asked a question', () => {
    // Questions are answered in the thread; the job must not re-fire in the meantime.
    expect(runnable(job({ pendingQuestions: ['How much rice?'] }), NOW)).toBe(false);
    expect(runnable(job({ pendingQuestions: ['How much rice?'], answers: ['a cup'] }), NOW)).toBe(true);
  });
  it('due() returns only the runnable ones', () => {
    const list = [job({ k: 'a' }), job({ k: 'b', dead: 'quota' }), job({ k: 'c', tries: 2, lastTryAt: NOW })];
    expect(due(list, NOW).map((e: { k: string }) => e.k)).toEqual(['a']);
  });
});

describe('quota policy', () => {
  it('keeps the newest photos and strips the oldest', () => {
    const list = [job({ k: 'old' }), job({ k: 'mid' }), job({ k: 'new' })];
    const out = trimPhotos(list, 2);
    expect(out.find((e: { k: string }) => e.k === 'old').base64).toBeNull();
    expect(out.find((e: { k: string }) => e.k === 'mid').base64).toBe('xxx');
    expect(out.find((e: { k: string }) => e.k === 'new').base64).toBe('xxx');
  });
  it('a stripped job is marked dead with a reason, not silently forgotten', () => {
    const out = trimPhotos([job({ k: 'old' }), job({ k: 'a' }), job({ k: 'b' })], 2);
    const dropped = out.find((e: { k: string }) => e.k === 'old');
    expect(dropped.dead).toBe('quota');
    expect(dropped.needUpload).toBe(false);
    expect(dropped.needAnalysis).toBe(false);
    expect(out.length).toBe(3);   // the entry itself survives so the thread can explain it
  });
  it('does nothing when under budget', () => {
    const list = [job({ k: 'a' })];
    expect(trimPhotos(list, 2)).toEqual(list);
  });
});

describe('list ops are pure', () => {
  it('enqueue/drop/patch never mutate the input', () => {
    const list = [job({ k: 'a' })];
    const snapshot = JSON.stringify(list);
    enqueue(list, job({ k: 'b' }));
    dropJob(list, 'a');
    patchJob(list, 'a', { tries: 9 });
    trimPhotos(list, 0);
    expect(JSON.stringify(list)).toBe(snapshot);
  });
  it('patch updates only the addressed job', () => {
    const out = patchJob([job({ k: 'a' }), job({ k: 'b' })], 'b', { tries: 3 });
    expect(out.find((e: { k: string }) => e.k === 'a').tries).toBe(0);
    expect(out.find((e: { k: string }) => e.k === 'b').tries).toBe(3);
  });
});
