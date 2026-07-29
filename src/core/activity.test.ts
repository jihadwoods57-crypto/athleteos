// Connected Standards activity math. Every case is a founder rule, not an implementation detail:
//   - a missing sample is NULL, never 0. Zero claims the athlete did nothing; null admits we
//     don't know, and only the second is true when a watch hasn't synced.
//   - "walk three miles" and "run three miles" are different requirements.
//   - a workout shorter than the coach's minimum is a mis-tap, not a session.
//   - pace here and pace on the athlete's card agree to the digit.
import {
  progressFromSample, qualifyingWorkouts, periodWindow, paceToGoal,
  type ActivitySample,
} from './activity';

const MI = 1609.344;
const EDT = -240;

const workout = (durationMin: number, distanceMeters?: number) => ({
  startedAt: '2026-07-28T22:00:00Z', endedAt: '2026-07-28T22:30:00Z',
  durationMin, distanceMeters,
});

describe('a missing sample is not a zero', () => {
  it('returns null when there is no sample at all', () => {
    expect(progressFromSample(null, { metric: 'steps' })).toBeNull();
    expect(progressFromSample(null, { metric: 'distance' })).toBeNull();
  });

  it('returns null for a metric the sample carries nothing about', () => {
    // The watch reported steps but the platform gave us no workout list — we know the step count
    // and we know nothing about workouts. Those must not collapse into the same answer.
    const sample: ActivitySample = { steps: 8000 };
    expect(progressFromSample(sample, { metric: 'steps' })).toBe(8000);
    expect(progressFromSample(sample, { metric: 'workouts' })).toBeNull();
    expect(progressFromSample(sample, { metric: 'workout_minutes' })).toBeNull();
  });

  it('reports a genuine zero when the platform actually said zero', () => {
    // An empty workout array is data: the day had no sessions. That IS zero, not unknown.
    const sample: ActivitySample = { workouts: [] };
    expect(progressFromSample(sample, { metric: 'workouts' })).toBe(0);
  });
});

describe('walking three miles and running three miles', () => {
  const sample: ActivitySample = {
    distanceMeters: 5 * MI,                       // a big day on foot
    workouts: [workout(31, 2.73 * MI)],           // one deliberate run inside it
  };

  it('an ambient distance standard counts the whole day', () => {
    expect(progressFromSample(sample, { metric: 'distance' })).toBeCloseTo(5 * MI, 3);
  });

  it('a workout distance standard counts ONLY the recorded session', () => {
    const p = progressFromSample(sample, { metric: 'distance', deliberateWorkout: true });
    expect(p).toBeCloseTo(2.73 * MI, 3);
  });

  it('a day of walking with no session does not satisfy a run', () => {
    const walkOnly: ActivitySample = { distanceMeters: 6 * MI, workouts: [] };
    expect(progressFromSample(walkOnly, { metric: 'distance', deliberateWorkout: true })).toBe(0);
    // …and the same day fully satisfies an ambient standard. Same athlete, same steps, two
    // different requirements — which is exactly why the card states the rule up front.
    expect(progressFromSample(walkOnly, { metric: 'distance' })).toBeCloseTo(6 * MI, 3);
  });
});

describe('the coach\'s minimum session length', () => {
  const sample: ActivitySample = {
    workouts: [workout(31, 2.7 * MI), workout(4, 0.2 * MI), workout(45, 3 * MI)],
  };

  it('drops sessions under the minimum', () => {
    expect(qualifyingWorkouts(sample, { metric: 'workouts', workoutMinDurationMin: 30 })).toHaveLength(2);
    expect(progressFromSample(sample, { metric: 'workouts', workoutMinDurationMin: 30 })).toBe(2);
  });

  it('counts everything when no minimum is set', () => {
    expect(progressFromSample(sample, { metric: 'workouts' })).toBe(3);
  });

  it('sums only qualifying minutes and qualifying distance', () => {
    expect(progressFromSample(sample, { metric: 'workout_minutes', workoutMinDurationMin: 30 })).toBe(76);
    const d = progressFromSample(sample, { metric: 'distance', deliberateWorkout: true, workoutMinDurationMin: 30 });
    expect(d).toBeCloseTo(5.7 * MI, 3);
  });
});

describe('the read window', () => {
  it('starts at local midnight of the period, not UTC midnight', () => {
    const w = periodWindow('2026-07-28', '2026-07-28T18:00:00Z', EDT)!;
    // Local midnight in EDT is 04:00 UTC the same day.
    expect(w.fromISO).toBe('2026-07-28T04:00:00.000Z');
    expect(w.toISO).toBe('2026-07-28T18:00:00.000Z');
  });

  it('covers a whole week so a phone offline since Tuesday still reports it all', () => {
    const w = periodWindow('2026-07-27', '2026-07-31T18:00:00Z', EDT)!;
    expect(w.fromISO).toBe('2026-07-27T04:00:00.000Z');
  });

  it('refuses a window that has not started yet rather than reading backwards', () => {
    expect(periodWindow('2026-08-10', '2026-07-28T18:00:00Z', EDT)).toBeNull();
    expect(periodWindow('2026-07-28', 'not-a-date', EDT)).toBeNull();
  });
});

describe('pace agrees with the athlete\'s card', () => {
  // These vectors are duplicated verbatim in the proto engine's own tests
  // (proto/redesign-2026-07/js/connected-standards.test.mjs). If one side changes, both fail.
  const base = { target: 12 * MI, periodStartISO: '2026-07-27', periodEndISO: '2026-08-02' };

  it('behind, with the catch-up figure', () => {
    const p = paceToGoal({ ...base, progress: 4 * MI, todayISO: '2026-07-30' })!;
    expect(p.state).toBe('behind');
    expect(p.daysLeft).toBe(4);
    expect(p.neededPerDay).toBeCloseTo(2 * MI, 3);
  });

  it('the 5% band absorbs a rounding-sized delta', () => {
    expect(paceToGoal({ ...base, progress: 6.8 * MI, todayISO: '2026-07-30' })!.state).toBe('on_pace');
    expect(paceToGoal({ ...base, progress: 6.4 * MI, todayISO: '2026-07-30' })!.state).toBe('behind');
  });

  it('ahead and done read differently', () => {
    expect(paceToGoal({ ...base, progress: 11 * MI, todayISO: '2026-07-30' })!.state).toBe('ahead');
    expect(paceToGoal({ ...base, progress: 12.4 * MI, todayISO: '2026-07-30' })!.state).toBe('done');
  });

  it('never divides by zero on or after the final day', () => {
    const last = paceToGoal({ ...base, progress: 4 * MI, todayISO: '2026-08-02' })!;
    expect(last.daysLeft).toBe(1);
    expect(Number.isFinite(last.neededPerDay)).toBe(true);
    const over = paceToGoal({ ...base, progress: 4 * MI, todayISO: '2026-08-05' })!;
    expect(over.daysLeft).toBe(0);
    expect(Number.isFinite(over.neededPerDay)).toBe(true);
  });
});
