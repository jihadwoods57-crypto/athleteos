// OnStandard — Stage D data source for the coach roster. Returns the seeded showcase ROSTER when
// the backend is off (byte-identical to today) and, when live, the coach's real athletes projected
// from fetchLinkedDays(today). For a snappy experience it paints the LAST CACHED real roster for
// the signed-in user immediately (no Supabase round-trip, no sample flash), then revalidates and
// re-caches. The cache is namespaced by userId and purged on sign-out, so it never paints one
// user's athletes for another. Falls back to the seeded rows on any error / first-ever load.
import { useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';
import { buildLiveRoster, cachedRosterFor, daysAgoStamp, todayStamp, type RosterMember, type RosterRow } from '@/core';

export interface LiveRoster {
  /** Rows to render: cached real rows or seeded when off / first load, real once (re)loaded. */
  roster: RosterRow[];
  /** True when the rows are real (cached or freshly loaded) — the dashboard drops its "Sample" tag. */
  live: boolean;
}

export function useLiveRoster(seeded: RosterRow[], kind: 'team' | 'practice' = 'team'): LiveRoster {
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
    (async () => {
      // The roster is the MEMBERSHIP (names, silent athletes/clients) merged with
      // today's day rows (who actually logged) + yesterday's (trend). Membership read
      // is soft-fail: if the roster RPC isn't available, we degrade to the
      // day-rows-only view rather than showing nothing.
      const [today, yesterday, orgs] = await Promise.all([
        db.fetchLinkedDays(todayStamp()),
        db.fetchLinkedDays(daysAgoStamp(1)).catch(() => []),
        (kind === 'team' ? db.fetchMyTeams() : db.fetchMyPractices()).catch(() => []),
      ]);
      let members: RosterMember[] = [];
      try {
        const lists = await Promise.all(
          orgs.map((o) => (kind === 'team' ? db.fetchTeamRoster(o.id) : db.fetchPracticeRoster(o.id))),
        );
        const seen = new Set<string>();
        members = lists.flat().filter((m) => (seen.has(m.athlete_id) ? false : (seen.add(m.athlete_id), true)));
      } catch {
        members = [];
      }
      if (cancelled) return;
      const rows = buildLiveRoster(members, today, yesterday);
      setReal(rows);
      if (userId) setCachedRoster(rows, userId); // refresh the cache for next time
    })().catch(() => {
      /* keep the cached/seeded rows on error */
    });
    return () => {
      cancelled = true;
    };
  }, [userId, kind]);

  if (!isBackendLive) return { roster: seeded, live: false };
  return { roster: real ?? seeded, live: real != null };
}
