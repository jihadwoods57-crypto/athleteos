/* Your marketplace listing — approved coaches only (the row exists only if the approval RPC made
   one). Presentation fields + the three tier prices + the publish switch. Categories, slug and
   suspension are admin-owned: not in this UI and not grant-writable even if someone tries. */
import { backHead, esc, skeletonRows, permissionState } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { roleNav } from '../state.js';
import { tierPriceError } from '../marketplace-rules.js';

const TIERS = [
  { key: 'essential', name: 'Essential Accountability', sub: 'Weekly written check-in · monitoring · alerts' },
  { key: 'daily', name: 'Daily Accountability', sub: 'Daily review · direct messages · follow-ups' },
  { key: 'high_touch', name: 'High-Touch Accountability', sub: 'Daily review · priority replies · calls' },
];

let G = { listing: null, flags: null, prices: {}, loaded: false };
let UI = { saving: false, msg: '', err: '' };

async function load(force) {
  if (G.loaded && !force) return;
  const [listing, flags] = await Promise.all([
    roles.fetchMyListing(), roles.fetchMarketplaceFlags(),
  ]);
  G.listing = listing;
  G.flags = flags;
  G.prices = {};
  if (listing) {
    const offers = await roles.fetchMyOffers(listing.practice_id);
    // fetchMyOffers returns { error: true } on failure now; prices just stay unknown here.
    if (Array.isArray(offers)) for (const o of offers) if (o.tier && o.price_cents != null) G.prices[o.tier] = o.price_cents / 100;
  }
  G.loaded = true;
  if (window.__render) window.__render();
}

function field(id, label, value, placeholder, textarea, numeric) {
  const labelHtml = `<label for="${id}" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin:14px 0 6px">${label}</label>`;
  if (textarea) {
    return `${labelHtml}<textarea id="${id}" placeholder="${esc(placeholder || '')}" style="width:100%;min-height:84px;border-radius:var(--r-card-sm);background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-family:var(--font);font-size:15px;padding:12px 14px;outline:none;resize:vertical">${esc(value || '')}</textarea>`;
  }
  return `${labelHtml}<input id="${id}" class="ob-input" type="${numeric ? 'number' : 'text'}" ${numeric ? 'min="1" max="100"' : ''} value="${esc(value || '')}" placeholder="${esc(placeholder || '')}">`;
}

function bounds(tier) {
  const b = (G.flags && G.flags.tier_bounds && G.flags.tier_bounds[tier]) || {};
  return { min: (b.min_cents ?? 0) / 100, max: (b.max_cents ?? 99900) / 100 };
}

export default {
  // Shared screen — approved coaches may be signed in as trainer or athlete.
  get nav() { return roleNav(); },
  render() {
    if (!G.loaded) return `${backHead('Your listing', 'How clients find you', 'coach-apply')}${skeletonRows(3)}`;
    const l = G.listing;
    if (!l) {
      return `${backHead('Your listing', 'How clients find you', 'coach-apply')}
      ${permissionState({ title: 'No listing yet', body: 'A listing is created when your coach application is approved.' })}`;
    }
    if (l.suspended) {
      return `${backHead('Your listing', 'How clients find you', 'profile')}
      <section class="state-demo"><div class="sd-ic" style="color:var(--red)">${icon('lock', 24)}</div>
      <div class="sd-t">Your listing is suspended</div>
      <div class="sd-s">You're hidden from the directory and can't take new clients while the OnStandard team reviews. Existing clients are unaffected. Check your email, or contact support.</div></section>`;
    }
    return `${backHead('Your listing', l.published ? 'Live in the directory' : 'Draft — publish when ready', 'profile')}

    <section class="card" style="padding:16px">
      <div class="lrow" style="cursor:default;padding:0 0 10px">
        <div class="lm"><div class="lt">Directory listing</div>
          <div class="ls">${l.published ? 'Clients can find and hire you' : 'Hidden until you publish'}</div></div>
        <span class="status-pill" style="background:${l.published ? 'var(--green-surface)' : 'var(--surface-2)'};color:${l.published ? 'var(--green-bright)' : 'var(--text-3)'}">${l.published ? 'Published' : 'Draft'}</span>
      </div>
      ${field('cle-name', 'Coaching name', l.display_name)}
      ${field('cle-head', 'Headline (one line that sells the work)', l.headline, 'I make your standard non-negotiable.')}
      ${field('cle-bio', 'About you', l.bio, '', true)}
      ${field('cle-style', 'Style tags, comma-separated', (l.style_tags || []).join(', '), 'direct, encouraging, structured')}
      ${field('cle-langs', 'Languages, comma-separated', (l.languages || []).join(', '))}
      ${field('cle-tz', 'Time zone', l.timezone)}
      ${field('cle-cap', 'Client capacity', l.capacity || 10, '', false, true)}
    </section>

    <div class="eyebrow">Your plans — monthly pricing</div>
    <section class="card" style="padding:16px">
      ${TIERS.map((t) => {
        const b = bounds(t.key);
        return `
      <div style="padding:6px 0">
        <div class="lt" style="font-size:14px">${t.name}</div>
        <div class="ls">${t.sub} · $${b.min}–$${b.max}/mo</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span style="font-weight:800;color:var(--text-2)">$</span>
          <input id="cle-price-${t.key}" class="ob-input" type="number" min="${b.min}" max="${b.max}" step="1"
            value="${G.prices[t.key] != null ? esc(String(G.prices[t.key])) : ''}" placeholder="e.g. ${Math.round((b.min + b.max) / 2)}"
            style="width:110px;height:44px">

          <span class="ls">/ month</span>
        </div>
      </div>`; }).join('')}
      <div class="ls" style="margin-top:6px">Set all three so clients can choose. Price changes apply to new clients only — existing subscriptions keep their price.</div>
    </section>

    <div style="padding:0 16px 14px">
      ${UI.err ? `<div style="color:var(--red);font-size:12.5px;font-weight:600;padding-bottom:8px">${esc(UI.err)}</div>` : ''}
      ${UI.msg ? `<div style="color:var(--green-bright);font-size:12.5px;font-weight:600;padding-bottom:8px">${esc(UI.msg)}</div>` : ''}
      <div style="display:flex;gap:10px">
        <button class="btn ghost sm" data-cle-save style="width:auto;padding:0 18px">${UI.saving ? 'Saving…' : 'Save'}</button>
        <button class="btn ${l.published ? 'ghost' : 'green'} sm" data-cle-pub style="width:auto;padding:0 18px">${l.published ? 'Unpublish' : 'Save & publish'}</button>
      </div>
    </div>`;
  },
  mount(root) {
    load();
    const collectPrices = () => {
      const out = {};
      for (const t of TIERS) {
        const v = Number((root.querySelector(`#cle-price-${t.key}`) || {}).value);
        if (v > 0) { out[t.key] = Math.round(v * 100); G.prices[t.key] = v; }
      }
      return out;
    };
    const collectPatch = () => ({
      display_name: (root.querySelector('#cle-name') || {}).value || '',
      headline: (root.querySelector('#cle-head') || {}).value || '',
      bio: (root.querySelector('#cle-bio') || {}).value || '',
      style_tags: ((root.querySelector('#cle-style') || {}).value || '').split(',').map((s) => s.trim()).filter(Boolean),
      languages: ((root.querySelector('#cle-langs') || {}).value || '').split(',').map((s) => s.trim()).filter(Boolean),
      timezone: (root.querySelector('#cle-tz') || {}).value || '',
      capacity: Math.max(1, Math.min(100, Number((root.querySelector('#cle-cap') || {}).value) || 10)),
    });
    const save = async (publish) => {
      if (UI.saving) return;
      // Read every field BEFORE flipping UI.saving — window.__render() below re-runs mount()
      // against a fresh render of G/UI, which repaints these inputs from G.prices (still stale
      // at this point) and silently discards whatever the coach just typed but never saved.
      const patch = collectPatch();
      const prices = collectPrices();
      // Catch an out-of-bounds price HERE. The server enforces the same bounds either way, but if
      // it only fails there the coach publishes happily and the 409 surfaces weeks later at a
      // client's checkout — the person who sees the error isn't the person who can fix it.
      for (const t of TIERS) {
        const raw = (root.querySelector(`#cle-price-${t.key}`) || {}).value;
        if (!raw) continue;
        const err = tierPriceError(t.key, raw, (G.flags || {}).tier_bounds);
        if (err) { UI.err = `${t.name}: ${err}`; if (window.__render) window.__render(); return; }
      }
      if (publish != null) patch.published = publish;
      UI.saving = true; UI.err = ''; UI.msg = '';
      if (window.__render) window.__render();
      const r1 = await roles.updateMyListing(patch);
      const r2 = Object.keys(prices).length ? await roles.setListingTierPrices(prices) : { ok: true };
      UI.saving = false;
      if (r1 && r1.error) UI.err = r1.error;
      else if (r2 && r2.error) UI.err = r2.error;
      else { UI.msg = publish === true ? 'Published — you’re in the directory' : publish === false ? 'Unpublished' : 'Saved'; await load(true); }
      if (window.__render) window.__render();
    };
    const saveBtn = root.querySelector('[data-cle-save]');
    if (saveBtn) saveBtn.addEventListener('click', () => save(null));
    const pubBtn = root.querySelector('[data-cle-pub]');
    if (pubBtn) pubBtn.addEventListener('click', () => save(!(G.listing && G.listing.published)));
  },
};
