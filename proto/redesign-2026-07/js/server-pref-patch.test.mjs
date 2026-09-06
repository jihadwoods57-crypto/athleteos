// serverPrefPatch: the profiles-row mirror of a notification-pref patch (0067 master switch,
// 0221 quiet window + team-standard opt-out). Only touched keys are written, so a quiet-hours tap
// never clobbers the master switch, and a null window means "device never synced one".
import test from 'node:test';
import assert from 'node:assert/strict';

// state.js pulls the browser in at import time; the helper is pure, so read it out of the source
// and evaluate it alone, the way the other state-shaped suites do. The only string that reaches
// new Function is this repo's own state.js, checked in and reviewed: not untrusted input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'state.js'), 'utf8');
const m = /export function serverPrefPatch\(patch, prefs\) \{[\s\S]*?\n\}/.exec(src);
assert.ok(m, 'serverPrefPatch is exported from state.js');
const serverPrefPatch = new Function(`${m[0].replace('export ', '')}; return serverPrefPatch;`)();

test('nothing the server reads: null, so no write is issued', () => {
  assert.equal(serverPrefPatch(null, {}), null);
  assert.equal(serverPrefPatch({}, { enabled: true }), null);
  assert.equal(serverPrefPatch({ briefing: false }, { enabled: true, briefing: false }), null);
});

test('master switch writes the opt-out column and nothing else', () => {
  assert.deepEqual(serverPrefPatch({ enabled: false }, { enabled: false, quietFrom: 1320 }), { notifications_opt_out: true });
  assert.deepEqual(serverPrefPatch({ enabled: true }, { enabled: true }), { notifications_opt_out: false });
});

test('quiet window writes minutes, rounded, and null when unset', () => {
  assert.deepEqual(serverPrefPatch({ quietFrom: 1320 }, { enabled: true, quietFrom: 1320, quietTo: 420 }), { quiet_from_min: 1320 });
  assert.deepEqual(serverPrefPatch({ quietTo: 420 }, { quietTo: 420 }), { quiet_to_min: 420 });
  assert.deepEqual(serverPrefPatch({ quietTo: 419.6 }, { quietTo: 419.6 }), { quiet_to_min: 420 });
  assert.deepEqual(serverPrefPatch({ quietFrom: null }, { quietFrom: null }), { quiet_from_min: null });
});

test('team-standard switch maps on/off to the opt-out column', () => {
  assert.deepEqual(serverPrefPatch({ teamPushes: false }, { teamPushes: false }), { team_standard_pushes_opt_out: true });
  assert.deepEqual(serverPrefPatch({ teamPushes: true }, { teamPushes: true }), { team_standard_pushes_opt_out: false });
});

test('a combined patch writes every touched column together', () => {
  assert.deepEqual(
    serverPrefPatch({ enabled: true, quietFrom: 1260, quietTo: 480, teamPushes: true }, { enabled: true, quietFrom: 1260, quietTo: 480, teamPushes: true }),
    { notifications_opt_out: false, quiet_from_min: 1260, quiet_to_min: 480, team_standard_pushes_opt_out: false },
  );
});
