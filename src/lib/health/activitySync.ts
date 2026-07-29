/* OnStandard — Connected Standards: the device→server sync.
 *
 * Everything that talks to the OS lives in ./index.ts; every DECISION lives in core/activity.ts,
 * which is pure and tested. This file is the thin thing in between.
 *
 * WHY THIS WRITES TO SUPABASE DIRECTLY
 * A step goal crossed at 6:40 PM wakes the app in the background — the WebView that renders the
 * UI may not exist at that moment. Routing progress through the bridge would mean an athlete who
 * hadn't opened the app that day (i.e. exactly the athlete a movement standard is for) never gets
 * verified, and the deadline cron would later find no fresh sync and park them in 'awaiting_sync'
 * forever. So this calls submit_activity_progress itself and the UI catches up on next load.
 * The same reasoning src/lib/location/index.ts documents for geofences applies verbatim.
 *
 * WHAT LEAVES THE DEVICE: a number, a timestamp, and an instance id. Never a sample, never a
 * workout route, never a heart rate. The comparison to the coach's target happens SERVER-side
 * against the snapshot; this only reports how far the athlete got.
 *
 * ⚠ NULL IS NOT ZERO. When readActivity can't read, this sends nothing at all rather than
 * reporting 0 — a posted zero is evidence of a shortfall, and "the watch is asleep" is not
 * evidence of anything. That single branch is what keeps a dead battery out of the miss column.
 */
import { supabase } from '../supabase';
import { isHealthAvailable, readActivity } from './index';
import { progressFromSample, periodWindow, type StandardDef } from '@/core/activity';

/** One open period the device can report on. Mirrors a row of my_connected_standards. */
export type SyncTarget = {
  instanceId: string;
  periodStartISO: string;
  metric: StandardDef['metric'];
  deliberateWorkout?: boolean;
  workoutMinDurationMin?: number | null;
};

export type SyncResult = { attempted: number; posted: number; skipped: number };

/** The device's UTC offset in minutes (EDT = -240). */
const offsetMin = () => -new Date().getTimezoneOffset();

/**
 * Read each open period and post whatever the platform actually knows.
 *
 * Called on foreground and from the observer wake. Best-effort by construction: a period that
 * cannot be read is SKIPPED, never posted as zero, and never throws — a sync failure must leave
 * the athlete's record exactly as it was.
 */
export async function syncActivity(targets: SyncTarget[], nowISO = new Date().toISOString()): Promise<SyncResult> {
  const out: SyncResult = { attempted: 0, posted: 0, skipped: 0 };
  if (!supabase || !isHealthAvailable || !Array.isArray(targets) || !targets.length) return out;

  const off = offsetMin();
  for (const t of targets) {
    out.attempted++;
    try {
      const window = periodWindow(t.periodStartISO, nowISO, off);
      if (!window) { out.skipped++; continue; }

      const sample = await readActivity(window.fromISO, window.toISO);
      const progress = progressFromSample(sample, {
        metric: t.metric,
        deliberateWorkout: t.deliberateWorkout,
        workoutMinDurationMin: t.workoutMinDurationMin,
      });

      // ⚠ The branch this whole file exists to get right.
      if (progress == null) { out.skipped++; continue; }

      const { error } = await supabase.rpc('submit_activity_progress', {
        p_instance: t.instanceId,
        p_progress: progress,
        p_synced_at: nowISO,
        p_source: 'healthkit',
        p_progress_days: null,
        p_device_connected: true,
      });
      if (error) { out.skipped++; continue; }
      out.posted++;
    } catch {
      // A single unreadable period must not abort the rest of them.
      out.skipped++;
    }
  }
  return out;
}

/**
 * Tell the server the athlete revoked health access, so the board can say "disconnected" instead
 * of implying a sync is still coming. Sends the LAST KNOWN progress unchanged — this reports a
 * device state, and must not be mistaken for new evidence about the work.
 */
export async function reportDisconnected(instanceId: string, lastProgress: number): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('submit_activity_progress', {
      p_instance: instanceId,
      p_progress: lastProgress,
      p_synced_at: new Date().toISOString(),
      p_source: 'healthkit',
      p_progress_days: null,
      p_device_connected: false,
    });
    return !error;
  } catch {
    return false;
  }
}
