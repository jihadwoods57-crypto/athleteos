/* 0250 (food preferences + the plan-ideas cache), pinned as text so `npm run verify` sees it
 * without a database. The behaviour itself (owner writes, staff reads, teammate/outsider/guardian
 * see nothing, only the function writes ideas) is supabase/tests/food_prefs_test.sql, which runs
 * under `npm run verify:full` against a local stack.
 *
 * The table-grants gotcha is the reason for most of this: profiles is granted COLUMN BY COLUMN
 * (0236, 0243), so a new column nobody granted denies the whole select that names it.
 * Run: node --test supabase/functions/_shared/food-prefs-migration.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const FILE = readdirSync(DIR).find((f) => f.startsWith('0250_'));
const SQL = FILE ? readFileSync(join(DIR, FILE), 'utf8') : '';

test('0250 exists and is the next number after 0249', () => {
  assert.equal(FILE, '0250_food_prefs_plan_ideas.sql');
  const nums = readdirSync(DIR).filter((f) => /^\d{4}_/.test(f)).map((f) => f.slice(0, 4));
  assert.equal(nums.filter((n) => n === '0250').length, 1, 'one migration per number');
});

test('additive and idempotent: if-not-exists everywhere, nothing dropped but its own policy', () => {
  assert.match(SQL, /add column if not exists food_prefs jsonb not null default '\{\}'::jsonb/);
  assert.match(SQL, /create table if not exists public\.plan_ideas/);
  assert.match(SQL, /if not exists \(select 1 from pg_constraint where conname = 'profiles_food_prefs_shape'\)/);
  const drops = SQL.match(/\bdrop\s+\w+(\s+\w+)*/gi) || [];
  assert.deepEqual(drops.map((d) => d.toLowerCase()), ['drop policy if exists plan_ideas_own_read on public'], 'only a re-runnable policy drop');
  assert.doesNotMatch(SQL, /alter column|drop column|truncate|delete from/i);
});

test('food_prefs: an object, bounded, and granted to the client column by column', () => {
  assert.match(SQL, /check \(jsonb_typeof\(food_prefs\) = 'object' and pg_column_size\(food_prefs\) <= 4096\)/);
  assert.match(SQL, /grant select \(food_prefs\) on public\.profiles to authenticated;/);
  assert.match(SQL, /grant update \(food_prefs\) on public\.profiles to authenticated;/);
});

test('plan_ideas: RLS on, the athlete reads their own, only the service role writes', () => {
  assert.match(SQL, /alter table public\.plan_ideas enable row level security;/);
  assert.match(SQL, /create policy plan_ideas_own_read on public\.plan_ideas\s+for select using \(athlete_id = auth\.uid\(\)\);/);
  assert.match(SQL, /revoke all on table public\.plan_ideas from public, anon, authenticated;/);
  assert.match(SQL, /grant select on public\.plan_ideas to authenticated;/);
  assert.match(SQL, /grant select, insert, update, delete on public\.plan_ideas to service_role;/);
  assert.match(SQL, /primary key \(athlete_id, day_date, slot\)/, 'one row per athlete, day and slot');
  assert.match(SQL, /references public\.profiles\(id\) on delete cascade/, 'account deletion takes the cache with it');
  assert.doesNotMatch(SQL, /create policy [^;]*plan_ideas[^;]*for (insert|update|delete|all)/i);
});

test('the SQL suite is registered with the runner', () => {
  const run = readFileSync(join(process.cwd(), 'supabase', 'tests', 'run.sh'), 'utf8');
  assert.match(run, /"food prefs \+ plan ideas \(0250\)\|food_prefs_test\.sql"/);
});
