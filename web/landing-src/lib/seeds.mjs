// Scenario seeds for proto screenshots.
//
// Each export is a JS source string evaluated INSIDE the page after boot. The proto serves native
// ES modules, so `import('/js/day.js')` from the page returns the SAME live module instance the
// running app uses — mutating DAY/RT in place and calling window.__render() paints real screens
// through the real engine. Nothing here fakes a rendered pixel: the scores in these screenshots
// are computed by day.js from the seeded evidence, exactly as they would be on a device.
//
// Rule: seed EVIDENCE, never outcomes. We set logged meals, macros and check-in answers; we never
// set a score. If a number looks wrong in a shot, the seed is wrong, not the engine.

/** Realistic macro payloads per slot (protein-forward, plausible portions). */
const PLATES = {
  breakfast: { protein: 46, kcal: 620, carbs: 58, fat: 18, quality: 88 },
  lunch: { protein: 52, kcal: 780, carbs: 82, fat: 22, quality: 84 },
  snack: { protein: 30, kcal: 290, carbs: 28, fat: 8, quality: 90 },
  dinner: { protein: 58, kcal: 910, carbs: 88, fat: 28, quality: 86 },
};

/** N days of believable history ending yesterday, all at/above the 80 streak bar. */
function history(days = 34) {
  const pattern = [92, 88, 95, 84, 91, 87, 93, 86, 90, 94, 82, 89, 96, 85, 91, 88, 93, 90, 87, 92, 84, 95, 89, 86, 91, 93, 88, 90, 85, 94, 87, 92, 89, 91];
  const out = [];
  for (let i = days; i >= 1; i--) {
    out.push({ __back: i, score: pattern[(days - i) % pattern.length] });
  }
  return out;
}

const COMMON = `
  const day = await import('/js/day.js');
  const st  = await import('/js/state.js');
  const { DAY } = day; const { RT } = st;
  const iso = (back) => { const d = new Date(DAY.date + 'T12:00:00'); d.setDate(d.getDate() - back);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const PLATES = ${JSON.stringify(PLATES)};
  const HIST = ${JSON.stringify(history())}.map(h => ({ date: iso(h.__back), score: h.score, weight: null }));
`;

/** Athlete identity + a real coach link. Shared by every athlete-side scenario. */
const ATHLETE_IDENTITY = `
  RT.authRole = 'athlete';
  RT.userId = 'seed-athlete';
  RT.profile = { name: 'Marcus Reed', sport: 'Football', position: 'WR', school: 'Lincoln High', level: 'Varsity' };
  RT.myCoach = { name: 'James Brooks', teamName: 'Lincoln Varsity Football' };
  RT.activationDate = iso(41);
  RT.day0 = false;
  // Real coach-set targets, so Plan renders a coached standard instead of "your coach can set
  // targets any time" (S.planTargetsState === 'unset').
  RT.profile.targets = { protein: 180, calories: 3200, weight: 195 };
  DAY.scoreHistory = HIST;
  DAY.proteinTarget = 180; DAY.calTarget = 3200; DAY.scoringProfile = 'athlete';
  DAY.currentWeight = 187.4;
`;

/** Log a slot as genuinely logged: meal flag + timestamp + saved plate. */
const LOG = (slot, atMin) => `
  DAY.meals.${slot} = true;
  DAY.mealLoggedAt.${slot} = ${atMin};
  DAY.slotMacros.${slot} = { ...PLATES.${slot} };
`;

/* ------------------------------------------------------------------ athlete day, in sequence */

/** Morning: breakfast logged on time, everything else still ahead. The honest early-day picture. */
export const dayMorning = `${COMMON}${ATHLETE_IDENTITY}
  ${LOG('breakfast', 505)}
  DAY.hydrationL = 0.5;
  DAY.ciLast = { date: iso(1), recovery: 82 };
  window.__render();
`;

/** Midday: breakfast + lunch in, dinner still open, commitment written. */
export const dayMidday = `${COMMON}${ATHLETE_IDENTITY}
  ${LOG('breakfast', 505)}
  ${LOG('lunch', 786)}
  DAY.hydrationL = 1.6;
  DAY.commitmentFocus = 'No skipped meals, lights out by 10.';
  DAY.ciLast = { date: iso(1), recovery: 82 };
  window.__render();
`;

/** Evening, complete: all four slots on time, hydration met, commitment closed, check-in in.
 *  This is the day the score ring is worth showing. */
export const dayComplete = `${COMMON}${ATHLETE_IDENTITY}
  ${LOG('breakfast', 505)}
  ${LOG('lunch', 786)}
  ${LOG('snack', 995)}
  ${LOG('dinner', 1194)}
  DAY.hydrationL = 3.1;
  DAY.quickAdded = [false, false, false];
  DAY.dailyCommitment = 'yes';
  DAY.commitmentFocus = 'No skipped meals, lights out by 10.';
  DAY.ciSubmitted = true;
  DAY.ci = { energy: 8, recovery: 8, sleep: 8, confidence: 9, soreness: 3, motivation: 8, digestion: 7, cravings: 3 };
  DAY.ciLast = { date: DAY.date, recovery: 82 };
  window.__render();
`;

/** A late dinner — the "late counts half, still log it" state the site must be able to show. */
export const dayLate = `${COMMON}${ATHLETE_IDENTITY}
  ${LOG('breakfast', 505)}
  ${LOG('lunch', 786)}
  DAY.meals.dinner = true; DAY.mealLoggedAt.dinner = 1322; DAY.slotMacros.dinner = { ...PLATES.dinner };
  DAY.hydrationL = 2.4;
  DAY.ciLast = { date: iso(1), recovery: 82 };
  window.__render();
`;

/** Genuine first day: activation is TODAY, so windows that already closed read "Not required". */
export const dayFirst = `${COMMON}
  RT.authRole = 'athlete'; RT.userId = 'seed-athlete';
  RT.profile = { name: 'Marcus Reed', sport: 'Football', position: 'WR', school: 'Lincoln High', level: 'Varsity' };
  RT.myCoach = { name: 'James Brooks', teamName: 'Lincoln Varsity Football' };
  RT.activationDate = DAY.date;
  DAY.scoreHistory = [];
  DAY.proteinTarget = 180; DAY.calTarget = 3200; DAY.scoringProfile = 'athlete';
  window.__render();
`;

/* ------------------------------------------------------------------ plan styles */

/* resolveMyPlanStyle() reads the style off RT.profile.targets (the professional's assignment) —
   NOT off DAY.planStyle, which is only the per-day stamp. Seeding setDayPlanStyle alone made all
   three style screenshots identical. Set both: the assignment drives what the Plan screen shows,
   the stamp drives what the engine scores. */
const styleSeed = (style) => `${COMMON}${ATHLETE_IDENTITY}
  RT.profile.targets = { protein: 180, calories: 3200, weight: 195, style: '${style}', styleOverrides: null };
  // S.planStyle prefers the CACHED RT.planStyle over live resolution (state.js:2248). Leaving a
  // stale cache made all three style screenshots render "Guided" despite resolveMyPlanStyle()
  // returning the right key. Clear it so the screen re-resolves from the assignment above.
  RT.planStyle = null;
  ${LOG('breakfast', 505)}
  ${LOG('lunch', 786)}
  ${LOG('snack', 995)}
  ${LOG('dinner', 1194)}
  DAY.hydrationL = 3.1;
  DAY.dailyCommitment = 'yes';
  DAY.ciSubmitted = true;
  DAY.ci = { energy: 8, recovery: 8, sleep: 8, confidence: 9, soreness: 3, motivation: 8, digestion: 7, cravings: 3 };
  DAY.ciLast = { date: DAY.date, recovery: 82 };
  DAY.signals = { breakfast: { hunger: 3, fullness: 4, satisfaction: 4 }, lunch: { hunger: 4, fullness: 4, satisfaction: 5 }, dinner: { hunger: 3, fullness: 4, satisfaction: 4 } };
  DAY.signalWeekRate = 0.86;
  const ps = await import('/js/plan-style.js');
  day.setDayPlanStyle('${style}', ps.knobsFor('${style}', null));
  window.__render();
`;

export const styleStructured = styleSeed('structured');
export const styleGuided = styleSeed('guided');
export const styleIntuitive = styleSeed('intuitive');

/* ------------------------------------------------------------------ operator (coach / trainer) */

export const coachIdentity = `${COMMON}
  RT.authRole = 'coach';
  RT.userId = 'seed-coach';
  RT.profile = { name: 'James Brooks', sport: 'Football', school: 'Lincoln High' };
  RT.team = { id: 'seed-team', name: 'Lincoln Varsity Football', code: 'LVF24' };
  RT.activationDate = iso(120);
  window.__render();
`;

export const trainerIdentity = `${COMMON}
  RT.authRole = 'trainer';
  RT.userId = 'seed-trainer';
  RT.profile = { name: 'Dana Ruiz' };
  RT.practice = { id: 'seed-practice', name: 'Ruiz Performance', code: 'RUIZ7' };
  RT.activationDate = iso(120);
  window.__render();
`;

/* ------------------------------------------------------------------ parent */

export const parentIdentity = `${COMMON}
  RT.authRole = 'parent';
  RT.userId = 'seed-parent';
  RT.profile = { name: 'Angela Reed' };
  window.__render();
`;

export const SEEDS = {
  dayMorning, dayMidday, dayComplete, dayLate, dayFirst,
  styleStructured, styleGuided, styleIntuitive,
  coachIdentity, trainerIdentity, parentIdentity,
};
