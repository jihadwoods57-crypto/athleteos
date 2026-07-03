// OnStandard — Stage D data source for the coach roster. Returns the seeded showcase ROSTER when
// the backend is off (byte-identical to today) and, when live, the coach's real athletes projected
// from fetchLinkedDays(today). For a snappy experience it paints the LAST CACHED real roster for
// the signed-in user immediately (no Supabase round-trip, no sample flash), then revalidates and
// re-caches. The cache is namespaced by userId and purged on sign-out, so it never paints one
// user's athletes for another. Falls back to the seeded rows on any error / first-ever load.
import { useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';
import { buildLiveRoster, cachedRosterFor, daysAgoStamp, teamWeeklyReport, todayStamp, weeklyRosterFromDays, type RosterMember, type RosterRow, type TeamWeeklyReport } from '@/core';

export interface LiveRoster {
  /** Rows to render: cached real rows or seeded when off / first load, real once (re)loaded. */
  roster: RosterRow[];
  /** True when the rows are real (cached or freshly loaded) — the dashboard drops its "Sample" tag. */
  live: boolean;
  /** A REAL 7-day team report built from the week's day rows (membership-based, silent
   *  athletes counted). Null when off / first load / membership unavailable — the caller
   *  falls back to the one-day snapshot in 'today' language. */
  weekReport: TeamWeeklyReport | null;
}

export function useLiveRoster(seeded: RosterRow[], kind: 'team' | 'practice' = 'team'): LiveRoster {
  const userId = useStore((s) => s.userId);
  const cached = useStore((s) => s.cachedRoster);
  const cachedUserId = useStore((s) => s.cachedRosterUserId);
  const setCachedRoster = useStore((s) => s.setCachedRoster);

  // Paint last-known-good for THIS user instantly (revalidated below). Only used when live.
  const seed = isBackendLive ? cachedRosterFor(userId, cachedUserId, cached) : null;
  const [real, setReal] = useState<RosterRow[] | null>(seed);
  const [weekReport, setWeekReport] = useState<TeamWeeklyReport | null>(null);

  useEffect(() => {
    if (!isBackendLive) return; // flag OFF: never fetch, never setState -> identical
    let cancelled = false;
    (async () => {
      // The roster is the MEMBERSHIP (names, silent athletes/clients) merged with
      // today's day rows (who actually logged) + yesterday's (trend). ONE range query
      // covers today, yesterday, and the full week for the real weekly report.
      // Membership read is soft-fail: if the roster RPC isn't available, we degrade
      // to the day-rows-only view rather than showing nothing.
      const today = todayStamp();
      const [week, orgs] = await Promise.all([
        db.fetchLinkedDaysSince(daysAgoStamp(6)),
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
      const rows = buildLiveRoster(
        members,
        week.filter((d) => d.date === today),
        week.filter((d) => d.date === daysAgoStamp(1)),
      );
      setReal(rows);
      // The week report needs the membership (silent athletes are its whole point);
      // without it, stay null and the caller keeps honest one-day language.
      setWeekReport(members.length > 0 ? teamWeeklyReport(weeklyRosterFromDays(members, week), 'week') : null);
      if (userId) setCachedRoster(rows, userId); // refresh the cache for next time
    })().catch(() => {
      /* keep the cached/seeded rows on error */
    });
    return () => {
      cancelled = true;
    };
  }, [userId, kind]);

  if (!isBackendLive) return { roster: seeded, live: false, weekReport: null };
  return { roster: real ?? seeded, live: real != null, weekReport };
}
