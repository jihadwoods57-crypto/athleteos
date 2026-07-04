import { S } from '../state.js';
import { icon } from '../icons.js';

export default {
  tab: 'camera',
  hideTabs: true,
  render() {
    const L = S.logging;
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
        <div class="cam-side"><div class="cbtn">${icon('image', 21)}</div>Gallery</div>
        <div class="shutter" data-go="meal-analysis"><div class="inner">${icon('camera', 26)}</div></div>
        <div class="cam-side" data-go="meal-analysis"><div class="cbtn">${icon('search', 20)}</div>Search</div>
      </div>
      <div style="display:flex;justify-content:center;padding-bottom:10px">
        <div class="cam-side" data-go="meal-analysis" style="flex-direction:row;gap:8px;align-items:center">
          <span style="color:var(--text-3)">${icon('barcode', 16)}</span> Scan Label
        </div>
      </div>
    </div>`;
  },
};
