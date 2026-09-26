// The season phase, for the AI Nutritionist's context (goals and eating plan, phase B, 2026-09-26).
//
// A team's phase (0252 teams.season_phase, or a solo athlete's own) is resolved by ONE database
// function, season_phase_for, which the athlete's device, the coach's reconstruction and these
// functions all call. This file only NAMES the phase and gives Nia one line of guidance for it. It
// carries no calorie figure: the server never derives targets (the device does, in state.js), so
// there is nothing here that could drift from the numbers the athlete is graded on.
//
// Every line is deterministic, plain, figure-free and free of weight words (it is read for minors
// too), with no em dashes. A plain .mjs so `npm run test:fn` runs it in Node.

export const PHASE_LABEL = { off: 'off-season', pre: 'pre-season', in: 'in-season', post: 'post-season' };

/** Nia's one line per phase, for the dossier (the chat, the plan ideas, the photo read's context). */
export const PHASE_GUIDANCE = {
  off: 'Off-season is for building: steady meals, protein at each one, and the full plan for their goal.',
  pre: 'Pre-season training is ramping up: more carbs around hard sessions, and never skipping the meal after training.',
  in: 'In-season, performance and recovery come first: no aggressive changes to how much they eat, carbs around practice and games, familiar easy-to-digest food before competition, and a real recovery meal after.',
  post: 'Post-season is for recovering and resetting: regular meals, plenty of protein and produce, and no drastic changes.',
};

/** For the plan ideas: what kind of meals suit the phase. */
export const PHASE_IDEA_HINT = {
  off: 'It is the off-season: hearty, build-friendly meals are right.',
  pre: 'It is pre-season: favour meals with real carbs for the harder training.',
  in: 'It is in-season: favour familiar, easy-to-digest meals with carbs for practice and games.',
  post: 'It is the post-season: favour simple, recovery-friendly meals with protein and produce.',
};

/** A stored phase, or null. Anything else (a typo, an injection) is not a phase. */
export function cleanPhase(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PHASE_LABEL, v) ? v : null;
}

/** The dossier line: "- Season: in-season (set by their team). <guidance>" or ''. */
export function phaseDossierLine(phase, source) {
  const p = cleanPhase(phase);
  if (!p) return '';
  const who = source === 'team' ? ' (set by their team)' : source === 'self' ? ' (they set it)' : '';
  return `- Season: ${PHASE_LABEL[p]}${who}. ${PHASE_GUIDANCE[p]}`;
}

/** season_phase_for's answer, read with the SERVICE client. Never throws; null on anything odd. */
export async function loadSeasonPhase(service, athleteId) {
  try {
    if (!service || typeof service.rpc !== 'function' || typeof athleteId !== 'string' || !athleteId) return null;
    const { data, error } = await service.rpc('season_phase_for', { p_athlete: athleteId });
    if (error || !data || typeof data !== 'object') return null;
    const phase = cleanPhase(data.phase);
    return phase ? { phase, source: data.source === 'team' || data.source === 'self' ? data.source : null } : null;
  } catch { return null; }
}
