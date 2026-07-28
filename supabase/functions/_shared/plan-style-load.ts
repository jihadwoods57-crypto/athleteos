// OnStandard — resolve an athlete's effective nutrition plan style server-side (0142), for the
// AI surfaces that must speak in it. Mirrors coach-voice-load.ts's shape and posture: service-role
// reads, best-effort, and a null return that degrades to today's exact behaviour.
//
// Precedence is the SAME one the client's resolvePlanStyle and the migration's own helpers use:
//
//     team standard  →  professional assignment  →  the athlete's own choice  →  null
//
// The first two are read through the migration's SECURITY DEFINER helpers rather than
// re-implemented here, so the resolution can never drift from what actually governs the athlete's
// scoring: athlete_governing_plan_style() already does the athlete > position > team scoping and
// the 0085 effective_date versioning.
//
// ---------------------------------------------------------------------------------------------
// WHY "NULL IS SAFE" IS A REAL GUARANTEE AND NOT AN ASSUMPTION
// ---------------------------------------------------------------------------------------------
// Null here means "no directive", which reproduces today's prompt byte for byte. That is exactly
// right for a grandfathered athlete (Structured/legacy — today's prompt IS their prompt), and
// merely non-ideal for a brand-new signup who defaults to Guided without an explicit row (they
// get today's slightly-more-numeric framing, which is still honest and still shows numbers they
// are allowed to see).
//
// The only style where a wrong answer would HARM someone is Intuitive — and Intuitive can never
// arise from a default. It only exists as an explicit team standard, professional assignment, or
// self-selection, every one of which is a real row this loader reads. So a failed/absent lookup
// can never silently strip an Intuitive athlete's protection: it can only fail toward the style
// they were already being scored under.

import { asPlanStyle, type PlanStyle } from './plan-style.ts';

// Loose structural type for the supabase-js client (callers pass their own service-role instance).
type SbLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export interface LoadedStyle {
  style: PlanStyle;
  /** Where it came from — carried into telemetry so a surprising style is traceable. */
  source: 'team' | 'pro' | 'self';
}

/**
 * The athlete's effective plan style, or null when nothing sets one (see the header note on why
 * that is safe). Never throws: every branch degrades to null.
 */
export async function loadPlanStyleForAthlete(sb: SbLike, uid: string): Promise<LoadedStyle | null> {
  if (!sb || !uid) return null;

  // 1. A governing TEAM STANDARD outranks everything, including the athlete's own choice — this
  //    is what makes "athletes cannot switch style to escape a team standard" true on the server.
  try {
    const { data, error } = await sb.rpc('athlete_governing_plan_style', { p_athlete: uid });
    if (!error) {
      const s = asPlanStyle(data);
      if (s) return { style: s, source: 'team' };
    }
  } catch { /* helper absent (0142 not applied) — fall through */ }

  // 2. A professional's per-athlete assignment (athlete_profiles.targets.style).
  try {
    const { data, error } = await sb.rpc('athlete_assigned_plan_style', { p_athlete: uid });
    if (!error) {
      const s = asPlanStyle(data);
      if (s) return { style: s, source: 'pro' };
    }
  } catch { /* helper absent — fall through */ }

  // 3. The athlete's own setting, for someone nobody else governs.
  try {
    const { data } = await sb.from('profiles').select('plan_style').eq('id', uid).maybeSingle();
    const s = asPlanStyle(data?.plan_style);
    if (s) return { style: s, source: 'self' };
  } catch { /* column absent / offline — fall through */ }

  return null;
}
