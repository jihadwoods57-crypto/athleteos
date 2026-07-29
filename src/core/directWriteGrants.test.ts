/**
 * Guards the bug class that migrations 0036, 0098 and 0150 have each had to fix.
 *
 * 0013_security_hardening revoked the default `grant insert, update, delete to authenticated`,
 * so any table the client writes DIRECTLY through PostgREST needs an explicit table grant. Miss
 * it and the write fails with 42501 "permission denied for table" BEFORE RLS is evaluated — the
 * policies look correct in review, the RLS suite passes (it asserts row visibility, not table
 * privilege), and the feature is simply broken on a real device.
 *
 * This test closes that gap statically: it reads what the shipped WebView client actually writes
 * and asserts a matching grant exists somewhere in the migrations. No database required.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const PROTO_JS = join(ROOT, 'proto', 'redesign-2026-07', 'js');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

type Op = 'insert' | 'update' | 'delete';

/** Every .js file under the proto, recursively. */
function protoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return protoFiles(p);
    return e.isFile() && e.name.endsWith('.js') ? [p] : [];
  });
}

/**
 * Direct writes the client performs: `.from('table')` followed by a write call.
 *
 * supabase-js is chainable and the write verb can sit on a later line (`.from(t).update(x)\n
 * .eq(...)`), so we scan a bounded window after each `.from(` rather than requiring the verb be
 * adjacent. `upsert` needs BOTH insert and update privileges.
 */
function clientDirectWrites(): Map<string, Map<Op, string>> {
  const found = new Map<string, Map<Op, string>>();
  const record = (table: string, op: Op, where: string) => {
    if (!found.has(table)) found.set(table, new Map());
    if (!found.get(table)!.has(op)) found.get(table)!.set(op, where);
  };

  for (const file of protoFiles(PROTO_JS)) {
    if (file.endsWith('.test.mjs')) continue;
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');

    for (const m of src.matchAll(/\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g)) {
      const table = m[1];
      // Bounded lookahead: enough for a chained call, short enough not to swallow the next
      // statement and attribute someone else's write to this table.
      const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 160);
      const verb = tail.match(/^\s*\.\s*(insert|update|upsert|delete)\b/);
      if (!verb) continue;
      const line = src.slice(0, m.index!).split('\n').length;
      const at = `${rel}:${line}`;
      if (verb[1] === 'upsert') { record(table, 'insert', at); record(table, 'update', at); }
      else record(table, verb[1] as Op, at);
    }
  }
  return found;
}

/**
 * Migration number in which each table is created.
 *
 * This is load-bearing. 0005 issued an IMMEDIATE `grant ... on all tables in schema public to
 * authenticated`, and 0013 only revoked the *default privileges* for FUTURE tables (plus explicit
 * revokes on subscriptions/org_memberships). 0013's own comment spells this out: "this does not
 * affect days/meals/checkins/athlete_profiles/profiles/links/orgs/teams". So only tables created
 * AFTER 0013 need an explicit grant — demanding one from `days` would be a false alarm.
 */
function tableBirth(): Map<string, number> {
  const birth = new Map<string, number>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const num = Number(f.slice(0, 4));
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      const t = m[1].toLowerCase();
      if (!birth.has(t)) birth.set(t, num);
    }
  }
  return birth;
}

/** Ops explicitly revoked from `authenticated` (0013 locks down service-role-only tables). */
function revokedOps(): Map<string, Set<Op>> {
  const revoked = new Map<string, Set<Op>>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(
      /\brevoke\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?(?:public\.)?([a-z0-9_]+)\s+from\s+([a-z_,\s]+?);/gi,
    )) {
      if (!/\bauthenticated\b/i.test(m[3])) continue;
      const table = m[2].toLowerCase();
      if (!revoked.has(table)) revoked.set(table, new Set());
      m[1].split(',').map((s) => s.trim().toLowerCase())
        .forEach((o) => { if (['insert', 'update', 'delete'].includes(o)) revoked.get(table)!.add(o as Op); });
    }
  }
  return revoked;
}

/** Ops granted to `authenticated` per table, across every migration. */
function grantedOps(): Map<string, Set<Op | 'select'>> {
  const granted = new Map<string, Set<Op | 'select'>>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    // `grant select, insert, update on public.foo to authenticated;` — schema optional, and the
    // statement may wrap across lines.
    for (const m of sql.matchAll(
      /\bgrant\s+([a-z,\s]+?)\s+on\s+(?:table\s+)?(?:public\.)?([a-z0-9_]+)\s+to\s+([a-z_,\s]+?);/gi,
    )) {
      if (!/\bauthenticated\b/i.test(m[3])) continue;
      const ops = m[1].split(',').map((s) => s.trim().toLowerCase());
      const table = m[2].toLowerCase();
      if (!granted.has(table)) granted.set(table, new Set());
      const set = granted.get(table)!;
      if (ops.includes('all')) (['select', 'insert', 'update', 'delete'] as const).forEach((o) => set.add(o));
      else ops.forEach((o) => { if (['select', 'insert', 'update', 'delete'].includes(o)) set.add(o as Op); });
    }
  }
  return granted;
}

/** The migration that stopped default DML grants for new tables. */
const DEFAULT_GRANT_REVOKED_AT = 13;

describe('direct client writes have table grants (0013 fallout)', () => {
  const writes = clientDirectWrites();
  const granted = grantedOps();
  const birth = tableBirth();
  const revoked = revokedOps();

  it('finds the direct writes it is supposed to be checking', () => {
    // A silent regex failure here would make every assertion below vacuously pass.
    expect(writes.size).toBeGreaterThan(5);
    expect(writes.has('team_rooms')).toBe(true);
  });

  it('parses table birth migrations', () => {
    expect(birth.get('days')).toBe(1);
    expect(birth.get('team_rooms')).toBe(87);
  });

  it('every post-0013 directly-written table has a grant for every operation used', () => {
    const missing: string[] = [];
    for (const [table, ops] of writes) {
      const born = birth.get(table);
      // Unknown table (created outside migrations, or a view) — nothing to assert.
      if (born === undefined) continue;
      // Pre-0013 tables carry 0005's immediate `on all tables` grant, unless later revoked.
      if (born <= DEFAULT_GRANT_REVOKED_AT && !revoked.has(table)) continue;
      const have = granted.get(table);
      for (const [op, where] of ops) {
        if (have?.has(op)) continue;
        if (born <= DEFAULT_GRANT_REVOKED_AT && !revoked.get(table)?.has(op)) continue;
        missing.push(
          `${table} (created in ${String(born).padStart(4, '0')}): client does ${op.toUpperCase()} ` +
          `at ${where}, but no migration grants ${op} on ${table} to authenticated ` +
          `— fails with 42501 before RLS runs`,
        );
      }
    }
    expect(missing).toEqual([]);
  });
});
