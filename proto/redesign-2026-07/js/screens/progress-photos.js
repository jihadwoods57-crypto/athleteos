/* Progress photos — a private before/after body-composition timeline. Capture reuses the same
   in-WebView canvas downscale as meal photos (1000px / q0.82) and uploads straight to the private
   progress-photos bucket (0133). Coach-visible via the same link model as meal photos. Reached
   from Progress. No AI, no analysis — just the athlete's own record of the work showing up.

   States: browse (timeline OR compare, plus Add) and compose (staged shot + pose/weight/note
   → Save). */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg, emptyState, errorState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { shortDateYear } from '../fmt-date.js';

/* `failed` separates "we asked and could not find out" from "there are none". Without it a
   dropped connection told an athlete with a year of photos to start their timeline, and hid
   Compare — the one control that would have proved the photos were still there. */
let CACHE = { photos: null, urls: {}, loading: false, resolving: false, failed: false };
let STAGE = null;          // { dataUrl, base64, pose, weightLb, note, busy, error } while composing
let PENDING_DELETE = null; // id awaiting a confirm tap
let DELETE_ERROR = null;   // a failed delete, said out loud above the grid

/* Compare was its own route (#progress-compare) for a while, and it was never a destination: its
   only door was a button on this screen, it read THIS module's photo list and THIS module's
   signed-URL map, and its back chip came straight back here. So it is a mode of the timeline
   instead. Switching modes is a repaint, not a navigation — nothing refetches, nothing is
   re-signed, and the picked pair survives because it lives here, next to the cache.

   MODE deliberately survives leaving and re-entering the screen, the same way STAGE already
   does. There is no trap in that: the segmented control is on screen in BOTH modes, so the
   timeline is always one tap away, and the back chip always points at Progress — the one place
   this screen is entered from. (The router has no unmount hook to reset it in anyway; a reset
   would have to be faked from a route diff, which is state this screen has no business owning.) */
let MODE = 'timeline';                   // 'timeline' | 'compare'
let SEL = { before: null, after: null }; // the picked pair, kept across repaints

const POSES = ['Front', 'Side', 'Back'];

const fmtDate = (d) => shortDateYear(d);

/* One canvas pipeline (mirrors camera.js encodeToJpeg params) — downscale a picked file to a
   compact JPEG. No quality measurement here; progress shots aren't analyzed. */
function encodeFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
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
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

async function loadPhotos() {
  CACHE.loading = true;
  CACHE.failed = false;
  const rows = await roles.listProgressPhotos();
  CACHE.loading = false;
  if (rows === null) CACHE.failed = true;
  else CACHE.photos = rows;
  if (window.__render) window.__render();
  resolveUrls();
}
async function resolveUrls() {
  if (CACHE.resolving || !CACHE.photos) return;
  CACHE.resolving = true;
  // One batch signing call for the whole timeline; per-photo requests made a 20-photo
  // gallery wait through 20 sequential round trips before the last cell could start loading.
  // Only paths with no entry yet are asked for, which is why changing mode costs nothing: the
  // compare panels read the very same map the grid already filled.
  const want = CACHE.photos.filter((p) => CACHE.urls[p.photo_path] === undefined).map((p) => p.photo_path);
  if (want.length) {
    const urls = await roles.signedProgressPhotoUrls(want);
    for (const path of want) CACHE.urls[path] = urls[path] || null;
  }
  CACHE.resolving = false;
  if (want.length && window.__render) window.__render();
}

function composeView() {
  const s = STAGE;
  return `${backHead('New progress photo', 'Same pose, same light. The trend does the talking', 'progress-photos')}
  <section class="card pad">
    <img src="${safeImg(s.dataUrl)}" alt="Progress photo preview" style="width:100%;border-radius:var(--r-card-sm);display:block;max-height:340px;object-fit:cover" />
  </section>
  <div style="height:12px"></div>
  <h2 class="eyebrow">Pose</h2>
  <section class="card pad">
    <div class="pw-toggle" style="margin:0" role="radiogroup" aria-label="Pose">
      ${POSES.map((p) => `<button class="pw-seg${s.pose === p ? ' on' : ''}" data-pp-pose="${esc(p)}" role="radio" aria-checked="${s.pose === p}">${esc(p)}</button>`).join('')}
    </div>
  </section>
  <div style="height:12px"></div>
  <h2 class="eyebrow">Weight (optional)</h2>
  <section class="card pad">
    <input class="ob-input" id="pp-weight" inputmode="decimal" placeholder="e.g. 182" aria-label="Weight (optional)" value="${s.weightLb != null ? esc(String(s.weightLb)) : ''}" />
    <div style="height:10px"></div>
    <input class="ob-input" id="pp-note" maxlength="120" placeholder="Note (optional)" aria-label="Note (optional)" value="${s.note ? esc(s.note) : ''}" />
  </section>
  <div style="height:14px"></div>
  ${s.error ? `<div role="alert" style="color:var(--red-bright);font-size:var(--t-sm);font-weight:600;text-align:center;margin-bottom:10px">${esc(s.error)}</div>` : ''}
  <button class="btn primary" id="pp-save" style="width:100%" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Saving…' : 'Save to my timeline'}</button>
  <div style="height:8px"></div>
  <button class="btn ghost" id="pp-cancel" style="width:100%" ${s.busy ? 'disabled' : ''}>Cancel</button>
  <div style="height:12px"></div>`;
}

function cell(p) {
  const url = CACHE.urls[p.photo_path];
  const src = url ? safeImg(url) : '';
  const meta = [fmtDate(p.taken_on), p.weight_lb ? `${p.weight_lb} lb` : '', p.pose || ''].filter(Boolean).join(' · ');
  const pending = PENDING_DELETE === p.id;
  const img = url === undefined
    ? `<div class="pp-cell-load">${icon('bolt', 18)}</div>`
    : (src ? `<img class="pp-cell-img" src="${src}" alt="Progress photo" loading="lazy" decoding="async" />` : `<div class="pp-cell-load">${icon('image', 18)}</div>`);
  return `
  <div class="pp-cell">
    ${img}
    <div class="pp-cell-meta">${esc(meta)}</div>
    <button class="pp-del${pending ? ' arm' : ''}" data-pp-del="${p.id}" data-pp-path="${esc(p.photo_path)}" aria-label="${pending ? 'Confirm delete' : 'Delete photo'}">${pending ? 'Delete?' : icon('x', 14)}</button>
  </div>`;
}

/* ---------------- compare mode ---------------- */

function byId(photos, id) { return photos.find((p) => p.id === id) || null; }
function daysBetween(a, b) {
  try { return Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000)); } catch { return null; }
}

function panel(p, urls, label) {
  if (!p) return `<div class="cmp-panel"><div class="cmp-lab">${label}</div><div class="cmp-empty">${icon('image', 20)}</div></div>`;
  const url = urls[p.photo_path];
  const src = url ? safeImg(url) : '';
  const img = url === undefined ? `<div class="cmp-empty">${icon('bolt', 18)}</div>`
    : (src ? `<img class="cmp-img" src="${src}" alt="${esc(label)} photo" decoding="async" />` : `<div class="cmp-empty">${icon('image', 18)}</div>`);
  const sub = [fmtDate(p.taken_on), p.weight_lb ? `${p.weight_lb} lb` : ''].filter(Boolean).join(' · ');
  return `<div class="cmp-panel"><div class="cmp-lab">${label}</div>${img}<div class="cmp-sub">${esc(sub)}</div></div>`;
}

function strip(photos, urls, side, selId) {
  return `<div class="cmp-strip">${photos.map((p) => {
    const url = urls[p.photo_path];
    const src = url ? safeImg(url) : '';
    const on = p.id === selId;
    const inner = src ? `<img class="cmp-thumb-img" src="${src}" alt="" loading="lazy" decoding="async" />` : `<div class="cmp-thumb-load">${icon('image', 12)}</div>`;
    return `<button class="cmp-thumb${on ? ' on' : ''}" data-cmp-side="${side}" data-cmp-id="${p.id}" aria-pressed="${on}">${inner}</button>`;
  }).join('')}</div>`;
}

function compareBody(photos, firstLoad) {
  if (firstLoad) return skeletonRows(2, 'Loading your photos');
  // The load FAILED vs there ARE too few: opposite messages. Without this branch a dropped
  // connection told an athlete with a year of photos to go add two.
  if (CACHE.failed && photos.length < 2) {
    return errorState({
      title: "Couldn't load your photos",
      body: 'Nothing was deleted. Reconnect and they load right here.',
      retryId: 'pp-retry',
    });
  }
  if (photos.length < 2) {
    return emptyState({
      icon: 'image',
      title: 'Two photos needed',
      body: 'Add at least two progress photos and you can line up any before against any after.',
    });
  }
  // Defaults: before = oldest (list is newest-first), after = newest. Re-validated every paint,
  // so a deleted photo drops the selection back to a real one instead of a blank panel.
  if (!SEL.before || !byId(photos, SEL.before)) SEL.before = photos[photos.length - 1].id;
  if (!SEL.after || !byId(photos, SEL.after)) SEL.after = photos[0].id;
  const before = byId(photos, SEL.before), after = byId(photos, SEL.after);
  const urls = CACHE.urls;

  let delta = '';
  if (before && after && before.weight_lb && after.weight_lb) {
    const d = after.weight_lb - before.weight_lb;
    const days = daysBetween(after.taken_on, before.taken_on);
    delta = `<div class="cmp-delta"><b>${d > 0 ? '+' : ''}${d} lb</b>${days != null ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}</div>`;
  } else {
    const days = before && after ? daysBetween(after.taken_on, before.taken_on) : null;
    if (days != null) delta = `<div class="cmp-delta">${days} day${days === 1 ? '' : 's'} apart</div>`;
  }

  return `<div class="cmp-row">
      ${panel(before, urls, 'Before')}
      ${panel(after, urls, 'After')}
    </div>
    ${delta}
    <h2 class="eyebrow cmp-pick">Before</h2>
    ${strip(photos, urls, 'before', SEL.before)}
    <h2 class="eyebrow cmp-pick">After</h2>
    ${strip(photos, urls, 'after', SEL.after)}`;
}

/* ---------------- timeline mode ---------------- */

function timelineBody(photos, firstLoad) {
  return `<button class="btn primary sm" id="pp-add" style="width:100%">${icon('camera', 16)} Add photo</button>
  <input type="file" accept="image/*" capture="environment" id="pp-file" style="display:none" />

  ${DELETE_ERROR ? `<div role="alert" style="color:var(--red-bright);font-size:var(--t-sm);font-weight:600;text-align:center;margin-top:12px">${esc(DELETE_ERROR)}</div>` : ''}
  ${/* The spacer used to live inside the photos branch only, so the empty, loading and failed
        states all sat flush against the Add photo button. */''}
  <div style="height:12px"></div>
  ${firstLoad ? `
    ${skeletonRows(3, 'Loading your photos')}`
  : photos.length ? `
    <div class="pp-grid">${photos.map(cell).join('')}</div>`
  : CACHE.failed ? `
    ${errorState({
    title: "Couldn't load your photos",
    body: 'Nothing was deleted. Your timeline is on the server and loads right here when you reconnect.',
    retryId: 'pp-retry',
  })}`
  : `
    ${emptyState({
    icon: 'camera',
    title: 'Start your timeline',
    body: "Take a progress photo today. Same pose, same light, once a week, and in a month you'll see the work. Only you and a coach you're linked to can see these.",
    action: { label: 'Take the first one', id: 'pp-empty-shoot' },
  })}`}`;
}

/* The shared two-way view switch: a .seg radiogroup, the same control coach-home, the plan-style
   picker and the feature flags use. It renders in BOTH modes and in every state, including a
   failed load — hiding the way into Compare on failure is the exact bug the CACHE.failed comment
   above was written for, and hiding the way OUT of Compare would be the same bug reversed. */
function modeSeg() {
  const on = (m) => MODE === m;
  const btn = (m, label) => `<button data-pp-mode="${m}" role="radio" aria-checked="${on(m)}" class="${on(m) ? 'on' : ''}">${label}</button>`;
  return `<div class="seg pp-modes" role="radiogroup" aria-label="Photo view">${btn('timeline', 'Timeline')}${btn('compare', 'Compare')}</div>`;
}

function browseView() {
  const photos = CACHE.photos || [];
  const firstLoad = CACHE.loading && !photos.length;
  return `${backHead('Progress photos', 'Your before & after · private to you and your coach', 'progress')}
  ${modeSeg()}
  ${MODE === 'compare' ? compareBody(photos, firstLoad) : timelineBody(photos, firstLoad)}
  <div style="height:14px"></div>`;
}

export default {
  tab: 'progress',
  render() { return STAGE ? composeView() : browseView(); },
  mount(root) {
    if (STAGE) {
      root.querySelectorAll('[data-pp-pose]').forEach((el) => el.addEventListener('click', () => {
        STAGE.pose = el.getAttribute('data-pp-pose'); if (window.__render) window.__render();
      }));
      const w = root.querySelector('#pp-weight'); if (w) w.addEventListener('input', () => { STAGE.weightLb = w.value.trim(); });
      const n = root.querySelector('#pp-note'); if (n) n.addEventListener('input', () => { STAGE.note = n.value; });
      const cancel = root.querySelector('#pp-cancel'); if (cancel) cancel.addEventListener('click', () => { STAGE = null; if (window.__render) window.__render(); });
      const save = root.querySelector('#pp-save'); if (save) save.addEventListener('click', async () => {
        if (!STAGE || STAGE.busy) return;
        STAGE.busy = true; STAGE.error = null; if (window.__render) window.__render();
        const row = await roles.uploadProgressPhoto(RT.userId, STAGE.base64, { pose: STAGE.pose, weightLb: STAGE.weightLb, note: STAGE.note });
        if (row) {
          if (CACHE.photos) CACHE.photos.unshift(row); else CACHE.photos = [row];
          STAGE = null;
          if (window.__render) window.__render();
          resolveUrls();
        } else {
          // Module state, painted by the NEXT render as a red line above Save. The old handler
          // wrote into a node from the pre-render root, which was already detached: the message
          // never reached the screen.
          STAGE.busy = false;
          STAGE.error = "The photo didn't save. Check your connection and try again.";
          if (window.__render) window.__render();
        }
      });
      return;
    }

    // browse (timeline or compare)
    // The mode switch is a repaint and nothing more: no fetch, no re-sign, no reset of the
    // picked pair. Both modes read the one CACHE below.
    root.querySelectorAll('[data-pp-mode]').forEach((el) => el.addEventListener('click', () => {
      const m = el.getAttribute('data-pp-mode');
      if (!m || m === MODE) return;
      MODE = m;
      if (window.__render) window.__render();
    }));

    if (CACHE.photos === null && !CACHE.loading && !CACHE.failed) loadPhotos();
    else resolveUrls();
    // One retry id for both modes: only one of the two failure states is ever on screen.
    const ppRetry = root.querySelector('#pp-retry');
    if (ppRetry) ppRetry.addEventListener('click', () => { if (!CACHE.loading) { ppRetry.disabled = true; loadPhotos(); } });

    root.querySelectorAll('[data-cmp-id]').forEach((el) => el.addEventListener('click', () => {
      const side = el.getAttribute('data-cmp-side'); const id = el.getAttribute('data-cmp-id');
      if (side === 'before') SEL.before = id; else SEL.after = id;
      if (window.__render) window.__render();
    }));

    const file = root.querySelector('#pp-file');
    const add = root.querySelector('#pp-add');
    if (add && file) add.addEventListener('click', () => file.click());
    // The empty state offers the same action rather than pointing at a button elsewhere on the
    // screen — an empty state with a dead pointer is the thing emptyState() exists to prevent.
    const emptyShoot = root.querySelector('#pp-empty-shoot');
    if (emptyShoot && file) emptyShoot.addEventListener('click', () => file.click());
    if (file) file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; if (!f) return;
      try {
        const enc = await encodeFile(f, 1000, 0.82);
        STAGE = { dataUrl: enc.dataUrl, base64: enc.base64, pose: 'Front', weightLb: null, note: '', busy: false };
        if (window.__render) window.__render();
      } catch { /* bad image — ignore */ }
      file.value = '';
    });

    root.querySelectorAll('[data-pp-del]').forEach((el) => el.addEventListener('click', async () => {
      const id = el.getAttribute('data-pp-del');
      const path = el.getAttribute('data-pp-path');
      if (PENDING_DELETE !== id) { PENDING_DELETE = id; if (window.__render) window.__render(); return; }
      PENDING_DELETE = null;
      DELETE_ERROR = null;
      const ok = await roles.deleteProgressPhoto(id, path);
      if (ok && CACHE.photos) CACHE.photos = CACHE.photos.filter((p) => p.id !== id);
      // A failed delete is SAID, in module state the next render paints above the grid; the old
      // silent path left the photo in place with nothing explaining why.
      if (!ok) DELETE_ERROR = "Couldn't delete that photo. Try again.";
      if (window.__render) window.__render();
    }));
  },
};

/** The one photo list and its signed-URL map. Both modes of this screen read it, and the test
 *  suite seeds it — a fixture door that does not require a network stub. */
export function progressPhotoCache() { return CACHE; }
