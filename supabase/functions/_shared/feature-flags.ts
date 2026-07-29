// OnStandard — pure feature-flag evaluator. ZERO imports on purpose: this exact file is
// loaded by both Deno edge functions (import '../_shared/feature-flags.ts') and jest (babel
// resolves the .ts), so there is ONE implementation of the rule, unit-tested per branch.
//
// Precedence is total and fixed: kill_switch → user → role → org → default_on.

export type FlagRow = {
  name: string;
  default_on: boolean;
  kill_switch: boolean;
  enabled_user_ids: string[];
  enabled_roles: string[];
  enabled_org_ids: string[];
};

export type FlagContext = { userId?: string | null; role?: string | null; orgId?: string | null };

export function evaluateFlag(flag: FlagRow, ctx: FlagContext): boolean {
  if (flag.kill_switch) return false;
  if (ctx.userId && flag.enabled_user_ids.includes(ctx.userId)) return true;
  if (ctx.role && flag.enabled_roles.includes(ctx.role)) return true;
  if (ctx.orgId && flag.enabled_org_ids.includes(ctx.orgId)) return true;
  return flag.default_on;
}

export function evaluateAll(flags: FlagRow[], ctx: FlagContext): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of flags) out[f.name] = evaluateFlag(f, ctx);
  return out;
}

/**
 * Is this flag on for this caller?
 *
 * Lives here rather than inline in each function: analyze-meal had its own copy, and meal-chat
 * was about to get a second one — the same "keep these in sync by comment" pattern that has
 * already cost this codebase real incidents. One implementation, one place to fix.
 *
 * Fails CLOSED. An unreadable flag table means the feature stays off, which is the safe direction
 * for anything gated: a flag exists precisely because we are not yet certain.
 */
export async function flagOn(
  sb: { from: (t: string) => any },
  name: string,
  ctx: FlagContext,
): Promise<boolean> {
  try {
    const { data } = await sb
      .from('feature_flags')
      .select('name, default_on, kill_switch, enabled_user_ids, enabled_roles, enabled_org_ids')
      .eq('name', name)
      .maybeSingle();
    if (!data) return false;
    return evaluateFlag(data as FlagRow, ctx);
  } catch {
    return false;
  }
}
