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
