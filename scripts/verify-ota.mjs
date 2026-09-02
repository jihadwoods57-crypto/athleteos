#!/usr/bin/env node
// OnStandard — PROVE that the live OTA serves the exact proto.zip on this disk.
//
// WHY THIS IS NOT OPTIONAL. An OTA's commit message is a claim, not evidence. The shipped UI is
// `assets/proto.zip` inside the update, and the ways it silently goes wrong all look identical
// from the dashboard: the zip was never rebuilt, it was rebuilt before the edit was saved, another
// session republished on top, or the update landed on a different runtime version. In every case
// the dashboard says "published" and users get the old app.
//
// THE CHAIN THIS BUILDS, and why it is airtight without downloading anything:
//   1. Read the local zip and take BOTH hashes — md5 (hex) and sha256 (base64url).
//   2. Optionally assert strings that must be INSIDE it (--expect), which is what proves the
//      edits were on disk when the zip was built. A fresh hash alone proves nothing about that.
//   3. Fetch the LIVE manifest for each platform and find its single application/zip asset.
//      The manifest's `key` IS the md5 and its `hash` IS the sha256 base64url.
//   4. Both matching means the bytes the manifest points at are the bytes checked in step 2.
//
// The asset itself CANNOT be re-downloaded to check: assets.eascdn.net answers anonymous requests
// with 403 "Unauthorized asset request" — only the app, with its own credentials, may fetch it.
// So the chain is built from the local file outwards, which is why step 2 matters.
//
//   node scripts/verify-ota.mjs
//   node scripts/verify-ota.mjs --expect wakeupPhase --expect subscribeBoard
//   node scripts/verify-ota.mjs --runtime 1.0.0 --channel production
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const G = '\x1b[32m'; const R = '\x1b[31m'; const B = '\x1b[1m'; const D = '\x1b[2m'; const X = '\x1b[0m';

const argv = process.argv.slice(2);
const expects = [];
let runtime = '1.0.0';
let channel = 'production';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--expect') expects.push(argv[++i]);
  else if (argv[i] === '--runtime') runtime = argv[++i];
  else if (argv[i] === '--channel') channel = argv[++i];
}

const ZIP = 'assets/proto.zip';
const projectId = JSON.parse(readFileSync('app.json', 'utf8')).expo.extra.eas.projectId;

const buf = readFileSync(ZIP);
const md5 = createHash('md5').update(buf).digest('hex');
const sha = createHash('sha256').update(buf).digest('base64url');

console.log(`${B}local ${ZIP}${X}`);
console.log(`  md5     ${md5}`);
console.log(`  sha256  ${sha}`);

// ---- step 2: the zip's CONTENTS, not just its hash
let contentOk = true;
if (expects.length) {
  const files = unzipSync(buf);
  const all = Object.entries(files).map(([, v]) => new TextDecoder().decode(v)).join('\n');
  console.log(`\n${B}contents${X} ${D}(${Object.keys(files).length} files)${X}`);
  for (const needle of expects) {
    const found = all.includes(needle);
    contentOk = contentOk && found;
    console.log(`  ${found ? `${G}found${X}` : `${R}MISSING${X}`}  ${JSON.stringify(needle)}`);
  }
}

/** Pull the manifest JSON out of the multipart body by brace-matching from the first `{` after the
 *  JSON part header. Splitting on the boundary is what an earlier attempt did and it is fragile:
 *  the boundary token varies and the body contains braces and quotes throughout. */
function manifestFrom(body) {
  const at = body.indexOf('Content-Type: application/json');
  const start = body.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  return null;
}

let ok = contentOk;
for (const platform of ['ios', 'android']) {
  console.log(`\n${B}=== ${platform} ===${X}`);
  let body;
  try {
    const res = await fetch(`https://u.expo.dev/${projectId}`, {
      headers: {
        'expo-platform': platform,
        'expo-runtime-version': runtime,
        'expo-channel-name': channel,
        'expo-protocol-version': '1',
        accept: 'multipart/mixed',
      },
    });
    body = await res.text();
  } catch (e) {
    console.log(`  ${R}could not reach the update server${X} ${e.message}`);
    ok = false;
    continue;
  }
  const manifest = manifestFrom(body);
  if (!manifest) { console.log(`  ${R}could not parse the manifest${X}`); ok = false; continue; }
  console.log(`  update id  ${manifest.id}`);
  console.log(`  runtime    ${manifest.runtimeVersion}`);
  const zip = (manifest.assets || []).find(
    (a) => a.contentType === 'application/zip' || a.fileExtension === '.zip',
  );
  if (!zip) { console.log(`  ${R}no zip asset in this manifest${X}`); ok = false; continue; }
  const okKey = zip.key === md5;
  const okHash = zip.hash === sha;
  console.log(`  key(md5)   ${zip.key} ${okKey ? `${G}MATCH${X}` : `${R}MISMATCH${X}`}`);
  console.log(`  hash(sha)  ${zip.hash} ${okHash ? `${G}MATCH${X}` : `${R}MISMATCH${X}`}`);
  ok = ok && okKey && okHash;
}

console.log();
if (ok) {
  console.log(`${G}${B}PROVEN${X} on both platforms: the live OTA serves exactly these bytes.`);
  process.exit(0);
}
console.log(`${R}${B}NOT PROVEN.${X} Do not tell anyone this shipped.`);
console.log(`${D}A mismatch usually means the zip was not rebuilt, or another session published on top.${X}`);
process.exit(1);
