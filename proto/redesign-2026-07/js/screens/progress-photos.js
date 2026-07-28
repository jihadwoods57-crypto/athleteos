/* Progress photos — a private before/after body-composition timeline. Capture reuses the same
   in-WebView canvas downscale as meal photos (1000px / q0.82) and uploads straight to the private
   progress-photos bucket (0133). Coach-visible via the same link model as meal photos. Reached
   from Progress. No AI, no analysis — just the athlete's own record of the work showing up.

   States: browse (grid + Add/Compare) and compose (staged shot + pose/weight/note → Save). */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';
import * as roles from '../roles.js';

let CACHE = { photos: null, urls: {}, loading: false, resolving: false };
let STAGE = null;          // { dataUrl, base64, pose, weightLb, note, busy } while composing
let PENDING_DELETE = null; // id awaiting a confirm tap

const POSES = ['Front', 'Side', 'Back'];

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(d); }
}

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
  CACHE.photos = await roles.listProgressPhotos();
  CACHE.loading = false;
  if (window.__render) window.__render();
  resolveUrls();
}
async function resolveUrls() {
  if (CACHE.resolving || !CACHE.photos) return;
  CACHE.resolving = true;
  let changed = false;
  for (const p of CACHE.photos) {
    if (CACHE.urls[p.photo_path] === undefined) {
      CACHE.urls[p.photo_path] = await roles.signedProgressPhotoUrl(p.photo_path);
      changed = true;
    }
  }
  CACHE.resolving = false;
  if (changed && window.__render) window.__render();
}

function composeView() {
  const s = STAGE;
  return `${backHead('New progress photo', 'Same pose, same light — the trend does the talking', 'progress-photos')}
  <section class="card pad">
    <img src="${safeImg(s.dataUrl)}" alt="Progress photo preview" style="width:100%;border-radius:14px;display:block;max-height:340px;object-fit:cover" />
  </section>
  <div style="height:12px"></div>
  <div class="eyebrow">Pose</div>
  <section class="card pad">
    <div class="pw-toggle" style="margin:0">
      ${POSES.map((p) => `<button class="pw-seg${s.pose === p ? ' on' : ''}" data-pp-pose="${esc(p)}">${esc(p)}</button>`).join('')}
    </div>
  </section>
  <div style="height:12px"></div>
  <div class="eyebrow">Weight (optional)</div>
  <section class="card pad">
    <input class="ob-input" id="pp-weight" inputmode="decimal" placeholder="e.g. 182" value="${s.weightLb != null ? esc(String(s.weightLb)) : ''}" />
    <div style="height:10px"></div>
    <input class="ob-input" id="pp-note" placeholder="Note (optional)" value="${s.note ? esc(s.note) : ''}" />
  </section>
  <div style="height:14px"></div>
  <button class="btn green" id="pp-save" style="width:100%" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Saving…' : 'Save to my timeline'}</button>
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
    : (src ? `<img class="pp-cell-img" src="${src}" alt="Progress photo" loading="lazy" />` : `<div class="pp-cell-load">${icon('image', 18)}</div>`);
  return `
  <div class="pp-cell">
    ${img}
    <div class="pp-cell-meta">${esc(meta)}</div>
    <button class="pp-del${pending ? ' arm' : ''}" data-pp-del="${p.id}" data-pp-path="${esc(p.photo_path)}" aria-label="${pending ? 'Confirm delete' : 'Delete photo'}">${pending ? 'Delete?' : icon('x', 14)}</button>
  </div>`;
}

function browseView() {
  const photos = CACHE.photos || [];
  const canCompare = photos.length >= 2;
  return `${backHead('Progress photos', 'Your before & after — private to you and your coach', 'progress')}

  <div style="display:flex;gap:8px">
    <button class="btn green sm" id="pp-add" style="flex:1">${icon('camera', 16)} Add photo</button>
    ${canCompare ? `<button class="btn ghost sm" data-go="progress-compare" style="flex:1">${icon('image', 16)} Compare</button>` : ''}
  </div>
  <input type="file" accept="image/*" capture="environment" id="pp-file" style="display:none" />

  ${CACHE.loading && !photos.length ? `
    <div class="sidebox" style="margin-top:12px"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading your photos…</div></div></div>`
  : photos.length ? `
    <div style="height:12px"></div>
    <div class="pp-grid">${photos.map(cell).join('')}</div>`
  : `
    <div class="state-demo" style="margin-top:14px">
      <div class="sd-ic">${icon('camera', 24)}</div>
      <div class="sd-t">Start your timeline</div>
      <div class="sd-s">Take a progress photo today. Same pose, same light, once a week — in a month you'll see the work. Only you and a coach you're linked to can see these.</div>
    </div>`}
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
        STAGE.busy = true; if (window.__render) window.__render();
        const row = await roles.uploadProgressPhoto(RT.userId, STAGE.base64, { pose: STAGE.pose, weightLb: STAGE.weightLb, note: STAGE.note });
        if (row) {
          if (CACHE.photos) CACHE.photos.unshift(row); else CACHE.photos = [row];
          STAGE = null;
          if (window.__render) window.__render();
          resolveUrls();
        } else {
          STAGE.busy = false;
          if (window.__render) window.__render();
          const err = root.querySelector('#pp-save'); if (err) { err.textContent = 'Save failed — try again'; }
        }
      });
      return;
    }

    // browse
    if (CACHE.photos === null && !CACHE.loading) loadPhotos();
    else resolveUrls();

    const file = root.querySelector('#pp-file');
    const add = root.querySelector('#pp-add');
    if (add && file) add.addEventListener('click', () => file.click());
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
      const ok = await roles.deleteProgressPhoto(id, path);
      if (ok && CACHE.photos) CACHE.photos = CACHE.photos.filter((p) => p.id !== id);
      if (window.__render) window.__render();
    }));
  },
};

/** For the compare screen + the Progress card: the cached list + a URL resolver. */
export function progressPhotoCache() { return CACHE; }
export async function ensureProgressPhotos() { if (CACHE.photos === null && !CACHE.loading) await loadPhotos(); return CACHE.photos || []; }
