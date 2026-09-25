// OnStandard — what Nia (the AI nutritionist) can SEE in a meal thread, and what a coach may ask it to add.
//
// THE INCIDENT (2026-09-22, live prod). An athlete posted a photo of a protein shake, Nutrition
// Facts panel in plain view, with "I'm also drinking this". Forty-five minutes later the coach
// wrote "Make sure that gets added in", and the AI answered "I don't have details on what he's
// drinking". Then, twice, "I only have access to the logged meal data, not the image itself".
//
// It was telling the truth. Only the image attached to the CURRENT message ever reached the model,
// so a coach turn could never see a photo the athlete had posted earlier. A person reading the
// thread could see it; the nutritionist in the same thread could not.
//
// This module is the fix, and it is server-side on purpose: the photos are read out of
// meal_comments by the function itself, so the client cannot name an image, only post one.
//
// Plain ES module, no Deno APIs, so `npm run test:fn` exercises it without Docker or a key.
import { addsFoodToThisMeal } from '../_shared/ai-addressing.mjs';

/** The only shape a chat attachment key has: `<uploader uid>/chat/<file>`. Storage RLS keys the
 *  first segment on the uploader, so the uid in the key IS who put it there. */
export const PHOTO_KEY_RE = /^[0-9a-f-]{36}\/chat\/[A-Za-z0-9._-]{1,64}$/i;

/** Rows whose meta.photos lists images whose food is ALREADY in the numbers. */
const APPLIED_META = ['analysis_update', 'ai_addition'];
const NOT_SPEECH = ['reaction', 'note'];

export const metaOf = (row) => {
  const m = row && row.meta;
  if (!m) return {};
  if (typeof m === 'string') { try { return JSON.parse(m) || {}; } catch { return {}; } }
  return typeof m === 'object' ? m : {};
};

/** A key the model may be shown: the right shape, inside one of the allowed owners' folders. */
export function photoKeyOk(key, owners) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k || !PHOTO_KEY_RE.test(k)) return false;
  return (Array.isArray(owners) ? owners : []).some((o) => typeof o === 'string' && o && k.startsWith(`${o}/`));
}

/** Every photo key some earlier turn already turned into numbers. */
export function appliedPhotoKeys(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = metaOf(r);
    if (r && r.role === 'ai' && APPLIED_META.includes(String(m.t || '')) && Array.isArray(m.photos)) {
      for (const k of m.photos) if (typeof k === 'string') out.add(k);
    }
  }
  return out;
}

const newestFirst = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((r) => r && typeof r === 'object')
  .slice()
  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

/**
 * The photos this turn should look at, newest first, at most `limit`.
 *
 *   - the photo attached to THIS message (`current`), when it sits in the caller's own folder;
 *   - then the thread's recent photos that no earlier turn has applied, each only from the meal
 *     OWNER (the athlete) or the CALLER themselves — never a third person's upload — and only when
 *     the key's folder is the row author's own (a row cannot point at somebody else's picture).
 *
 * @param rows     meal_comments rows for THIS meal (any order)
 * @param opts     { athleteId, callerId, current, limit = 2, now = Date.now(), maxAgeMs = 36h }
 * @returns Array<{ key, messageId, authorId, role, text, at, current }>
 */
export function pickThreadPhotos(rows, opts) {
  const o = opts || {};
  const limit = Math.max(0, Math.min(2, Number.isFinite(o.limit) ? o.limit : 2));
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const maxAge = Number.isFinite(o.maxAgeMs) ? o.maxAgeMs : 36 * 3600 * 1000;
  const owners = [o.athleteId, o.callerId].filter((v) => typeof v === 'string' && v);
  const applied = appliedPhotoKeys(rows);
  const out = [];
  const seen = new Set();
  const cur = typeof o.current === 'string' ? o.current.trim() : '';
  if (cur && photoKeyOk(cur, [o.callerId])) {
    const r = newestFirst(rows).find((x) => metaOf(x).photo === cur) || null;
    out.push({
      key: cur, messageId: r ? r.id || null : null, authorId: o.callerId, role: r ? r.role : null,
      text: r ? String(r.text || '') : '', at: r ? r.created_at || null : null, current: true,
    });
    seen.add(cur);
  }
  for (const r of newestFirst(rows)) {
    if (out.length >= limit) break;
    if (NOT_SPEECH.includes(String(r.kind || '')) || r.role === 'ai') continue;
    const key = metaOf(r).photo;
    if (typeof key !== 'string' || seen.has(key) || applied.has(key)) continue;
    if (!owners.includes(r.author_id)) continue;
    if (!photoKeyOk(key, [r.author_id])) continue;
    const t = Date.parse(r.created_at || '');
    if (Number.isFinite(t) && now - t > maxAge) continue;
    seen.add(key);
    out.push({ key, messageId: r.id || null, authorId: r.author_id, role: r.role || null, text: String(r.text || ''), at: r.created_at || null, current: false });
  }
  return out.slice(0, limit);
}

const lowered = (s) => String(s == null ? '' : s).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * What in this thread could ground a COACH-requested addition: the athlete's own messages that
 * either carry a photo nothing has applied yet, or say in words that something else went into this
 * meal. Nothing a coach wrote can ground it — the coach is asking, the athlete is the evidence.
 * A message that already sourced an addition is spent.
 *
 * @returns Array<{ id, text, photoKey, at }> newest first, at most 4
 */
export function additionGrounds(rows, athleteId) {
  const applied = appliedPhotoKeys(rows);
  const spent = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = metaOf(r);
    if (r && r.role === 'ai' && m.t === 'ai_addition' && m.source && m.source.messageId) spent.add(String(m.source.messageId));
  }
  const out = [];
  for (const r of newestFirst(rows)) {
    if (out.length >= 4) break;
    if (!r.id || r.role !== 'athlete' || r.author_id !== athleteId) continue;
    if (NOT_SPEECH.includes(String(r.kind || '')) || spent.has(String(r.id))) continue;
    const key = metaOf(r).photo;
    const photoKey = typeof key === 'string' && !applied.has(key) && photoKeyOk(key, [athleteId]) ? key : null;
    if (!photoKey && !addsFoodToThisMeal(lowered(r.text))) continue;
    out.push({ id: String(r.id), text: String(r.text || '').slice(0, 300), photoKey, at: r.created_at || null });
  }
  return out;
}

const gnum = (v, cap) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= cap ? n : null;
};
const str = (v, cap) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, cap);
const FIGURES = ['protein', 'kcal', 'carbs', 'fat'];

/**
 * A whole food to add to this meal, off the model and therefore untrusted. Shared by the athlete's
 * `missed` list and the coach-requested addition so the two cannot drift.
 *
 * LABEL BASIS (2026-09-22). When the image shows a Nutrition Facts panel the model reports the
 * PRINTED per-serving figures, how many servings were consumed, and which figures it could not
 * read. The client multiplies and marks the food basis 'label', which the curated reference never
 * overrides (meal-intel.js add-foods). A figure listed as unreadable is dropped even if the model
 * also guessed it: an unreadable number is asked for, never invented.
 */
export function sanitizeFood(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const name = str(a.name, 60);
  if (!name) return null;
  const unreadable = (Array.isArray(a.unreadable) ? a.unreadable : [])
    .map((u) => String(u || '').toLowerCase().replace(/^calories$/, 'kcal').replace(/^carbohydrates?$/, 'carbs'))
    .filter((u, i, arr) => FIGURES.includes(u) && arr.indexOf(u) === i);
  const per = {};
  for (const k of FIGURES) per[k] = unreadable.includes(k) ? null : gnum(a[k], k === 'kcal' ? 2000 : k === 'carbs' ? 500 : 300);
  const label = a.basis === 'label' && FIGURES.some((k) => per[k] != null);
  const sv = Number(a.servings);
  return {
    name,
    quantity: str(a.quantity, 40) || null,
    per,
    ...(label ? { basis: 'label', servings: Number.isFinite(sv) && sv > 0 && sv <= 10 ? Math.round(sv * 100) / 100 : 1 } : {}),
    ...(unreadable.length ? { unreadable } : {}),
  };
}

export function sanitizeFoods(list, max = 6) {
  return (Array.isArray(list) ? list : []).slice(0, max).map(sanitizeFood).filter(Boolean);
}

/**
 * The coach asked the AI to add something. Accepted ONLY when the model names a message from the
 * athlete's own grounds (see additionGrounds) and at least one food survives sanitising. Anything
 * else is refused: a coach cannot have the AI put food on an athlete's plate on the coach's word.
 *
 * @returns {{ source: {id,text,photoKey,at}, foods }|null}
 */
export function validateCoachAddition(input, grounds) {
  const i = input && typeof input === 'object' ? input : {};
  const id = String(i.sourceMessageId || '');
  const source = (Array.isArray(grounds) ? grounds : []).find((g) => g && g.id === id) || null;
  if (!source) return null;
  const foods = sanitizeFoods(i.foods);
  if (!foods.length) return null;
  return { source, foods };
}

const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * The receipt row's sentence: whose evidence, at whose request, what. No figures, so it reads the
 * same to an Intuitive athlete as to anyone else; the numeric receipt follows once the athlete's
 * app applies it.
 */
export function additionReceiptText({ athleteFirst, requester, foods, fromPhoto }) {
  const who = str(athleteFirst, 40) || 'the athlete';
  const by = str(requester, 60) || 'the coach';
  const list = (Array.isArray(foods) ? foods : []).map((f) => (f.quantity ? `${f.name} (${f.quantity})` : f.name));
  const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] || 'it');
  const from = fromPhoto ? `${possessive(who)} photo` : `what ${who} said`;
  return `Added to this meal from ${from}, at ${possessive(by)} request: ${what}. ${possessive(who)} numbers and meal score update with it.`;
}

/**
 * The one line the numeric receipt card carries under "Updated" (chat-view receiptNoteOf), built
 * from the ai_addition row's own meta so either device filing the receipt says the same thing.
 * e.g. "Added from Jihad's photo, at Coach Brooks' request".
 */
export function additionNote(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const src = m.source && typeof m.source === 'object' ? m.source : {};
  const by = m.requestedBy && typeof m.requestedBy === 'object' ? m.requestedBy : {};
  const who = str(src.athleteFirst, 40) || 'the athlete';
  const asker = str(by.name, 60) || 'the coach';
  const from = src.photo ? `${possessive(who)} photo` : `what ${who} said`;
  return `Added from ${from}, at ${possessive(asker)} request`.slice(0, 140);
}

/** Receipt rows an athlete on this plan style may read: an Intuitive athlete sees the meal score
 *  and nothing else (PRODUCT.md calorie red line), exactly as state.js _correctionReceiptRows
 *  selects on the athlete's own device. */
export function receiptRowsForStyle(rows, planStyle) {
  const list = Array.isArray(rows) ? rows : [];
  return planStyle === 'intuitive' ? list.filter((r) => r && r.score === true && r.label === 'Meal score') : list;
}

/**
 * The words that tell the model what each image is, so it can say "the shake Jihad posted" rather
 * than "the image". Order matches the image blocks.
 */
export function photoPreamble(photos, names) {
  const n = names || {};
  return (Array.isArray(photos) ? photos : []).map((p, i) => {
    const who = p.authorId && p.authorId === n.athleteId ? (n.athleteFirst || 'the athlete')
      : p.authorId && p.authorId === n.callerId ? (n.callerLabel || 'the person asking you') : 'someone in the thread';
    const said = p.text ? ` with the words "${String(p.text).replace(/["<>]/g, '').slice(0, 160)}"` : ' with no caption';
    const when = p.current ? ' (attached to this message)' : ' (earlier in this thread)';
    return `Image ${i + 1}: a photo ${who} posted${said}${when}.`;
  }).join('\n');
}

/** First name off a profiles.full_name, or '' — never a guessed pronoun in its place. */
export function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0].replace(/[<>"]/g, '').slice(0, 40);
}

const NOUNS = { coach: 'Coach', trainer: 'Trainer', dietitian: 'Dietitian', nutritionist: 'Nutritionist' };

/** "Coach Brooks": the asker's role noun and last name, the way an athlete would say it. Falls back
 *  to the first name, then to "your coach". */
export function requesterLabel(fullName, noun) {
  const n = NOUNS[String(noun || '').toLowerCase()] || 'Coach';
  const parts = String(fullName || '').replace(/[<>"]/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${n} ${parts[parts.length - 1]}`.slice(0, 60);
  if (parts.length === 1) return `${n} ${parts[0]}`.slice(0, 60);
  return `your ${n.toLowerCase()}`;
}

/**
 * The thread as the model should read it on a COACH turn, built from the database rather than from
 * the coach's client (which sent six `{role, text}` lines with no names and no pictures). Names,
 * roles, message ids (so add_from_athlete can cite one), and which line carries which image.
 *
 * @param rows    meal_comments rows (any order)
 * @param names   { byId: {uid: full_name}, athleteId, aiName }
 * @param photos  the pickThreadPhotos result, so a line can say "[Image 1]"
 */
export function threadTranscript(rows, names, photos) {
  const n = names || {};
  const byId = n.byId || {};
  const imageOf = new Map((Array.isArray(photos) ? photos : []).map((p, i) => [p.key, i + 1]));
  const speech = newestFirst(rows)
    .filter((r) => !NOT_SPEECH.includes(String(r.kind || '')) && (r.text || metaOf(r).photo))
    .slice(0, 14)
    .reverse();
  return speech.map((r) => {
    const m = metaOf(r);
    const who = r.role === 'ai' ? (n.aiName || 'Nia')
      : `${firstName(byId[r.author_id]) || (r.role === 'athlete' ? 'Athlete' : 'Coach')} (${r.role === 'athlete' ? 'athlete' : r.role === 'ai' ? 'ai' : 'staff'})`;
    const img = typeof m.photo === 'string'
      ? (imageOf.has(m.photo) ? ` [photo: Image ${imageOf.get(m.photo)}]` : ' [photo, already counted or out of view]')
      : '';
    const tag = m.t === 'ai_addition' || m.t === 'analysis_update' || m.t === 'correction_receipt' ? ' [update record]' : '';
    return `- id ${r.id} | ${who}${img}${tag}: ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 220)}`;
  }).join('\n');
}
