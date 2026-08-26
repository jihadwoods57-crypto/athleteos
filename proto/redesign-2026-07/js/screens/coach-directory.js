/* Coach directory — browse approved marketplace coaches. Deliberately not a feed and not ranked
   by popularity: earliest partners first, filtered by what actually matters (category, price).
   #coach-directory or #coach-directory/verified to land pre-filtered on credentialed pros.
   Every card leads to #coach-listing/<slug>. */
import { backHead, esc, skeletonRows, emptyState, errorState } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { track, EVENTS } from '../analytics.js';
import { shouldLoad } from '../marketplace-rules.js';

const CAT_LABEL = { accountability: 'Accountability', cpt: 'Certified trainer', snc: 'Strength & conditioning' };
const PRICE_STEPS = [
  { label: 'Any price', cents: null },
  { label: 'Under $100/mo', cents: 9999 },
  { label: 'Under $200/mo', cents: 19999 },
  { label: 'Under $350/mo', cents: 34999 },
];

let CACHE = { list: null, error: false, key: '', loading: false };
let UI = { category: null, priceIdx: 0 };

async function load(force) {
  const key = `${UI.category || ''}|${UI.priceIdx}`;
  // The guard lives in marketplace-rules.js so it can be tested — this exact condition is the
  // difference between a working screen and an infinite synchronous render→mount→load recursion
  // that crashes the tab (3277745). See shouldLoad's comment for why `loading` must be part of it.
  if (!shouldLoad(CACHE, key, force)) return;
  CACHE = { list: null, error: false, key, loading: true };
  if (window.__render) window.__render();
  try {
    const list = await roles.fetchMarketplaceDirectory({
      category: UI.category, maxPriceCents: PRICE_STEPS[UI.priceIdx].cents,
    });
    if (CACHE.key !== key) return; // a newer filter won
    // null = the RPC FAILED — that's the error state, not "No coaches match". This branch is
    // what finally makes the cd-retry errorState below reachable.
    if (list === null) CACHE.error = true;
    else CACHE.list = Array.isArray(list) ? list : [];
  } catch {
    CACHE.error = true;
  }
  CACHE.loading = false;
  if (window.__render) window.__render();
}

function monogram(name) {
  return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function fromPrice(c) {
  if (c == null) return 'Pricing soon';
  const d = c / 100;
  return `From $${Number.isInteger(d) ? d : d.toFixed(2)}/mo`;
}
function chip(label, active, attr) {
  return `<button class="chip" ${attr} aria-pressed="${active ? 'true' : 'false'}" style="${active ? 'background:var(--blue-bright);color:var(--ink-on-accent);border-color:transparent' : ''}">${label}</button>`;
}
const PRICE_CHIP = ['Any', 'Under $100', 'Under $200', 'Under $350'];

export default {
  render({ sub }) {
    if (sub === 'verified' && UI.category == null) UI.category = 'cpt';
    const list = CACHE.list;
    return `${backHead('Find your coach', 'Approved by OnStandard · verified where it says so', 'get-a-coach')}

    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:2px 16px 10px">
      ${chip('All', !UI.category, 'data-cat=""')}
      ${chip('Accountability', UI.category === 'accountability', 'data-cat="accountability"')}
      ${chip('Certified trainer', UI.category === 'cpt', 'data-cat="cpt"')}
      ${chip('S&C', UI.category === 'snc', 'data-cat="snc"')}
      ${/* One chip per price band, not a cycling button: state and control were sharing one
            label, and reaching "Any" again took three taps through every other band. */''}
      ${PRICE_STEPS.map((p, i) => chip(PRICE_CHIP[i], UI.priceIdx === i, `data-price="${i}"`)).join('')}
    </div>

    ${CACHE.error ? errorState({ title: "Couldn't load coaches", body: 'The directory is still there. Reconnect and it loads right here.', retryId: 'cd-retry' }) : ''}
    ${!CACHE.error && !list ? skeletonRows(4, 'Loading coaches') : ''}
    ${list && !list.length ? emptyState({ icon: 'users', title: 'No coaches match', body: 'Loosen a filter, or check back soon. The partner program is growing.' }) : ''}

    ${list && list.length ? `
    <section class="card" style="padding:6px 16px">
      ${list.map((l) => `
      <div class="lrow" data-go="coach-listing/${esc(l.slug)}" style="align-items:flex-start">
        <div class="lic" style="background:linear-gradient(150deg,var(--blue-bright),var(--blue));color:var(--ink-on-accent);font-weight:800;font-size:14px">${esc(monogram(l.display_name))}</div>
        <div class="lm" style="flex:1">
          <div class="lt">${esc(l.display_name)}${(l.categories || []).some((c) => c !== 'accountability') ? ` <span style="color:var(--blue-bright)">${icon('shield', 13)}</span>` : ''}</div>
          <div class="ls">${esc((l.categories || []).map((c) => CAT_LABEL[c] || c).join(' · '))}</div>
          ${l.headline ? `<div class="ls" style="margin-top:3px">${esc(l.headline)}</div>` : ''}
          ${/* A seat count is a plain fact, not a scarcity lever: no amber, no urgency. */''}
          <div class="ls" style="margin-top:3px;color:var(--text-2)">${esc(fromPrice(l.from_cents))}${l.seats_left != null ? ` · <span style="color:var(--text-2)">${l.capacity != null ? `${l.seats_left} of ${l.capacity} spots open` : `${l.seats_left} ${l.seats_left === 1 ? 'spot' : 'spots'} open`}</span>` : ''}</div>
        </div>
        ${icon('chevron', 17, 'style="color:var(--text-3);margin-top:10px"')}
      </div>`).join('')}
    </section>
    <div class="sidebox" style="margin-top:10px"><div class="req-icon b" style="width:34px;height:34px">${icon('shield', 15)}</div>
      <div><div class="tt">The shield means we checked</div><div class="ts">Verified badges are earned by documents we reviewed. Never self-declared. Accountability coaches keep you consistent; they don't prescribe.</div></div></div>` : ''}

    <div class="lrow" data-go="coach-apply" style="margin:4px 16px 14px">
      <div class="lic">${icon('users', 16)}</div>
      <div class="lm"><div class="lt" style="font-size:13px">Are you a coach?</div><div class="ls">Apply to the OnStandard Coach Partner Program</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>
    `;
  },
  mount(root) {
    load();
    track(EVENTS.MKT_DIRECTORY_VIEWED);
    root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      UI.category = b.getAttribute('data-cat') || null;
      load(true);
    }));
    root.querySelectorAll('[data-price]').forEach((b) => b.addEventListener('click', () => {
      UI.priceIdx = Number(b.getAttribute('data-price')) || 0;
      load(true);
    }));
    const retry = root.querySelector('#cd-retry');
    if (retry) retry.addEventListener('click', () => load(true));
  },
};
