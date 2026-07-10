import { icon } from '../icons.js';

/* Post-signup Face ID opt-in. Reached only when the native seam reports biometrics are
   usable. Enabling sets the Keychain flag the native cold-start gate reads. */
export default {
  hideTabs: true,
  render() {
    return `
    <div class="ob">
      <div class="standard-set" style="padding-top:40px">
        <div class="halo"><div class="core">${icon('lock', 34)}</div></div>
        <div class="ob-title" style="margin-top:22px">Lock it down.</div>
        <div class="ob-sub" style="padding:0 10px">Unlock OnStandard with Face ID. Your scores, meals, and weight stay yours — even if someone has your phone.</div>
      </div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn green" id="bio-on">Enable Face ID</button>
        <div style="text-align:center;padding-top:14px;font-size:14px;font-weight:700;color:var(--text-3);cursor:pointer" data-go="home">Not now</div>
      </div>
    </div>`;
  },
  mount(root) {
    const btn = root.querySelector('#bio-on');
    btn.addEventListener('click', async () => {
      try { await window.OnStandardNative.secureStore.setItem('onstd-biolock', '1'); } catch { /* no-op */ }
      window.__go('home');
    });
  },
};
