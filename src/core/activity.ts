// OnStandard — Connected Standards: turning a health sample into progress against a target.
//
// PURE. No clock, no I/O, no native module. Same split src/lib/location/geofence.ts uses: the
// decision that matters is testable on a laptop, and the module that touches the device holds
// none of it.
//
// ⚠ CANONICAL UNITS, matching the 0155 column comment and the proto engine:
//   steps → count · distance → METRES · workouts → count · minutes → minutes.
// Miles exist only at the moment of rendering.
//
// ⚠ THIS FILE IS WHERE "WALK THREE MILES" AND "RUN THREE MILES" STOP BEING THE SAME THING.
// A conditioning standard that silently accepted a day of ambient walking would be worthless to
// a coach; a movement standard that silently rejected it would punish an honest day. The rule is
// the coach's to set (connected_standards.deliberate_workout) and it is applied here, once.

export type Workout = {
  startedAt: string;          // ISO
  endedAt: string;            // ISO
  durationMin: number;
  distanceMeters?: number;
  activityType?: string;      // platform's own label; only used for display
};

export type ActivitySample = {
  steps?: number;
  distanceMeters?: number;    // ambient: everything the platform attributes to walking + running
  activeMinutes?: number;
  activeEnergyKcal?: number;  // read for Phase Two; unused by any v1 metric
  workouts?: Workout[];
};

export type StandardDef = {
  metric: 'steps' | 'distance' | 'workouts' | 'workout_minutes' | 'active_minutes';
  deliberateWorkout?: boolean;
  workoutMinDurationMin?: number | null;
};

/** Workouts that clear the standard's minimum duration. A 4-minute "workout" is a mis-tap. */
export function qualifyingWorkouts(sample: ActivitySample | null, def: StandardDef): Workout[] {
  const min = def.workoutMinDurationMin ?? 0;
  return (sample?.workouts ?? []).filter(
    (w) => w && Number.isFinite(w.durationMin) && w.durationMin >= min);
}

/**
 * Progress toward the target, in the metric's canonical unit.
 *
 * Returns null — NOT zero — when the sample is missing entirely. The difference is the whole
 * feature: zero is a claim that the athlete did nothing, and null is an admission that we don't
 * know. Only the second is true when a watch hasn't synced, and only the second keeps the period
 * out of the denominator downstream.
 */
export function progressFromSample(sample: ActivitySample | null, def: StandardDef): number | null {
  if (!sample) return null;

  switch (def.metric) {
    case 'steps':
      return num(sample.steps);

    case 'distance':
      if (def.deliberateWorkout) {
        // Only distance recorded INSIDE a qualifying workout session. Ambient walking, however
        // much of it there was, is not the thing that was asked for.
        const w = qualifyingWorkouts(sample, def);
        if (!w.length && sample.workouts == null) return null;
        return w.reduce((t, x) => t + (Number(x.distanceMeters) || 0), 0);
      }
      return num(sample.distanceMeters);

    case 'workouts':
      if (sample.workouts == null) return null;
      return qualifyingWorkouts(sample, def).length;

    case 'workout_minutes':
      if (sample.workouts == null) return null;
      return qualifyingWorkouts(sample, def).reduce((t, x) => t + (Number(x.durationMin) || 0), 0);

    case 'active_minutes':
      return num(sample.activeMinutes);

    default:
      return null;
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The window to read, for a period that is still open.
 *
 * Local midnight to now, expressed as ISO instants. A weekly period starts on its own Monday, so
 * a phone that has been offline since Tuesday still reports the whole week when it wakes up
 * rather than only what happened after it reconnected.
 */
export function periodWindow(
  periodStartISO: string, nowISO: string, offsetMin: number,
): { fromISO: string; toISO: string } | null {
  const now = Date.parse(nowISO);
  if (!Number.isFinite(now)) return null;
  // Local midnight of the period's first day, converted back to an absolute instant.
  const startLocalMidnight = Date.parse(String(periodStartISO) + 'T00:00:00Z');
  if (!Number.isFinite(startLocalMidnight)) return null;
  const fromMs = startLocalMidnight - offsetMin * 60000;
  if (fromMs > now) return null;
  return { fromISO: new Date(fromMs).toISOString(), toISO: new Date(now).toISOString() };
}

/**
 * Weekly pace. Byte-for-byte the same contract as paceToGoal in the proto engine
 * (proto/redesign-2026-07/js/connected-standards.js) — the two are pinned to shared vectors in
 * activity.test.ts so the phone and the card can never disagree about whether someone is behind.
 */
export function paceToGoal(
  args: { target: number; progress: number; periodStartISO: string; periodEndISO: string; todayISO: string },
): { state: 'done' | 'ahead' | 'on_pace' | 'behind'; daysLeft: number; neededPerDay: number } | null {
  const dayNum = (iso: string) => Math.floor(Date.parse(String(iso) + 'T12:00:00Z') / 86400000);
  const start = dayNum(args.periodStartISO);
  const end = dayNum(args.periodEndISO);
  const today = dayNum(args.todayISO);
  if (![start, end, today].every(Number.isFinite)) return null;

  const total = end - start + 1;
  if (total <= 0) return null;

  const remaining = Math.max(0, args.target - args.progress);
  const daysLeft = Math.max(0, end - today + 1);
  const elapsed = Math.max(0, Math.min(total, today - start + 1));
  const expected = args.target * (elapsed / total);

  let state: 'done' | 'ahead' | 'on_pace' | 'behind';
  if (args.progress >= args.target) state = 'done';
  else if (daysLeft === 0) state = 'behind';
  // The same 5% band the card uses, so a rounding-sized delta never makes the two disagree.
  else if (args.progress > expected * 1.05) state = 'ahead';
  else if (args.progress < expected * 0.95) state = 'behind';
  else state = 'on_pace';

  return { state, daysLeft, neededPerDay: daysLeft > 0 ? remaining / daysLeft : remaining };
}
