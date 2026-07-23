/* Before / after compare — pick two shots from the progress timeline and see them side by side
   with the weight change and days between. Shares the cache + signed-URL map with the
   progress-photos screen. Defaults to oldest (before) vs newest (after). */
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';
import * as roles from '../roles.js';
import { progressPhotoCache, ensureProgressPhotos } from './progress-photos.js';

let SEL = { before: null, after: null };

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(d); }
}
function byId(photos, id) { return photos.find((p) => p.id === id) || null; }
function daysBetween(a, b) {
  try { return Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000)); } catch { return null; }
}

function panel(p, urls, label) {
  if (!p) return `<div class="cmp-panel"><div class="cmp-lab">${label}</div><div class="cmp-empty">${icon('image', 20)}</div></div>`;
  const url = urls[p.photo_path];
  const src = url ? safeImg(url) : '';
  const img = url === undefined ? `<div class="cmp-empty">${icon('bolt', 18)}</div>`
    : (src ? `<img class="cmp-img" src="${src}" alt="${esc(label)} photo" />` : `<div class="cmp-empty">${icon('image', 18)}</div>`);
  const sub = [fmtDate(p.taken_on), p.weight_lb ? `${p.weight_lb} lb` : ''].filter(Boolean).join(' · ');
  return `<div class="cmp-panel"><div class="cmp-lab">${label}</div>${img}<div class="cmp-sub">${esc(sub)}</div></div>`;
}

function strip(photos, urls, side, selId) {
  return `<div class="cmp-strip">${photos.map((p) => {
    const url = urls[p.photo_path];
    const src = url ? safeImg(url) : '';
    const on = p.id === selId;
    const inner = src ? `<img class="cmp-thumb-img" src="${src}" alt="" />` : `<div class="cmp-thumb-load">${icon('image', 12)}</div>`;
    return `<button class="cmp-thumb${on ? ' on' : ''}" data-cmp-side="${side}" data-cmp-id="${p.id}" aria-pressed="${on}">${inner}</button>`;
  }).join('')}</div>`;
}

async function resolveUrls() {
  const cache = progressPhotoCache();
  if (!cache.photos) return;
  let changed = false;
  for (const p of cache.photos) {
    if (cache.urls[p.photo_path] === undefined) { cache.urls[p.photo_path] = await roles.signedProgressPhotoUrl(p.photo_path); changed = true; }
  }
  if (changed && window.__render) window.__render();
}

export default {
  tab: 'progress',
  render() {
    const cache = progressPhotoCache();
    const photos = cache.photos || [];
    if (photos.length < 2) {
      return `${backHead('Compare', 'Before & after', 'progress-photos')}
      <div class="state-demo" style="margin-top:14px"><div class="sd-ic">${icon('image', 24)}</div>
      <div class="sd-t">Two photos needed</div><div class="sd-s">Add at least two progress photos and you can line up any before against any after.</div></div>`;
    }
    // Defaults: before = oldest (list is newest-first), after = newest.
    if (!SEL.before || !byId(photos, SEL.before)) SEL.before = photos[photos.length - 1].id;
    if (!SEL.after || !byId(photos, SEL.after)) SEL.after = photos[0].id;
    const before = byId(photos, SEL.before), after = byId(photos, SEL.after);
    const urls = cache.urls;

    let delta = '';
    if (before && after && before.weight_lb && after.weight_lb) {
      const d = after.weight_lb - before.weight_lb;
      const days = daysBetween(after.taken_on, before.taken_on);
      delta = `<div class="cmp-delta"><b>${d > 0 ? '+' : ''}${d} lb</b>${days != null ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}</div>`;
    } else {
      const days = before && after ? daysBetween(after.taken_on, before.taken_on) : null;
      if (days != null) delta = `<div class="cmp-delta">${days} day${days === 1 ? '' : 's'} apart</div>`;
    }

    return `${backHead('Compare', 'Before & after', 'progress-photos')}
    <div class="cmp-row">
      ${panel(before, urls, 'Before')}
      ${panel(after, urls, 'After')}
    </div>
    ${delta}
    <div class="eyebrow" style="margin-top:14px">Before</div>
    ${strip(photos, urls, 'before', SEL.before)}
    <div class="eyebrow" style="margin-top:12px">After</div>
    ${strip(photos, urls, 'after', SEL.after)}
    <div style="height:14px"></div>`;
  },
  async mount(root) {
    await ensureProgressPhotos();
    resolveUrls();
    root.querySelectorAll('[data-cmp-id]').forEach((el) => el.addEventListener('click', () => {
      const side = el.getAttribute('data-cmp-side'); const id = el.getAttribute('data-cmp-id');
      if (side === 'before') SEL.before = id; else SEL.after = id;
      if (window.__render) window.__render();
    }));
  },
};
