// AthleteOS — Stage D data source for the coach roster. Returns the seeded showcase
// ROSTER when the backend is off (byte-identical to today) and, when live, the coach's
// real athletes projected from fetchLinkedDays(today). The fetch falls back to the
// seeded rows on any error / before it resolves, so the dashboard never flashes empty.
import { useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { mapLinkedDaysToRoster, todayStamp, type RosterRow } from '@/core';

export interface LiveRoster {
  /** Rows to render: seeded when off / loading / on error, real once loaded. */
  roster: RosterRow[];
  /** True only when real rows are loaded — the dashboard drops its "Sample" tag then. */
  live: boolean;
}

export function useLiveRoster(seeded: RosterRow[]): LiveRoster {
  const [real, setReal] = useState<RosterRow[] | null>(null);

  useEffect(() => {
    if (!isBackendLive) return; // flag OFF: never fetch, never setState -> identical
    let cancelled = false;
    db.fetchLinkedDays(todayStamp())
      .then((days) => {
        if (!cancelled) setReal(mapLinkedDaysToRoster(days));
      })
      .catch(() => {
        if (!cancelled) setReal(null); // keep the seeded fallback on error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isBackendLive) return { roster: seeded, live: false };
  return { roster: real ?? seeded, live: real != null };
}
