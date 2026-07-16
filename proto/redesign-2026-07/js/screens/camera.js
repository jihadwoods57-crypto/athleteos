import { S, RT, act, MEAL, slotTitle } from '../state.js';
import { icon } from '../icons.js';
import { esc, safeImg, nonLiveBadge } from '../components.js';
import { photoAgeMinutes, describePhotoAge } from '../photo-hash.js';
import { photoStats, photoQuality } from '../meal-intel.js';

/* ---- shared JPEG encode: one canvas pipeline for live frames AND picked files ----
   Downscale (max side) + JPEG-encode → { dataUrl, base64 }. Keeps the upload well under the
   8MB analyze-meal limit and fast to send. Also MEASURES photo quality (brightness + edge
   energy on a 96px sample of the same canvas — real numbers, ~1ms) so the review step can
   give honest capture feedback and the rubric can carry a measured photo-quality row. */
function encodeToJpeg(source, srcW, srcH, maxDim, quality) {
  let w = srcW, h = srcH;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(source, 0, 0, w, h);
  const dataUrl = cv.toDataURL('image/jpeg', quality);
  let stats = null;
  try {
    const sw = Math.max(1, Math.min(96, w)), sh = Math.max(1, Math.round(sw * (h / w)));
    const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
    const sctx = sc.getContext('2d');
    sctx.drawImage(cv, 0, 0, sw, sh);
    const d = sctx.getImageData(0, 0, sw, sh);
    stats = photoStats(d.data, sw, sh);
  } catch { /* measurement is best-effort — capture always proceeds */ }
  return { dataUrl, base64: dataUrl.split(',')[1], stats };
}
function downscaleToJpeg(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try { resolve(encodeToJpeg(img, img.width, img.height, maxDim, quality)); } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

const hapticTap = (style) => { try { window.OnStandardNative && window.OnStandardNative.haptic(style || 'medium'); } catch { /* web */ } };

export default {
  tab: 'camera',
  hideTabs: true,
  transient: true, // flow interstitial: never a back-target — Done/Back from the flow returns to the pre-camera origin
  render({ sub } = {}) {
    const L = S.logging;
    const slotName = sub ? slotTitle(sub) : L.name; // coach-standard title, never raw "Meal-5"
    const slotKey = sub || S.currentSlot;
    const upTo = slotKey ? S.mealUpTo(slotKey) : 0;
    // Apple-style permission priming: explain BEFORE the OS ever asks
    if (!RT.camPrimed) {
      return `
      <div class="ob" style="padding-top:40px">
        <div class="standard-set" style="padding-top:10px">
          <div class="halo"><div class="core" style="background:linear-gradient(155deg, var(--green-bright), #16a34a)">${icon('camera', 34)}</div></div>
          <div class="ob-title" style="margin-top:22px">Camera, for proof.</div>
          <div class="ob-sub" style="padding:0 8px">OnStandard uses your camera to capture meal photos. They go to your coach connection only — never public, never sold, never used to train anything without asking.</div>
        </div>
        <div class="ob-foot" style="margin-top:auto">
          <button class="btn green" data-act="primeCamera" data-then="camera">Allow Camera</button>
          <div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="food-search">Log without a camera</div>
        </div>
      </div>`;
    }
    // LIVE-FIRST: mount() tries getUserMedia and, on success, reveals #vf-video and hides the
    // fallback prompt — the camera is already open and the green shutter captures THIS frame.
    // On any failure the prompt stays and the shutter opens the native camera exactly as before.
    return `
    <div class="cam">
      <div class="cam-head">
        <div class="bk iconbtn" data-back="home" style="width:40px;height:40px" role="button" aria-label="Back">${icon('back', 19)}</div>
        <div class="meta">
          <div class="t">Log ${slotName}</div>
          <div class="s">${L.due}${upTo > 0 ? ` <span class="dim">· earn up to ${upTo} points</span>` : ''}</div>
        </div>
      </div>

      <div class="cam-guide">
        <b>Photograph everything you're having.</b>
        <span>Full plate · Drink · Sides · Sauces · Supplements</span>
      </div>

      <div class="viewfinder" id="viewfinder">
        <video id="vf-video" autoplay playsinline muted style="display:none"></video>
        <div class="vf-flash" id="vf-flash"></div>
        <div class="vf-empty" id="vf-fallback">
          <div class="vf-lens">${icon('camera', 30)}</div>
          <div class="vf-prompt">Take a photo to analyze</div>
          <div class="vf-hint" id="vf-hint">Tap the shutter — your camera opens</div>
        </div>
        ${L.empty ? '' : `<div class="vf-deadline">${icon('clock', 13)} ${L.remaining}</div>`}
        <div class="vf-corner tl"></div><div class="vf-corner tr"></div>
        <div class="vf-corner bl"></div><div class="vf-corner br"></div>
      </div>

      <input type="file" accept="image/*" capture="environment" id="cam-file" style="display:none" />
      <input type="file" accept="image/*" id="cam-gallery" style="display:none" />
      <div class="cam-actions">
        <div class="cam-side" id="gallery-btn"><div class="cbtn">${icon('image', 19)}</div>Gallery</div>
        <div class="shutter" id="shutter"><div class="inner">${icon('camera', 26)}</div></div>
        <div class="cam-side" data-go="food-search"><div class="cbtn">${icon('search', 20)}</div>No photo</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:10px">
        <div style="font-size:11px;font-weight:600;color:var(--text-3);padding:0 24px;text-align:center">Gallery uploads are allowed. The same photo can't be submitted twice.</div>
        <div id="cam-note" style="font-size:12.5px;font-weight:600;color:var(--amber-bright);text-align:center;min-height:16px;padding:0 20px"></div>
      </div>
    </div>`;
  },
  mount(root, { sub } = {}) {
    if (!RT.camPrimed) return; // priming screen has no capture wiring
    const file = root.querySelector('#cam-file');
    const gallery = root.querySelector('#cam-gallery');
    const shutter = root.querySelector('#shutter');
    const galleryBtn = root.querySelector('#gallery-btn');
    const video = root.querySelector('#vf-video');
    const fallbackUi = root.querySelector('#vf-fallback');
    const flash = root.querySelector('#vf-flash');

    /* ---- live preview (getUserMedia inside the WebView; ProtoApp grants the permission) ---- */
    let stream = null;
    let liveReady = false;
    const stopStream = () => {
      liveReady = false;
      if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* already dead */ } stream = null; }
      if (video) { try { video.srcObject = null; } catch { /* detached */ } }
    };
    const onHide = () => { if (document.visibilityState !== 'visible') stopStream(); };
    document.addEventListener('visibilitychange', onHide);
    // Router calls window.__screenCleanup before every re-render/route change — the stream must
    // never keep the camera light on behind another screen.
    window.__screenCleanup = () => { document.removeEventListener('visibilitychange', onHide); stopStream(); };

    const startLive = async () => {
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !video) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        video.srcObject = stream;
        await video.play().catch(() => { /* autoplay policies — frame still renders muted */ });
        // Only claim "live" once real frames exist; a zero-dimension track falls back silently.
        const armed = () => {
          if (video.videoWidth > 0) {
            liveReady = true;
            video.style.display = 'block';
            if (fallbackUi) fallbackUi.style.display = 'none';
          }
        };
        if (video.videoWidth > 0) armed();
        else video.addEventListener('loadedmetadata', armed, { once: true });
      } catch { stopStream(); /* denied/unavailable → file-input fallback, no error state */ }
    };
    void startLive();

    /* ---- capture paths: live frame OR picked file, both land on #camera-confirm ---- */
    const failNote = () => {
      shutter.style.opacity = '1';
      const note = root.querySelector('#cam-note');
      // food-search, not 'log': the Action Hub's photo hero routes straight back to the
      // camera that just failed — matching the primed screen's no-camera path. The router
      // only wires [data-go] at render time, so this post-mount injection wires its own tap.
      if (note) {
        note.innerHTML = `Couldn't get the photo — check camera access, or <span class="lnk">log without a camera</span>.`;
        note.querySelector('.lnk').addEventListener('click', () => window.__go('food-search'));
      }
    };

    const pick = (inputEl, live) => async () => {
      const f = inputEl.files && inputEl.files[0];
      if (!f) return;
      shutter.style.opacity = '0.5';
      try {
        // Gallery picks: read EXIF DateTimeOriginal from the ORIGINAL bytes before the canvas
        // re-encode strips it — powers the staleness transparency badge (0062).
        let takenAt = null;
        if (!live) {
          try {
            const { exifDateTimeOriginal } = await import('../photo-hash.js');
            takenAt = exifDateTimeOriginal(new Uint8Array(await f.arrayBuffer()));
          } catch { /* EXIF absent/unreadable — normal, no badge */ }
        }
        const { base64, dataUrl, stats } = await downscaleToJpeg(f, 1000, 0.82);
        act.captureMeal(base64, dataUrl, sub || undefined, live, { takenAt, stats });
        window.__go('camera-confirm');
      } catch { failNote(); }
    };

    const captureLiveFrame = () => {
      try {
        hapticTap('medium');
        if (flash) { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); }
        const { base64, dataUrl, stats } = encodeToJpeg(video, video.videoWidth, video.videoHeight, 1000, 0.82);
        act.captureMeal(base64, dataUrl, sub || undefined, true, { stats });
        stopStream();
        // Let the flash read as a shutter click before the route swap.
        setTimeout(() => window.__go('camera-confirm'), 120);
      } catch { failNote(); }
    };

    if (shutter) {
      shutter.addEventListener('click', () => {
        if (liveReady && video && video.videoWidth > 0) captureLiveFrame();
        else if (file) file.click(); // silent fallback: native OS camera, exactly as before
      });
    }
    if (file) file.addEventListener('change', pick(file, true));
    if (gallery && galleryBtn) {
      galleryBtn.addEventListener('click', () => gallery.click());
      gallery.addEventListener('change', pick(gallery, false));
    }
  },
};

/* ---------- Capture confirm — "is this the photo you want analyzed?" ----------
   One gate for EVERY path (live frame, native camera, gallery). Nothing has been logged or
   analyzed yet: Analyze runs the 0062 duplicate pre-check, then hands off to #analyzing;
   Retake clears the staged capture and returns to the viewfinder. */
export const cameraConfirm = {
  tab: 'camera',
  hideTabs: true,
  transient: true,
  render() {
    if (!MEAL.photoDataUrl) {
      // Deep link / stale entry with nothing staged: back to capture, never a blank screen.
      if (location.hash.startsWith('#camera-confirm')) location.hash = '#camera';
      return '';
    }
    const gallery = MEAL.source === 'gallery';
    const age = gallery ? describePhotoAge(photoAgeMinutes(MEAL.takenAt, Date.now())) : null;
    return `
    <div class="cam cam-confirm">
      <div class="cam-head">
        <div class="bk iconbtn" id="cc-back" style="width:40px;height:40px" role="button" aria-label="Back">${icon('back', 19)}</div>
        <div class="meta">
          <div class="t">Use this photo?</div>
          <div class="s"><span class="dim">${esc(MEAL.mealType || 'Meal')} · review your photo before analysis</span></div>
        </div>
      </div>
      <div class="viewfinder cc-photo" style="background-image:url('${safeImg(MEAL.photoDataUrl)}')">
        ${gallery ? `<div class="cc-badges">${nonLiveBadge()}${age ? `<span class="status-pill muted">${icon('clock', 12)} ${esc(age.toUpperCase())}</span>` : ''}</div>` : ''}
      </div>
      <div class="cc-complete">
        <b>Make sure everything you're having is visible.</b>
        <div class="cc-chips">
          <span class="cc-chip">Drink</span><span class="cc-chip">Sauce</span><span class="cc-chip">Side</span><span class="cc-chip">Supplement</span>
        </div>
        ${(() => {
          // Measured capture feedback (spec §4.7): brightness + sharpness from the capture
          // canvas — a gentle nudge, never a block. Silent when the photo reads clear.
          const pq = photoQuality(MEAL.photoQ);
          return pq && pq.state !== 'met'
            ? `<div style="font-size:12px;font-weight:700;color:var(--amber-bright);margin-top:8px">${esc(pq.hint)}</div>`
            : '';
        })()}
      </div>
      <details class="cc-details">
        <summary>${icon('edit', 15)} Add details AI may not know <span class="opt">Optional</span></summary>
        <textarea id="cc-user-note" maxlength="240" rows="2"
          placeholder="Sauce type, cooking method, oil used, portion changes, refills…">${esc(MEAL.userNote || '')}</textarea>
        <div class="cc-details-hint">Notes improve the analysis, but everything consumed should still be shown in the photo.</div>
      </details>
      <div id="cc-note" style="font-size:12.5px;font-weight:700;color:var(--amber-bright);text-align:center;min-height:18px;padding:8px 24px 0"></div>
      <div class="btn-row" style="padding:12px 20px 10px;margin-top:auto">
        <button class="btn ghost sm" id="cc-retake" style="flex:1">${icon(gallery ? 'image' : 'camera', 17)} ${gallery ? 'Choose another' : 'Retake'}</button>
        <button class="btn green sm" id="cc-analyze" style="flex:1.6">${icon('sparkle', 17)} Analyze meal</button>
      </div>
      <input type="file" accept="image/*" id="cc-repick" style="display:none" />
      <div style="text-align:center;font-size:11.5px;font-weight:600;color:var(--text-3);padding-bottom:10px">You'll confirm the detected foods, portions, and nutrition estimate before it counts.</div>
    </div>`;
  },
  async mount(root) {
    if (!MEAL.photoDataUrl) return;
    const gallery = MEAL.source === 'gallery';
    const noteField = root.querySelector('#cc-user-note');
    const saveNote = () => { if (noteField) act.setMealNote(noteField.value); };
    if (noteField) noteField.addEventListener('change', saveNote);
    const retake = () => {
      saveNote();
      const slot = MEAL.key;
      act.clearMeal();
      window.__go(slot ? `camera/${slot}` : 'camera');
    };
    // Gallery source: "Choose another" re-picks in place — no round-trip through the camera.
    const repick = root.querySelector('#cc-repick');
    const rePickNow = async () => {
      const f = repick.files && repick.files[0];
      if (!f) return;
      try {
        let takenAt = null;
        try {
          const { exifDateTimeOriginal } = await import('../photo-hash.js');
          takenAt = exifDateTimeOriginal(new Uint8Array(await f.arrayBuffer()));
        } catch { /* EXIF absent — no badge */ }
        const { base64, dataUrl, stats } = await downscaleToJpeg(f, 1000, 0.82);
        act.captureMeal(base64, dataUrl, MEAL.key || undefined, false, { takenAt, stats });
        window.__render && window.__render();
      } catch { /* keep the current photo */ }
    };
    const back = root.querySelector('#cc-back');
    const rt = root.querySelector('#cc-retake');
    if (back) back.addEventListener('click', retake);
    if (rt) {
      if (gallery && repick) {
        rt.addEventListener('click', () => { saveNote(); repick.click(); });
        repick.addEventListener('change', rePickNow);
      } else rt.addEventListener('click', retake);
    }
    const analyzeBtn = root.querySelector('#cc-analyze');
    const note = root.querySelector('#cc-note');
    if (analyzeBtn) analyzeBtn.addEventListener('click', () => { saveNote(); window.__go('analyzing'); });
    // Duplicate pre-check (0062), free and before the paid analyze call. Fail-open: offline the
    // button stays enabled and the server's unique index still backstops at insert time.
    try {
      const r = await act.checkPhotoReuse();
      if (r && r.reused && root.isConnected) {
        const p = r.prior || {};
        const when = p.day_date ? `as ${String(p.meal_type || 'a meal')} on ${String(p.day_date)}` : 'once';
        // textContent, so the server strings render inert — no escaping needed here.
        if (note) note.textContent = `This exact photo was already logged ${when}. Pick a different photo — repeats don't count.`;
        if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.style.opacity = '0.45'; analyzeBtn.textContent = 'Already logged'; }
      }
    } catch { /* pre-check is best-effort */ }
  },
};
