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
        <div class="ob-sub" style="padding:0 10px">Unlock OnStandard with Face ID. Your scores, meals, and weight stay yours, even if someone has your phone.</div>
      </div>
      <div class="ob-foot" style="margin-top:auto">
        <div id="bio-err" role="alert" style="color:var(--red-bright);font-size:var(--t-sm);font-weight:600;min-height:18px;text-align:center;margin-bottom:8px"></div>
        <button class="btn green" id="bio-on">Enable Face ID</button>
        <div class="ob-textlink" style="padding-top:14px" data-go="home">Not now</div>
      </div>
    </div>`;
  },
  mount(root) {
    const btn = root.querySelector('#bio-on');
    const err = root.querySelector('#bio-err');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Turning on…';
      // The write is AWAITED and navigation only happens on confirmed success. The old handler
      // swallowed a failed Keychain write and navigated anyway, so the athlete left believing
      // the lock was on when the cold-start gate would never see the flag.
      let ok = false;
      try {
        const store = window.OnStandardNative && window.OnStandardNative.secureStore;
        if (store) { await store.setItem('onstd-biolock', '1'); ok = true; }
      } catch { ok = false; }
      if (!ok) {
        btn.disabled = false;
        btn.textContent = was;
        if (err) err.textContent = "Couldn't turn that on. Try again from Settings.";
        return;
      }
      window.__go('home');
    });
  },
};
