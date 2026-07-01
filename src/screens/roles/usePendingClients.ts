// OnStandard — the trainer's "Client requests" inbox data source (mirror of
// usePendingRequests for coaches). Gathers client-initiated join requests across the
// trainer's practice(s) (each a practice_clients row with status='pending'), with the
// requester's name via the pending_practice_requests RPC. Inert offline (empty inbox).
// Approve flips the row to 'active' (the client then appears in the book); decline deletes.
import { useCallback, useEffect, useState } from 'react';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';

export interface PendingClientItem {
  practiceId: string;
  practiceName: string;
  clientId: string;
  clientName: string | null;
  requestedAt: string | null;
}

export interface PendingClientInbox {
  items: PendingClientItem[];
  approve: (practiceId: string, clientId: string) => Promise<void>;
  decline: (practiceId: string, clientId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePendingClients(): PendingClientInbox {
  const userId = useStore((s) => s.userId);
  const [items, setItems] = useState<PendingClientItem[]>([]);

  const load = useCallback(async () => {
    if (!isBackendLive) {
      setItems([]);
      return;
    }
    const practices = await db.fetchMyPractices().catch(() => []);
    const all: PendingClientItem[] = [];
    for (const p of practices) {
      const reqs = await db.pendingPracticeRequests(p.id).catch(() => []);
      for (const r of reqs) {
        all.push({
          practiceId: p.id,
          practiceName: p.name,
          clientId: r.client_id,
          clientName: r.client_name,
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
    async (practiceId: string, clientId: string) => {
      await db.approveClient(practiceId, clientId).catch(() => undefined);
      await load();
    },
    [load],
  );

  const decline = useCallback(
    async (practiceId: string, clientId: string) => {
      await db.declineClient(practiceId, clientId).catch(() => undefined);
      await load();
    },
    [load],
  );

  return { items, approve, decline, refresh: load };
}
