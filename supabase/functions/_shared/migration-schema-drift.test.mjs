/* Migrations must not reference columns a LATER migration dropped.
 *
 * WHY THIS EXISTS. The evidence-ceiling trigger (clamp_day_score_to_evidence) reads
 * trust_passes. Migration 0196 replaced that table's `granted_date` + `length_days` window with
 * `covers_from`/`covers_until` and rewrote the function to match. Migration 0228 (score v3) was
 * written by copying 0193 forward and brought the pre-0196 block back with it.
 *
 * Postgres accepted the function: a column reference inside a PL/pgSQL expression is planned at
 * EXECUTION time, so `create or replace function` succeeded and the migration reported success.
 * The trigger then raised 42703 on every INSERT OR UPDATE of `days`, which killed the whole
 * upsert. No day row was written to production for two days and the only symptom anyone could
 * see was the client's "not synced" pill.
 *
 * Nothing in the suite could catch that, because the SQL authorization suite needs a local
 * Supabase stack and does not run in `npm run verify`. This does: it is pure text analysis of
 * the migration files, so it runs everywhere, every time.
 *
 * Run: node --test supabase/functions/_shared/migration-schema-drift.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => readFileSync(join(DIR, f), 'utf8');

/**
 * Columns a migration DROPPED, and the number of the migration that dropped them. Anything
 * dated after that number which still names one is reading a column that no longer exists.
 *
 * Add a row here whenever a migration removes a column that other SQL reads. Keeping the list
 * explicit is the point: a generic schema parser would have to model every DDL form Postgres
 * accepts, and would be wrong in a way nobody notices.
 */
const DROPPED = [
  {
    since: '0196',
    table: 'trust_passes',
    columns: ['granted_date', 'length_days'],
    replacedBy: 'covers_from / covers_until, plus pass_spends for spent credits',
    /* The two migrations that actually carried the bug. They are APPLIED history and cannot be
       edited, so they are named here rather than silently tolerated. 0233 is the fix; if either
       of these is ever re-run against a fresh database, 0233 runs after it and repairs the
       function. Nothing may be added to this list to make a NEW migration pass. */
    appliedAndSuperseded: ['0228_score_v3_ceiling.sql', '0232_wakeup_score_ceiling.sql'],
  },
];

const numberOf = (file) => file.slice(0, 4);

test('the migration directory is readable and non-trivial', () => {
  assert.ok(FILES.length > 100, `expected the full migration history, found ${FILES.length} files`);
});

test('every migration excused from the rule above really is superseded', () => {
  // An allowlist nobody re-checks is how the next one of these gets through. Each excused file
  // must exist AND be older than a migration that redefines the same function correctly.
  for (const rule of DROPPED) {
    for (const f of rule.appliedAndSuperseded || []) {
      assert.ok(FILES.includes(f), `${f} is excused but no longer exists`);
      const later = FILES.filter((x) => x > f && /create or replace function clamp_day_score_to_evidence/i.test(read(x)));
      assert.ok(later.length > 0, `${f} is excused but nothing after it redefines the function`);
    }
  }
});

for (const rule of DROPPED) {
  for (const col of rule.columns) {
    test(`no migration after ${rule.since} reads ${rule.table}.${col}`, () => {
      const offenders = [];
      for (const f of FILES) {
        if (numberOf(f) <= rule.since) continue;
        if ((rule.appliedAndSuperseded || []).includes(f)) continue;
        const sql = read(f);
        // Look for the column named against an alias or the table itself, which is how every
        // reference in this repo is written. A bare word would false-positive on prose.
        const hit = new RegExp(`\\b(?:[a-z_]+\\.)?${col}\\b`).test(stripComments(sql));
        if (hit) offenders.push(f);
      }
      assert.deepEqual(offenders, [],
        `${rule.table}.${col} was dropped by ${rule.since} (replaced by ${rule.replacedBy}).\n`
        + `These later migrations still reference it, and Postgres will not catch it until the\n`
        + `statement actually runs:\n  ${offenders.join('\n  ')}`);
    });
  }
}

test('the live ceiling trigger reads the trust-pass shape that exists today', () => {
  // The specific regression, pinned directly rather than only by the generic rule above: the
  // NEWEST migration that defines clamp_day_score_to_evidence is what production runs.
  const defining = FILES.filter((f) => /create or replace function clamp_day_score_to_evidence/i.test(read(f)));
  assert.ok(defining.length > 0, 'no migration defines clamp_day_score_to_evidence');
  const newest = defining[defining.length - 1];
  const sql = stripComments(read(newest));
  assert.match(sql, /covers_from/, `${newest} must gate the trust pass on covers_from (the 0196 shape)`);
  assert.ok(!/granted_date|length_days/.test(sql),
    `${newest} reads a trust_passes column 0196 dropped. This does not fail at migrate time; it `
    + 'raises 42703 on every days upsert and silently stops the whole app syncing.');
});

/** Strip line and block comments so documentation naming an old column is not an offence. */
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}
