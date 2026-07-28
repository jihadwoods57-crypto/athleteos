/* Slice E: the client experience. A "client" is a trainer's athlete chasing a body outcome, not
   a team athlete chasing a sport standard — before this slice they were the SAME screens with a
   label swapped in one place (S.experience, keyed off base_goal). This is the regression net for
   S.audience (the real, link-derived key) and the three screens it changes: home.js's outcome
   band, progress.js's reorder, and profile.js's ID card + Packages promotion. */
import assert from 'node:assert';

/* ---- DOM + storage stubs (module-eval only) ---- */
const el = () => ({
  style: { setProperty() {}, removeProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => null, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, appendChild() {}, remove() {}, insertAdjacentHTML() {},
});
const store = new Map();
globalThis.window = { location: { hash: '' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), __render() {} };
globalThis.document = Object.assign(el(), { createElement: el, getElementById: () => null, documentElement: el(), body: el(), head: el() });
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = globalThis.window.location;

const { S, RT } = await import('./state.js');
const { DAY } = await import('./day.js');
const home = (await import('./screens/home.js')).default;
const progress = (await import('./screens/progress.js')).default;
const profile = (await import('./screens/profile.js')).default;

RT.userId = 'u1';

/* ================================================================ S.audience: the seam itself */
{
  // Unconnected: falls back to the goal-derived voice (S.experience) — there's no link to be
  // honest about yet, so the classifier can only go on the goal.
  RT.myCoach = null; RT.myTrainer = null; RT.profile = { name: 'X', baseGoal: 'lose' };
  assert.strictEqual(S.audience, 'client', 'unconnected + lose/maintain falls back to experience');
  RT.profile = { name: 'X', baseGoal: 'gain' };
  assert.strictEqual(S.audience, 'athlete', 'unconnected + gain/perform falls back to experience');
}
{
  // THE bug S.experience had: a trainer's client whose GOAL is gain must still read as 'client' —
  // experience alone would call him 'athlete' and ask for his school.
  RT.myCoach = null; RT.myTrainer = { practiceId: 'p1', practiceName: 'Rivera Strength', name: 'Sam T' };
  RT.profile = { name: 'X', baseGoal: 'gain' };
  assert.strictEqual(S.audience, 'client', 'a trainer link overrides a gain/perform goal');
  assert.strictEqual(S.experience, 'athlete', 'S.experience is untouched — it still only reads the goal');
}
{
  // ...and the mirror bug: a team athlete cutting weight (lose) must still read as 'athlete' —
  // experience alone would call her 'client' and drop the team frame.
  RT.myCoach = { teamId: 't1', teamName: 'Northside Prep', name: 'Coach J' }; RT.myTrainer = null;
  RT.profile = { name: 'X', baseGoal: 'lose' };
  assert.strictEqual(S.audience, 'athlete', 'a team link overrides a lose/maintain goal');
  assert.strictEqual(S.experience, 'client', 'S.experience still reads client from the goal alone');
}
{
  // Precedence: linked to both, coach wins (mirrors S.coach's own precedence, state.js:2128).
  RT.myCoach = { teamId: 't1', teamName: 'Northside Prep', name: 'Coach J' };
  RT.myTrainer = { practiceId: 'p1', practiceName: 'Rivera Strength', name: 'Sam T' };
  RT.profile = { name: 'X', baseGoal: 'gain' };
  assert.strictEqual(S.audience, 'athlete', 'coach-before-trainer: someone linked to both gets the team frame');
}

/* ================================================================ home.js: the outcome band */
function resetDay() {
  DAY.currentWeight = null;
  DAY.scoreHistory = [];
}
{
  // A client with no real weight history yet — never a fabricated "0.0 lb" band.
  RT.myCoach = null; RT.myTrainer = { practiceId: 'p1', practiceName: 'Rivera Strength', name: 'Sam T' };
  RT.profile = { name: 'X', baseGoal: 'gain' };
  resetDay();
  const html = home.render();
  assert.ok(!html.includes('Your progress'), 'no outcome band without a real current AND starting weight');
}
{
  // Real history: current 172, start (oldest) 165 lb, target 180 — a gain-goal client mid-plan.
  resetDay();
  DAY.currentWeight = 172;
  DAY.scoreHistory = [
    { date: '2026-06-01', score: 70, weight: 165 },
    { date: '2026-06-15', score: 78, weight: 168 },
  ];
  RT.profile = { name: 'X', baseGoal: 'gain', seasonGoal: { start: 165, target: 180 } };
  const html = home.render();
  assert.ok(html.includes('Your progress'), 'a client with real weight history gets the outcome band');
  assert.ok(html.includes('172'), 'shows the real current weight');
  assert.ok(html.includes('goal 180 lb'), 'shows the real target');
  assert.ok(!/color:(var\(--red\)|var\(--green-bright\)).*172/.test(html),
    'weight direction must never be colored by sign — the honest signal is the pace pill');

  // A team athlete (even with the same baseGoal-adjacent data) never gets the band at all — the
  // band is a client-only surface, not a general "has weight data" surface.
  RT.myCoach = { teamId: 't1', teamName: 'Northside Prep', name: 'Coach J' }; RT.myTrainer = null;
  const teamHtml = home.render();
  assert.ok(!teamHtml.includes('Your progress'), 'a team athlete never sees the client outcome band');
}

/* ================================================================ progress.js: the reorder */
{
  resetDay();
  DAY.currentWeight = 172;
  DAY.scoreHistory = Array.from({ length: 10 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, score: 75 + i, weight: 165 + i }));
  RT.myCoach = null; RT.myTrainer = { practiceId: 'p1', practiceName: 'Rivera Strength', name: 'Sam T' };
  RT.profile = { name: 'X', baseGoal: 'gain', seasonGoal: { start: 165, target: 180 } };
  const clientHtml = progress.render();
  const wIdx = clientHtml.indexOf('Weight Trend');
  const sIdx = clientHtml.indexOf('Score Trend');
  assert.ok(wIdx >= 0 && sIdx >= 0, 'both sections must render');
  assert.ok(wIdx < sIdx, 'a client sees Weight Trend BEFORE Score Trend — the outcome leads');
  assert.ok(clientHtml.includes(`private to you &amp; your trainer`), 'the photo card names the real link (trainer), not a hardcoded "coach"');

  RT.myCoach = { teamId: 't1', teamName: 'Northside Prep', name: 'Coach J' }; RT.myTrainer = null;
  const teamHtml = progress.render();
  const wIdx2 = teamHtml.indexOf('Weight Trend');
  const sIdx2 = teamHtml.indexOf('Score Trend');
  assert.ok(sIdx2 < wIdx2, 'a team athlete keeps Score Trend FIRST — unchanged order');
  assert.ok(teamHtml.includes('private to you &amp; your coach'), 'a team athlete still sees "your coach"');
}

/* ================================================================ profile.js: ID card + Packages */
{
  RT.myCoach = null; RT.myTrainer = { practiceId: 'p1', practiceName: 'Rivera Strength', name: 'Sam T' };
  RT.profile = { name: 'X', baseGoal: 'gain' }; // the exact case S.experience got backwards
  const html = profile.render();
  assert.ok(!html.includes('Add your sport'), "a trainer's client must not be asked for a sport");
  assert.ok(!html.includes('Add your school'), "a trainer's client must not be asked for a school");
  assert.ok(html.includes('Rivera Strength'), 'the ID card shows the practice, not a sport/school prompt');
  assert.ok(html.includes('data-go="my-trainer-offers"'), "a trainer's client gets the Packages row");
  assert.ok(!html.includes('data-go="recruiting"'), "a trainer's client does not get the recruiting/discipline row");
  assert.ok(html.includes('Trainer Connection'), 'the connection card eyebrow uses the real noun');

  RT.myCoach = { teamId: 't1', teamName: 'Northside Prep', name: 'Coach J' }; RT.myTrainer = null;
  RT.profile = { name: 'Y', baseGoal: 'lose', sport: 'Football', position: 'LB', school: 'Northside High' };
  const teamHtml = profile.render();
  assert.ok(teamHtml.includes('Football') && teamHtml.includes('Northside High'), 'a team athlete keeps sport/school');
  assert.ok(teamHtml.includes('data-go="recruiting"'), 'a team athlete keeps the recruiting/discipline row');
  assert.ok(!teamHtml.includes('data-go="my-trainer-offers"'), 'a team athlete is never offered Packages');
  assert.ok(teamHtml.includes('Coach Connection'), 'a coach-linked athlete sees "Coach Connection"');
}
{
  // An unconnected user voiced as 'client' (goal-derived, no trainer) must NOT be sent to a
  // Packages screen that can only ever be empty for them — Packages requires an actual trainer.
  RT.myCoach = null; RT.myTrainer = null; RT.profile = { name: 'Z', baseGoal: 'maintain' };
  const html = profile.render();
  assert.strictEqual(S.audience, 'client');
  assert.ok(!html.includes('data-go="my-trainer-offers"'), 'no trainer link means no Packages row, even if voiced as client');
  assert.ok(html.includes('data-go="recruiting"'), 'falls back to the recruiting/discipline row honestly');
}

console.log('client experience (Slice E): all assertions passed');
