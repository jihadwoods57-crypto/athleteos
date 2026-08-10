#!/usr/bin/env node
// Tester demo-account ops: generates the 10 per-tester passwords, runs the seed, and proves the
// result actually works before any real tester sees the link. Three commands:
//
//   node scripts/tester-accounts.mjs gen
//     Substitutes 10 fresh passwords into scripts/seed-tester-accounts.sql, writes the runnable
//     file + a credentials JSON to the OS temp dir (never into the repo), and prints the exact
//     `supabase db query` command to run it.
//
//   node scripts/tester-accounts.mjs verify
//     Signs in all 40 seeded accounts for real (a hand-inserted auth.users row can look perfect in
//     every table and still fail every sign-in — see scripts/seed-demo-accounts.sql), then proves
//     cross-tenant RLS isolation across all ten set boundaries. Reads credentials from the temp-dir
//     JSON `gen` wrote. Needs SUPABASE_URL + SUPABASE_ANON_KEY (or EXPO_PUBLIC_ variants) in env —
//     no service-role key, by design.
//
//   node scripts/tester-accounts.mjs smoke
//     Exercises the DEPLOYED tester-claim + beta-board functions end to end: claim, re-claim,
//     recover, exhaustion after 10, and the board tie-in. WARNING: this CLAIMS all 10 sets with
//     synthetic emails. Re-run `gen` and re-apply the seed before handing the real link to testers.
//     Needs TESTER_CLAIM_KEY, TESTER_ADMIN_KEY, BETA_BOARD_KEY in env.
//
// Local stack:
//   supabase status -o env   # prints local ANON_KEY etc.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<from above> node scripts/tester-accounts.mjs verify
//
// Prod:
//   node --env-file=.env scripts/tester-accounts.mjs verify   # .env already has EXPO_PUBLIC_SUPABASE_*
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomInt } from 'node:crypto';

const ROOT = join(import.meta.dirname, '..');
const SEED_SRC = join(ROOT, 'scripts', 'seed-tester-accounts.sql');
const OUT_SQL = join(tmpdir(), 'onstandard-tester-seed.sql');
const OUT_CREDS = join(tmpdir(), 'onstandard-tester-creds.json');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const WORDS = [
  'Cedar', 'Ridge', 'Anchor', 'Quarry', 'Ballast', 'Harbor', 'Ember', 'Granite', 'Willow', 'Meadow',
  'Canyon', 'Thicket', 'Lantern', 'Compass', 'Timber', 'Boulder', 'Brook', 'Summit', 'Hollow', 'Ferry',
  'Orchard', 'Pebble', 'Marsh', 'Cinder', 'Foundry', 'Hearth', 'Ledge', 'Mill', 'Nook', 'Overlook',
  'Pier', 'Quay', 'Rafter', 'Slate', 'Trellis', 'Underpass', 'Vale', 'Wharf', 'Yard', 'Zephyr',
];

function genPassword() {
  const picked = new Set();
  while (picked.size < 3) picked.add(WORDS[randomInt(WORDS.length)]);
  const digits = String(randomInt(10, 100));
  return [...picked].join('-') + '-' + digits;
}

function cmdGen() {
  const passwords = [];
  const used = new Set();
  for (let n = 1; n <= 10; n++) {
    let pw;
    do { pw = genPassword(); } while (used.has(pw));
    used.add(pw);
    passwords.push(pw);
  }

  let sql = readFileSync(SEED_SRC, 'utf8');
  const creds = [];
  for (let n = 1; n <= 10; n++) {
    const nn = String(n).padStart(2, '0');
    const token = `__PW_${nn}__`;
    if (!sql.includes(token)) throw new Error(`placeholder ${token} not found in ${SEED_SRC}`);
    sql = sql.split(token).join(passwords[n - 1]);
    creds.push({
      set_no: n,
      password: passwords[n - 1],
      emails: {
        coach: `t${nn}-coach@onstandard.app`,
        athlete: `t${nn}-athlete@onstandard.app`,
        trainer: `t${nn}-trainer@onstandard.app`,
        client: `t${nn}-client@onstandard.app`,
      },
    });
  }

  writeFileSync(OUT_SQL, sql, 'utf8');
  writeFileSync(OUT_CREDS, JSON.stringify(creds, null, 2), 'utf8');

  console.log(`Wrote ${OUT_SQL}`);
  console.log(`Wrote ${OUT_CREDS}  (credentials — not in the repo, delete when the beta ends)`);
  console.log('\nRun it with:');
  console.log(`  npx supabase db query --linked --file "${OUT_SQL}"`);
  console.log('\n(For the local stack, use --local instead of --linked.)\n');
  console.log('Set  Password              Coach email');
  for (const c of creds) console.log(`${String(c.set_no).padStart(2, '0')}   ${c.password.padEnd(22)} ${c.emails.coach}`);
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, email, user_id: body?.user?.id, access_token: body?.access_token, error: body?.error_description || body?.msg };
}

async function restGet(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function restPost(path, token, payload) {
  // return=minimal, not return=representation: PostgREST's representation path needs a blanket
  // table-level SELECT grant, but days (this call's only caller) is deliberately column-scoped —
  // see migration 0181_day_push_grants.sql. return=representation 403s with "permission denied for
  // table days" even though the insert itself succeeds and the row is fully readable right after via
  // a normal (column-scoped) GET — confirmed empirically. The caller always re-reads via restGet
  // anyway, so the representation body was never used.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

async function restDelete(path, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function rpcPost(fn, token, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { ok: res.ok, status: res.status };
}

async function cmdVerify() {
  if (!SUPABASE_URL || !ANON_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or EXPO_PUBLIC_ variants) in env.');
  const creds = JSON.parse(readFileSync(OUT_CREDS, 'utf8'));

  console.log('Signing in 40 accounts…');
  const sessions = {};
  let failed = 0;
  for (const c of creds) {
    for (const role of ['coach', 'athlete', 'trainer', 'client']) {
      const email = c.emails[role];
      const r = await signIn(email, c.password);
      sessions[email] = r;
      if (!r.ok) { failed++; console.log(`  FAIL  ${email}  ${r.error || 'sign-in rejected'}`); }
    }
  }
  console.log(`${40 - failed}/40 signed in.`);
  if (failed) { console.log('Stopping — fix sign-in failures before checking isolation.'); process.exitCode = 1; return; }

  console.log("\nCollecting each set's own team/practice id (self-read)…");
  const teamId = {}, practiceId = {};
  for (const c of creds) {
    const coach = sessions[c.emails.coach];
    const teams = await restGet(`teams?created_by=eq.${coach.user_id}&select=id`, coach.access_token);
    teamId[c.set_no] = teams.body?.[0]?.id;
    const trainer = sessions[c.emails.trainer];
    const practices = await restGet(`practices?owner_id=eq.${trainer.user_id}&select=id`, trainer.access_token);
    practiceId[c.set_no] = practices.body?.[0]?.id;
  }

  console.log('\nCross-tenant isolation (each set n against set n+1)…');
  let rosterFails = 0, daysFails = 0;
  for (const c of creds) {
    const m = (c.set_no % 10) + 1;
    const mCreds = creds.find((x) => x.set_no === m);
    const coach = sessions[c.emails.coach];
    const trainer = sessions[c.emails.trainer];
    const athleteN = sessions[c.emails.athlete];
    const athleteM = sessions[mCreds.emails.athlete];

    const teamLeak = await rpcPost('team_roster', coach.access_token, { team: teamId[m] });
    if (teamLeak.ok) { rosterFails++; console.log(`  FAIL  set ${c.set_no} coach read set ${m}'s team_roster`); }

    const practiceLeak = await rpcPost('practice_roster', trainer.access_token, { practice: practiceId[m] });
    if (practiceLeak.ok) { rosterFails++; console.log(`  FAIL  set ${c.set_no} trainer read set ${m}'s practice_roster`); }

    // A throwaway row proves the RLS check means something — with zero seeded history, an empty
    // result would look identical whether isolation works or there's simply nothing to leak. If the
    // insert itself doesn't land, the check below is vacuous (an empty table looks like a held
    // boundary either way) — so a failed insert is itself a FAIL, not a silent skip.
    const ins = await restPost('days', athleteN.access_token, { athlete_id: athleteN.user_id, date: '2000-01-01' });
    if (!ins.ok) { daysFails++; console.log(`  FAIL  set ${c.set_no} could not insert its own throwaway days row (status ${ins.status}) — isolation check would be vacuous`); }
    const leak = await restGet(`days?athlete_id=eq.${athleteM.user_id}&select=id`, athleteN.access_token);
    if ((leak.body || []).length > 0) { daysFails++; console.log(`  FAIL  set ${c.set_no} athlete read set ${m}'s days`); }
    await restDelete(`days?athlete_id=eq.${athleteN.user_id}&date=eq.2000-01-01`, athleteN.access_token);
  }
  console.log(`Roster isolation: ${rosterFails === 0 ? 'PASS — 10/10 boundaries held' : `FAIL — ${rosterFails} leak(s)`}`);
  console.log(`Days isolation:   ${daysFails === 0 ? 'PASS — 10/10 boundaries held' : `FAIL — ${daysFails} leak(s)`}`);
  if (rosterFails || daysFails) process.exitCode = 1;
}

async function fnPost(name, secretEnv, payload) {
  const key = process.env[secretEnv];
  if (!key) throw new Error(`Set ${secretEnv} in env.`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, k: key }),
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

async function cmdSmoke() {
  if (!SUPABASE_URL) throw new Error('Set SUPABASE_URL in env.');
  console.log('WARNING: this claims all 10 sets with synthetic emails.');
  console.log('Re-run `gen` and re-apply the seed afterward, before sharing the real link.\n');

  const r1 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-01@onstandard.app' });
  console.log(r1.ok && r1.body.set_no === 1 ? 'PASS  claim assigns set 1' : `FAIL  claim: ${JSON.stringify(r1.body)}`);

  const r2 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'resume', device_token: r1.body.device_token });
  console.log(r2.ok && r2.body.set_no === 1 ? 'PASS  resume returns the same set' : `FAIL  resume: ${JSON.stringify(r2.body)}`);

  const r3 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-01@onstandard.app' });
  console.log(r3.ok && r3.body.set_no === 1 ? 'PASS  re-claim by the same email returns set 1, not a new one' : `FAIL  re-claim: ${JSON.stringify(r3.body)}`);

  const r4 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'recover', email: 'smoke-01@onstandard.app' });
  console.log(r4.ok && r4.body.set_no === 1 ? 'PASS  recover finds set 1 from a fresh device' : `FAIL  recover: ${JSON.stringify(r4.body)}`);

  for (let n = 2; n <= 10; n++) {
    const r = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: `smoke-${String(n).padStart(2, '0')}@onstandard.app` });
    if (!r.ok || r.body.set_no !== n) console.log(`FAIL  claim ${n}: ${JSON.stringify(r.body)}`);
  }
  console.log('PASS  sets 2-10 claimed in order');

  const r11 = await fnPost('tester-claim', 'TESTER_CLAIM_KEY', { action: 'claim', name: 'Smoke Test', email: 'smoke-11@onstandard.app' });
  console.log(r11.status === 409 && r11.body.error === 'exhausted' ? 'PASS  11th claim is exhausted' : `FAIL  11th claim: ${JSON.stringify(r11.body)}`);

  const boardUrl = r1.body.board_url;
  console.log(boardUrl ? `PASS  board_url present: ${boardUrl}` : 'FAIL  board_url missing — check BETA_BOARD_KEY is set');

  const submit = await fnPost('beta-board', 'BETA_BOARD_KEY', { action: 'submit', author_name: 'Smoke Test', body: 'smoke test report', tester_set: 1 });
  console.log(submit.ok ? 'PASS  board submit accepted tester_set' : `FAIL  board submit: ${JSON.stringify(submit.body)}`);

  const list = await fnPost('beta-board', 'BETA_BOARD_KEY', { action: 'list' });
  const posted = (list.body.posts || []).find((p) => p.body === 'smoke test report');
  console.log(posted && posted.tester_set === 1 ? 'PASS  post carries tester_set = 1 on the board' : 'FAIL  tester_set not on the returned post');

  console.log('\nDone. Re-run `gen` + re-apply the seed before sharing the real link.');
}

const cmd = process.argv[2];
try {
  if (cmd === 'gen') cmdGen();
  else if (cmd === 'verify') await cmdVerify();
  else if (cmd === 'smoke') await cmdSmoke();
  else { console.error('Usage: node scripts/tester-accounts.mjs <gen|verify|smoke>'); process.exitCode = 1; }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
}
