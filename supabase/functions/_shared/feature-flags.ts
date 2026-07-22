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
