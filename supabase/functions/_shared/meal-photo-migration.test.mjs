/* 0251 (no photo, no meal), pinned as text so `npm run verify` sees it without a database. The
 * behaviour itself (refusals, updates, legacy rows, service role, Trust Pass, pro correction) is
 * supabase/tests/meal_photo_test.sql, which runs under `npm run verify:full` against a local stack.
 *
 * Two contracts live here because nothing else would notice them break:
 *   - the error the client matches on ('photo_required') is the one the trigger raises;
 *   - no edge function writes `meals`. 0251 holds the service role too, so a new server writer
 *     that logs a meal without a photo fails loudly. This test makes that a decision, not a surprise.
 * Run: node --test supabase/functions/_shared/meal-photo-migration.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase', 'migrations');
const FILE = readdirSync(DIR).find((f) => f.startsWith('0251_'));
const SQL = FILE ? readFileSync(join(DIR, FILE), 'utf8') : '';

test('0251 exists and is the only migration with its number', () => {
  assert.equal(FILE, '0251_meal_photo_required.sql');
  const nums = readdirSync(DIR).filter((f) => /^\d{4}_/.test(f)).map((f) => f.slice(0, 4));
  assert.equal(nums.filter((n) => n === '0251').length, 1, 'one migration per number');
});

test('additive and idempotent: a trigger, no constraint, no data touched', () => {
  assert.match(SQL, /create or replace function public\.enforce_meal_photo\(\) returns trigger/);
  assert.match(SQL, /drop trigger if exists meals_photo_required on public\.meals;/);
  assert.match(SQL, /create trigger meals_photo_required\s+before insert or update on public\.meals\s+for each row execute function public\.enforce_meal_photo\(\);/);
  const drops = SQL.match(/^\s*drop\s+\w+(\s+\w+)*/gim) || [];
  assert.deepEqual(drops.map((d) => d.trim().toLowerCase()), ['drop trigger if exists meals_photo_required on public'], 'only its own re-runnable trigger drop');
  // Past no-photo rows must stay valid: no table constraint, no rewrite of existing rows.
  assert.doesNotMatch(SQL, /^\s*(alter table|update|delete from|truncate)\b/im);
  const header = SQL.slice(SQL.indexOf('create or replace function public.enforce_meal_photo'), SQL.indexOf('as $$'));
  assert.ok(header.length > 0);
  assert.doesNotMatch(header.replace(/--.*$/gm, ''), /security definer/i, 'must run as the caller so current_user is the request role');
});

test('who is held: every API role; a direct database session is not', () => {
  assert.match(SQL, /current_user in \('authenticated', 'anon', 'service_role'\)/);
  assert.match(SQL, /revoke all on function public\.enforce_meal_photo\(\) from public, anon, authenticated;/);
});

test('the invariant is a path in the athlete\'s own folder, and the error is stable', () => {
  assert.match(SQL, /v_prefix := new\.athlete_id::text \|\| '\/';/);
  assert.match(SQL, /new\.photo_path is null/);
  assert.equal((SQL.match(/errcode = '23514',\s+message = 'photo_required'/g) || []).length, 2, 'insert and update raise the same code');
  assert.match(SQL, /if old\.photo_path is not null/, 'a logged photo cannot be cleared or swapped');
});

test('the client matches exactly the message the trigger raises', () => {
  const day = readFileSync(join(ROOT, 'proto', 'redesign-2026-07', 'js', 'day.js'), 'utf8');
  assert.match(day, /export const PHOTO_REQUIRED = 'photo_required';/);
});

test('no edge function writes meals (0251 holds the service role, so a new writer is a decision)', () => {
  const FN = join(ROOT, 'supabase', 'functions');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(join(d, e.name)) : (/\.(ts|mjs|js)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(d, e.name)] : [])));
  const writers = [];
  for (const f of walk(FN)) {
    const src = readFileSync(f, 'utf8');
    const re = /\.from\(\s*['"]meals['"]\s*\)([\s\S]{0,200})/g;
    let m;
    while ((m = re.exec(src))) {
      const chain = m[1].split(';')[0];
      if (/\.(insert|upsert|update|delete)\s*\(/.test(chain)) writers.push(f.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(writers, [], 'a server writer of meals must satisfy 0251 (photo_path in the athlete\'s folder)');
});

test('the SQL suite is registered with the runner', () => {
  const run = readFileSync(join(ROOT, 'supabase', 'tests', 'run.sh'), 'utf8');
  assert.match(run, /"no photo, no meal \(0251\)\|meal_photo_test\.sql"/);
});
