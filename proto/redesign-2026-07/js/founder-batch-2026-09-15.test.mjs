/* The 2026-09-15 founder batch, pinned structurally: the roll-call audit fixes, the group ring on
 * every operator home, and the shared profile-photo control. Source-string pins, the shape this
 * repo uses for wiring no unit test can see (a build-step-less proto throws at click time). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, p), 'utf8');

test('roll call: the board no longer reads an undeclared name, and the general composer no longer builds roll calls', () => {
  const cc = src('screens/coach-commitments.js');
  assert.doesNotMatch(cc, /\$\{asksArrival/, 'the ReferenceError that blanked every board with a pending athlete');
  assert.doesNotMatch(cc, /const TYPES = \[\s*'morning_roll_call'/, 'one type, one composer (coach-wakeup.js)');
  assert.match(cc, /type: 'practice', title: TYPE_LABEL\.practice/, 'the general composer starts on a session, not a roll call');
  assert.doesNotMatch(cc, /querySelectorAll\('\[data-place\]'\)/, 'the dead place-picker handlers are gone');
  assert.doesNotMatch(cc, /#vc-saveplace/, 'and the dead geolocation round trip with them');
  assert.match(cc, /Nobody is on this roll call yet/, 'a roll call with no audience says so on Home');
  assert.match(cc, /: !c\.total \? 'Nobody on it'/, 'and on the board');
  assert.match(cc, /\$\{c\.accountedFor\} of \$\{c\.total\}<\/div>\s*<div class="wk-homel">accounted for/, 'the bar and the number count the same thing');
});

test('roll call: the coach morning summary admits every operator and goes back to the right home', () => {
  const wm = src('screens/wakeup-morning.js');
  assert.match(wm, /nav: 'operator', tab: 'home'/);
  assert.match(wm, /const homeOf = \(\) => \(RT\.authRole === 'trainer' \? 'trainer' : 'coach-home'\);/);
  assert.doesNotMatch(wm, /backHead\('This morning', [^)]*'coach-home'\)/, 'no hard-coded coach-only back target');
});

test("roll call: the athlete reads the coach's own button word, and the feature has one name", () => {
  const rc = src('screens/roll-call.js');
  assert.doesNotMatch(rc, /Tap <b>I’M UP<\/b>/, 'the how-it-works line quotes the real label');
  assert.doesNotMatch(rc, /Check in now<\/button>/, 'the late CTA is the real label too');
  assert.match(src('commitments.js'), /morning_roll_call: 'Roll call',/);
  assert.match(src('screens/accountability.js'), /backHead\('Roll call record'/);
  assert.doesNotMatch(src('screens/progress.js'), /<div class="lt">Morning Readiness<\/div>/);
});

test('the operator home leads with the group ring, the same hero the athlete has', () => {
  const ch = src('screens/coach-home.js');
  assert.match(ch, /scoreRing\(\{\s*score: have \? p\.avg : 0,/, 'the group average feeds the ring');
  assert.match(ch, /uid: 'group', notStarted: !have,/, 'no scores yet is not a zero');
  assert.match(ch, /<section class="xhero co-hero tappable" data-pulse/, "the athlete's hero classes, so it is the same ring at the same size");
  const ring = ch.indexOf("${entries === null ? '' : pulseCard(rows, statuses)}");
  const board = ch.indexOf("${isNutritionBook() ? '<div id=\"nut-board-slot\"></div>' : ''}");
  assert.ok(ring > 0 && board > ring, 'the ring renders before the nutrition board on every book');
  assert.doesNotMatch(ch, /<div class="num">\$\{p\.avg/, 'the flat 60px numeral is gone');
});

test('one profile-photo control, for the athlete and for every operator', () => {
  const up = src('avatar-upload.js');
  assert.match(up, /export function avatarControlHtml\(/);
  assert.match(up, /export function wireAvatarUpload\(/);
  assert.match(up, /window\.__act\.setAvatar\(c\.toDataURL\('image\/jpeg', 0\.82\)\)/, 'the same upload path the athlete always had');
  const pf = src('screens/profile.js');
  assert.match(pf, /avatarControlHtml\(\{ uid: RT\.userId, initials: a\.initials, size: 88, editable: true \}\)/);
  assert.match(pf, /wireAvatarUpload\(root, \{ errHost: '\.pf-hero \.pf-id'/);
  assert.match(pf, /class="lic pf-coach-av"\$\{S\.coach\.id \? ` data-avatar-uid=/, "the coach's row wears the coach's real face");
  const roles = src('screens/roles.js');
  assert.equal((roles.match(/avatarControlHtml\(\{ uid: RT\.userId/g) || []).length, 2, 'the coach card and the trainer card both carry the control');
  assert.equal((roles.match(/wireAvatarUpload\(root\)/g) || []).length, 2, 'and both mounts wire it');
  const home = src('screens/home.js');
  assert.match(home, /sic-face/, "the day receipt wears the viewer's face when it is the linked coach");
});
