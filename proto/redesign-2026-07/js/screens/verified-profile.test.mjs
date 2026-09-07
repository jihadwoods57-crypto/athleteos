/* Verified Profile: the ONE screen for "what a recruiter can see about me".
 *
 * #verified-discipline used to be a second, unrelated screen with a second sharing switch that
 * never mentioned the first. It is folded in here as a separately labelled section. What this
 * suite protects is the reason the merge is safe:
 *
 *   1. The two switches did NOT become one. They are different server contracts (0199/0200
 *      publish state vs profiles.share_verified_discipline via 0138's verified_discipline()), and
 *      the day someone "simplifies" them into a single control is the day an athlete publishes a
 *      page they only meant to preview, or releases numbers they only meant to publish a page of.
 *   2. Each section keeps its own loading, its own failure and its own retry. One dead read must
 *      not take the other section down.
 *   3. Nothing still routes to the deleted screen. The proto has NO BUILD STEP, so a stale
 *      data-go lands on #notfound at TAP TIME and a stale registry entry throws on import.
 *
 * Source-shape pins, the way the other screen suites work (see apple-health.test.mjs): the
 * screen imports state.js, share-card.js and the DOM, so rendering it here would cost more than
 * it proves, and the thing being protected IS the presence of these shapes in the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const screen = read('verified-profile.js');
const registry = read('index.js');
const settings = read('settings.js');
const profile = read('profile.js');

test('both switches exist, on their own server contracts, and neither drives the other', () => {
  // Switch 1: the public page. 0199/0200, through the verified-profile edge function.
  assert.match(screen, /id="vp-enable"/);
  assert.match(screen, /id="vp-publish"/);
  assert.match(screen, /id="vp-unpublish"/);
  assert.match(screen, /roles\.verifiedProfilePublish\(dataUrl\)/);
  assert.match(screen, /roles\.verifiedProfileUnpublish\(\)/);

  // Switch 2: the discipline record. 0138, through commitment-data's setShareDiscipline.
  assert.match(screen, /id="vd-share"/);
  assert.match(screen, /setShareDiscipline\(next\)/);
  assert.match(screen, /import \{[^}]*\bsetShareDiscipline\b[^}]*\} from '\.\.\/commitment-data\.js'/);

  // Independently settable: the discipline handler never touches the page's publish state, and
  // the page's handlers never touch the share flag. Neither writes the other's cache.
  const vd = screen.slice(screen.indexOf("const btn = root.querySelector('#vd-share')"));
  assert.ok(vd.length > 0, 'the discipline switch handler exists');
  assert.ok(!/verifiedProfilePublish|verifiedProfileUnpublish|CACHE\./.test(vd),
    'the discipline switch must not publish, unpublish, or write the page cache');
  const pageHandlers = screen.slice(
    screen.indexOf("on('#vp-enable'"), screen.indexOf("const uid = RT.userId"));
  assert.ok(!/setShareDiscipline|VD\./.test(pageHandlers),
    'the page controls must not move the discipline switch');
});

test('the copy tells the athlete which switch releases what, on both switches', () => {
  // If a reader could plausibly think one switch controls both, the copy is wrong. Each control
  // names the OTHER one and says it stays put.
  assert.match(screen, /your discipline record below keeps its own switch/);
  assert.match(screen, /Your discipline record below stays exactly as you set it/);
  assert.match(screen, /Publishing the page above does not turn this on/);
  assert.match(screen, /This switch covers the four numbers only, never the public page above/);
  // And each section is introduced by its own heading, not one shared "sharing" header.
  assert.match(screen, /<h2 class="eyebrow">Your public page<\/h2>/);
  assert.match(screen, /<h2 class="eyebrow">Your discipline record /);
});

test('each section owns its own loading, failure and retry', () => {
  // Two caches, never one combined fetch.
  assert.match(screen, /let CACHE = \{ st: null, loaded: false/);
  assert.match(screen, /let VD = \{ data: null, failed: false, share: null[,}]/);
  // Two skeletons, two errorStates, two retry ids.
  assert.match(screen, /skeletonRows\(3, 'Loading your Verified Profile'\)/);
  assert.match(screen, /skeletonRows\(2, 'Pulling your discipline record'\)/);
  assert.match(screen, /retryId: 'vp-retry'/);
  assert.match(screen, /retryId: 'vd-retry'/);
  assert.match(screen, /on\('#vp-retry'/);
  assert.match(screen, /on\('#vd-retry'/);
});

test('a failed read on one section does not take the other down', () => {
  // render() always emits BOTH sections: the page section's own branches return their fragment,
  // they never return early for the whole screen.
  const render = screen.slice(screen.indexOf('  render() {'), screen.indexOf('  mount(root) {'));
  assert.match(render, /\$\{pageSection\(\)\}/);
  assert.match(render, /\$\{disciplineSection\(\)\}/);
  // pageSection returns fragments, so its error path cannot swallow disciplineSection.
  assert.ok(!/return `\$\{head\}/.test(screen), 'no branch renders the head and stops');
  // The discipline fetch and its render read no page state at all.
  const disc = screen.slice(screen.indexOf('function disciplineBody()'), screen.indexOf('export default'));
  assert.ok(!/CACHE/.test(disc), 'the discipline section must not read the page cache');
  // And the page-status error copy says out loud that the other half still works.
  assert.match(screen, /your discipline record below still works/);
  assert.match(screen, /your public page above is unaffected/);
});

test('every state both screens used to carry is still rendered', () => {
  for (const s of [
    // the page (0199/0200)
    'One link that proves you show up',        // not enabled
    'How it works, straight',                  // the all-or-nothing contract, before the switch
    'Building your record',                    // under minDays
    'A parent or guardian has to approve first', // minor without consent
    'The public page rides with Individual Plus', // paywall
    'Publish my page',
    'Your page is live',
    'Copy link',
    'Share my page',
    'Share this week',
    'Refresh the preview card',
    'Take my page down',
    // the discipline record (0138)
    'Your record · last 90 days',
    'On-time arrival',
    'Morning response',
    'Commitments completed',
    'Accountability',
    'No verified commitments in the last 90 days yet',  // no record, distinct from failed
    'What is never shared',                             // the withheld-fields explanation
    'Off by default. Only you can turn it on',
  ]) {
    assert.ok(screen.includes(s), `missing state copy: ${s}`);
  }
  // The paywall is still counted once per session, and the guardian gate still has its door.
  assert.match(screen, /EVENTS\.PAYWALL_VIEWED, \{ variant: 'verified_profile_locked'/);
  assert.match(screen, /data-go="guardian"/);
  assert.match(screen, /data-go="paywall"/);
});

test('the discipline read is lazy and cached, not a fetch on every visit', () => {
  // Module-scoped VD plus the unread guard: one RPC per app session, fired from mount() rather
  // than from load(), so a failed page-status read never costs the athlete their numbers.
  assert.match(screen, /if \(uid && VD\.data === null && !VD\.failed\) \{/);
  assert.match(screen, /loadVerifiedDiscipline\(uid, shiftISO\(todayISO\(\), -89\), todayISO\(\)\)/);
  const loadFn = screen.slice(screen.indexOf('async function load(force)'), screen.indexOf('function fmtDate'));
  assert.ok(!/loadVerifiedDiscipline/.test(loadFn), 'the page status load must not pull the aggregate');
  // null from the data layer is "the read failed", never "no record".
  assert.match(screen, /if \(d === null\) VD\.failed = true; else VD\.data = d;/);
});

test('the removed route has no callers left anywhere', () => {
  assert.ok(!existsSync(join(here, 'verified-discipline.js')), 'the screen file is deleted');
  assert.ok(!/verified-discipline\.js|'verified-discipline'/.test(registry), 'the registry entry is gone');
  // A data-go match, not a bare string match: a comment recording what the row USED to point at
  // is history worth keeping, while a live data-go is a tap that lands on #notfound.
  for (const f of readdirSync(here)) {
    if (!f.endsWith('.js')) continue;
    assert.ok(!/data-go="verified-discipline"/.test(read(f)), `${f} still routes to the dead screen`);
  }
  assert.ok(!/data-go="verified-discipline"/.test(settings), 'Settings no longer points at the dead route');
  assert.ok(!/data-go="verified-discipline"/.test(profile), 'the profile screen never pointed there, and still does not');
  // Settings keeps the row, pointed at what it now lands on.
  assert.match(settings, /data-go="verified-profile"/);
  assert.match(settings, /What recruiters can see/);
  // Profile keeps its own row.
  assert.match(profile, /data-go="verified-profile"/);
  // And the route is still registered as a lazy thunk.
  assert.match(registry, /'verified-profile': lazy\(\(\) => import\('\.\/verified-profile\.js'\)\)/);
});

test('the merged file uses the shared primitives and stays inside its ratchet ceilings', () => {
  // The ceilings the merge had to fit: verified-profile.js was 41 inline styles and 3 em dashes;
  // verified-discipline.js contributed 7 and 1. Merging inherits only the surviving file's
  // ceilings, so the total had to come DOWN, not add up.
  assert.ok((screen.match(/style\s*=\s*["']/g) || []).length <= 41, 'inline-style ratchet ceiling');
  assert.ok((screen.match(/—|&mdash;/g) || []).length <= 3, 'em-dash ratchet ceiling');
  // Shared primitives rather than per-screen one-offs: one stat helper for both sections, the
  // status pill for state, the card padding class instead of eight hand-typed paddings.
  assert.match(screen, /function stat\(label, value, suffix = ''\)/);
  assert.match(screen, /class="stat"/);
  assert.match(screen, /class="status-pill g"/);
  assert.match(screen, /class="card pad"/);
  assert.match(screen, /class="sidebox mt"/);
  assert.match(screen, /class="vc-stats"/);
  assert.match(screen, /class="btn danger"/);
  assert.equal((screen.match(/style="padding:16px"/g) || []).length, 0, 'no hand-typed card padding');
  // No raw font-size anywhere: the type ratchet starts a changed file at its recorded ceiling of
  // zero, and both sections are meant to sit on the --t-* scale.
  assert.equal((screen.match(/font-size:\s*[\d.]+px/g) || []).length, 0);
});

test('every identifier the screen uses is imported (there is no build step to catch it)', () => {
  const imported = new Set();
  for (const m of screen.matchAll(/import\s*(?:\*\s*as\s*(\w+)|\{([^}]*)\})\s*from/g)) {
    if (m[1]) imported.add(m[1]);
    else for (const n of m[2].split(',')) { const t = n.trim(); if (t) imported.add(t); }
  }
  for (const n of ['backHead', 'esc', 'skeletonRows', 'errorState', 'copyText', 'icon', 'S', 'RT',
    'roles', 'drawScoreCard', 'shareScoreCard', 'shareWeek', 'profileCardPayload', 'track',
    'EVENTS', 'loadVerifiedDiscipline', 'setShareDiscipline', 'todayISO', 'shiftISO']) {
    assert.ok(imported.has(n), `${n} is used but not imported`);
    assert.ok(screen.includes(n), `${n} is imported but unused`);
  }
  // The one that actually bit: copyText was briefly renamed to a function that did not exist,
  // which throws only when a published athlete taps Copy link.
  assert.match(screen, /await copyText\(st\.url \|\| ''\)/);
});

test('the discipline switch reads the server, not just this device', () => {
  // It was write-only until 2026-09-06: a fresh install showed Private to an athlete whose record
  // recruiters could still ask for. A sharing control that understates what is shared is the
  // worst direction to be wrong in.
  const data = read('../commitment-data.js');
  assert.match(data, /export async function loadShareDiscipline\(\)/);
  assert.match(data, /select\('share_verified_discipline'\)/);
  assert.match(screen, /loadShareDiscipline\(\)\.then/);
  // A failed read must not invent an "off".
  assert.match(screen, /if \(server === null \|\| server === VD\.share\) return;/);
});
