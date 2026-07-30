// Athlete memory — the I/O half. Pure logic lives in ./memory.ts (same split as
// coach-voice.ts / coach-voice-load.ts).
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import type { MemoryFact } from './memory.ts';

export type { MemoryFact } from './memory.ts';
export { memoryBlock, avoidFromFacts, rankFacts, factLine } from './memory.ts';

/**
 * Load this athlete's CONFIRMED facts. Best-effort: a failure returns [] so the meal still gets
 * read — memory improves an analysis, it must never be able to block one.
 */
export async function loadMemoryForAthlete(url: string, serviceKey: string, athleteId: string): Promise<MemoryFact[]> {
  if (!url || !serviceKey || !athleteId) return [];
  try {
    const sb = createClient(url, serviceKey);
    const { data, error } = await sb
      .from('athlete_memory_facts')
      .select('kind,value,confidence,evidence_n')
      .eq('athlete_id', athleteId)
      .eq('status', 'active')          // RULE 1: pending facts never reach a prompt
      .limit(60);
    if (error || !Array.isArray(data)) return [];
    return data as MemoryFact[];
  } catch {
    return [];
  }
}
