// run: node --test supabase/functions/_shared/season-phase.test.mjs
//
// Phase B (2026-09-26): the season phase reaches Nia deterministically. Pins the dossier line and
// its guidance (figure-free, weight-free, one per phase), the plan ideas' phase hint, the loader
// (the one database resolution, season_phase_for, never throws, garbage is no phase), and the
// wiring in meal-chat and analyze-meal. No new model call anywhere: these are prompt lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_LABEL, PHASE_GUIDANCE, PHASE_IDEA_HINT, cleanPhase, phaseDossierLine, loadSeasonPhase } from './season-phase.mjs';
import { renderDossier, loadAthleteDossier } from './athlete-dossier.mjs';
import { planIdeasUserText } from '../meal-chat/suggest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHASES = ['off', 'pre', 'in', 'post'];
const WEIGHT = /\b(weight|weigh|lbs?|pounds?|scale|deficit|surplus|cut|cutting|bulk|bulking|lose|losing|slim|diet)\b/i;
const DASH = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);

test('one label, one guidance line and one idea hint per phase, all on the rails', () => {
  assert.deepEqual(Object.keys(PHASE_LABEL).sort(), [...PHASES].sort());
  for (const p of PHASES) {
    for (const line of [PHASE_GUIDANCE[p], PHASE_IDEA_HINT[p]]) {
      assert.ok(line && line.length < 240, p);
      assert.doesNotMatch(line, /\d/, line);          // no figures: the server never derives targets
      assert.doesNotMatch(line, WEIGHT, line);        // read for minors too
      assert.doesNotMatch(line, DASH, line);
      assert.doesNotMatch(line, /\bNia\b/);           // context for Nia, never signed by her
    }
  }
  assert.match(PHASE_GUIDANCE.in, /no aggressive changes to how much they eat/);
  assert.match(PHASE_GUIDANCE.in, /carbs around practice and games/);
  assert.match(PHASE_GUIDANCE.in, /recovery/);
});

test('cleanPhase and the dossier line', () => {
  for (const bad of [null, undefined, '', 'IN', 'playoffs', 3, {}, 'in; drop table']) assert.equal(cleanPhase(bad), null);
  assert.equal(phaseDossierLine('in', 'team'), `- Season: in-season (set by their team). ${PHASE_GUIDANCE.in}`);
  assert.equal(phaseDossierLine('post', 'self'), `- Season: post-season (they set it). ${PHASE_GUIDANCE.post}`);
  assert.equal(phaseDossierLine('bogus', 'team'), '');
});

test('the dossier carries the season for every viewer it renders for, and nothing when unset', () => {
  const facts = { fullName: 'Jihad Woods', sport: 'football', baseGoal: 'gain', seasonPhase: 'in', seasonSource: 'team', asOf: '2026-09-26' };
  for (const viewer of ['self', 'staff']) {
    const out = renderDossier(facts, { viewer, planStyle: 'structured' });
    assert.match(out, /- Season: in-season \(set by their team\)\. In-season, performance and recovery come first/);
  }
  const intuitive = renderDossier(facts, { viewer: 'self', planStyle: 'intuitive' });
  assert.match(intuitive, /- Season: in-season/);
  const minor = renderDossier({ ...facts, dob: '2012-01-01' }, { viewer: 'self' });
  const seasonLine = minor.split('\n').find((l) => l.startsWith('- Season'));
  assert.doesNotMatch(seasonLine, WEIGHT);
  assert.doesNotMatch(renderDossier({ ...facts, seasonPhase: null }, { viewer: 'self' }), /Season:/);
  // A solo athlete's accepted suggestion is theirs, not their coach's.
  assert.match(renderDossier({ ...facts, targets: { protein: 200, calories: 3400, source: 'self' } }, { viewer: 'self' }), /daily targets they set from a suggested change: 200g protein, 3400 calories/);
  assert.match(renderDossier({ ...facts, targets: { protein: 200 } }, { viewer: 'self' }), /daily targets set by their coach: 200g protein/);
});

test('the loader asks the one resolution with the owner id, and never throws', async () => {
  const calls = [];
  const service = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: { phase: 'pre', source: 'team', team_id: 't', can_set_self: false }, error: null }; } };
  assert.deepEqual(await loadSeasonPhase(service, 'a1'), { phase: 'pre', source: 'team' });
  assert.deepEqual(calls, [['season_phase_for', { p_athlete: 'a1' }]]);
  assert.equal(await loadSeasonPhase({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }, 'a1'), null);   // pre-0252
  assert.equal(await loadSeasonPhase({ rpc: async () => ({ data: { phase: 'nope' }, error: null }) }, 'a1'), null);
  assert.equal(await loadSeasonPhase({ rpc: async () => { throw new Error('boom'); } }, 'a1'), null);
  assert.equal(await loadSeasonPhase({ from() {} }, 'a1'), null);        // a stub with no rpc
  assert.equal(await loadSeasonPhase(null, 'a1'), null);
});

test('the dossier loader fills the season from season_phase_for, and a failure costs only that line', async () => {
  const table = (data) => {
    const q = { select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, maybeSingle: () => q, then: (res) => res({ data, error: null }) };
    return q;
  };
  const make = (rpc) => ({
    from: (t) => table(t === 'athlete_profiles' ? { base_goal: 'gain', profiles: { full_name: 'J W' } } : []),
    rpc,
  });
  const ok = await loadAthleteDossier(make(async () => ({ data: { phase: 'in', source: 'team' }, error: null })), 'a1', { isSelf: true, dayDate: '2026-09-26' });
  assert.equal(ok.seasonPhase, 'in');
  assert.equal(ok.seasonSource, 'team');
  assert.equal(ok.baseGoal, 'gain');
  const bad = await loadAthleteDossier(make(async () => ({ data: null, error: { message: 'x' } })), 'a1', { isSelf: true, dayDate: '2026-09-26' });
  assert.equal(bad.seasonPhase, null);
  assert.equal(bad.baseGoal, 'gain');
});

test('plan ideas: the phase shapes the kind of meal, never a figure', () => {
  const req = { slotTitle: 'Dinner', proteinTarget: 50, kcalTarget: 800, usuals: [] };
  const withPhase = planIdeasUserText(req, { phase: 'in' });
  assert.match(withPhase, new RegExp(PHASE_IDEA_HINT.in.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(planIdeasUserText(req, {}), /season/i);
  assert.doesNotMatch(planIdeasUserText(req, { phase: 'playoffs' }), /season/i);
});

test('wiring: meal-chat passes the dossier facts\' phase to the plan ideas, analyze-meal to the opener', () => {
  const chat = readFileSync(join(HERE, '..', 'meal-chat', 'index.ts'), 'utf8');
  assert.match(chat, /planIdeasUserText\(ask, \{[^}]*phase: facts\?\.seasonPhase \?\? null/);
  const am = readFileSync(join(HERE, '..', 'analyze-meal', 'index.ts'), 'utf8');
  assert.match(am, /loadSeasonPhase\(service, userId\)/);
  assert.match(am, /phase: season \? season\.phase : null/);
});
