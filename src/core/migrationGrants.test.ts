// Regression guard for a bug class that has bitten this repo twice (0050->0051, and then
// every other lockdown in the tree until 0147).
//
// PostgreSQL grants EXECUTE to the PUBLIC pseudo-role by DEFAULT on every function, and
// anon/authenticated inherit through PUBLIC. So this is a silent no-op:
//
//     revoke execute on function f() from anon, authenticated;
//
// The function stays callable by anyone via PostgREST RPC. The RLS test suite cannot catch
// this — it tests row visibility, not EXECUTE grants — so it is asserted statically here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

/** `revoke ... on function <sig> from <roles>;` — captures the signature and the role list. */
const REVOKE_FN = /revoke\s+(?:execute|all)\s+(?:privileges\s+)?on\s+function\s+([\s\S]*?)\s+from\s+([^;]+);/gi;

// Migrations that predate the fix and are superseded by a later, correct revoke. Each entry
// is kept explicit (rather than a blanket "ignore everything before 0147") so a NEW omission
// in an old-numbered file still fails.
const SUPERSEDED = new Set([
  '0034_team_membership_sync.sql',      // -> 0147
  '0035_privilege_hardening.sql',       // -> 0147
  '0037_analytics.sql',                 // -> 0147 (is_platform_admin)
  '0050_minor_consent_enforcement.sql', // -> 0051
  '0066_data_retention.sql',            // -> 0147
  '0120_cc_reauth.sql',                 // -> 0147 (admin_recent_auth_epoch)
  '0130_admin_auth_gate.sql',           // -> 0147
  '0131_admin_auth_monitor.sql',        // -> 0147
]);

/** Strip `-- line` comments and block comments so prose ABOUT the bug isn't read as the bug. */
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

describe('migration EXECUTE grants', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

  it('has migrations to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never revokes a function from anon/authenticated without also revoking from public', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (SUPERSEDED.has(file)) continue;
      const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));

      for (const m of sql.matchAll(REVOKE_FN)) {
        const signature = m[1].replace(/\s+/g, ' ').trim();
        const roles = m[2].replace(/\s+/g, ' ').trim();

        // `public` here must be the ROLE in the FROM clause. It is matched against the role
        // list only — never the signature — so a schema-qualified name like
        // `function public.foo()` cannot be mistaken for a revoke from the public role.
        const revokesPublic = /(^|[\s,])public([\s,]|$)/i.test(roles);
        if (!revokesPublic) offenders.push(`${file}: revoke on ${signature} from ${roles}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
