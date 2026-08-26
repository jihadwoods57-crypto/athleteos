/* One marketplace coach — #coach-listing/<slug>. The whole hire path lives here: read the person,
   pick a tier, accept the coaching agreement in a sheet, and hand off to Stripe. The webhook is
   what actually creates the relationship — this screen only ever starts a checkout. Scope copy is
   deliberate and unskippable: what this coach does, and what they are not. */
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { initialsOf } from '../initials.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { track, EVENTS } from '../analytics.js';

const CAT_LABEL = { accountability: 'Accountability', cpt: 'Certified trainer', snc: 'Strength & conditioning' };
const TIER_SUB = {
  essential: 'Weekly written check-in · dashboard monitoring · alerts when you slip',
  daily: 'Daily review of your day · direct messages · missed-standard follow-up',
  high_touch: 'Daily review · priority replies · scheduled calls · weekly plan tuning',
};

let CACHE = { slug: null, listing: null, loaded: false };
let UI = { tier: null, sheet: false, agreed: false, paying: false, err: '' };
// Slugs a checkout was launched for this session — when one comes back already_client, that's the
// only signal the WebView ever gets that the hire went through (billing-return lands in the
// system browser, not here), so it is where mkt_hired fires. Once.
const HIRING = new Map(); // slug -> tier

async function load(slug, force) {
  if (CACHE.slug === slug && CACHE.loaded && !force) return;
  CACHE = { slug, listing: null, loaded: false };
  UI = { tier: null, sheet: false, agreed: false, paying: false, err: '' };
  CACHE.listing = await roles.fetchMarketplaceListing(slug);
  CACHE.loaded = true;
  if (CACHE.listing && CACHE.listing.already_client && HIRING.has(slug)) {
    track(EVENTS.MKT_HIRED, { tier: HIRING.get(slug).tier });
    HIRING.delete(slug);
  }
  if (window.__render) window.__render();
}

function money(c) { const d = c / 100; return `$${Number.isInteger(d) ? d : d.toFixed(2)}`; }
const monogram = (name) => initialsOf(name, '?');

function agreementSheet(l, tier) {
  return `
  <div class="sheet-scrim" data-mkt-close></div>
  <div class="sheet">
    <div style="font-size:16px;font-weight:800;padding:4px 2px 10px">Coaching agreement</div>
    <div class="sheet-row" style="display:block;line-height:1.55;font-size:13px;color:var(--text-2)">
      <b style="color:var(--text)">${esc(l.display_name)} · ${esc(tier.name)} · ${money(tier.price_cents)}/mo</b><br>
      Your coach reviews your OnStandard activity, holds you to the standards you set, and responds inside this app.
      Billing renews monthly through Stripe; cancel any time and access runs to the end of the period.<br><br>
      <b style="color:var(--text)">What your coach is not:</b> accountability coaching is not medical care, therapy,
      licensed nutrition counseling, or emergency support. And your coach won't pretend otherwise.
      Payment and communication stay on OnStandard; that protection is the deal.
    </div>
    <label class="sheet-row" style="gap:10px;cursor:pointer">
      <input type="checkbox" data-mkt-agree ${UI.agreed ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--blue-bright)">
      <span style="font-size:13px;font-weight:700">I understand what this coaching includes. And what it doesn't.</span>
    </label>
    ${UI.err ? `<div style="color:var(--red);font-size:12.5px;font-weight:600;padding:4px 2px">${esc(UI.err)}</div>` : ''}
    <button class="btn primary" data-mkt-pay ${UI.agreed && !UI.paying ? '' : 'disabled'} style="margin-top:10px">
      ${UI.paying ? 'Opening secure checkout…' : `Continue to payment · ${money(tier.price_cents)}/mo`}</button>
    <div style="font-size:11.5px;color:var(--text-3);text-align:center;padding:8px 0 2px">Secure checkout via Stripe. Includes OnStandard membership.</div>
  </div>`;
}

export default {
  hideTabs: true,
  render({ sub }) {
    const slug = (sub || '').trim();
    if (CACHE.slug !== slug) load(slug);
    const l = CACHE.listing;
    if (!CACHE.loaded) return `${backHead('Coach', '', 'coach-directory')}${skeletonRows(3, 'Loading this coach')}`;
    // A failed read is not evidence about this coach's business. Saying "at capacity or no
    // longer taking clients" because a request dropped costs a real partner a real client.
    if (l && l.error) {
      return `${backHead('Coach', '', 'coach-directory')}
      ${errorState({
    title: "Couldn't load this coach",
    body: 'Their page is still there. Reconnect and it loads right here.',
    retryId: 'mkl-retry',
  })}`;
    }
    if (!l) {
      return `${backHead('Coach', '', 'coach-directory')}
      ${emptyState({ icon: 'users', title: 'This coach is not available', body: 'They may be at capacity or no longer taking clients.', action: { label: 'Browse coaches', go: 'coach-directory' } })}`;
    }
    const tiers = l.tiers || [];
    const selected = tiers.find((t) => t.tier === UI.tier) || null;
    return `${backHead(esc(l.display_name), 'OnStandard Coach Partner', 'coach-directory')}

    <section class="card pad" style="display:flex;gap:14px;align-items:center">
      <div class="lic" style="width:52px;height:52px;border-radius:var(--r-card-sm);background:linear-gradient(150deg,var(--blue-bright),var(--blue));color:var(--ink-on-accent);font-weight:800;font-size:19px">${esc(monogram(l.display_name))}</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">${esc(l.display_name)}</div>
        <div class="ls" style="margin-top:2px">${esc((l.categories || []).map((c) => CAT_LABEL[c] || c).join(' · '))}</div>
        ${(l.categories || []).some((c) => c !== 'accountability') ? `<div class="ls" style="margin-top:2px;color:var(--blue-bright)">${icon('shield', 13)} Credentials verified by OnStandard</div>` : ''}
      </div>
    </section>

    ${l.headline ? `<section class="card pad" style="font-size:14px;font-weight:700;line-height:1.5">${esc(l.headline)}</section>` : ''}
    ${l.bio ? `<div class="eyebrow">About</div><section class="card pad" style="font-size:13px;color:var(--text-2);font-weight:600;line-height:1.6">${esc(l.bio)}</section>` : ''}

    <div class="eyebrow">What this coach does</div>
    <section class="card" style="padding:10px 16px;font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.7">
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} Reviews your Accountability Score, meals, weigh-ins and missed standards</div>
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} Messages you with course corrections. And celebrates when you deliver</div>
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} Runs your weekly check-in and keeps your standards realistic</div>
      <div style="margin-top:6px">${icon('x', 14, 'style="color:var(--red)"')} ${(l.categories || []).some((c) => c !== 'accountability')
        ? 'No medical, mental-health, or clinical nutrition treatment'
        : 'No workout or nutrition prescriptions. They hold you to a plan you already have'}</div>
    </section>

    <div class="eyebrow">Plans</div>
    ${tiers.length ? `<section class="card" style="padding:6px 16px">
      ${tiers.map((t) => `
      <div class="lrow" data-mkt-tier="${esc(t.tier)}" style="align-items:flex-start${UI.tier === t.tier ? ';background:var(--surface-2);border-radius:12px' : ''}">
        <div class="lic"${UI.tier === t.tier ? ' style="background:var(--blue-bright);color:var(--ink-on-accent)"' : ''}>${icon(UI.tier === t.tier ? 'check' : 'bolt', 16)}</div>
        <div class="lm" style="flex:1">
          <div class="lt">${esc(t.name)}</div>
          <div class="ls">${esc(TIER_SUB[t.tier] || t.blurb || '')}</div>
        </div>
        <span class="lv" style="font-weight:800">${money(t.price_cents)}/mo</span>
      </div>`).join('')}
    </section>` : `<div class="sidebox"><div class="req-icon b" style="width:34px;height:34px">${icon('bolt', 15)}</div>
      <div><div class="tt">Plans coming soon</div><div class="ts">This coach hasn't finished setting up pricing yet.</div></div></div>`}

    ${l.already_client ? `
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px;background:var(--green-surface);color:var(--green-bright)">${icon('check', 15)}</div>
      <div><div class="tt">You already work with this coach</div><div class="ts">Manage the relationship from your Profile.</div></div></div>` : `
    <div style="padding:14px 16px">
      <button class="btn primary" data-mkt-hire ${selected ? '' : 'disabled'}>${selected ? `Hire ${esc(l.display_name.split(' ')[0])} · ${money(selected.price_cents)}/mo` : 'Pick a plan to continue'}</button>
    </div>`}

    <div class="lrow" data-go="report-coach/${esc(l.practice_id)}" style="margin:0 16px 14px">
      <div class="lic" style="color:var(--red)">${icon('bell', 16)}</div>
      <div class="lm"><div class="lt" style="font-size:13px">Report this coach</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>

    ${UI.sheet && selected ? agreementSheet(l, selected) : ''}
    `;
  },
  mount(root) {
    const mklRetry = root.querySelector('#mkl-retry');
    if (mklRetry) mklRetry.addEventListener('click', () => { mklRetry.disabled = true; load(CACHE.slug, true); });
    track(EVENTS.MKT_PROFILE_VIEWED);
    // Back from Stripe with a checkout in flight? Re-pull the listing so already_client (set by
    // the webhook) lands. Throttled — __render() re-runs mount(), and an unguarded force here
    // would poll the RPC in a loop.
    const inflight = HIRING.get(CACHE.slug);
    if (inflight && Date.now() - inflight.at > 10_000) {
      inflight.at = Date.now();
      load(CACHE.slug, true);
    }
    root.querySelectorAll('[data-mkt-tier]').forEach((el) => el.addEventListener('click', () => {
      UI.tier = el.getAttribute('data-mkt-tier');
      if (window.__render) window.__render();
    }));
    const hire = root.querySelector('[data-mkt-hire]');
    if (hire) hire.addEventListener('click', () => {
      if (!UI.tier) return;
      UI.sheet = true; UI.err = '';
      track(EVENTS.MKT_CHECKOUT_STARTED, { tier: UI.tier });
      if (window.__render) window.__render();
    });
    const close = root.querySelector('[data-mkt-close]');
    if (close) close.addEventListener('click', () => { UI.sheet = false; if (window.__render) window.__render(); });
    const agree = root.querySelector('[data-mkt-agree]');
    if (agree) agree.addEventListener('change', () => { UI.agreed = agree.checked; if (window.__render) window.__render(); });
    const pay = root.querySelector('[data-mkt-pay]');
    if (pay) pay.addEventListener('click', async () => {
      const tiers = (CACHE.listing && CACHE.listing.tiers) || [];
      const t = tiers.find((x) => x.tier === UI.tier);
      if (!t || UI.paying) return;
      UI.paying = true; UI.err = '';
      if (window.__render) window.__render();
      const r = await roles.startMarketplaceCheckout(t.offer_id);
      UI.paying = false;
      if (r && r.url) { UI.sheet = false; HIRING.set(CACHE.slug, { tier: UI.tier, at: 0 }); roles.openExternal(r.url); }
      else UI.err = (r && r.error) || 'Could not start checkout';
      if (window.__render) window.__render();
    });
  },
};
