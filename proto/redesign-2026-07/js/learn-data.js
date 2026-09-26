/* Lessons and the team challenge, the athlete's data (goals and eating plan, phase D, 2026-09-26).
 *
 * One read, 0256 my_learning: the lessons assigned to me (my team and my room), the ones I have
 * finished, and a running team challenge with my own days and the team as a count. Kept in memory
 * and on this phone per user, so Home and Learn paint what they last knew before the network
 * answers. Lazy: nothing here is in the boot graph.
 *
 * FINISHING A LESSON NEVER GETS LOST. The completion is kept on the phone first (pending) and sent
 * through complete_lesson; a failed send stays pending and goes again on the next read. The Learn
 * list and Home count a pending completion as done, so the athlete never sees a lesson they just
 * finished come back.
 */
import { RT, S } from './state.js';
import { DAY } from './day.js';
import { audience, isLessonId } from './lessons-model.js';

export const LEARN_TTL = 120000;
let L = { uid: null, at: 0, data: null, err: false, inflight: null };

const KEY = (uid) => `os.learn.${uid}`;
const PKEY = (uid) => `os.learnPending.${uid}`;
const store = () => { try { return window.localStorage; } catch { return null; } };
function readJson(k) { try { const s = store(); const v = s && JSON.parse(s.getItem(k) || 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; } }
function writeJson(k, v) { try { const s = store(); if (s) s.setItem(k, JSON.stringify(v)); } catch { /* quota: the next read refills it */ } }

/** The reader for the lesson words: Intuitive (no figures) and minor (no weight words). */
export function readerAudience() {
  return audience({ showMacros: !!(S.planStyle && S.planStyle.showMacros), minor: !!(S.consent && S.consent.minor) });
}

function mine() {
  const uid = RT.userId || null;
  if (L.uid !== uid) {
    L = { uid, at: 0, data: uid ? readJson(KEY(uid)) : null, err: false, inflight: null };
  }
  return L;
}

/** What this phone knows: { assignments, completions, challenge, today } or null before any read. */
export function learning() { return mine().data; }

/** Completions waiting to reach the server: [{ lesson_id, quiz_correct, at }]. */
export function pendingCompletions() {
  const uid = RT.userId;
  const p = uid ? readJson(PKEY(uid)) : null;
  return Array.isArray(p) ? p.filter((x) => x && isLessonId(x.lesson_id)) : [];
}

/** Every lesson I have finished, as far as this phone knows (the server's plus the pending). */
export function doneIds() {
  const d = learning();
  const server = d && Array.isArray(d.completions) ? d.completions.map((c) => c.lesson_id) : [];
  return [...new Set([...server, ...pendingCompletions().map((p) => p.lesson_id)])];
}

/** Send what is pending. Resolves true when anything landed. */
async function flushPending() {
  const sb = window.sb;
  const uid = RT.userId;
  const list = pendingCompletions();
  if (!sb || !uid || !list.length) return false;
  let landed = false;
  const left = [];
  for (const p of list) {
    try {
      const { data, error } = await sb.rpc('complete_lesson', { p_lesson: p.lesson_id, p_correct: !!p.quiz_correct });
      if (error) { left.push(p); continue; }
      landed = true;
      const d = mine().data || { assignments: [], completions: [], challenge: null };
      const others = (d.completions || []).filter((c) => c.lesson_id !== p.lesson_id);
      L.data = { ...d, completions: [...others, data && data.lesson_id ? data : { lesson_id: p.lesson_id, completed_at: p.at, quiz_correct: !!p.quiz_correct }] };
    } catch { left.push(p); }
  }
  if (RT.userId === uid) {
    writeJson(PKEY(uid), left);
    if (landed && L.data) writeJson(KEY(uid), L.data);
  }
  return landed;
}

/**
 * Read my_learning (and first send anything pending). Resolves true when what the screens draw
 * changed. At most one read in flight; a fresh read inside LEARN_TTL is skipped unless `force`.
 */
export function loadLearning(force = false) {
  const st = mine();
  const sb = window.sb;
  if (!st.uid || !sb) return Promise.resolve(false);
  if (st.inflight) return st.inflight;
  if (!force && st.at && Date.now() - st.at < LEARN_TTL) return Promise.resolve(false);
  const uid = st.uid;
  const run = (async () => {
    await flushPending();
    try {
      const { data, error } = await sb.rpc('my_learning', { p_today: String(DAY.date) });
      if (RT.userId !== uid) return false;
      if (error || !data || typeof data !== 'object') { L.err = true; return false; }
      const next = {
        today: data.today || String(DAY.date),
        assignments: Array.isArray(data.assignments) ? data.assignments : [],
        completions: Array.isArray(data.completions) ? data.completions : [],
        challenge: data.challenge && typeof data.challenge === 'object' ? data.challenge : null,
      };
      const changed = JSON.stringify(next) !== JSON.stringify(L.data);
      L = { ...L, data: next, at: Date.now(), err: false };
      writeJson(KEY(uid), next);
      return changed;
    } catch { L.err = true; return false; } finally { if (L.uid === uid) L.inflight = null; }
  })();
  L.inflight = run;
  return run;
}

/**
 * I finished a lesson (the quick check answered). Counted as done at once on this phone, then
 * sent. Resolves { ok } where ok means the server has it; not ok stays pending and is retried.
 */
export async function recordCompletion(lessonId, correct) {
  const uid = RT.userId;
  if (!uid || !isLessonId(lessonId)) return { ok: false };
  const list = pendingCompletions().filter((p) => p.lesson_id !== lessonId);
  const prev = pendingCompletions().find((p) => p.lesson_id === lessonId);
  list.push({ lesson_id: lessonId, quiz_correct: !!correct || !!(prev && prev.quiz_correct), at: new Date().toISOString() });
  writeJson(PKEY(uid), list);
  const landed = await flushPending();
  return { ok: landed && !pendingCompletions().some((p) => p.lesson_id === lessonId) };
}

/** Tests only. */
export function _resetLearning() { L = { uid: null, at: 0, data: null, err: false, inflight: null }; }
