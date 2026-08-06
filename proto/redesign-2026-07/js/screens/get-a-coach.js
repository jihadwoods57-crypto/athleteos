/* Get a Coach — the accountability chooser for an athlete with no one in their corner. Four honest
   options: keep going self-guided with the AI, hire an OnStandard Coach or a verified pro from the
   marketplace, or connect a coach they already have. Reached from Profile's coach-connection card
   (and the OB2 pointer after onboarding). Marketplace rows only render when the server switch is
   on AND this account may hire (adults only — the server decides, we just mirror it). */
import { backHead } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { track, EVENTS } from '../analytics.js';

let CACHE = { flags: null, loaded: false };

async function load() {
  if (CACHE.loaded) return;
  CACHE.flags = await roles.fetchMarketplaceFlags();
  CACHE.loaded = true;
  if (window.__render) window.__render();
}

function row(go, ic, iconStyle, title, sub) {
  return `<div class="lrow" data-go="${go}">
    <div class="lic"${iconStyle ? ` style="${iconStyle}"` : ''}>${icon(ic, 17)}</div>
    <div class="lm"><div class="lt">${title}</div><div class="ls">${sub}</div></div>
    ${icon('chevron', 17, 'style="color:var(--text-3)"')}
  </div>`;
}

export default {
  render() {
    const f = CACHE.flags || {};
    const marketplaceOpen = CACHE.loaded && f.enabled && f.can_hire;
    return `${backHead('Accountability', 'Who holds you to your standard', 'profile')}

    <section class="card pad">
      <div style="font-size:15.5px;font-weight:800">Standards are easier to keep when someone is watching.</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Pick how you want to be held accountable. You can change this at any time.</div>
    </section>

    <div class="eyebrow">Your options</div>
    <section class="card" style="padding:6px 16px">
      ${row('home', 'bolt', 'background:var(--green-surface);color:var(--green-bright)',
        'Self-guided with AI', 'Your score, your streak, and the AI nutritionist — you drive')}
      ${marketplaceOpen ? `
      ${row('coach-directory', 'users', 'background:var(--blue-surface, rgba(59,130,246,0.14));color:var(--blue-bright)',
        'OnStandard Coach', 'A real person who reviews your days and keeps you on standard')}
      ${row('coach-directory/verified', 'shield', '',
        'Verified professional', 'Certified trainers with credentials we checked ourselves')}` : ''}
      ${row('connect', 'key', '',
        'I already have a coach', 'Enter their code to share your execution and hear from them')}
    </section>

    ${CACHE.loaded && !marketplaceOpen ? `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
      <div><div class="tt">Coach hiring isn't available on this account yet</div>
      <div class="ts">${f.enabled === false ? 'The coach marketplace opens soon.' : 'Marketplace coaching is for adults. Connect a coach you already work with instead.'}</div></div></div>` : ''}

    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('eye', 15)}</div>
      <div><div class="tt">Accountability coaching is support, not treatment</div>
      <div class="ts">Coaches keep you consistent with a plan you already have. They are not a replacement for medical, nutrition, or mental-health professionals.</div></div></div>
    `;
  },
  mount() {
    load();
    track(EVENTS.MKT_INTRO_VIEWED);
  },
};
