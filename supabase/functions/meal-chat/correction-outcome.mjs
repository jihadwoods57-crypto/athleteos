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
//      correction plus a signed `pending` token that carries Nia's ack and a hash of the correction.
//   2. The client applies it and calls back in `correctionOutcome` mode with the token, the
//      correction it was handed (verbatim), and what happened. No model call, no tokens, no cap.
//   3. Applied: Nia's lead goes into the thread, followed by the receipt with the real before and
//      after. Not applied: Nia says the one precise thing that is true instead ("Which one should I
//      double: the grilled chicken or the chicken salad?", "Already counted as a double, 6 oz.").
//
// NIA'S WORDS MATCH WHAT HAPPENED (review 2026-09-24). Her own ack is filed only when the client
// reports every part landed exactly as the model described it, and then in the past tense ("your
// numbers are updated", never "updating now": it is filed after the fact). Anything else, a part
// that became a question, was already counted, or was refined by the athlete's own words, gets a
// lead composed HERE from what actually landed ("Doubled the grilled chicken to 6 oz.").
//
// THE ATHLETE CANNOT PUT WORDS IN HER MOUTH. Everything the client reports is bounded to enums, and
// every food NAME in a sentence must come from the correction this function signed (hash-checked:
// the client echoes it and the token carries its SHA-256) or from the meal's own `detected` row in
// the database. Any other name becomes "that item". URLs and markup are stripped from every name
// regardless. The token is an HMAC over the meal, the caller, the ack, the correction hash and a
// nonce, keyed with the service role key: good once (a unique index on meta->>'ct', 0249), on its
// own meal, for its own correction, within 15 minutes.
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

/** The fingerprint of the correction a token was issued for: the JSON the client was handed. */
export async function correctionHash(correction) {
  const json = JSON.stringify(correction === undefined ? null : correction);
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(json))));
}

/** Sign Nia's pending ack. `photos` are the image keys the turn looked at (they count as applied
 *  only if the correction lands); `correction` is the exact object returned to the client.
 *  @param {{ mealId: string, userId: string, ack: string, photos?: string[], correction?: unknown }} p
 *  @param {string | undefined} key
 *  @param {number} [now] */
export async function signPending({ mealId, userId, ack, photos = [], correction = null }, key, now = Date.now()) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = {
    v: 2, m: String(mealId), u: String(userId), a: String(ack || '').slice(0, 500),
    p: (Array.isArray(photos) ? photos : []).slice(0, 4).map(String), h: await correctionHash(correction), t: now, n: nonce,
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(key, body));
  return `${body}.${sig}`;
}

/** The pending ack, if this token is genuine, unexpired, and for THIS meal and caller; else null.
 *  @param {unknown} token
 *  @param {{ mealId: string, userId: string }} who
 *  @param {string | undefined} key
 *  @param {number} [now]
 *  @returns {Promise<{ ack: string, photos: string[], nonce: string, hash: string } | null>} */
export async function readPending(token, { mealId, userId }, key, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4000 || !key) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let p;
  try {
    if (!sameBytes(fromB64url(sig), await hmac(key, body))) return null;
    p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch { return null; }
  if (!p || p.v !== 2 || p.m !== String(mealId) || p.u !== String(userId) || typeof p.h !== 'string') return null;
  if (!(typeof p.t === 'number' && now - p.t >= -60000 && now - p.t <= TTL_MS)) return null;
  return { ack: String(p.a || ''), photos: Array.isArray(p.p) ? p.p.map(String) : [], nonce: String(p.n || ''), hash: p.h };
}

/* ---------------- which names Nia may say ---------------- */

/** URLs and markup out of anything that might become part of a sentence. */
export function stripName(v, cap = 60) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>?/g, ' ')                                   // a tag goes whole, never as "b ... /b"
    .replace(/(?:https?:\/\/|www\.)\S*/gi, ' ')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b\S*/gi, ' ')   // any domain
    .replace(/[^\p{L}\p{M}\p{N}' &,.%-]+/gu, ' ')                   // markup, symbols, control characters
    .replace(/(^|\s)[^\p{L}\p{M}\p{N}\s&]+(?=\s|$)/gu, ' ')           // stray punctuation between words
    .replace(/\s+/g, ' ').trim().slice(0, cap).replace(/[\s,.&-]+$/, '').trim();
}
// Words compared letter for letter, accents and all ("jalapeño" is not "jalapeno", and never "jalape o").
const lowerWords = (s) => String(s || '').normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}']+/u).map((w) => w.replace(/'/g, '').replace(/s$/, '')).filter((w) => w.length >= 2);

/** Every food name this turn may put in a sentence: the signed correction's and the meal row's.
 *  @param {any} correction  the hash-checked correction
 *  @param {unknown} detected  meals.detected (names, or rich rows with a name) */
export function allowedNames(correction, detected) {
  const c = correction && typeof correction === 'object' ? correction : {};
  const out = [];
  const add = (v) => { const n = stripName(v, 80); if (n) out.push(n); };
  const part = (p) => { if (p && typeof p === 'object') { add(p.item); add(p.newName); for (const a of Array.isArray(p.add) ? p.add : []) add(a && a.name); } };
  part(c);
  for (const p of Array.isArray(c.more) ? c.more : []) part(p);
  for (const f of Array.isArray(c.missed) ? c.missed : []) add(f && f.name);
  for (const d of Array.isArray(detected) ? detected.slice(0, 24) : []) add(typeof d === 'string' ? d : d && d.name);
  return out;
}

/** A gate over one list of allowed names: a name passes when every word of it is a word of ONE
 *  of them ("chicken" out of "Grilled chicken"; never "sour chicken lettuce" stitched from three).
 *  Anything else is ''. */
function nameGate(allowed) {
  const sets = (Array.isArray(allowed) ? allowed : []).map((n) => new Set(lowerWords(n)));
  return (v) => {
    const n = stripName(v);
    const w = lowerWords(n);
    if (!w.length || w.length > 6) return '';
    return sets.some((set) => w.every((x) => set.has(x))) ? n : '';
  };
}
/* An amount Nia may say: a positive number and a unit, inside what a plate can hold. The cap is
   per unit (a sane plate, not a typo or a joke); anything outside it is not said at all. */
const UNIT_CAP = { oz: 64, 'fl oz': 64, ounce: 64, g: 2000, gram: 2000, ml: 3000, cup: 10, tbsp: 30, tablespoon: 30,
  tsp: 60, teaspoon: 60, lb: 4, pound: 4, slice: 12, piece: 12, serving: 12, portion: 12, bowl: 12, scoop: 12,
  egg: 12, strip: 12, patty: 12, can: 12, bottle: 12, glass: 12, wing: 20, nugget: 20, sandwich: 12, tortilla: 12,
  taco: 12, burrito: 6, bar: 12, cookie: 12, pancake: 12, waffle: 12, banana: 12, apple: 12, fillet: 6, breast: 6, thigh: 12 };
/** The singular a unit table knows: "slices" slice, "sandwiches" sandwich, "fl oz" as is. */
const unitOf = (u) => [u, u.replace(/es$/, ''), u.replace(/s$/, '')].find((x) => UNIT_CAP[x]) || '';
const SIZE = /^(?:large|medium|small|whole|big|jumbo|mini)$/;
const FRAC = [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']];
/** 0.5 -> "1/2", 1.5 -> "1 1/2", 4.5 -> "4 1/2"; metric stays decimal. */
function asFraction(n, unit) {
  if (/^(?:g|gram|ml)$/.test(unit)) return String(Math.round(n * 10) / 10);
  const whole = Math.floor(n + 1e-9);
  const fr = FRAC.find(([f]) => Math.abs(n - whole - f) < 0.01);
  if (Math.abs(n - whole) < 0.01) return String(whole);
  if (fr) return whole ? `${whole} ${fr[1]}` : fr[1];
  return String(Math.round(n * 100) / 100);
}
/** "6 oz", "3/4 cup", "8 fl oz" or "2 medium bananas" (one word of ONE allowed food), or ''. */
function amountGate(allowed) {
  const sets = (Array.isArray(allowed) ? allowed : []).map((n) => new Set(lowerWords(n)));
  return (v) => {
    // Its own cleaning, not stripName's: "/" is part of an amount ("1 1/2 cups"). The pattern below
    // is the whole grammar, so nothing else can ride along.
    const s = String(v == null ? '' : v).replace(/<[^>]*>?/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 30);
    const m = s.match(/^(\d+(?:\.\d+)?|\d+ ?\/ ?\d+|\d+ \d+ ?\/ ?\d+)\s+(fl oz|[a-z]+)(?:\s([a-z]+))?$/);
    if (!m) return '';
    const parts = m[1].match(/^(\d+) (\d+) ?\/ ?(\d+)$/) || m[1].match(/^()(\d+) ?\/ ?(\d+)$/);
    const n = parts ? (Number(parts[1]) || 0) + Number(parts[2]) / Number(parts[3]) : Number(m[1]);
    if (!(n > 0) || !isFinite(n)) return '';                         // zero is a removal; x/0 is nothing
    let unit = m[2] === 'fl oz' ? 'fl oz' : unitOf(m[2]);
    let food = m[3] || '';
    if (SIZE.test(m[2]) && food) { unit = ''; }                      // "2 medium bananas": size + food
    else if (!unit) {                                                 // "3 eggs", "20 nuggets": a count of a food
      if (food) return '';
      food = m[2];
    }
    const cap = unit ? UNIT_CAP[unit] : UNIT_CAP[unitOf(food)] || 12;
    if (food && !UNIT_CAP[unitOf(food)] && !sets.some((set) => set.has(lowerWords(food)[0]))) return '';
    if (n > (cap || 12)) return '';
    return `${asFraction(n, unit)} ${m[2]}${m[3] ? ` ${m[3]}` : ''}`;
  };
}

/* ---------------- what the client may tell us, bounded ---------------- */

const REASONS = ['ambiguous', 'composite', 'missing', 'already', 'no_match', 'amount', 'unpriced', 'unchanged', 'nothing', 'counted', 'confirm'];
const VERBS = ['double', 'triple', 'extra', 'half', 'remove', 'add', 'set'];
const OPS = ['scale', 'amount', 'remove', 'rename', 'add', 'ingredients', 'macros'];

/** The outcome off the wire, with nothing in it but enums, allowed names and plain amounts.
 *  @param {any} raw  body.correctionOutcome
 *  @param {string[]} allowed  allowedNames(...) for this turn; nothing is allowed without it */
export function sanitizeOutcome(raw, allowed) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const nm = nameGate(allowed);
  const amt = amountGate(allowed);
  const names = (v, max) => (Array.isArray(v) ? v : []).slice(0, 8).map(nm).filter(Boolean).slice(0, max);
  const askOf = (a) => (a && typeof a === 'object' && REASONS.includes(a.reason) ? {
    reason: a.reason,
    verb: VERBS.includes(a.verb) ? a.verb : '',
    food: nm(a.food),
    dish: nm(a.dish),
    newName: nm(a.newName),
    amount: amt(a.amount),
    candidates: names(a.candidates, 4),
    unpriced: (Array.isArray(a.unpriced) ? a.unpriced : []).slice(0, 3).map((x) => nm(x) || 'that item'),
  } : null);
  const rawAsks = Array.isArray(o.asks) && o.asks.length ? o.asks : o.ask ? [o.ask] : [];
  const asks = rawAsks.slice(0, 3).map(askOf).filter(Boolean);
  const done = (Array.isArray(o.done) ? o.done : []).slice(0, 6)
    .filter((d) => d && OPS.includes(d.op))
    .map((d) => ({ op: d.op, verb: VERBS.includes(d.verb) ? d.verb : '', food: nm(d.food), to: amt(d.to), newName: nm(d.newName) }));
  const unpriced = [...new Set((Array.isArray(o.unpriced) ? o.unpriced : []).slice(0, 3).map((x) => nm(x) || 'that item'))];
  const applied = o.applied === true;
  // `exact` is the client's claim that every part landed as the model described it. It is believed
  // only when something applied, nothing is owed, and what landed covers every part of the SIGNED
  // correction (review round 2). Otherwise the server composes the lead from what did land.
  const exact = o.exact === true && applied && !asks.length && !unpriced.length && covers(done, o.correction);
  return { applied, exact, done, unpriced, asks, ask: asks[0] || null };
}

/* Does what landed account for every part of the correction the model sent (review round 3)? Each
   part is checked for the operation it asked for, on the same food: a removal is covered only by a
   removal of that food, an amount only by a scale or amount of it, a rename only by that rename.
   "Doubled the grilled chicken" says nothing about the chicken salad the model also took off. */
const ZERO = /^\s*(?:0+(?:\.0+)?(?:\s*[a-z]+)?|zero|none|nothing|no\b.*|removed?|drop(?:ped)?|took (?:it )?off|taken off|did(?:n't| not) .*)\s*$/i;
function covers(done, correction) {
  const c = correction && typeof correction === 'object' ? correction : {};
  const same = (a, b) => {
    const x = lowerWords(a), y = lowerWords(b);
    return x.length > 0 && y.length > 0 && (x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)));
  };
  const hit = (name, ops) => done.some((d) => ops.includes(d.op) && same(name, d.food));
  const items = [c, ...(Array.isArray(c.more) ? c.more : [])].filter((p) => p && typeof p === 'object' && p.item);
  const missed = (Array.isArray(c.missed) ? c.missed : []).filter((f) => f && f.name);
  if (!done.length || (!items.length && !missed.length)) return false;
  const perGiven = (p) => p.per && typeof p.per === 'object' && Object.values(p.per).some((v) => v != null);
  return items.every((p) => {
    if (p.quantity && ZERO.test(String(p.quantity))) return hit(p.item, ['remove']);
    const need = [];
    if (p.quantity) need.push(['scale', 'amount']);
    if (p.newName) need.push(['rename', 'scale', 'amount']);        // a "Double chicken" rename lands as a scale
    if (Array.isArray(p.add) && p.add.length) need.push(['ingredients']);
    if (perGiven(p) && !p.newName) need.push(['macros', 'scale', 'amount']);
    return need.length > 0 && need.every((ops) => hit(p.item, ops) || (p.newName && ops.includes('rename') && done.some((d) => d.op === 'rename' && same(p.newName, d.newName))));
  }) && missed.every((f) => hit(f.name, ['add']));
}

/* ---------------- the words Nia files ---------------- */

const lower = (s) => String(s || '').toLowerCase();
const theFood = (f) => (f ? `the ${lower(f)}` : 'that item');
/** "the grilled chicken or the chicken salad"; "the a, the b or the c". */
function theList(names) {
  const n = names.map((x) => `the ${lower(x)}`);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`;
}
const orList = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);
const VERB_ASK = { double: 'double', triple: 'triple', extra: 'add extra to', half: 'cut in half', remove: 'take off', add: 'add', set: 'change' };
const COUNTED_AS = { double: 'a double', triple: 'a triple', half: 'half', extra: 'extra' };
/** "6 oz" never breaks between the 6 and the oz in a bubble. */
const nb = (s) => String(s || '').replace(/(\d) (?=[\da-z])/gi, '$1\u00a0');

/** Nia's one precise sentence for a part that did not land. Deterministic, no model. */
export function askText(ask) {
  const a = ask || {};
  const cands = Array.isArray(a.candidates) ? a.candidates : [];
  const food = lower(a.food) || 'that';
  switch (a.reason) {
    case 'ambiguous':
      return cands.length > 1
        ? `Which one should I ${VERB_ASK[a.verb] || 'change'}: ${theList(cands)}?`
        : a.food ? `Which food did you mean by ${food}?` : 'Which food did you mean?';
    case 'composite': {
      if (!a.dish) return `Which food on this plate did you mean, and about how much?`;
      const lead = `In this read the ${food} is part of the ${lower(a.dish)}, not its own item.`;
      if (a.verb === 'remove') return `${lead} Should I take off the whole ${lower(a.dish)}, or tell me about how much ${food} to take out?`;
      if (a.verb === 'double' || a.verb === 'triple') return `${lead} Should I count ${a.verb === 'triple' ? 'two more portions' : 'another portion'} of ${food} on top of it, or ${a.verb} the whole ${lower(a.dish)}?`;
      if (a.verb === 'extra') return `${lead} Should I count some extra ${food} on top of it? Tell me about how much if you know.`;
      return `${lead} About how much ${food} was in it, like half a portion or 2 oz?`;
    }
    case 'missing':
      return a.verb === 'remove'
        ? `I don't see ${a.food ? food : 'that'} in this meal's read, so there was nothing to take off. Which food did you mean?`
        : `I don't see ${a.food ? food : 'that'} in this meal's read yet. Was it on this plate? Tell me about how much and I'll add it.`;
    case 'already':
      return `I already have ${cands.length ? theList(cands.slice(0, 1)) : theFood(a.food)} in this read. Was yours on top of that, so a double portion?`;
    case 'no_match':
      return cands.length
        ? `I couldn't match ${a.food ? food : 'that'} to anything in this meal's read. Which one did you mean: ${orList(cands.map(lower))}?`
        : `I couldn't match ${a.food ? food : 'that'} to anything in this meal's read. Which food did you mean?`;
    case 'amount':
      return `How much ${a.food ? food : 'of it'} was it: double the portion, half, or an amount like 8 oz?`;
    case 'unpriced':
      return `I don't have numbers for ${orList((a.unpriced && a.unpriced.length ? a.unpriced : ['that']).map(lower))} yet, so your totals haven't changed. What are the protein and calories on the label, or what ${a.unpriced && a.unpriced.length > 1 ? 'are they' : 'is it'} closest to?`;
    case 'unchanged':
      return a.newName
        ? `Got it, it's ${lower(a.newName)} now. The numbers are the same, so your totals and score stay where they were.`
        : `That didn't change any numbers. Tell me what to fix, like how much there was or what else was in it.`;
    case 'counted': {
      const as = COUNTED_AS[a.verb] || '';
      if (a.amount) return as ? `Already counted as ${as}, ${nb(a.amount)}.` : `Already counted as ${nb(a.amount)}.`;
      if (as) return `${a.food ? `The ${food} is` : 'That is'} already counted as ${as}.`;
      return a.food ? `The ${food} is already in this read, so nothing changed.` : `That's already counted, so nothing changed.`;
    }
    case 'confirm':
      return cands.length ? `Should I take ${theList(cands.slice(0, 1))} off this meal?` : `Which food should I take off this meal?`;
    default:
      return `I couldn't tell what to change there. Which food was it, and how much?`;
  }
}

/** One sentence per thing that landed, in Nia's voice, past tense. */
export function composeDone(done) {
  const out = [];
  const adds = [];
  for (const d of Array.isArray(done) ? done : []) {
    const f = theFood(d.food);
    const to = d.to ? ` to ${nb(d.to)}` : '';
    if (d.op === 'scale') {
      if (d.verb === 'double') out.push(`Doubled ${f}${to}.`);
      else if (d.verb === 'triple') out.push(`Tripled ${f}${to}.`);
      else if (d.verb === 'half') out.push(`Halved ${f}${to}.`);
      else if (d.verb === 'extra') out.push(`Counted extra ${d.food ? lower(d.food) : 'of that item'}${d.to ? `, ${nb(d.to)} now` : ''}.`);
      else out.push(d.to ? `Set ${f}${to}.` : `Updated ${f}.`);
    } else if (d.op === 'amount') out.push(d.to ? `Set ${f}${to}.` : `Updated the amount of ${f}.`);
    else if (d.op === 'remove') out.push(`Took ${f} off.`);
    else if (d.op === 'rename') out.push(d.newName ? `Changed ${f} to ${lower(d.newName)}.` : `Renamed ${f}.`);
    else if (d.op === 'add') adds.push(d.food ? lower(d.food) : 'that item');
    else if (d.op === 'ingredients') out.push(`Updated what's in ${f}.`);
    else if (d.op === 'macros') out.push(`Put your numbers on ${f}.`);
  }
  if (adds.length) out.push(`Added ${orList([...new Set(adds)]).replace(/ or ([^,]*)$/, ' and $1')}.`);
  const text = out.slice(0, 3).join(' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Your numbers are updated.';
}

/** Is the model's ack still talking about a change in progress ("updating your numbers now")? It is
 *  filed AFTER the change, so such an ack is never filed or rewritten word by word (review round 2:
 *  "Got it. Recalculating now." became "Got it. updated."). The server's own lead replaces it. */
export function stillHappening(ack) {
  return /\b(?:updating|recalculating|recomputing|refreshing)\b|\b(?:is|are)\s+(?:changing|moving)\b|\b(?:will|'ll|going to|about to)\s+(?:update|recalculate|change|refresh)\b|\bupdat\w*\s+(?:right\s+)?now\b/i.test(String(ack || ''));
}

/**
 * What to file for an outcome, in thread order. `lead` is Nia's message: her signed ack when the
 * numbers moved exactly as she described (an analysis_update, which carries the photos the turn
 * looked at, now counted), a sentence composed from what landed when they moved some other way, or
 * what is true when they did not move at all. The receipt goes right after `lead` when the numbers
 * moved. `follow` is anything still owed after an applied correction (a food with no numbers on
 * file, a second food she could not place): its own row, meta t correction_ask, so the athlete's
 * answer to it reaches her (ai-addressing.js reads an analysis_update as a system record).
 * Each row's `ct` is unique (the lead's is the nonce, the follow's the nonce + ':q'; the receipt
 * takes ':r' in index.ts), so migration 0249's unique index files each at most once.
 */
/** @param {ReturnType<typeof sanitizeOutcome>} outcome @param {string} ack
 *  @param {{ nonce?: string, photos?: string[] }} [opts] */
export function outcomeRows(outcome, ack, { nonce, photos = [] } = {}) {
  const o = outcome || { applied: false, exact: false, done: [], unpriced: [], asks: [], ask: null };
  const asks = Array.isArray(o.asks) && o.asks.length ? o.asks : o.ask ? [o.ask] : [];
  const ct = (suffix) => (nonce ? { ct: `${nonce}${suffix}` } : {});
  // What is already true reads before what is being asked.
  const ordered = [...asks.filter((a) => a.reason === 'counted'), ...asks.filter((a) => a.reason !== 'counted')];
  if (o.applied) {
    const own = o.exact && !stillHappening(ack) ? String(ack || '').trim() : '';
    const lead = { text: (own || composeDone(o.done)).slice(0, 600), meta: { t: 'analysis_update', ...ct(''), ...(photos.length ? { photos } : {}) } };
    const owed = [];
    if (o.unpriced.length) {
      const many = o.unpriced.length > 1;
      owed.push(`I don't have numbers for ${orList(o.unpriced.map(lower)).replace(/ or ([^,]*)$/, many ? ' and $1' : ' or $1')} yet, so ${many ? 'those parts aren\'t' : 'that part isn\'t'} counted. What are ${many ? 'their' : 'its'} protein and calories?`);
    }
    for (const a of ordered.slice(0, 2)) owed.push(askText(a));
    const reason = o.unpriced.length ? 'unpriced' : ordered.length ? ordered[0].reason : '';
    return { lead, follow: owed.length ? { text: owed.join(' ').slice(0, 600), meta: { t: 'correction_ask', ...ct(':q'), reason } } : null };
  }
  const first = ordered[0] || { reason: 'nothing', candidates: [], unpriced: [] };
  const text = (ordered.length ? ordered.slice(0, 2).map(askText).join(' ') : askText(first)).slice(0, 600);
  return { lead: { text, meta: { t: 'correction_ask', ...ct(''), reason: first.reason } }, follow: null };
}
