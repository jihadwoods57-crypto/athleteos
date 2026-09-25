// OnStandard: Nia says what happened to the numbers, AFTER it happened.
//
// THE DOUBLE CHICKEN INCIDENT (founder, 2026-09-24, 9:09 PM ET). "Nia in my meal i had double
// chicken. This from chipotle." The model called apply_correction, and this function wrote its ack
// into the thread straight away: "Good catch, Jihad. Double chicken it is, your numbers and score
// are updating now." Then the client tried to apply the correction, could not tell what "double"
// meant against the chicken's "4 oz", and changed nothing. An amber line under the message box said
// so, contradicting Nia in the thread above it. Prod still holds that row (meta t analysis_update,
// 01:09:59 UTC) over a meal whose numbers never moved.
//
// The rule from 2026-08-09 ("never persist an acknowledgment before the change is proven
// applicable") was kept on the server's side of the wire only: hasChange proved the model SAID
// something, not that the plate could take it. Only the client can know that, because the plate
// (the detected foods, their amounts, the pricing and scoring engines) lives there. So the promise
// now waits for the client:
//
//   1. apply_correction, from a client that says canConfirmCorrection, writes NOTHING. It returns the
//      correction plus a signed `pending` token that carries Nia's ack.
//   2. The client applies it and calls back in `correctionOutcome` mode with the token and what
//      happened. No model call, no tokens, no cap.
//   3. Applied: the ack goes into the thread (it is true now), followed by the receipt with the
//      real before and after. Not applied: Nia asks the one precise thing she needs instead, in her
//      own bubble ("Which one should I double: the grilled chicken or the chicken salad?").
//
// The token is what keeps this an 'ai' row nobody can forge. It is an HMAC over the meal, the
// caller, the ack and a nonce, keyed with the service role key, so a client can only file the words
// the model actually wrote, once, on its own meal, within a few minutes. The follow-up questions are
// composed HERE from bounded fields, never taken as text from the client.
//
// Plain ES module on Web Crypto, so `npm run test:fn` runs it under node.

const enc = new TextEncoder();
const TTL_MS = 15 * 60 * 1000;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(key)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** Sign Nia's pending ack. `photos` are the image keys the turn looked at (they count as applied
 *  only if the correction lands). Returns an opaque string.
 *  @param {{ mealId: string, userId: string, ack: string, photos?: string[] }} p
 *  @param {string | undefined} key
 *  @param {number} [now] */
export async function signPending({ mealId, userId, ack, photos = [] }, key, now = Date.now()) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = { v: 1, m: String(mealId), u: String(userId), a: String(ack || '').slice(0, 500), p: (Array.isArray(photos) ? photos : []).slice(0, 4).map(String), t: now, n: nonce };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(key, body));
  return `${body}.${sig}`;
}

/** The pending ack, if this token is genuine, unexpired, and for THIS meal and caller; else null.
 *  @param {unknown} token
 *  @param {{ mealId: string, userId: string }} who
 *  @param {string | undefined} key
 *  @param {number} [now]
 *  @returns {Promise<{ ack: string, photos: string[], nonce: string } | null>} */
export async function readPending(token, { mealId, userId }, key, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4000 || !key) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let p;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(key, body))) return null;
    p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch { return null; }
  if (!p || p.v !== 1 || p.m !== String(mealId) || p.u !== String(userId)) return null;
  if (!(typeof p.t === 'number' && now - p.t >= -60000 && now - p.t <= TTL_MS)) return null;
  return { ack: String(p.a || ''), photos: Array.isArray(p.p) ? p.p.map(String) : [], nonce: String(p.n || '') };
}

/* ---------------- what the client may tell us, bounded ---------------- */

const REASONS = ['ambiguous', 'composite', 'missing', 'already', 'no_match', 'amount', 'unpriced', 'unchanged', 'nothing'];
const VERBS = ['double', 'triple', 'extra', 'half', 'remove', 'add'];
const txt = (v, cap = 60) => String(v == null ? '' : v).replace(/[<>*_=`\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);
const list = (v, max, cap) => (Array.isArray(v) ? v : []).map((x) => txt(x, cap)).filter(Boolean).slice(0, max);

/** The outcome off the wire, with nothing in it that could carry more than a food's name. */
export function sanitizeOutcome(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const a = o.ask && typeof o.ask === 'object' ? o.ask : null;
  const ask = a && REASONS.includes(a.reason) ? {
    reason: a.reason,
    verb: VERBS.includes(a.verb) ? a.verb : '',
    food: txt(a.food),
    dish: txt(a.dish),
    newName: txt(a.newName),
    candidates: list(a.candidates, 4, 60),
    unpriced: list(a.unpriced, 3, 60),
  } : null;
  return { applied: o.applied === true, unpriced: list(o.unpriced, 3, 60), ask };
}

/* ---------------- the words Nia files ---------------- */

const lower = (s) => String(s || '').toLowerCase();
/** "the grilled chicken or the chicken salad"; "the a, the b or the c". */
function theList(names) {
  const n = names.map((x) => `the ${lower(x)}`);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`;
}
const orList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);
const VERB_ASK = { double: 'double', triple: 'triple', extra: 'add extra to', half: 'cut in half', remove: 'take off', add: 'add' };

/** Nia's one precise question for a correction that could not land. Deterministic, no model. */
export function askText(ask) {
  const a = ask || {};
  const food = lower(a.food) || 'that';
  switch (a.reason) {
    case 'ambiguous':
      return a.candidates.length > 1
        ? `Which one should I ${VERB_ASK[a.verb] || 'change'}: ${theList(a.candidates)}?`
        : `Which food did you mean by ${food}?`;
    case 'composite': {
      const lead = `In this read the ${food} is part of the ${lower(a.dish)}, not its own item.`;
      if (a.verb === 'remove') return `${lead} Should I take off the whole ${lower(a.dish)}, or tell me about how much ${food} to take out?`;
      if (a.verb === 'double' || a.verb === 'triple') return `${lead} Should I count ${a.verb === 'triple' ? 'two more portions' : 'another portion'} of ${food} on top of it, or ${a.verb} the whole ${lower(a.dish)}?`;
      if (a.verb === 'extra') return `${lead} Should I count some extra ${food} on top of it? Tell me about how much if you know.`;
      return `${lead} About how much ${food} was in it, like half a portion or 2 oz?`;
    }
    case 'missing':
      return a.verb === 'remove'
        ? `I don't see ${food} in this meal's read, so there was nothing to take off. Which food did you mean?`
        : `I don't see ${food} in this meal's read yet. Was it on this plate? Tell me about how much and I'll add it.`;
    case 'already':
      return `I already have ${theList(a.candidates.length ? a.candidates.slice(0, 1) : [food])} in this read. Was yours on top of that, so a double portion?`;
    case 'no_match':
      return a.candidates.length
        ? `I couldn't match ${food} to anything in this meal's read. Which one did you mean: ${orList(a.candidates.map(lower))}?`
        : `I couldn't match ${food} to anything in this meal's read. Which food did you mean?`;
    case 'amount':
      return `How much ${food} was it: double the portion, half, or an amount like 8 oz?`;
    case 'unpriced':
      return `I don't have numbers for ${orList(a.unpriced.length ? a.unpriced : ['that'])} yet, so your totals haven't changed. What are the protein and calories on the label, or what is it closest to?`;
    case 'unchanged':
      return a.newName
        ? `Got it, it's ${a.newName} now. The numbers are the same, so your totals and score stay where they were.`
        : `That didn't change any numbers. Tell me what to fix, like how much there was or what else was in it.`;
    default:
      return `I couldn't tell what to change there. Which food was it, and how much?`;
  }
}

/**
 * What to file for an outcome, in thread order. `lead` is Nia's message: her signed ack when the
 * numbers moved (an analysis_update, which carries the photos the turn looked at, now counted), or
 * her question when they did not. The receipt goes right after `lead` when the numbers moved.
 * `follow` is a question still owed after an applied correction (a food with no numbers on file, a
 * second food she could not place): its own row, meta t correction_ask, so the athlete's answer to
 * it reaches her (ai-addressing.js reads an analysis_update as a system record, not a question).
 */
/** @param {ReturnType<typeof sanitizeOutcome>} outcome @param {string} ack
 *  @param {{ nonce?: string, photos?: string[] }} [opts] */
export function outcomeRows(outcome, ack, { nonce, photos = [] } = {}) {
  const o = outcome || { applied: false, unpriced: [], ask: null };
  const ask = (reason, text) => ({ text: text.slice(0, 600), meta: { t: 'correction_ask', ct: nonce, reason } });
  if (o.applied) {
    const lead = { text: (String(ack || '').trim() || 'Good catch. Your numbers and score are updated.').slice(0, 600), meta: { t: 'analysis_update', ct: nonce, ...(photos.length ? { photos } : {}) } };
    const owed = [];
    if (o.unpriced.length) owed.push(`I don't have numbers for ${orList(o.unpriced)} yet, so that part isn't counted. What are its protein and calories?`);
    if (o.ask) owed.push(askText(o.ask));
    return { lead, follow: owed.length ? ask(o.unpriced.length ? 'unpriced' : o.ask.reason, owed.join(' ')) : null };
  }
  const a = o.ask || { reason: 'nothing', candidates: [], unpriced: [] };
  return { lead: ask(a.reason, askText(a)), follow: null };
}
