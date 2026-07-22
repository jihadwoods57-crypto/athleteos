// OnStandard — load a team's enabled Coach Voice config for an athlete (service role). Extracted
// from coach-voice-nudge so analyze-meal (and future surfaces) reuse the exact same resolution:
// athlete's active team_members row -> that team's coach_voice_config, only when enabled. Returns
// the parsed VoiceConfig plus the config `version` (for output stamping) and the team id.
//
// Note: selects `version` (added in migration 0110). If that column is absent (0110 not yet applied)
// the query errors and this returns null — a safe degradation (no voice, deterministic copy stands).
import type { VoiceConfig } from './coach-voice.ts';

// Loose structural type for the supabase-js client (callers pass their own service-role instance).
type SbLike = { from: (table: string) => any };

export interface LoadedVoice {
  cfg: VoiceConfig;
  version: number;
  teamId: string;
}

export async function loadVoiceForAthlete(sb: SbLike, uid: string): Promise<LoadedVoice | null> {
  try {
    const { data: mem } = await sb
      .from('team_members')
      .select('team_id')
      .eq('athlete_id', uid)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    const teamId = mem?.team_id;
    if (!teamId) return null;

    const { data: row } = await sb
      .from('coach_voice_config')
      .select('enabled, config, version')
      .eq('team_id', teamId)
      .maybeSingle();
    if (!row || row.enabled === false) return null;

    const cfg = (row.config ?? {}) as Record<string, unknown>;
    return {
      cfg: {
        tone: typeof cfg.tone === 'string' ? cfg.tone : 'direct',
        level: typeof cfg.level === 'string' ? cfg.level : 'balanced',
        approved: Array.isArray(cfg.approved) ? cfg.approved.filter((p) => typeof p === 'string').slice(0, 12) : [],
        prohibited: typeof cfg.prohibited === 'string' ? cfg.prohibited : '',
      },
      version: typeof row.version === 'number' ? row.version : 1,
      teamId,
    };
  } catch {
    return null;
  }
}
