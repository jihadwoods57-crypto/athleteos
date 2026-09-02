#!/usr/bin/env node
// OnStandard — "where am I, and what do I do next?" for the roll-call lock screen on iOS.
//
// The iOS card needs three things that only exist after somebody has been into the Apple Developer
// portal. Each one fails in a way that looks like nothing happening, and they have to be done in
// order. So rather than a checklist you have to hold in your head, this checks the actual state of
// each one and prints the single next action.
//
//   node scripts/rollcall-ios-setup.mjs            what is done, what is next
//   node scripts/rollcall-ios-setup.mjs --set-secrets --p8 <file> --key-id <id>
//                                                  verifies the key, then sets the 3 secrets
//
// Safe to run any time. Reads state; the only thing that writes anything is --set-secrets, and it
// refuses to run unless the key has passed a live check against Apple first.
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const B = '\x1b[1m'; const D = '\x1b[2m'; const X = '\x1b[0m';
const tick = `${G}✓${X}`; const cross = `${Y}○${X}`;

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i]);
}

const TEAM_ID = 'C44B6N2KC6';
const BUNDLE_ID = 'com.onstandard.app';
const WIDGET_BUNDLE_ID = 'com.onstandard.app.RollCallWidget';
const APP_GROUP = 'group.com.onstandard.app';

/** The XML plist inside a CMS-signed .mobileprovision. */
function profilePlist(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path);
  const s = raw.indexOf('<?xml');
  const e = raw.indexOf('</plist>');
  return s < 0 || e < 0 ? null : raw.slice(s, e + 8).toString('utf8');
}

// `npx` on Windows is a .cmd, which execFile cannot launch directly, and PATHEXT resolution does
// not apply to execFile either. Going through cmd.exe is the reliable route; every argument this
// script passes that way is a fixed literal with no spaces, so cmd's own re-parsing is harmless.
// (Anything with user content in it goes through a file instead — see setSecrets.)
const WIN = process.platform === 'win32';
function npx(argv, opts = {}) {
  return WIN
    ? execFileSync('cmd.exe', ['/c', 'npx', ...argv], opts)
    : execFileSync('npx', argv, opts);
}

function run(argv) {
  try {
    return npx(argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- state
const secretsRaw = run(['supabase', 'secrets', 'list', '--output', 'json']);
let secretNames = null; // null = could not read (not linked / offline), so do not claim anything
if (secretsRaw) {
  try { secretNames = new Set((JSON.parse(secretsRaw).secrets ?? []).map((s) => s.name)); } catch { /* leave null */ }
}
const hasApnsSecrets = secretNames
  ? ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID'].every((k) => secretNames.has(k))
  : null;

const appStore = profilePlist('ios-certs/appstore.mobileprovision');
const hasAppGroup = appStore === null ? null : appStore.includes('application-groups');

const widgetProfile = profilePlist('ios-certs/widget.mobileprovision');
const hasWidgetProfile = widgetProfile !== null && widgetProfile.includes(WIDGET_BUNDLE_ID);

let pluginHasGroup = false;
try {
  const appJson = JSON.parse(readFileSync('app.json', 'utf8'));
  const entry = (appJson.expo.plugins ?? []).find((p) => Array.isArray(p) && String(p[0]).includes('withRollCallLiveActivity'));
  pluginHasGroup = !!(entry && entry[1] && entry[1].appGroup);
} catch { /* leave false */ }

// ---------------------------------------------------------------- --set-secrets
if (args.get('set-secrets')) {
  const p8 = args.get('p8');
  const keyId = args.get('key-id');
  if (!p8 || !keyId) {
    console.error(`${R}Need --p8 <file> and --key-id <10 chars>.${X}`);
    process.exit(2);
  }
  console.log(`${B}Checking the key against Apple first...${X}\n`);
  try {
    execFileSync(process.execPath, ['scripts/apns-check.mjs', '--p8', p8, '--key-id', keyId, '--team-id', TEAM_ID],
      { stdio: 'inherit' });
  } catch {
    console.error(`\n${R}The key did not pass. Nothing was changed.${X}`);
    console.error('Fix whatever the check reported above, then run this again.');
    process.exit(1);
  }
  console.log(`\n${B}Setting the three secrets...${X}`);
  const p8Body = readFileSync(p8, 'utf8');
  for (const [name, value] of [['APNS_KEY_P8', p8Body], ['APNS_KEY_ID', keyId], ['APNS_TEAM_ID', TEAM_ID]]) {
    try {
      execFileSync(bin('npx'), ['supabase', 'secrets', 'set', `${name}=${value}`],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      console.log(`  ${tick} ${name}`);
    } catch {
      console.error(`  ${R}✗ ${name} — could not set. Is the project linked?${X}`);
      process.exit(1);
    }
  }
  console.log(`\n${G}Step 1 is done.${X} Run this script again with no arguments to see what is next.`);
  process.exit(0);
}

// ---------------------------------------------------------------- report
console.log(`${B}The roll-call lock screen on iOS${X}`);
console.log(`${D}Team ${TEAM_ID} · ${BUNDLE_ID} · push already enabled on the App ID${X}\n`);

const s1 = hasApnsSecrets === true;
const s2 = hasAppGroup === true;
const s3 = hasWidgetProfile;

console.log(`${s1 ? tick : cross} 1. APNs Auth Key ${s1 ? '' : `${D}(the server cannot talk to Apple without it)${X}`}`);
if (hasApnsSecrets === null) console.log(`     ${Y}could not read Supabase secrets — is the project linked?${X}`);
console.log(`${s2 ? tick : cross} 2. App Group on the provisioning profile`);
if (hasAppGroup === null) console.log(`     ${Y}ios-certs/appstore.mobileprovision not found${X}`);
console.log(`${s3 ? tick : cross} 3. Widget extension identity`);
console.log('');

const done = [s1, s2, s3].filter(Boolean).length;
console.log(`${B}${done} of 3 done.${X}\n`);

if (!s1) {
  console.log(`${B}NEXT: create the APNs Auth Key.${X}
  1. Open   ${B}https://developer.apple.com/account/resources/authkeys/list${X}
  2. Click  +
  3. Name   OnStandard Push
  4. Tick   "Apple Push Notifications service (APNs)", choose Team Scoped
  5. Continue -> Register -> Download   ${D}(you only get one download)${X}
  6. Put the file in ios-certs/  ${D}(gitignored, so it stays out of the repo)${X}

  Then run, with the ten characters from the filename as the key id:

  ${B}node scripts/rollcall-ios-setup.mjs --set-secrets \\
      --p8 ios-certs/AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX${X}

  That checks the key against Apple and, only if it passes, sets all three secrets.`);
} else if (!s2) {
  console.log(`${B}NEXT: the App Group.${X}
  1. Open   ${B}https://developer.apple.com/account/resources/identifiers/list/applicationGroup${X}
     Click + , description "OnStandard Shared", identifier ${B}${APP_GROUP}${X}
     ${D}(that string is hard-coded in the app; it has to match exactly)${X}
  2. Open   ${B}https://developer.apple.com/account/resources/identifiers/list/bundleId${X}
     Click ${BUNDLE_ID} -> tick "App Groups" -> Edit -> tick ${APP_GROUP} -> Save
  3. Open   ${B}https://developer.apple.com/account/resources/profiles/list${X}
     For BOTH "OnStandard App Store" and "OnStandard AdHoc Push ...":
     open it -> Edit -> Save -> Download
     ${D}(editing the App ID does not update profiles already issued)${X}
  4. Put the downloaded files in ios-certs/ , keeping these names:
       OnStandard App Store  ->  ios-certs/appstore.mobileprovision
       OnStandard AdHoc      ->  ios-certs/profile.mobileprovision

  Then run this script again. It reads the profile and will confirm the group is in it.`);
} else if (!s3) {
  console.log(`${B}NEXT: the widget extension's identity.${X}  Two ways; A is less clicking.

  ${B}A. Let EAS do it${X}
     In eas.json, under build.production, change
       "credentialsSource": "local"   ->   "credentialsSource": "remote"
     then run  ${B}npx eas credentials -p ios${X}  and let it create what it asks about.
     Trade-off: EAS then also manages the distribution certificate.

  ${B}B. By hand${X}
     1. ${B}https://developer.apple.com/account/resources/identifiers/list/bundleId${X}
        + -> App IDs -> App -> description "OnStandard Roll Call Widget",
        explicit Bundle ID ${B}${WIDGET_BUNDLE_ID}${X} , tick App Groups -> Edit ->
        tick ${APP_GROUP} -> Continue -> Register
     2. ${B}https://developer.apple.com/account/resources/profiles/list${X}
        + -> App Store Connect -> pick ${WIDGET_BUNDLE_ID} -> your distribution
        certificate -> name it "OnStandard Widget App Store" -> Generate -> Download
     3. Save it as ${B}ios-certs/widget.mobileprovision${X}

  Then run this script again.`);
} else {
  console.log(`${G}All three are done.${X}\n`);
  console.log(`${pluginHasGroup ? tick : cross} app.json declares the App Group`);
  console.log(`${cross} widget extension target exists  ${D}(this is the part I still have to wire up)${X}\n`);
  console.log(`Tell me and I will add the App Group to app.json, add the widget target, and run a
preview build to prove the Swift compiles before anything touches ${B}npm run ship${X}.`);
}

console.log(`\n${D}Full walkthrough: docs/go-live/APPLE-PORTAL-CHECKLIST.md${X}`);
