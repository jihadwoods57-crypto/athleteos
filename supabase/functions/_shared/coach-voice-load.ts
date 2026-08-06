// OnStandard — load the enabled Coach Voice config that governs an athlete (service role).
// Extracted from coach-voice-nudge so analyze-meal and meal-chat reuse the exact same resolution:
//   1. athlete's active team_members row -> that team's coach_voice_config, only when enabled;
//   2. otherwise (2026-08-06) the athlete's active practice_clients row -> that practice's
//      practice_voice_config (0187), only when enabled — a trainer IS the coach of record for a
//      solo client, and before this fallback a practice had no voice at all.
// Team-first on purpose: an athlete on both keeps the exact pre-0187 behavior byte for byte.
// Returns the parsed VoiceConfig plus the config `version` (for output stamping) and the book id.
//
// Note: the team query selects `version` (added in migration 0110). If that column is absent the
// query errors and resolution falls through — a safe degradation (no voice, deterministic copy
// stands). practice_voice_config ships with `version` from day one.
import type { VoiceConfig } from './coach-voice.ts';

// Loose structural type for the supabase-js client (callers pass their own service-role instance).
type SbLike = { from: (table: string) => any };

export interface LoadedVoice {
  cfg: VoiceConfig;
  version: number;
  teamId: string;
}

function parseCfg(raw: unknown): VoiceConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  return {
    tone: typeof cfg.tone === 'string' ? cfg.tone : 'direct',
    level: typeof cfg.level === 'string' ? cfg.level : 'balanced',
    approved: Array.isArray(cfg.approved) ? cfg.approved.filter((p) => typeof p === 'string').slice(0, 12) : [],
    prohibited: typeof cfg.prohibited === 'string' ? cfg.prohibited : '',
    length: typeof cfg.length === 'string' ? cfg.length : undefined,
    instructions: typeof cfg.instructions === 'string' ? cfg.instructions : undefined,
  };
}

export async function loadVoiceForAthlete(sb: SbLike, uid: string): Promise<LoadedVoice | null> {
  // ---- 1. team voice (pre-0187 behavior, unchanged) ----
  try {
    const { data: mem } = await sb
      .from('team_members')
      .select('team_id')
      .eq('athlete_id', uid)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const teamId = mem?.team_id;
    if (teamId) {
      const { data: row } = await sb
        .from('coach_voice_config')
        .select('enabled, config, version')
        .eq('team_id', teamId)
        .maybeSingle();
      if (row && row.enabled !== false) {
        return { cfg: parseCfg(row.config), version: typeof row.version === 'number' ? row.version : 1, teamId };
      }
      // On a team with voice off (or none set) the team's choice stands — a practice fallback
      // here would let a side trainer's tone override the team coach's explicit Off.
      return null;
    }
  } catch {
    return null;
  }
  // ---- 2. practice voice (0187) — only for an athlete on NO team ----
  try {
    const { data: pc } = await sb
      .from('practice_clients')
      .select('practice_id')
      .eq('client_id', uid)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const practiceId = pc?.practice_id;
    if (!practiceId) return null;
    const { data: row } = await sb
      .from('practice_voice_config')
      .select('enabled, config, version')
      .eq('practice_id', practiceId)
      .maybeSingle();
    if (!row || row.enabled === false) return null;
    return { cfg: parseCfg(row.config), version: typeof row.version === 'number' ? row.version : 1, teamId: practiceId };
  } catch {
    return null;
  }
}
