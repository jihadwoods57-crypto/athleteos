// OnStandard — Practice HQ identity + invite-loop helpers. Pure, no RN/Supabase imports.
// Real trainer identity + real practice/join-code hydrate into RT.practice (state.js) from the
// server (mirrors _loadProfileIntoRt for athletes). These helpers turn that real data into the
// header + invite copy WITHOUT ever fabricating a name, business, or code — an unknown field is
// an honest neutral fallback ("Trainer" / "Your practice"), never a demo persona like
// "Tracy Boone" and never a dead "No code yet" with no path forward.
//
// Link format matches the shipped deep link (src/lib/inviteLink.ts):
//   https://onstandard.app/join?code=EAGLES24

export interface TrainerProfileLike {
  name?: string | null;
}

export interface PracticeLike {
  id?: string | null;
  name?: string | null;
  code?: string | null;
}

export interface PracticeHeader {
  /** Real signed-in trainer name, or an honest neutral fallback — never a fabricated persona. */
  trainerName: string;
  initials: string;
  /** Real practice/business name, or an honest neutral fallback — never a fabricated business. */
  practiceName: string;
  /** True once BOTH the trainer's name and the practice's name are real (server-confirmed). */
  hasIdentity: boolean;
}

const initialsFor = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'T';

/** Build the Practice HQ header from whatever real identity has hydrated so far. Both inputs
 *  may be null/partial (still loading) — the result is always honest, never a placeholder
 *  persona dressed up as real data. */
export function practiceHeader(
  profile: TrainerProfileLike | null | undefined,
  practice: PracticeLike | null | undefined,
): PracticeHeader {
  const realName = (profile && profile.name && profile.name.trim()) || '';
  const realPractice = (practice && practice.name && practice.name.trim()) || '';
  const trainerName = realName || 'Trainer';
  const practiceName = realPractice || 'Your practice';
  return {
    trainerName,
    initials: initialsFor(trainerName),
    practiceName,
    hasIdentity: !!realName && !!realPractice,
  };
}

/** The client-facing join link for a real practice join code. Empty input -> empty string
 *  (never a link to a blank/placeholder code a client could actually tap). */
export function inviteLink(code: string | null | undefined): string {
  const c = (code || '').trim().toUpperCase();
  return c ? `https://onstandard.app/join?code=${c}` : '';
}

/** Share-sheet text for the invite. Carries both the human-readable code and the tappable
 *  link. Empty code -> empty string so nothing gets shared before a code is real. */
export function inviteShareText(code: string | null | undefined, practiceName: string | null | undefined): string {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const name = (practiceName && practiceName.trim()) || 'my practice';
  return `Join ${name} on OnStandard. Use code ${c} or open ${inviteLink(c)}`;
}

/** Outcome of one fetchMyPracticeIdentity() attempt (see proto/redesign-2026-07/js/roles.js
 *  and src/lib/supabase/queries.ts). `error: true` means the fetch itself failed (network/RLS)
 *  — distinct from a confirmed "no practice row yet" (a plain null/empty result). Without this
 *  distinction a real outage looks identical to "still minting". */
export interface PracticeFetchResult extends PracticeLike {
  error?: boolean;
}

export interface PracticeLoadDecision {
  /** Next value for RT.practice — null means "nothing to show", not "still loading". */
  practice: PracticeLike | null;
  /** Whether to render the offline/reconnecting state instead of live or minting. */
  offline: boolean;
}

/** Decide the next trainer-practice state from one fetch attempt plus whatever identity was
 *  already cached. Pure mirror of _loadPracticeIntoRt's branching (state.js) — four honest
 *  outcomes, so a real outage is never misreported as still-minting:
 *    - the fetch found a real practice row -> live, use it
 *    - nothing usable came back but we had a cached identity -> offline, keep the cache
 *      (covers both a confirmed empty row and a same-tick RLS/network hiccup)
 *    - the fetch itself failed and there is no cache -> offline, no identity to fabricate
 *    - the fetch succeeded and confirmed no row exists, and there is no cache -> still minting */
export function practiceLoadDecision(
  identity: PracticeFetchResult | null | undefined,
  cachedPractice: PracticeLike | null | undefined,
): PracticeLoadDecision {
  if (identity && identity.code) {
    return { practice: { id: identity.id ?? null, name: identity.name || '', code: identity.code }, offline: false };
  }
  const hadCache = !!(cachedPractice && cachedPractice.code);
  if (hadCache) return { practice: cachedPractice as PracticeLike, offline: true };
  const fetchFailed = !!(identity && identity.error);
  return { practice: null, offline: fetchFailed };
}
