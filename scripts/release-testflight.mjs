// OnStandard — release the just-shipped build to EXTERNAL TestFlight testers.
//
// WHY THIS EXISTS (2026-09-21, found the hard way)
// `npm run ship` built and uploaded fine for seven weeks and every external tester stayed on
// build 25 from 31 July. Uploading a build to TestFlight does NOT release it: an external tester
// can only install a build that has (a) been attached to their beta group and (b) passed Apple's
// Beta App Review. Builds 26 through 41 had neither, so the public link served July code while
// the founder — an INTERNAL tester, who skips beta review entirely — saw every build instantly.
// Two people on two different products, and nothing in the pipeline said so.
//
// The failure was silent in the worst way: `eas submit` succeeds, TestFlight shows the build,
// App Store Connect shows it VALID. Everything looks shipped. Only the testers' own TestFlight
// says "Open" instead of "Update", and nobody on this side of the wall ever sees that screen.
//
// So this step is part of shipping now, not a thing to remember. It is idempotent: re-running it
// on an already-released build reports that and exits 0.
//
// Runs after `eas submit`. Needs the App Store Connect key at ios-certs/ (same one
// scripts/apple-provision.mjs uses; the JWT helper is duplicated there rather than shared,
// because that script is load-bearing for signing and not worth refactoring for this).
//
//   node scripts/release-testflight.mjs            # release the newest build
//   node scripts/release-testflight.mjs --build 41 # a specific build number
//   WHAT_TO_TEST="..." node scripts/release-testflight.mjs
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const APP_ID = '6787705639';
const KEY_PATH = 'ios-certs/AuthKey_TNS4WL4GLR.p8';
const KEY_ID = 'TNS4WL4GLR';
const ISSUER_ID = '3dcac87d-ec88-493a-8f31-e298ae76af64';
const API = 'https://api.appstoreconnect.apple.com';

const tty = process.stdout.isTTY;
const c = (code) => (tty ? code : '');
const RED = c('\x1b[31m'), GRN = c('\x1b[32m'), YEL = c('\x1b[33m');
const DIM = c('\x1b[2m'), BOLD = c('\x1b[1m'), RST = c('\x1b[0m');

const argv = process.argv.slice(2);
const wantBuild = (() => {
  const i = argv.indexOf('--build');
  return i >= 0 ? String(argv[i + 1]) : null;
})();

// The ASC JWT: ES256, aud appstoreconnect-v1, and an exp Apple caps at 20 minutes. Minted per
// run rather than per request — a release takes well under that.
function ascToken() {
  const key = createPrivateKey(readFileSync(KEY_PATH, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
  const body = b64({ iss: ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = cryptoSign(null, Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${head}.${body}.${sig}`;
}

let TOKEN;
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.title}: ${e.detail ?? ''}`).join('; ') || text.slice(0, 300);
    throw new Error(`${res.status} ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  TOKEN = ascToken();
} catch (e) {
  console.error(`${RED}✗ release: cannot read ${KEY_PATH} — ${e.message}${RST}`);
  console.error(`${DIM}  The build IS uploaded; it is just not released to external testers yet.${RST}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. find the build
// ASC needs the build PROCESSED before it can be attached or submitted. A freshly uploaded
// build sits in PROCESSING for a few minutes, and every call against it fails until it does.
let build = null;
const deadline = Date.now() + 25 * 60 * 1000;
for (let first = true; ; first = false) {
  const r = await api('GET', `/v1/builds?filter[app]=${APP_ID}&limit=10&sort=-version`);
  const rows = r.data || [];
  build = wantBuild
    ? rows.find((b) => String(b.attributes.version) === wantBuild)
    : rows[0];
  if (!build) {
    console.error(`${RED}✗ release: no build${wantBuild ? ` numbered ${wantBuild}` : ''} found for app ${APP_ID}.${RST}`);
    process.exit(1);
  }
  const state = build.attributes.processingState;
  if (state === 'VALID') break;
  if (state === 'FAILED' || state === 'INVALID') {
    console.error(`${RED}✗ release: build ${build.attributes.version} is ${state}. Nothing to release.${RST}`);
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error(`${RED}✗ release: build ${build.attributes.version} still ${state} after 25 minutes.${RST}`);
    console.error(`${DIM}  Re-run when it finishes: node scripts/release-testflight.mjs --build ${build.attributes.version}${RST}`);
    process.exit(1);
  }
  if (first) console.log(`${DIM}  build ${build.attributes.version} is ${state}; waiting for Apple to finish processing…${RST}`);
  await sleep(30_000);
}

const NUM = String(build.attributes.version);
console.log(`${BOLD}Releasing build ${NUM} to external TestFlight${RST}`);

// ---------------------------------------------------------------- 2. What to Test
// REQUIRED for an external submission — an empty one is rejected. Defaults to the commit
// subject, which is the honest answer to "what changed", and is overridable for a real release note.
const locs = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations`);
let whatsNew = process.env.WHAT_TO_TEST;
if (!whatsNew) {
  let subject = '';
  // execFileSync, not execSync: no shell, so nothing in a commit subject can be interpreted.
  try { subject = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
  whatsNew = subject || `Build ${NUM}.`;
}
const en = (locs.data || []).find((l) => l.attributes.locale === 'en-US') || (locs.data || [])[0];
if (en) {
  const current = (en.attributes.whatsNew || '').trim();
  // A note someone WROTE outranks a generated one. The commit subject is a fallback for the
  // empty case, not the truth about a release — the first run of this script overwrote a
  // hand-written build 41 note with "refactor(press): the other 23 press rules join the scale",
  // which is accurate about the last commit and useless to a tester. An explicit WHAT_TO_TEST
  // still wins, because that IS someone writing it.
  if (current && !process.env.WHAT_TO_TEST) {
    console.log(`  ${DIM}What to Test already written, left alone${RST}`);
  } else if (current === whatsNew.trim()) {
    console.log(`  ${DIM}What to Test already set${RST}`);
  } else {
    await api('PATCH', `/v1/betaBuildLocalizations/${en.id}`, {
      data: { type: 'betaBuildLocalizations', id: en.id, attributes: { whatsNew } },
    });
    console.log(`  ${GRN}✓${RST} What to Test set ${DIM}${whatsNew.slice(0, 60)}${whatsNew.length > 60 ? '…' : ''}${RST}`);
  }
} else {
  await api('POST', '/v1/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: 'en-US', whatsNew },
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  console.log(`  ${GRN}✓${RST} What to Test created (en-US)`);
}

// ---------------------------------------------------------------- 3. attach to external groups
// Every EXTERNAL group, not a named one: the public link belongs to a group, and a second group
// added later must not quietly stop receiving builds because this script named only the first.
const groups = await api('GET', `/v1/apps/${APP_ID}/betaGroups?limit=50`);
const external = (groups.data || []).filter((g) => !g.attributes.isInternalGroup);
if (!external.length) {
  console.error(`${YEL}! no external beta group exists — nothing to release to.${RST}`);
  process.exit(1);
}
for (const g of external) {
  const rel = await api('GET', `/v1/betaGroups/${g.id}/relationships/builds?limit=50`);
  if ((rel.data || []).some((b) => b.id === build.id)) {
    console.log(`  ${DIM}already on "${g.attributes.name}"${RST}`);
    continue;
  }
  await api('POST', `/v1/betaGroups/${g.id}/relationships/builds`, {
    data: [{ type: 'builds', id: build.id }],
  });
  console.log(`  ${GRN}✓${RST} attached to "${g.attributes.name}"${g.attributes.publicLinkEnabled ? ` ${DIM}(public link)${RST}` : ''}`);
}

// ---------------------------------------------------------------- 4. Beta App Review
const existing = await api('GET', `/v1/builds/${build.id}/betaAppReviewSubmission`);
let state = existing?.data?.attributes?.betaReviewState || null;
if (state) {
  console.log(`  ${DIM}already submitted for review: ${state}${RST}`);
} else {
  const sub = await api('POST', '/v1/betaAppReviewSubmissions', {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  state = sub.data.attributes.betaReviewState;
  console.log(`  ${GRN}✓${RST} submitted for Beta App Review ${DIM}(${state})${RST}`);
}

console.log('');
if (state === 'APPROVED') {
  console.log(`${GRN}${BOLD}Build ${NUM} is live for external testers.${RST} Their TestFlight now offers Update.`);
} else {
  console.log(`${YEL}Build ${NUM} is ${state}.${RST} External testers get it once Apple approves ${DIM}(usually within a day)${RST}.`);
  console.log(`${DIM}Check later: node scripts/release-testflight.mjs --build ${NUM}${RST}`);
}
