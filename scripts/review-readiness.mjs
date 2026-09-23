// App Review readiness: the GO / NO-GO the founder runs before pressing Submit.
//
// Every check here is something that has ALREADY cost a rejection, or would. It reads the live
// truth (App Store Connect, RevenueCat, Supabase, the public site) and prints a verdict per line,
// then a grade. It never guesses from the repo: a build that is on the version, a product Apple
// is actually serving, a demo account that actually signs in, a policy page that actually says
// "Apple Health" — those are facts on servers, and that is where this looks.
//
// Run: npm run check:review          Exit 0 only when nothing is a hard NO-GO.
//
// The one thing no API exposes is the Paid Applications agreement. RevenueCat's product
// `duration` stays null until Apple serves product metadata, and Apple serves nothing while the
// agreement is Pending — so that field is the objective proxy, and it is the line that fails
// while the agreement is not Active. Submitting before it flips repeats 2.1(b) verbatim.
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const APP = '6787705639';
const BUNDLE = 'com.onstandard.app';
const RC_PROJECT = 'projb14991df';
const REVIEW_ATHLETE = 'review-athlete@onstandard.app';
const REVIEW_COACH = 'review-coach@onstandard.app';

// ---- App Store Connect (same JWT recipe as scripts/release-testflight.mjs) ----
function ascJwt() {
  const key = readFileSync(join(ROOT, 'ios-certs/AuthKey_TNS4WL4GLR.p8'), 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: 'TNS4WL4GLR', typ: 'JWT' })}.${b64({ iss: '3dcac87d-ec88-493a-8f31-e298ae76af64', iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(unsigned).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${unsigned}.${sig}`;
}
const ASC = 'https://api.appstoreconnect.apple.com';
let JWT = null;
async function asc(path) {
  JWT ||= ascJwt();
  for (let i = 0; i < 4; i++) {
    const r = await fetch(ASC + path, { headers: { Authorization: `Bearer ${JWT}` } });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (i + 1))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(j.errors || j).slice(0, 160)}`);
    return j;
  }
  throw new Error(`${path}: App Store Connect kept answering 5xx`);
}

// ---- report ----
const rows = [];
const HARD = 'hard', SOFT = 'soft';
function check(name, ok, detail, weight = HARD) { rows.push({ name, ok, detail, weight }); }
async function guard(name, weight, fn) {
  try { await fn(); } catch (e) { check(name, false, `could not verify: ${String(e.message || e).slice(0, 140)}`, weight); }
}

// 1. The version, its build, the open submission
await guard('version 1.0 has a VALID build attached', HARD, async () => {
  const vs = await asc(`/v1/apps/${APP}/appStoreVersions?limit=1&include=build`);
  const v = vs.data[0]; const b = (vs.included || []).find((i) => i.type === 'builds');
  check('version 1.0 has a VALID build attached', !!b && b.attributes.processingState === 'VALID',
    b ? `build ${b.attributes.version} (${b.attributes.processingState}), version state ${v.attributes.appStoreState}` : `no build attached; version state ${v.attributes.appStoreState}`);
  const builds = await asc(`/v1/builds?filter[app]=${APP}&sort=-uploadedDate&limit=1&include=betaAppReviewSubmission`);
  const newest = builds.data[0]; const beta = (builds.included || []).find((i) => i.type === 'betaAppReviewSubmissions');
  check('the attached build is the newest upload', !!b && !!newest && b.id === newest.id,
    newest ? `newest upload is build ${newest.attributes.version}` : 'no builds', SOFT);
  check('newest build passed Beta App Review (a crash-free signal)', beta?.attributes?.betaReviewState === 'APPROVED',
    `betaReviewState ${beta?.attributes?.betaReviewState || 'none'}`, SOFT);
  const subs = await asc(`/v1/apps/${APP}/reviewSubmissions?limit=1`);
  const s = subs.data?.[0];
  check('the rejected submission is still open to resubmit into', !!s && ['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW', 'WAITING_FOR_REVIEW'].includes(s.attributes.state),
    s ? `submission ${s.id.slice(0, 8)} is ${s.attributes.state}` : 'no submission', SOFT);
  const rd = await asc(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`);
  const a = rd.data?.attributes || {};
  check('review notes carry a demo account and stay under 4000 chars', a.demoAccountRequired === true && !!a.demoAccountName && (a.notes || '').length <= 4000,
    `demo ${a.demoAccountName || 'NONE'}, notes ${(a.notes || '').length} chars`);
  // Location is BACK (roll call rebuilt, 2026-09-23) and the notes must say where and how: region
  // monitoring for the optional walk-in check-in, never a background location mode (G-L2, G-P6).
  check('review notes explain the location feature (region monitoring, no background mode)',
    /region monitoring/i.test(a.notes || '') && !/Background mode "?location"? (is|remains) (on|used)|exists solely for that geofence|requests no location permission/i.test(a.notes || ''),
    /region monitoring/i.test(a.notes || '') ? 'region monitoring named' : 'notes do not name region monitoring');
  const loc = await asc(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  const d = loc.data?.[0]?.attributes || {};
  check('description links Terms of Use and Privacy Policy (3.1.2 metadata rule)', /onstandard\.app\/terms/.test(d.description || '') && /onstandard\.app\/privacy/.test(d.description || ''),
    'both links present');
  check('description does not name another platform (2.3.10)', !/android|google play|play store/i.test(d.description || ''), 'clean');
});

// 2. Products: exist, priced, screenshot, and — the proxy for the agreement — served by Apple
await guard('subscriptions ready', HARD, async () => {
  const groups = await asc(`/v1/apps/${APP}/subscriptionGroups`);
  let subs = [];
  for (const g of groups.data) { try { subs.push(...(await asc(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=20`)).data); } catch { /* the group listing has answered 500 since the Plus deletions */ } }
  if (!subs.length) for (const id of ['6813437416', '6813437592', '6813437473', '6813437474']) subs.push((await asc(`/v1/subscriptions/${id}`)).data);
  const bad = subs.filter((s) => s.attributes.state !== 'READY_TO_SUBMIT' && s.attributes.state !== 'APPROVED');
  check('every subscription is READY_TO_SUBMIT (they ride with the version)', bad.length === 0,
    subs.map((s) => `${s.attributes.productId}=${s.attributes.state}`).join(', '));
  for (const s of subs) {
    const shot = await asc(`/v1/subscriptions/${s.id}/appStoreReviewScreenshot`).catch(() => ({ data: null }));
    const st = shot.data?.attributes?.assetDeliveryState?.state;
    check(`review screenshot on ${s.attributes.productId}`, st === 'COMPLETE', st || 'MISSING', HARD);
  }
});
await guard('RevenueCat sees Apple serving the products', HARD, async () => {
  const r = await fetch(`https://api.revenuecat.com/v2/projects/${RC_PROJECT}/products?limit=20`, { headers: { Authorization: `Bearer ${env.RC_V2_SECRET_KEY}` } });
  const j = await r.json();
  const items = j.items || [];
  const served = items.filter((p) => p.subscription && p.subscription.duration);
  // THE DEFINITIVE SIGNAL is a purchase that went through: RevenueCat then holds a customer with a
  // subscription (sandbox purchases count). Once that exists, the metadata proxy is only a note.
  let proven = 0;
  try {
    const cs = await fetch(`https://api.revenuecat.com/v2/projects/${RC_PROJECT}/customers?limit=50`, { headers: { Authorization: `Bearer ${env.RC_V2_SECRET_KEY}` } }).then((x) => x.json());
    for (const c of cs.items || []) {
      const subs = await fetch(`https://api.revenuecat.com/v2/projects/${RC_PROJECT}/customers/${encodeURIComponent(c.id)}/subscriptions?limit=5`, { headers: { Authorization: `Bearer ${env.RC_V2_SECRET_KEY}` } }).then((x) => x.json());
      proven += (subs.items || []).length;
    }
  } catch { /* unknown stays 0: never a false yes */ }
  check('a purchase has gone through end to end (RevenueCat holds at least one subscription)', proven > 0, proven ? `${proven} subscription(s) on file` : 'none yet: buy Individual in the sandbox on the newest TestFlight build (SANDBOX-AND-RECORDING.md part 1)', proven > 0 ? SOFT : HARD);
  check('RevenueCat has fetched product metadata from Apple (Paid Applications agreement Active)', items.length > 0 && served.length === items.length,
    served.length === items.length ? `${items.length}/${items.length} products carry a duration` : `${served.length}/${items.length} products carry a duration — Apple is not serving them yet; the Paid Applications agreement is almost certainly still Pending (ASC → Business). A submission now repeats 2.1(b).`, proven > 0 ? SOFT : HARD);
  const off = await fetch(`https://api.revenuecat.com/v2/projects/${RC_PROJECT}/offerings?expand=items.package`, { headers: { Authorization: `Bearer ${env.RC_V2_SECRET_KEY}` } }).then((x) => x.json());
  const cur = (off.items || []).find((o) => o.is_current);
  check('RevenueCat current offering matches the store catalog', !!cur && items.length === 4, cur ? `offering "${cur.lookup_key}" is current; ${items.length} products` : 'no current offering');
});

// 3. The demo accounts a reviewer signs in with
await guard('demo accounts sign in', HARD, async () => {
  const url = env.EXPO_PUBLIC_SUPABASE_URL, key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const pw = { [REVIEW_ATHLETE]: env.REVIEW_ATHLETE_PW || 'Plate-Photo-2026', [REVIEW_COACH]: env.REVIEW_COACH_PW || 'Roster-Ranked-2026' };
  const tokens = {};
  for (const email of [REVIEW_ATHLETE, REVIEW_COACH]) {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw[email] }) });
    const j = await r.json();
    tokens[email] = j.access_token || null;
    check(`${email} signs in`, !!j.access_token, j.access_token ? `user ${j.user.id.slice(0, 8)}…` : (j.error_description || j.msg || 'refused'));
  }
  const t = tokens[REVIEW_ATHLETE];
  if (t) {
    const H = { apikey: key, Authorization: `Bearer ${t}` };
    const meals = await fetch(`${url}/rest/v1/meals?select=day_date&order=day_date.desc&limit=20`, { headers: H }).then((x) => x.json());
    const recent = Array.isArray(meals) ? meals.filter((m) => (Date.now() - Date.parse(m.day_date)) < 8 * 86400000).length : 0;
    check('review athlete has meals logged in the last 7 days (no empty screens)', recent > 0, `${recent} meal(s) in the last 7 days`, SOFT);
    const minor = await fetch(`${url}/rest/v1/rpc/is_provable_minor`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).sub }) }).then((x) => x.json());
    check('review athlete is an adult to the server (no guardian wall on Apple Health)', minor === false, `is_provable_minor = ${JSON.stringify(minor)}`);
  }
  const ct = tokens[REVIEW_COACH];
  if (ct) {
    const roster = await fetch(`${url}/rest/v1/team_members?select=athlete_id,status&status=eq.active`, { headers: { apikey: key, Authorization: `Bearer ${ct}` } }).then((x) => x.json());
    const n = Array.isArray(roster) ? roster.length : 0;
    check('review coach can see at least one active athlete (the roster is not empty)', n > 0, `${n} active athlete(s) visible to the coach`);
  }
  const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).then((x) => x.json());
  check('Sign in with Apple and Google are enabled on the auth server (4.8)', settings.external?.apple === true && settings.external?.google === true,
    `apple=${settings.external?.apple} google=${settings.external?.google}`);
});

// 4. The public pages the listing and the app point at
await guard('policy pages', HARD, async () => {
  const priv = await fetch('https://onstandard.app/privacy');
  const pt = await priv.text();
  check('privacy policy is live and names Apple Health (5.1.3)', priv.ok && /Apple Health/.test(pt) && !/arrival verification/i.test(pt), `${priv.status}, Apple Health ${/Apple Health/.test(pt) ? 'present' : 'MISSING'}, stale location paragraph ${/arrival verification/i.test(pt) ? 'PRESENT' : 'gone'}`);
  // The truths the binary now needs the policy to state (G-L4, G-P6). Checked on the LIVE page and
  // on the repo's copy, so a correct page that has not been deployed yet says exactly that.
  const truths = policyTruths(pt);
  check('live privacy policy states location, mic/speech, AI consent, RevenueCat and activity sharing (5.1.1, 5.1.2)', truths.ok, truths.detail);
  const local = policyTruths(readFileSync(join(ROOT, 'web/landing/privacy.html'), 'utf8'));
  check('repo privacy policy (web/landing) carries the same truths', local.ok, local.detail);
  const terms = await fetch('https://onstandard.app/terms');
  const tt = await terms.text();
  check('terms are live and carry the objectionable-content clause (1.2)', terms.ok && /objectionable/i.test(tt), `${terms.status}`);
});

// 4b. The over-the-air bundle is compiled from the EAS production ENVIRONMENT, not from eas.json
//     and not from .env (EAS CLI sets EXPO_NO_DOTENV=1 for `eas update`). On 2026-09-22 that
//     environment held only the Supabase pair, so every published update carried no RevenueCat
//     key and no Google client ids: the store and Google sign-in switched off on any device that
//     took an update, build 43 included. Every EXPO_PUBLIC_* in the production build profile
//     must also exist server-side, or the next update repeats it.
await guard('EAS production environment carries every public variable the build profile does', HARD, async () => {
  const { execSync } = await import('node:child_process');
  const want = Object.keys(JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8')).build.production.env).filter((k) => !k.startsWith('_'));
  const out = execSync('npx eas-cli env:list --environment production', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const have = new Set([...out.matchAll(/^(EXPO_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const missing = want.filter((k) => !have.has(k));
  check('EAS production environment carries every public variable the build profile does (an OTA is compiled from it)', missing.length === 0,
    missing.length ? `missing on the server: ${missing.join(', ')} — run: npx eas-cli env:create production --name <NAME> --value <value> --visibility plaintext` : `${want.length}/${want.length} present`);
});

// 5. The binary's declarations, from the tree that built it
await guard('app config', HARD, async () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
  const plist = cfg.ios?.infoPlist || {};
  // Roll call's place check is back (2026-09-23): exactly the three iOS location strings, each
  // specific, and NO `location` background mode (walk-in check-in is region monitoring, 2.5.4).
  const LOC_KEYS = ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription'];
  const locKeys = Object.keys(plist).filter((k) => /Location/.test(k)).sort();
  check('exactly the three location purpose strings, each filled in, and no location background mode (2.5.4, 5.1.1)',
    JSON.stringify(locKeys) === JSON.stringify([...LOC_KEYS].sort()) && LOC_KEYS.every((k) => String(plist[k] || '').length > 20)
      && !(plist.UIBackgroundModes || []).includes('location'),
    `${locKeys.join(', ') || 'none'}; background modes ${(plist.UIBackgroundModes || []).join(', ') || 'none'}`);
  const perms = cfg.android?.permissions || [];
  check('no Android background location permission', !perms.some((p) => /ACCESS_BACKGROUND_LOCATION/.test(p)), perms.length ? perms.map((p) => p.replace('android.permission.', '')).join(', ') : 'none', SOFT);
  const mic = String(plist.NSMicrophoneUsageDescription || '');
  check('microphone purpose string is the real one (5.1.1)', !!mic && !/PRODUCT_NAME/.test(mic) && /tap the mic in a chat/i.test(mic), mic ? 'dictation' : 'missing');
  check('camera priming button says Continue (5.1.1(iv))', /data-act="primeCamera"[^>]*>Continue</.test(readFileSync(join(ROOT, 'proto/redesign-2026-07/js/screens/camera.js'), 'utf8')), 'camera.js');
  check('assets/proto.zip is committed (the OTA ships it)', existsSync(join(ROOT, 'assets/proto.zip')), 'present');
});

/** What the privacy policy must say for this build (review pass 2026-09-23, G-L4). Pure. */
function policyTruths(html) {
  const t = String(html || '');
  const need = {
    'location section': /Location check-in/i.test(t) && /Arrived or Not arrived/.test(t) && /discarded/i.test(t) && /region monitoring/i.test(t),
    'no "Location: none"': !/Location: none/i.test(t),
    'microphone + speech': /Microphone and speech/i.test(t) && /speech recognition/i.test(t),
    'AI consent': /Anthropic/.test(t) && /Before any of your data\s+is sent/i.test(t),
    'RevenueCat subprocessor': /RevenueCat/.test(t) && /subprocessors/i.test(t),
    'activity totals to the coach': /activity totals/i.test(t),
    'teammates see roll call': /roll call board/i.test(t),
  };
  const missing = Object.keys(need).filter((k) => !need[k]);
  return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all present' };
}

// ---- verdict ----
const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok ? '  ✓ ' : r.weight === HARD ? '  ✗ ' : '  ! '}${r.name.padEnd(w)}  ${r.detail}`);
const hardFails = rows.filter((r) => !r.ok && r.weight === HARD);
const softFails = rows.filter((r) => !r.ok && r.weight === SOFT);
const passed = rows.filter((r) => r.ok).length;
const grade = hardFails.length ? 'NO-GO' : softFails.length ? 'GO, with notes' : 'GO';
console.log(`\nreview-readiness: ${passed}/${rows.length} checks passed — ${grade}`);
if (hardFails.length) console.log(`  hard blockers: ${hardFails.map((r) => r.name).join('; ')}`);
if (softFails.length) console.log(`  notes: ${softFails.map((r) => r.name).join('; ')}`);
process.exit(hardFails.length ? 1 : 0);
