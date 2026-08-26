/* OnStandard — photo attachments on a chat message.
 *
 * A meal thread is a conversation about food, and the most natural reply in it is a picture:
 * "here's what I actually ate", "this is the label", "is this portion right?". Until now the
 * composer was text-only, so the athlete's only way to show a coach anything was to log another
 * meal — which scores, and which is the wrong instrument for answering a question.
 *
 * WHAT THIS IS NOT: an attachment is NOT a logged meal. It never touches the `meals` table, is
 * never scored, and cannot trip the 0062 photo-hash reuse wall. Attaching a picture of a plate you
 * already logged is a legitimate conversational act.
 *
 * WHERE THE KEY LIVES: `meal_comments.meta.photo` (0157 explicitly permits clients to write meta
 * on their own rows — the insert policy is row-level, not column-level). The storage key is
 * `<uid>/chat/<ts>.jpg` in the existing private `meal-photos` bucket, which needs NO policy
 * change: 0003's storage RLS only ever checks that the first path segment is the caller's own
 * uid, and coaches read through the same can_view() arm they already use for logged plates.
 */

/** The storage path attached to a comment, or null. Tolerates every shape `meta` can arrive in
 *  (absent on old rows, a string on a database that stored it untyped, junk from a bad client). */
export function attachedPhoto(comment) {
  if (!comment) return null;
  let meta = comment.meta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { return null; } }
  if (!meta || typeof meta !== 'object') return null;
  const p = meta.photo;
  if (typeof p !== 'string' || !p) return null;
  // A key must look like a key. This value ends up in a storage lookup, so refuse anything with
  // traversal or a scheme in it rather than passing it along and hoping the bucket says no.
  if (p.includes('..') || p.includes('://') || p.length > 200) return null;
  return p;
}

/* Downscale + JPEG-encode a picked file. Same 1000px / 0.82 parameters camera.js and
   progress-photos.js already use, so an attachment costs the same bytes as a logged plate.
   This is the THIRD copy of this canvas pipeline in the codebase — it lives here, shared, rather
   than becoming a fourth. */
export function encodeImageFile(file, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('no file')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

/* LEGACY SENTINEL. Before migration 0173, `meal_comments.text` was NOT NULL with a minimum length
   of 1, so a wordless photo was structurally impossible and the client had to send this stand-in.
   0173 relaxes the floor to allow empty text when `meta ? 'photo'`, so new wordless photos send
   ''. This constant stays because ROWS ALREADY WRITTEN with it still exist and must keep
   rendering as photo-only rather than showing a phantom caption. Do not send it in new code —
   postChatMessage falls back to it only when the database rejects the empty string. */
export const PHOTO_ONLY_TEXT = 'Sent a photo';

/** True when this message is a photo standing on its own, so the renderer shows the image without
 *  a redundant caption under it. Covers both the post-0173 empty string and the legacy sentinel. */
export function isPhotoOnly(comment) {
  if (!comment || !attachedPhoto(comment)) return false;
  const t = String(comment.text || '').trim();
  return t === '' || t === PHOTO_ONLY_TEXT;
}

/**
 * Upload (if needed) and post one chat message that may carry a photo.
 *
 * Returns { ok, photoPath, error } — never throws. `error` is a short reason the caller can show:
 *   'upload'  the picture never reached storage, so nothing was posted (the caller should keep
 *             the athlete's typed text and let them retry) — deliberately NOT posted text-only,
 *             because silently dropping the attachment from a message about it is worse than
 *             failing loudly.
 *   'post'    storage was fine but the row insert failed.
 *
 * The empty-text/sentinel dance is handled here so no screen has to know about it: a wordless
 * photo is attempted as '' (correct once 0173 is applied) and falls back to the legacy sentinel
 * if the database still carries 0046's original floor. That makes both screens correct on a
 * database at either level, with no feature flag.
 */
export async function postChatMessage(rolesMod, {
  mealId, athleteId, authorId, role, text = '', photo = null,
}) {
  let photoPath = null;
  if (photo && photo.base64) {
    photoPath = await rolesMod.uploadChatPhoto(authorId, photo.base64);
    if (!photoPath) return { ok: false, photoPath: null, error: 'upload' };
  }
  const meta = photoPath ? { photo: photoPath } : null;
  const typed = String(text || '').trim();
  const ok = await rolesMod.postMealComment(mealId, athleteId, authorId, role, typed, 'message', meta);
  if (ok) return { ok: true, photoPath, error: null };
  // Only a WORDLESS photo can be rejected by the length floor; a typed message that failed has a
  // different cause and re-sending it with a caption it never had would be a lie.
  if (!typed && photoPath) {
    const legacy = await rolesMod.postMealComment(mealId, athleteId, authorId, role, PHOTO_ONLY_TEXT, 'message', meta);
    if (legacy) return { ok: true, photoPath, error: null };
  }
  return { ok: false, photoPath, error: 'post' };
}

/* Signed URLs for chat attachments. Module-scoped so a repaint does not re-sign the same handful
   of images forever; 45min TTL against the 60min signature life, matching photo-store's margin.
   Kept separate from photo-store because that module's key builder is meal-SLOT shaped
   (`<uid>/<date>/<slot>.jpg`) and a chat attachment deliberately is not. */
const CHAT_PHOTO_URLS = new Map(); // path -> { url, at }
const CHAT_PHOTO_TTL = 45 * 60 * 1000;

/** Markup for an attached photo inside a bubble. The src is filled in by hydrateThreadPhotos()
 *  after paint (signed URLs are async); until then it is a sized placeholder, so the thread does
 *  not reflow when images land. Shared by all THREE thread renderers — meal.js, coach.js and
 *  trust.js — because a bubble that renders differently in one of them is exactly the bug this
 *  codebase keeps rediscovering. */
export function bubblePhotoHtml(path, escFn) {
  if (!path) return '';
  return `<img class="bimg" data-photo="${escFn(path)}" alt="Photo attached to this message" loading="lazy" decoding="async" />`;
}

/** Resolve every pending attachment inside a painted thread. Safe to call on every repaint. */
export async function hydrateThreadPhotos(rootEl, rolesMod) {
  if (!rootEl || !rolesMod) return;
  const imgs = Array.from(rootEl.querySelectorAll('img.bimg[data-photo]'));
  const misses = [];
  for (const el of imgs) {
    const path = el.getAttribute('data-photo');
    if (!path) continue;
    const hit = CHAT_PHOTO_URLS.get(path);
    if (hit && Date.now() - hit.at < CHAT_PHOTO_TTL) { if (el.src !== hit.url) el.src = hit.url; continue; }
    misses.push({ el, path });
  }
  if (!misses.length) return;
  // One signing round trip for the whole thread. A 20-photo thread used to pay 20 sequential
  // requests before the first pixel of the last photo could even start downloading.
  const urls = await (rolesMod.signedMealPhotoUrls
    ? rolesMod.signedMealPhotoUrls(misses.map(m => m.path))
    : Promise.all(misses.map(async ({ path }) => [path, await rolesMod.signedMealPhotoUrl(path).catch(() => null)]))
        .then(Object.fromEntries)).catch(() => ({}));
  for (const { el, path } of misses) {
    const url = urls[path] || null;
    if (!url) continue;                       // leave the placeholder; a repaint retries
    CHAT_PHOTO_URLS.set(path, { url, at: Date.now() });
    el.src = url;
  }
}

/**
 * Wire a composer's attach button + hidden file input + pending-preview strip.
 *
 * Shared because the athlete thread and the coach thread need identical behaviour and the wiring
 * is ~40 lines of DOM plumbing that has no business being duplicated (and drifting) across two
 * screens. Nothing uploads on pick: the encoded image is held until the caller sends, so choosing
 * a photo stays undoable and one message carries both the picture and the words about it.
 *
 * Returns { get, clear } — `get()` is the pending {dataUrl, base64} or null.
 */
export function wireComposerAttach({ root, attachId, pendingId, safeImg, onNote }) {
  const btn = root && root.querySelector(`#${attachId}`);
  const file = root && root.querySelector(`#${attachId}-file`);
  const pending = root && root.querySelector(`#${pendingId}`);
  let held = null;
  const note = (m) => { if (typeof onNote === 'function') onNote(m || ''); };

  const paint = () => {
    if (!pending) return;
    if (!held) { pending.hidden = true; pending.innerHTML = ''; return; }
    pending.hidden = false;
    pending.innerHTML = `<img src="${safeImg(held.dataUrl)}" alt="" />
      <span class="cap">Photo ready to send</span>
      <button type="button" data-attach-drop="1">Remove</button>`;
    const drop = pending.querySelector('[data-attach-drop]');
    if (drop) drop.addEventListener('click', () => { clear(); });
  };
  const clear = () => {
    held = null;
    if (file) file.value = '';
    if (btn) btn.classList.remove('on');
    paint();
  };

  if (btn && file) {
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      note('');
      try {
        held = await encodeImageFile(f);
        btn.classList.add('on');
        paint();
      } catch {
        held = null;
        btn.classList.remove('on');
        note("Couldn't read that image. Try another.");
      }
      file.value = '';   // let the same file be re-picked after a Remove
    });
  }
  return { get: () => held, clear };
}
