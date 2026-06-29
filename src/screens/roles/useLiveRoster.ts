// AthleteOS — Stage D data source for the coach roster. Returns the seeded showcase ROSTER when
// the backend is off (byte-identical to today) and, when live, the coach's real athletes projected
// from fetchLinkedDays(today). For a snappy experience it paints the LAST CACHED real roster for
// the signed-in user immediately (no Supabase round-trip, no sample flash), then revalidates and
// re-caches. The cache is namespaced by userId and purged on sign-out, so it never paints one
// user's athletes for another. Falls back to the seeded rows on any error / first-ever load.
import { useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';
import { cachedRosterFor, mapLinkedDaysToRoster, todayStamp, type RosterRow } from '@/core';

export interface LiveRoster {
  /** Rows to render: cached real rows or seeded when off / first load, real once (re)loaded. */
  roster: RosterRow[];
  /** True when the rows are real (cached or freshly loaded) — the dashboard drops its "Sample" tag. */
  live: boolean;
}

export function useLiveRoster(seeded: RosterRow[]): LiveRoster {
  const userId = useStore((s) => s.userId);
  const cached = useStore((s) => s.cachedRoster);
  const cachedUserId = useStore((s) => s.cachedRosterUserId);
  const setCachedRoster = useStore((s) => s.setCachedRoster);

  // Paint last-known-good for THIS user instantly (revalidated below). Only used when live.
  const seed = isBackendLive ? cachedRosterFor(userId, cachedUserId, cached) : null;
  const [real, setReal] = useState<RosterRow[] | null>(seed);

  useEffect(() => {
    if (!isBackendLive) return; // flag OFF: never fetch, never setState -> identical
    let cancelled = false;
    db.fetchLinkedDays(todayStamp())
      .then((days) => {
        if (cancelled) return;
        const rows = mapLinkedDaysToRoster(days);
        setReal(rows);
        if (userId) setCachedRoster(rows, userId); // refresh the cache for next time
      })
      .catch(() => {
        /* keep the cached/seeded rows on error */
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!isBackendLive) return { roster: seeded, live: false };
  return { roster: real ?? seeded, live: real != null };
}
