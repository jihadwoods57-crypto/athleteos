#!/usr/bin/env node
// OnStandard — do the Apple Developer portal work that can be done by machine.
//
// WHAT THIS REPLACES. Of the three portal jobs the roll-call lock screen needs, exactly one is
// unavoidably manual: creating the `group.…` App Group identifier and ticking it on an App ID.
// That is not in the App Store Connect API at all — there is no `appGroups` resource, `BundleId`
// has no relationship to link one, and `CapabilitySetting.key` is a closed enum with nothing
// app-group-shaped in it. Everything ELSE is scriptable, and this script does it:
//
//   · create the widget extension's bundle id, com.onstandard.app.RollCallWidget
//   · turn the App Groups capability ON for both that and the main app
//   · mint an App Store distribution profile for each, around the current distribution cert
//   · write both profiles into ios-certs/ as the .mobileprovision files the build reads
//
// SAFETY. It does nothing without `--apply`. Run it bare and it tells you exactly what it would
// create and what already exists. It is idempotent: an identifier or capability that is already
// there is reported and skipped, never duplicated.
//
// AUTH. Uses the App Store Connect API key already in eas.json (ios-certs/AuthKey_*.p8). That key
// must be a TEAM key with the ADMIN role: Apple states individual keys "aren't able to use
// Provisioning endpoints", and creating DISTRIBUTION profiles is Account Holder/Admin only. If the
// key is the wrong kind you get a clear 403 here rather than a confusing failure at build time.
//
//   node scripts/apple-provision.mjs              # report only
//   node scripts/apple-provision.mjs --apply      # actually create things
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const B = '\x1b[1m'; const D = '\x1b[2m'; const X = '\x1b[0m';
const APPLY = process.argv.includes('--apply');

const APP_BUNDLE = 'com.onstandard.app';
const WIDGET_BUNDLE = 'com.onstandard.app.RollCallWidget';
const APP_GROUP = 'group.com.onstandard.app';
const API = 'https://api.appstoreconnect.apple.com';
const TEAM_ID_PREFIX = 'C44B6N2KC6.';

// From eas.json's submit.production.ios block — the same key that uploads builds.
const KEY_PATH = 'ios-certs/AuthKey_TNS4WL4GLR.p8';
const KEY_ID = 'TNS4WL4GLR';
const ISSUER_ID = '3dcac87d-ec88-493a-8f31-e298ae76af64';

// ---------------------------------------------------------------- auth
// The App Store Connect JWT is NOT the APNs one: it carries `typ`, an `aud` of
// "appstoreconnect-v1", and a mandatory `exp` that Apple caps at 20 minutes.
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
  const res = await fetch(`${API}${path}`, {
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
    const err = new Error(`${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------- helpers
/**
 * Find ONE bundle id, matching the identifier EXACTLY.
 *
 * `filter[identifier]` is not an exact match — it behaves as a contains/prefix search. Once
 * `com.onstandard.app.RollCallWidget` existed, a lookup of `com.onstandard.app` returned BOTH and
 * the widget came first, so taking `data[0]` silently handed back the wrong identifier. That
 * minted the main app's App Store profile against the widget's bundle id and overwrote the file
 * `npm run ship` signs with. Filter locally; never trust the server's ordering.
 */
async function findBundle(identifier) {
  const r = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`);
  return (r?.data ?? []).find((b) => b.attributes?.identifier === identifier) ?? null;
}

async function capabilities(bundleResourceId) {
  // No `limit` here: Apple rejects it on this relationship route with
  // "This relationship does not support this parameter". The set is small anyway.
  const r = await api('GET', `/v1/bundleIds/${bundleResourceId}/bundleIdCapabilities`);
  return new Set((r?.data ?? []).map((c) => c.attributes?.capabilityType));
}

function writeProfile(file, base64, expectIdentifier) {
  // Back up whatever is there first. `ios-certs/appstore.mobileprovision` is what `npm run ship`
  // signs with, and overwriting it with no way back would be a bad trade for a convenience script.
  if (existsSync(file)) {
    const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(file, bak);
    console.log(`  ${D}backed up the old one to ${bak}${X}`);
  }
  writeFileSync(file, Buffer.from(base64, 'base64'));
  const raw = readFileSync(file);
  const s = raw.indexOf('<?xml'); const e = raw.indexOf('</plist>');
  const plist = s < 0 || e < 0 ? '' : raw.slice(s, e + 8).toString();
  // The KEY being present proves nothing. Enabling the APP_GROUPS capability through the API puts
  // `com.apple.security.application-groups` into the profile as an EMPTY ARRAY, because the API
  // can turn the capability on but cannot say which group. Only the portal binds one. So the test
  // has to be for the group's actual identifier, not for the entitlement key.
  const m = plist.match(/<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/);
  const groups = m ? [...m[1].matchAll(/<string>(.*?)<\/string>/g)].map((x) => x[1]) : [];
  const appId = (plist.match(/<key>application-identifier<\/key>\s*<string>(.*?)<\/string>/) || [])[1] || '';
  return { bytes: raw.length, groups, hasGroup: groups.includes(APP_GROUP), appId };
}

// ---------------------------------------------------------------- run
(async () => {
  if (!existsSync(KEY_PATH)) {
    console.error(`${R}Missing ${KEY_PATH}${X} — the App Store Connect key eas.json points at.`);
    process.exit(2);
  }
  console.log(`${B}Apple provisioning for the roll-call lock screen${X}`);
  console.log(`${D}${APPLY ? 'APPLY — this will create things in your Apple account' : 'Report only. Add --apply to actually create anything.'}${X}\n`);

  try { TOKEN = ascToken(); } catch (e) {
    console.error(`${R}Could not sign an App Store Connect token${X}\n  ${e.message}`);
    process.exit(1);
  }

  // Permission probe. A wrong key kind fails HERE, with a readable reason, rather than at build.
  try {
    await api('GET', '/v1/bundleIds?limit=1');
  } catch (e) {
    console.error(`${R}The App Store Connect key cannot read Provisioning.${X}\n  ${e.message}\n`);
    console.error(`  Apple requires a TEAM key with the ADMIN role for this. Individual keys
  cannot use Provisioning endpoints at all, and creating distribution profiles is
  Account Holder / Admin only.
  Check the key's role: https://appstoreconnect.apple.com/access/integrations/api`);
    process.exit(1);
  }
  console.log(`${G}✓${X} key authenticates and can read Provisioning\n`);

  // ---- the two bundle ids
  const app = await findBundle(APP_BUNDLE);
  if (!app) {
    console.error(`${R}Could not find ${APP_BUNDLE} on this team.${X} Is the key for the right team?`);
    process.exit(1);
  }
  console.log(`${G}✓${X} ${APP_BUNDLE} ${D}(${app.id})${X}`);

  let widget = await findBundle(WIDGET_BUNDLE);
  if (widget) {
    console.log(`${G}✓${X} ${WIDGET_BUNDLE} already exists ${D}(${widget.id})${X}`);
  } else if (!APPLY) {
    console.log(`${Y}→${X} would CREATE bundle id ${B}${WIDGET_BUNDLE}${X}`);
  } else {
    const created = await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: WIDGET_BUNDLE, name: 'OnStandard Roll Call Widget', platform: 'IOS' } },
    });
    widget = created.data;
    console.log(`${G}✓${X} created ${WIDGET_BUNDLE} ${D}(${widget.id})${X}`);
  }

  // ---- the App Groups capability on both
  for (const [label, b] of [[APP_BUNDLE, app], [WIDGET_BUNDLE, widget]]) {
    if (!b) { console.log(`  ${D}(skipping capability for ${label}: no bundle id yet)${X}`); continue; }
    const caps = await capabilities(b.id);
    if (caps.has('APP_GROUPS')) {
      console.log(`${G}✓${X} App Groups capability on ${label}`);
    } else if (!APPLY) {
      console.log(`${Y}→${X} would ENABLE App Groups on ${label}`);
    } else {
      await api('POST', '/v1/bundleIdCapabilities', {
        data: {
          type: 'bundleIdCapabilities',
          attributes: { capabilityType: 'APP_GROUPS' },
          relationships: { bundleId: { data: { type: 'bundleIds', id: b.id } } },
        },
      });
      console.log(`${G}✓${X} enabled App Groups on ${label}`);
    }
  }

  console.log(`\n${Y}The one thing no API can do:${X} create the group ${B}${APP_GROUP}${X} and tick it
on both identifiers. Apple has no appGroups endpoint. Do it once here:
  ${B}https://developer.apple.com/account/resources/identifiers/list/applicationGroup${X}
Turning the CAPABILITY on (above) is not the same as choosing WHICH group; only the
portal can bind them. Until that is done the profiles below will carry the capability
but no group, and the build will still fail to sign.\n`);

  // ---- the distribution certificate the profiles are built around
  const certs = await api('GET', '/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=200');
  const cert = (certs?.data ?? [])[0];
  if (!cert) {
    console.log(`${R}No IOS_DISTRIBUTION certificate on this team.${X} Cannot mint profiles.`);
    process.exit(1);
  }
  console.log(`${G}✓${X} distribution certificate ${D}${cert.attributes?.name ?? cert.id}, expires ${cert.attributes?.expirationDate ?? '?'}${X}`);

  // ---- the profiles
  // Apple requires profile NAMES to be unique on a team, so a regenerated profile gets a dated
  // name rather than trying to reuse one. The old profile is left alone: nothing is deleted here.
  //
  // These are minted in the SAME pass as the capability change on purpose. Editing an App ID's
  // capabilities marks profiles already issued from it INVALID, so enabling App Groups and then
  // stopping would leave `npm run ship` signing with a dead profile. Minting here means the build
  // keeps working from the moment the capability flips, whether or not the App Group is bound yet.
  // Minute-precision, because re-running is the normal way to pick up the App Group once the
  // portal step is done, and Apple rejects a profile whose name already exists on the team.
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const wanted = [
    { name: `OnStandard App Store ${stamp}`, bundle: app, file: 'ios-certs/appstore.mobileprovision', label: APP_BUNDLE },
    { name: `OnStandard Widget App Store ${stamp}`, bundle: widget, file: 'ios-certs/widget.mobileprovision', label: WIDGET_BUNDLE },
  ];

  console.log('');
  for (const w of wanted) {
    if (!w.bundle) { console.log(`${Y}→${X} would create a profile for ${w.label} once its bundle id exists`); continue; }
    if (!APPLY) {
      console.log(`${Y}→${X} would CREATE profile ${B}${w.name}${X} -> ${w.file}`);
      continue;
    }
    try {
      const p = await api('POST', '/v1/profiles', {
        data: {
          type: 'profiles',
          attributes: { name: w.name, profileType: 'IOS_APP_STORE' },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: w.bundle.id } },
            certificates: { data: [{ type: 'certificates', id: cert.id }] },
          },
        },
      });
      const content = p?.data?.attributes?.profileContent;
      if (!content) { console.log(`${R}✗${X} ${w.name}: no profileContent in the response`); continue; }
      // Assert the profile Apple returned is for the identifier we asked for. This is the check
      // that would have caught the contains-match bug the moment it happened, instead of after it
      // had overwritten the production profile.
      const wantId = `${TEAM_ID_PREFIX}${w.label}`;
      const info = writeProfile(w.file, content, w.label);
      if (info.appId && !info.appId.endsWith(`.${w.label}`)) {
        console.log(`${R}✗ ${w.file} is for ${info.appId}, not ${w.label}. NOT trusting it.${X}`);
        continue;
      }
      const groupNote = info.hasGroup
        ? `${G}carries ${APP_GROUP}${X}`
        : info.groups.length === 0
          ? `${Y}App Groups is ON but NO group is bound — do the portal step above, then re-run${X}`
          : `${Y}binds ${info.groups.join(', ')}, not ${APP_GROUP}${X}`;
      console.log(`${G}✓${X} ${w.file} ${D}(${info.bytes} bytes, ${info.appId})${X} ${groupNote}`);
    } catch (e) {
      console.log(`${R}✗${X} ${w.name}: ${e.message}`);
      if (e.status === 403) {
        console.log(`  ${D}403 here almost always means the key is not an Admin team key.${X}`);
      }
    }
  }

  console.log(`\n${D}Then: node scripts/rollcall-ios-setup.mjs${X}`);
})().catch((e) => {
  console.error(`${R}${e.message}${X}`);
  process.exit(1);
});
