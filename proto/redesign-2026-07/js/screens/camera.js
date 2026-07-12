import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';

/** Load, downscale (max side), and JPEG-encode a picked photo → { dataUrl, base64 }.
 *  Keeps the upload well under the 8MB analyze-meal limit and fast to send. */
function downscaleToJpeg(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = cv.toDataURL('image/jpeg', quality);
      resolve({ dataUrl, base64: dataUrl.split(',')[1] });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default {
  tab: 'camera',
  hideTabs: true,
  render({ sub } = {}) {
    const L = S.logging;
    const slotName = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : L.name;
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
    return `
    <div class="cam">
      <div class="cam-head">
        <div class="bk iconbtn" data-go="home" style="width:40px;height:40px">${icon('back', 19)}</div>
        <div class="meta">
          <div class="t">Log ${slotName}</div>
          <div class="s">${L.due} <span class="dim">· Nutrition is 50% of your score</span></div>
        </div>
      </div>

      <div class="viewfinder">
        <div class="vf-img" style="background-image:url('assets/meal-lunch.jpg'); filter: blur(1.5px) brightness(0.85); transform: scale(1.06)"></div>
        <div class="vf-deadline">${icon('clock', 13)} ${L.remaining}</div>
        <div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:4;display:flex;align-items:center;gap:6px;background:rgba(7,11,20,0.6);backdrop-filter:blur(8px);border:1px solid var(--green-border);color:var(--green-bright);font-size:11px;font-weight:800;padding:5px 12px;border-radius:999px">
          <span style="width:7px;height:7px;border-radius:50%;background:var(--green-bright);box-shadow:0 0 8px var(--green-bright)"></span> LIVE
        </div>
        <div class="vf-corner tl"></div><div class="vf-corner tr"></div>
        <div class="vf-corner bl"></div><div class="vf-corner br"></div>
        <div class="vf-tools">
          <div class="vf-tool">${icon('flash', 18)}</div>
          <div class="vf-tool">${icon('flip', 18)}</div>
        </div>
      </div>

      <div class="cam-note">Hidden foods, portion, drink, how you're feeling…</div>

      <input type="file" accept="image/*" capture="environment" id="cam-file" style="display:none" />
      <div class="cam-actions">
        <div class="cam-side" style="cursor:default;opacity:0.45"><div class="cbtn">${icon('lock', 19)}</div>Gallery</div>
        <div class="shutter" id="shutter"><div class="inner">${icon('camera', 26)}</div></div>
        <div class="cam-side" data-go="food-search"><div class="cbtn">${icon('search', 20)}</div>Search</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding-bottom:10px">
        <div class="cam-side" data-go="label-scan" style="flex-direction:row;gap:8px;align-items:center">
          <span style="color:var(--text-3)">${icon('barcode', 16)}</span> Enter Label
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text-3)">Live capture only for scored meals. That's the integrity rule.</div>
        <div id="cam-note" style="font-size:12.5px;font-weight:600;color:var(--amber-bright);text-align:center;min-height:16px;padding:0 20px"></div>
      </div>
    </div>`;
  },
  mount(root, { sub } = {}) {
    root.querySelectorAll('.vf-tool').forEach(t => t.addEventListener('click', (e) => {
      e.stopPropagation();
      t.style.color = t.style.color === 'var(--amber-bright)' ? '#fff' : 'var(--amber-bright)';
    }));
    // Real capture: shutter opens the native camera/photo picker; the photo is downscaled,
    // handed to state, and the analyzing screen runs the AI on it.
    const file = root.querySelector('#cam-file');
    const shutter = root.querySelector('#shutter');
    if (file && shutter) {
      shutter.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        shutter.style.opacity = '0.5';
        try {
          const { base64, dataUrl } = await downscaleToJpeg(f, 1000, 0.82);
          act.captureMeal(base64, dataUrl, sub || undefined);
          window.__go('analyzing');
        } catch {
          // Camera/gallery failed or was denied — say so honestly and offer the no-camera path,
          // instead of the old silent opacity reset that left the athlete stuck on a dead shutter.
          shutter.style.opacity = '1';
          const note = root.querySelector('#cam-note');
          // food-search, not 'log': the Action Hub's photo hero routes straight back to the
          // camera that just failed — matching the primed screen's no-camera path. The router
          // only wires [data-go] at render time, so this post-mount injection wires its own tap.
          if (note) {
            note.innerHTML = `Couldn't get the photo — check camera access, or <span class="lnk">log without a camera</span>.`;
            note.querySelector('.lnk').addEventListener('click', () => window.__go('food-search'));
          }
        }
      });
    }
  },
};
