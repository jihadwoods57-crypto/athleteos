/* The privacy promises, written ONCE (review pass 2026-09-23, athlete report Repetition 4).
 *
 * The camera primer, the Privacy screen, Terms & Privacy and the location screen each wrote their
 * own version of "who sees this", four versions in all, and three of them said meal photos never
 * leave the coach connection while the photos went to a third-party AI. A promise that lives in
 * four places drifts; this module is the one place, and every screen imports from it.
 *
 * Change a sentence here only together with the published policy (web/landing/privacy.html) and
 * the App Store privacy answers. Plain English, no em dashes (lint:dash).
 */

/** Who reads meal photos and messages with AI. Named in full everywhere it is disclosed. */
export const AI_PROVIDER = 'Anthropic (Claude)';

/** Meal photos: who sees them, including the AI provider, and what never happens to them. */
export const PHOTO_PRIVACY = `Your meal photos are seen by you and the people connected to your plan, like your coach. If you turn on AI reads, our AI provider, ${AI_PROVIDER}, also reads them to work out the numbers. They are never public, never sold, and never used to train AI models.`;

/** The roll call board: what teammates see. The founder chose that the board names everyone
 *  (2026-09-23); this sentence is what makes that true on the Privacy screen. */
export const ROLLCALL_BOARD_PRIVACY = 'On a team roll call, your coach and your teammates see your name, when you answered, your place in line, and Arrived or Not arrived when the roll call has a place.';

/** Location check-in: what is kept and who sees it. Precise location is read once and discarded;
 *  the distance is kept for you alone (athlete report M6). */
export const ARRIVAL_PRIVACY = 'Your exact location is not kept. OnStandard keeps Arrived or Not arrived, which your coach and team see, and how far away you were, which only you see.';

/** The Squad score board: opt-in, number only. */
export const SQUAD_PRIVACY = 'Your score: only if you opt in on the Squad board. Roll call answers: visible to your team.';
