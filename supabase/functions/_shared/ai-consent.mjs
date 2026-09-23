// OnStandard: the ONE rule for "may this person's data go to the third-party AI" (0243, 2026-09-23).
//
// Guideline 5.1.2(i): personal data reaches Anthropic (Claude) only after the person whose data it
// is said yes. profiles.ai_consent is true only after "Continue" on the consent sheet; null (never
// asked) and false (Not now) both mean NO. Every edge function that calls the model with a
// person's data asks this module, and every cron that loops over people filters through it.
//
// Plain ES module on purpose (the quiet-hours.mjs precedent): Deno imports it from the functions,
// node:test imports it from ai-consent.test.mjs, so the rule is pinned by `npm run test:fn`.

/** The error code a function returns when consent is missing. The clients read it and show a plain
 *  sentence ("AI reads are off"), never an error. */
export const AI_CONSENT_REQUIRED = 'ai_consent_required';

/** Is one stored answer a yes? Only an explicit `true` counts. */
export function consentGiven(value) {
  return value === true;
}

/** Of `ids`, the ones whose profile row says yes. `rows` is the result of
 *  `select id, ai_consent from profiles where id in (...)`. A person with no row is a no. */
export function consentedIds(ids, rows) {
  const yes = new Set((Array.isArray(rows) ? rows : [])
    .filter((r) => r && consentGiven(r.ai_consent))
    .map((r) => String(r.id)));
  return (Array.isArray(ids) ? ids : []).filter((id) => id && yes.has(String(id)));
}

/** The first of `ids` (in order) who has NOT said yes, or null when everyone has. Callers pass the
 *  data subject first (the athlete), then the caller, so the answer names the most important
 *  missing person. Duplicates and empties are ignored. */
export function firstWithoutConsent(ids, rows) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
  const ok = new Set(consentedIds(want, rows));
  return want.find((id) => !ok.has(id)) ?? null;
}

/** Read the answers for `ids` with a service-role client. Fails CLOSED: an unreadable answer is a
 *  no, because sending someone's data on a database hiccup is the one outcome this gate exists to
 *  prevent. Returns the rows (possibly empty). */
export async function loadConsentRows(svc, ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
  if (!svc || !want.length) return [];
  try {
    const { data, error } = await svc.from('profiles').select('id, ai_consent').in('id', want);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/** Convenience: the first person in `ids` without consent (or null), read live. */
export async function missingConsent(svc, ids) {
  return firstWithoutConsent(ids, await loadConsentRows(svc, ids));
}

/** Convenience: filter a cron's people down to the ones who said yes, read live, in chunks. */
export async function filterConsented(svc, ids, chunk = 200) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))];
  const out = [];
  for (let i = 0; i < want.length; i += chunk) {
    const part = want.slice(i, i + chunk);
    out.push(...consentedIds(part, await loadConsentRows(svc, part)));
  }
  return out;
}

/** The JSON a function answers with when it skipped the AI for lack of consent. `who` is 'athlete'
 *  when the data subject has not said yes and 'you' when it is the caller. HTTP 200 on purpose:
 *  this is a normal outcome, not a failure, and supabase-js hides the body of a non-2xx. */
export function consentSkipBody(who) {
  return { ok: false, skipped: AI_CONSENT_REQUIRED, error: AI_CONSENT_REQUIRED, who: who === 'you' ? 'you' : 'athlete' };
}
