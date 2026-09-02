#!/usr/bin/env node
// OnStandard — prove an APNs Auth Key actually works, before it goes anywhere near a build.
//
// WHY THIS EXISTS. The three values a Live Activity push needs (the .p8, the Key ID, the Team ID)
// fail in ways that look identical from the outside: nothing arrives. Worse, the most common
// mistake is using an App Store Connect API key instead of an APNs Auth Key — both are ES256 .p8
// files from Apple, and the wrong one produces a perfectly well-formed token that APNs rejects.
//
// HOW IT PROVES IT WITHOUT TOUCHING A PHONE. It sends one push to a deliberately invalid device
// token. Apple checks the AUTHORIZATION FIRST and the device token second, so:
//
//   "BadDeviceToken"        the key, the Key ID, the Team ID and the topic are ALL correct.
//                           This is the SUCCESS case. Nothing was delivered to anyone.
//   "InvalidProviderToken"  wrong key file, wrong Key ID, or the key is not an APNs key.
//   "ExpiredProviderToken"  the machine's clock is wrong (the token carries a timestamp).
//   "TopicDisallowed"       the bundle id does not match the key's team, or the key is
//                           topic-specific and was not configured for this app.
//
// USAGE
//   node scripts/apns-check.mjs --p8 ./AuthKey_ABC1234XYZ.p8 --key-id ABC1234XYZ --team-id C44B6N2KC6
//   (--bundle-id defaults to com.onstandard.app; add --sandbox to test the development gateway)
//
// Reads nothing from the environment and writes nothing anywhere. Safe to run as often as you like.
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import http2 from 'node:http2';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i]);
}

const p8Path = args.get('p8');
const keyId = args.get('key-id');
const teamId = args.get('team-id');
const bundleId = args.get('bundle-id') || 'com.onstandard.app';
const sandbox = args.get('sandbox') === true;

const RED = '\x1b[31m'; const GRN = '\x1b[32m'; const YEL = '\x1b[33m'; const DIM = '\x1b[2m'; const RST = '\x1b[0m';

if (!p8Path || !keyId || !teamId) {
  console.error(`Usage:
  node scripts/apns-check.mjs --p8 <AuthKey_XXXXXXXXXX.p8> --key-id <10 chars> --team-id <10 chars>
                              [--bundle-id com.onstandard.app] [--sandbox]

  --p8       the file downloaded from developer.apple.com -> Keys, with
             "Apple Push Notifications service" ticked. NOT an App Store Connect key.
  --key-id   the 10-character Key ID shown next to that key.
  --team-id  the 10-character Team ID (top right of the developer portal).`);
  process.exit(2);
}

let p8;
try {
  p8 = readFileSync(p8Path, 'utf8');
} catch (e) {
  console.error(`${RED}Cannot read ${p8Path}${RST}\n  ${e.message}`);
  process.exit(2);
}

// A first, free sanity check: is this even an EC private key?
let key;
try {
  key = createPrivateKey(p8);
} catch (e) {
  console.error(`${RED}That file is not a private key Node can read.${RST}\n  ${e.message}`);
  process.exit(1);
}
if (key.asymmetricKeyType !== 'ec') {
  console.error(`${RED}That key is ${key.asymmetricKeyType}, not EC.${RST} APNs supports only ES256 (P-256) keys.`);
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Exactly the four fields Apple documents: {alg,kid} / {iss,iat}. No exp, no aud.
const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
// ieee-p1363 is the raw r||s pair JWS wants; the default DER encoding is silently rejected.
const signature = b64url(cryptoSign(null, Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }));
const jwt = `${header}.${claims}.${signature}`;

const host = sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
// 64 hex zeros: syntactically a device token, belonging to nothing. Apple validates our
// authorization before it looks this up, which is exactly what makes the check safe.
const fakeToken = '0'.repeat(64);

console.log(`${DIM}key      ${p8Path} (EC, ${key.asymmetricKeyDetails?.namedCurve ?? 'P-256'})
key id   ${keyId}
team id  ${teamId}
topic    ${bundleId}.push-type.liveactivity
gateway  ${host}${RST}\n`);

const client = http2.connect(host);
client.on('error', (e) => {
  console.error(`${RED}Could not reach ${host}${RST}\n  ${e.message}`);
  process.exit(1);
});

const body = JSON.stringify({
  aps: {
    timestamp: Math.floor(Date.now() / 1000),
    event: 'update',
    'content-state': {},
  },
});

const req = client.request({
  ':method': 'POST',
  ':path': `/3/device/${fakeToken}`,
  authorization: `bearer ${jwt}`,
  'apns-push-type': 'liveactivity',
  'apns-topic': `${bundleId}.push-type.liveactivity`,
  'apns-priority': '10',
  'content-type': 'application/json',
});

let status = 0;
let payload = '';
req.on('response', (h) => { status = Number(h[':status']); });
req.setEncoding('utf8');
req.on('data', (c) => { payload += c; });
req.on('end', () => {
  client.close();
  let reason = '';
  try { reason = JSON.parse(payload).reason ?? ''; } catch { reason = payload.trim(); }

  if (reason === 'BadDeviceToken') {
    console.log(`${GRN}PASS.${RST} Apple accepted the key, the Key ID, the Team ID and the topic.`);
    console.log(`${DIM}(It rejected only the fake device token, which is the point. Nothing was sent to anyone.)${RST}\n`);
    console.log('Set these three secrets and the server half is live:\n');
    console.log(`  supabase secrets set APNS_KEY_P8="$(cat ${p8Path})"`);
    console.log(`  supabase secrets set APNS_KEY_ID=${keyId}`);
    console.log(`  supabase secrets set APNS_TEAM_ID=${teamId}`);
    process.exit(0);
  }

  const advice = {
    InvalidProviderToken:
      'The key, the Key ID or the Team ID is wrong.\n' +
      '  The usual cause: this is an App Store Connect API key, not an APNs Auth Key.\n' +
      '  An APNs key comes from developer.apple.com -> Certificates, Identifiers & Profiles ->\n' +
      '  Keys, with the "Apple Push Notifications service" box ticked when you created it.\n' +
      '  Also check the Key ID matches THIS file (it is in the filename: AuthKey_<KEYID>.p8).',
    ExpiredProviderToken:
      "This machine's clock is off. The token carries a timestamp and Apple rejects one more\n" +
      '  than an hour old. Fix the system clock and run this again.',
    TopicDisallowed:
      `The key is not allowed to push for ${bundleId}.\n` +
      '  Either the key belongs to a different team, or it is a topic-specific key that was not\n' +
      '  configured for this app. A team-scoped key is the simpler choice.',
    Forbidden:
      'Apple refused the token outright. Re-download the key or create a new one.',
    BadTopic: `The topic ${bundleId}.push-type.liveactivity was rejected. Check --bundle-id.`,
  }[reason];

  console.log(`${RED}FAIL.${RST} Apple answered ${status} ${reason || '(no reason given)'}\n`);
  if (advice) console.log(`  ${advice}`);
  else console.log(`  Raw response: ${payload || '(empty)'}`);
  process.exit(1);
});
req.on('error', (e) => {
  console.error(`${RED}Request failed${RST}\n  ${e.message}`);
  process.exit(1);
});
req.end(body);
