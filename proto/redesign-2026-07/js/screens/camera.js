import { S, RT } from '../state.js';
import { icon } from '../icons.js';

export default {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
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
          <div class="t">Log ${L.name}</div>
          <div class="s">${L.due} <span class="dim">· Nutrition is 50% of your score</span></div>
        </div>
      </div>

      <div class="viewfinder">
        <div class="vf-img" style="background-image:url('assets/meal-lunch.jpg'); filter: blur(1.5px) brightness(0.85); transform: scale(1.06)"></div>
        <div class="vf-deadline">${icon('clock', 13)} ${L.remaining}</div>
        <div class="vf-corner tl"></div><div class="vf-corner tr"></div>
        <div class="vf-corner bl"></div><div class="vf-corner br"></div>
        <div class="vf-tools">
          <div class="vf-tool">${icon('flash', 18)}</div>
          <div class="vf-tool">${icon('flip', 18)}</div>
        </div>
      </div>

      <div class="cam-note">Hidden foods, portion, drink, how you're feeling…</div>

      <div class="cam-actions">
        <div class="cam-side" data-go="analyzing"><div class="cbtn">${icon('image', 21)}</div>Gallery</div>
        <div class="shutter" data-go="analyzing"><div class="inner">${icon('camera', 26)}</div></div>
        <div class="cam-side" data-go="food-search"><div class="cbtn">${icon('search', 20)}</div>Search</div>
      </div>
      <div style="display:flex;justify-content:center;padding-bottom:10px">
        <div class="cam-side" data-go="label-scan" style="flex-direction:row;gap:8px;align-items:center">
          <span style="color:var(--text-3)">${icon('barcode', 16)}</span> Scan Label
        </div>
      </div>
    </div>`;
  },
  mount(root) {
    root.querySelectorAll('.vf-tool').forEach(t => t.addEventListener('click', (e) => {
      e.stopPropagation();
      t.style.color = t.style.color === 'var(--amber-bright)' ? '#fff' : 'var(--amber-bright)';
    }));
  },
};
