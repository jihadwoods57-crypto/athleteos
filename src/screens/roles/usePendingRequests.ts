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
  approve: (teamId: string, athleteId: string) => Promise<void>;
  decline: (teamId: string, athleteId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePendingRequests(): PendingInbox {
  const userId = useStore((s) => s.userId);
  const [items, setItems] = useState<PendingItem[]>([]);

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
      await db.approveMember(teamId, athleteId).catch(() => undefined);
      await load();
    },
    [load],
  );

  const decline = useCallback(
    async (teamId: string, athleteId: string) => {
      await db.declineMember(teamId, athleteId).catch(() => undefined);
      await load();
    },
    [load],
  );

  return { items, approve, decline, refresh: load };
}
