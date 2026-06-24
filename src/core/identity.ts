// AthleteOS — pure helpers for the athlete's displayed identity (pure TS, no RN
// imports). The avatar monogram and the leaderboard "YOU" row used to render a
// frozen "Jihad" / "J" seed, so an athlete who onboards under a different name
// saw someone else's initials on their own profile. Deriving the monogram from
// the live name keeps the identity honest everywhere it's shown.

/**
 * Monogram for an avatar: the first letter of the first name plus the first
 * letter of the last name (uppercased), e.g. "Marcus Cole" → "MC". A single
 * name yields one letter ("Jihad" → "J"); a blank/whitespace name falls back to
 * the given placeholder so the avatar is never empty.
 */
export function initials(name: string | undefined, fallback: string = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** First name for greetings/labels; falls back when the name is blank. */
export function firstName(name: string | undefined, fallback: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : fallback;
}

/**
 * The athlete a PARENT monitors, derived from the child's name they typed in
 * onboarding (stored in `obMeta.athleteName`, so it may arrive as a string,
 * array, or number). A real parent entered their child's name; the seeded demo
 * leaves it blank, so the Parent dashboard keeps showing the showcase athlete
 * "Jihad". Returns the display name, its first name, an avatar monogram, and
 * whether this is the seeded demo, so the demo-only "Coach Davis" note stays
 * gated to the showcase instead of fabricating a coach for a real family.
 */
export function monitoredAthlete(metaName: unknown): {
  name: string;
  first: string;
  monogram: string;
  isDemo: boolean;
} {
  const entered = typeof metaName === 'string' ? metaName.trim() : '';
  const isDemo = entered === '';
  const name = isDemo ? 'Jihad' : entered;
  return { name, first: firstName(name, 'Jihad'), monogram: initials(name, 'J'), isDemo };
}

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The team title on the Coach dashboard. The seeded demo keeps the showcase
 * "Linebackers · Varsity"; a real coach gets their own onboarding context (their
 * school, else the sport they train), so the header never hands them another
 * team's name. Falls back to a neutral "Your Team" when neither is set.
 */
export function coachTeamTitle(opts: { isReal: boolean; sport?: unknown; school?: unknown }): string {
  if (!opts.isReal) return 'Linebackers · Varsity';
  return asText(opts.school) || asText(opts.sport) || 'Your Team';
}

/**
 * The organization label on the Trainer dashboard. The seeded demo keeps the
 * showcase gym "Apex Performance"; a real trainer (onboarding does not capture a
 * business name) gets a neutral "Your Practice" rather than another trainer's gym.
 */
export function trainerOrgTitle(isReal: boolean): string {
  return isReal ? 'Your Practice' : 'Apex Performance';
}
