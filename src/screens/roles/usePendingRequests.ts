// OnStandard — the coach's "Pending requests" inbox data source. Gathers athlete-initiated
// join requests across the coach's team(s) (each a team_members row with status='pending'),
// with the requester's name via the pending_team_requests RPC (the coach can't read a
// pending athlete's profile directly — the link isn't active yet). Inert when the backend
// is off: returns an empty inbox so the demo dashboard is unchanged. Approve flips the row
// to 'active' (the athlete then appears on the roster); decline deletes it. Both refetch.
import { useCallback, useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';

export interface PendingItem {
  teamId: string;
  teamName: string;
  athleteId: string;
  athleteName: string | null;
  position: string | null;
  requestedAt: string;
}

export interface PendingInbox {
  items: PendingItem[];
  /** Resolve true on success; false means the failure is surfaced in `error` —
   *  the join-request loop is the coach's distribution moment, it must visibly
   *  succeed or visibly fail, never silently leave the row sitting there. */
  approve: (teamId: string, athleteId: string) => Promise<boolean>;
  decline: (teamId: string, athleteId: string) => Promise<boolean>;
  /** The last approve/decline failure, in product voice; null when clean. */
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePendingRequests(): PendingInbox {
  const userId = useStore((s) => s.userId);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isBackendLive) {
      setItems([]);
      return;
    }
    const teams = await db.fetchMyTeams().catch(() => []);
    const all: PendingItem[] = [];
    for (const t of teams) {
      const reqs = await db.pendingTeamRequests(t.id).catch(() => []);
      for (const r of reqs) {
        all.push({
          teamId: t.id,
          teamName: t.name,
          athleteId: r.athlete_id,
          athleteName: r.athlete_name,
          position: r.position,
          requestedAt: r.requested_at,
        });
      }
    }
    setItems(all);
  }, []);

  useEffect(() => {
    void load();
  }, [userId, load]);

  const approve = useCallback(
    async (teamId: string, athleteId: string) => {
      setError(null);
      try {
        await db.approveMember(teamId, athleteId);
      } catch {
        setError("Couldn't approve that request. Check your connection and try again.");
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const decline = useCallback(
    async (teamId: string, athleteId: string) => {
      setError(null);
      try {
        await db.declineMember(teamId, athleteId);
      } catch {
        setError("Couldn't decline that request. Check your connection and try again.");
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  return { items, approve, decline, error, refresh: load };
}
