// The audience picker's model (js/audience.js) and the Assign composer's use of it. The pure
// functions are exercised directly; the composer and roster are source-shape pinned, the way the
// other screen suites work, because the shipped proto has no bundler and a missing wire only
// throws at tap time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { everyone, people, roomsOf, audienceIds, audienceLabel, planSends, namesSummary, audienceHtml } from './audience.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const ROWS = [
  { athleteId: 'a1', name: 'Marcus Reed', unit: 'WR' },
  { athleteId: 'a2', name: 'Marcus Bell', unit: 'wr' },
  { athleteId: 'a3', name: 'DeShawn Cole', unit: 'RB' },
  { athleteId: 'a4', name: 'Tommy Vargas', unit: '' },
];
const GROUPS = [{ id: 'g1', name: 'Starters', athlete_ids: ['a1', 'a3', 'gone'] }];

test('everyone resolves the whole roster and reads as the team', () => {
  assert.deepEqual(audienceIds(everyone(), ROWS, GROUPS), ['a1', 'a2', 'a3', 'a4']);
  assert.equal(audienceLabel(everyone(), ROWS, GROUPS), 'the whole team');
  assert.equal(audienceLabel(everyone(), ROWS, GROUPS, { everyoneWord: 'all clients' }), 'all clients');
  assert.deepEqual(planSends(everyone(), ROWS, GROUPS), [{ scopeKind: 'team', scopeValue: null }]);
});

test('a room matches the way the server does: case-insensitive on the unit', () => {
  const aud = { kind: 'position', value: 'wr', ids: [] };
  assert.deepEqual(roomsOf(ROWS), ['WR', 'RB']);
  assert.deepEqual(audienceIds(aud, ROWS, GROUPS), ['a1', 'a2']);
  assert.equal(audienceLabel(aud, ROWS, GROUPS), 'the WR room');
  assert.deepEqual(planSends(aud, ROWS, GROUPS), [{ scopeKind: 'position', scopeValue: 'WR' }]);
});

test('a group fans out per member and drops anyone no longer on the roster', () => {
  const aud = { kind: 'group', value: 'g1', ids: [] };
  assert.deepEqual(audienceIds(aud, ROWS, GROUPS), ['a1', 'a3']);
  assert.equal(audienceLabel(aud, ROWS, GROUPS), 'Starters');
  assert.deepEqual(planSends(aud, ROWS, GROUPS), [
    { scopeKind: 'athlete', scopeValue: 'a1' }, { scopeKind: 'athlete', scopeValue: 'a3' },
  ]);
});

test('hand-picked people: one call each, named in full, dedup on the way in', () => {
  const aud = people(['a3', 'a1', 'a1', null]);
  assert.deepEqual(aud.ids, ['a3', 'a1']);
  assert.equal(audienceLabel(aud, ROWS, GROUPS), '2 athletes');
  assert.equal(audienceLabel(people(['a2']), ROWS, GROUPS), 'Marcus Bell');
  assert.equal(audienceLabel(people(['nope']), ROWS, GROUPS), '0 athletes');
  assert.deepEqual(planSends(aud, ROWS, GROUPS), [
    { scopeKind: 'athlete', scopeValue: 'a3' }, { scopeKind: 'athlete', scopeValue: 'a1' },
  ]);
  assert.equal(namesSummary(['a1', 'a3'], ROWS), 'Marcus and DeShawn');
  assert.equal(namesSummary(['a1', 'a2', 'a3', 'a4'], ROWS, 2), 'Marcus, Marcus and 2 more');
});

test('the markup: scope chips are one radiogroup, people are full-name checkboxes, rooms never show on a practice', () => {
  const team = audienceHtml(people(['a1']), { rows: ROWS, groups: GROUPS });
  assert.match(team, /role="radiogroup" aria-label="Who"/);
  assert.match(team, /Whole team · 4/);
  assert.match(team, /WR room · 2/);
  assert.match(team, /Starters · 2/);
  assert.match(team, /Pick people · 1/);
  // Two Marcuses on one roster: the list says which one.
  assert.match(team, /role="checkbox" aria-checked="true" tabindex="0" data-aud-id="a1" aria-label="Marcus Reed"/);
  assert.match(team, /aria-checked="false" tabindex="0" data-aud-id="a2" aria-label="Marcus Bell"/);
  assert.match(team, /1 picked/);
  const practice = audienceHtml(everyone(), { rows: ROWS, groups: GROUPS, practice: true, nouns: 'clients' });
  assert.match(practice, /All clients · 4/);
  assert.doesNotMatch(practice, /room ·/);
  assert.doesNotMatch(practice, /Starters/);
  assert.doesNotMatch(practice, /aud-pick/);
  // Search narrows in place and says so when nothing matches.
  assert.match(audienceHtml(people([]), { rows: ROWS, query: 'zz' }), /No one matches/);
  // The module starts at an inline-style ceiling of zero and stays there.
  assert.doesNotMatch(read('audience.js'), /style="/);
});

test('the Assign composer rides the picker, previews the landing, and fans out honestly', () => {
  const coach = read('screens/coach.js');
  assert.match(coach, /import \{ everyone, people, audienceIds, audienceLabel, planSends, namesSummary, audienceHtml, wireAudience \} from '\.\.\/audience\.js'/);
  assert.match(coach, /export function presetAssignAudience\(ids\)/);
  assert.match(coach, /audienceHtml\(ASSIGN\.aud, \{ rows, groups, practice, nouns: CD\.nouns \}\)/);
  assert.match(coach, /wireAudience\(root, ASSIGN\.aud/);
  assert.match(coach, /id="as-preview"/);
  assert.match(coach, /How it lands/);
  assert.match(coach, /data-sugg=/);
  // Per-scope calls with a tally, and the sent state names who it reached and who it did not.
  assert.match(coach, /for \(const s of sends\) \{\s*const r = await roles\.assignRequirement\(\{ \.\.\.base, scopeKind: s\.scopeKind, scopeValue: s\.scopeValue \}\)/);
  assert.match(coach, /Couldn’t reach \$\{esc\(d\.failedNames/);
  assert.match(coach, /Sent to \$\{d\.sent\}/);
  // A selection never calls a full render; the old keep() snapshot hack is gone.
  const block = coach.slice(coach.indexOf('export const coachAssign'), coach.indexOf('/* ---------- Coach sets an athlete'));
  assert.doesNotMatch(block, /const keep = /);
  assert.equal((block.match(/window\.__render\(\)/g) || []).length, 2, 'only Assign another and Sent repaint the whole screen');
});

test('roster Select → Assign carries every ticked athlete into the composer', () => {
  const roster = read('screens/coach-roster.js');
  assert.match(roster, /presetAssignAudience\(ids\)/);
  assert.match(roster, /Assign \$\{SEL\.size\}/);
  assert.doesNotMatch(roster, /one \$\{CD\.noun\} at a time/);
  const create = read('screens/coach-create.js');
  assert.match(create, /the people you pick/);
});
