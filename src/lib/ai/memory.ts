// OnStandard — AI Memory + Performance Profile data access (doc-05 §4/§5). Reads/writes the
// athlete_memory_facts and performance_profiles tables (migrations 0018-0020). The tables aren't in
// the generated Database types yet (applied by the founder), so queries go through a loose client —
// the table/column names are validated server-side and by RLS. All calls fail safe (return empty /
// false) so a screen never crashes when the backend is off.
import { supabase } from '@/lib/supabase/client';
import type { MemoryFact, MemoryStatus } from '@/core';

/** Loose Supabase client for the not-yet-typed AI tables. */
// deno-lint-ignore no-explicit-any
type Loose = any;

interface FactRow {
  id: string;
  kind: string;
  value: unknown;
  confidence: number;
  source: string;
  evidence_n: number;
  status: string;
}

function toFact(r: FactRow): MemoryFact {
  return {
    id: r.id,
    kind: r.kind as MemoryFact['kind'],
    value: r.value,
    confidence: r.confidence,
    source: r.source as MemoryFact['source'],
    evidenceN: r.evidence_n,
    status: r.status as MemoryStatus,
  };
}

/** Fetch the current athlete's memory facts, optionally filtered by status. Empty when unconfigured. */
export async function fetchMemoryFacts(status?: MemoryStatus): Promise<MemoryFact[]> {
  if (!supabase) return [];
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return [];
  let q = (supabase.from as Loose)('athlete_memory_facts').select('*').eq('athlete_id', uid);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as FactRow[]).map(toFact);
}

/** Confirm ('active') or reject ('rejected') a pending fact. RLS scopes it to the athlete's own row. */
export async function setFactStatus(id: string, status: 'active' | 'rejected'): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await (supabase.from as Loose)('athlete_memory_facts').update({ status }).eq('id', id);
  return !error;
}

/**
 * Write inferred/stated candidate facts for the current athlete (the missing WRITE half of the
 * memory flywheel). RLS scopes rows to auth.uid(); the caller has already run them through
 * admitCandidate, so a safety fact arrives 'pending_confirmation' and only the athlete's confirm
 * flips it active. Fails safe (returns false) when the backend is off or no session — the meal
 * still logs; only the learning is skipped.
 */
export async function insertMemoryFacts(facts: MemoryFact[]): Promise<boolean> {
  if (!supabase || facts.length === 0) return false;
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return false;
  const rows = facts.map((f) => ({
    athlete_id: uid,
    kind: f.kind,
    value: f.value,
    confidence: f.confidence,
    source: f.source,
    evidence_n: f.evidenceN,
    status: f.status,
  }));
  const { error } = await (supabase.from as Loose)('athlete_memory_facts').insert(rows);
  return !error;
}

export interface ProfileRow {
  feedback_log?: { authorId: string; scope: string; text: string; at: string }[];
}

/** Fetch an athlete's performance_profiles row (or null). RLS enforces self-or-can_view. */
export async function fetchProfileRow(athleteId: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  const { data, error } = await (supabase.from as Loose)('performance_profiles')
    .select('feedback_log')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}

/** Fetch the active memory facts for an athlete (coach-visible kinds are RLS-filtered). */
export async function fetchFactsFor(athleteId: string): Promise<MemoryFact[]> {
  if (!supabase) return [];
  const { data, error } = await (supabase.from as Loose)('athlete_memory_facts')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('status', 'active');
  if (error || !data) return [];
  return (data as FactRow[]).map(toFact);
}
