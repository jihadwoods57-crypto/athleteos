/* Trainer "Grow" tab — the monetization wedge in-app surface (0114). Three jobs in one screen:
   (1) build + publish a public acquisition page (get a shareable link), (2) manage offers/packages,
   (3) work inbound applications (accept/decline). Owner-scoped by RLS; best-effort reads via roles.js,
   repaint via window.__render(). Reuses the shared .card/.lrow/.btn/.state-demo/.status-pill system. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, backHead, skeletonRows, errorState } from '../components.js';
import * as roles from '../roles.js';

const SHARE_BASE = 'https://onstandard.app/t?t=';

// Local cache + light UI state (which offer is being edited). Repaint after any load/change.
let G = { practiceId: null, page: null, offers: null, apps: null, connect: null, payments: null, funded: null, claims: null, fail: {}, loaded: false };
let UI = { editing: null, connecting: false, confirmRefund: null, payMsg: '' };  // editing: null | 'new' | <offer id>

function practiceId() { return (RT.practice && RT.practice.id) || G.practiceId || null; }

async function loadGrow(force) {
  if (G.loaded && !force) return;
  let pid = practiceId();
  if (!pid) { const id = await roles.fetchMyPracticeIdentity(); if (id && id.id) { G.practiceId = pid = id.id; } }
  if (!pid) { G.loaded = true; if (window.__render) window.__render(); return; }
  const [page, offers, apps, connect, payments, funded, claims] = await Promise.all([
    roles.fetchMyTrainerPage(pid), roles.fetchMyOffers(pid), roles.fetchMyApplications(pid),
    roles.fetchConnectStatus(pid), roles.fetchPracticePayments(pid), roles.fetchFundedClients(pid),
    roles.fetchPendingClaims(pid),
  ]);
  // Failed reads keep whatever we last had and set a fail flag — the screen renders an honest
  // error for that section instead of a fabricated "No payments yet." (roles.js returns
  // { error: true } on failure; a plain []/null really is empty).
  const isErr = (x) => !!(x && !Array.isArray(x) && x.error);
  G.fail = { page: isErr(page), offers: isErr(offers), apps: isErr(apps), connect: isErr(connect), payments: isErr(payments), funded: isErr(funded), claims: isErr(claims) };
  if (!G.fail.page) G.page = page;
  if (!G.fail.offers) G.offers = Array.isArray(offers) ? offers : [];
  if (!G.fail.apps) G.apps = Array.isArray(apps) ? apps : [];
  if (!G.fail.connect) G.connect = connect || { status: 'none' };
  if (!G.fail.payments) G.payments = Array.isArray(payments) ? payments : [];
  if (!G.fail.funded) G.funded = Array.isArray(funded) ? funded : [];
  if (!G.fail.claims) G.claims = Array.isArray(claims) ? claims : [];
  G.loaded = true;
  if (window.__render) window.__render();
}

/* Inline per-section failure row: the section stays on screen, says it couldn't load, and offers
   the same retry everywhere. Never renders as an empty state. */
function sectionErr(what) {
  return `<div class="lrow" style="cursor:default">
    <div class="lm"><div class="lt" style="color:var(--red)">Couldn't load ${esc(what)}</div>
      <div class="ls">Check your connection, then retry.</div></div>
    <button class="btn ghost sm" data-tg="retry" style="width:auto;padding:0 12px;height:32px">Retry</button>
  </div>`;
}

const CONNECT_LABEL = {
  none: { pill: 'Not set up', color: 'var(--text-3)', cta: 'Connect Stripe to get paid', tone: 'green' },
  pending: { pill: 'Setup in progress', color: 'var(--amber-bright)', cta: 'Continue setup', tone: 'ghost' },
  active: { pill: 'Connected', color: 'var(--green-bright)', cta: 'Manage on Stripe', tone: 'ghost' },
  restricted: { pill: 'Action needed', color: 'var(--red)', cta: 'Fix on Stripe', tone: 'green' },
};

/* The one card that turns "have offers" into "can actually get paid for them" — a trainer with no
   Connect account sees a single clear CTA; Stripe hosts 100% of the identity/bank-account
   collection, so this screen never asks for any of that itself. */
function connectSection() {
  const status = (G.connect && G.connect.status) || 'none';
  const meta = CONNECT_LABEL[status] || CONNECT_LABEL.none;
  const sub = status === 'active'
    ? 'Client payments for your offers deposit to your bank account on Stripe’s schedule.'
    : status === 'pending'
      ? 'Finish the steps Stripe asked for to start accepting payments.'
      : status === 'restricted'
        ? 'Stripe paused payouts — a document or detail needs attention.'
        : 'Connect a Stripe account so clients can pay for your offers right in the app.';
  return `
    <div class="lrow" style="cursor:default;padding:0 0 10px">
      <div class="lm"><div class="lt">Stripe account</div><div class="ls">${esc(sub)}</div></div>
      <span class="status-pill" style="background:var(--surface-2);color:${meta.color}">${meta.pill}</span>
    </div>
    <button class="btn ${meta.tone} sm" id="tg-connect" style="width:auto;padding:0 16px;height:36px">${UI.connecting ? '…' : meta.cta}</button>
    <span id="tg-connect-msg" class="ls" style="margin-left:10px"></span>
    <div class="sidebox" style="margin:12px 0 0"><div class="req-icon g" style="width:34px;height:34px">${icon('check', 15)}</div>
      <div><div class="tt">Bill through OnStandard, and your clients ride free</div>
      <div class="ts">A client on a recurring package gets full OnStandard membership included, and you are not charged a seat for them. One bill for them, no seat bill for you — the platform fee covers it. Most trainers add ~$25 to the package and include the app.</div></div></div>
  `;
}

/* Who is covered by a live package, and — the part that actually matters day to day — who has
   lapsed. A trainer needs the client whose card failed far more than the ones who are fine, so
   lapsed rows are listed and sorted to stay visible rather than filtered out. */
function fundedSection() {
  const rows = G.funded || [];
  const live = rows.filter(r => r.is_active).length;
  const lapsed = rows.filter(r => !r.is_active);
  if (!rows.length) {
    return `<div class="ls" style="padding:10px 0">No one yet. Share your page link — anyone who buys a monthly or weekly package is covered automatically, and never counts toward your seats.</div>`;
  }
  return `
    <div class="lrow" style="cursor:default;padding:6px 0 10px">
      <div class="lm"><div class="lt">${live} covered${lapsed.length ? ` · ${lapsed.length} lapsed` : ''}</div>
        <div class="ls">Covered clients have membership included and cost you no seat.</div></div>
    </div>
    ${rows.map(r => `
    <div class="lrow" style="cursor:default">
      <div class="lm"><div class="lt">${esc(r.full_name || 'Client')}</div>
        <div class="ls">${r.offer_name ? esc(r.offer_name) + ' · ' : ''}${r.is_active ? 'Renews ' + shortDate(r.expires_at) : 'Lapsed ' + shortDate(r.expires_at)}</div></div>
      <span class="status-pill" style="background:${r.is_active ? 'var(--green-surface)' : 'var(--surface-2)'};color:${r.is_active ? 'var(--green-bright)' : 'var(--red)'}">${r.is_active ? 'Covered' : 'Lapsed'}</span>
    </div>`).join('')}`;
}

function shortDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time' : o.cadence === 'session' ? ' / session' : o.cadence === 'week' ? ' / wk' : ' / mo';
  return `$${n}${per}`;
}

function newApps() { return (G.apps || []).filter(a => a.status === 'new').length; }

export const trainerGrow = {
  nav: 'trainer', tab: 'profile',   // reached from You → Grow your practice; no longer its own tab
  badge() { return newApps(); },
  render() {
    const head = backHead('Grow', 'Your page, offers & applications', 'trainer-profile');
    // Offline is checked BEFORE the loading gate (same order as coach-roster): a cold offline
    // open would otherwise sit on a skeleton forever.
    if (!G.loaded && !navigator.onLine) {
      return `${head}${errorState({ title: "You're offline", body: 'Your page, offers and payments load right here when you reconnect.', retryId: 'tg-retry' })}`;
    }
    if (!G.loaded) {
      return `${head}${skeletonRows(4, 'Loading your practice')}`;
    }
    const F = G.fail || {};
    // Every core read failed and there's nothing cached to show: one honest screen-level error.
    if (F.page && F.offers && F.apps && !G.page && !(G.offers || []).length && !(G.apps || []).length) {
      return `${head}${errorState({ title: "Couldn't load your practice", body: 'Nothing was lost. Reconnect and everything loads right here.', retryId: 'tg-retry' })}`;
    }
    if (!practiceId()) {
      return `${head}
      <div class="state-demo" data-go="trainer-profile" style="cursor:pointer"><div class="sd-ic">${icon('heart', 24)}</div>
      <div class="sd-t">Set up your practice first</div>
      <div class="sd-s">Your public page and offers hang off your practice. Finish your trainer profile to get started.</div></div>`;
    }
    const p = G.page || {};
    const published = !!p.published;
    const slug = p.public_slug || '';
    const shareUrl = slug ? SHARE_BASE + slug : '';

    return `${head}

    <div class="eyebrow">Your public page</div>
    <section class="card tg-page" style="padding:16px">
      <div class="lrow" style="cursor:default;padding:0 0 10px">
        <div class="lm"><div class="lt">Acquisition page</div>
          <div class="ls">${published ? 'Live — anyone with your link can apply' : 'Draft — publish to get a shareable link'}</div></div>
        <span class="status-pill" style="background:${published ? 'var(--green-surface)' : 'var(--surface-2)'};color:${published ? 'var(--green-bright)' : 'var(--text-3)'}">${published ? 'Published' : 'Draft'}</span>
      </div>
      ${published && shareUrl ? `
      <div class="code-boxes" style="display:flex;gap:8px;align-items:center;margin:4px 0 12px">
        <input id="tg-link" readonly value="${esc(shareUrl)}" style="flex:1;font-size:var(--t-sm);letter-spacing:0;text-align:left;padding:0 10px;height:44px">
        <button class="btn ghost sm" id="tg-copy" style="width:auto;padding:0 12px;height:36px">Copy</button>
      </div>` : ''}
      <label class="tg-l">Display name</label><input id="tg-name" value="${esc(p.display_name || RT.profile && RT.profile.full_name || '')}" placeholder="Your name">
      <label class="tg-l">Specialty</label><input id="tg-spec" value="${esc(p.specialty || '')}" placeholder="Sports-performance nutrition & accountability">
      <label class="tg-l">Headline (your promise)</label><input id="tg-head" value="${esc(p.headline || '')}" placeholder="Turn your training into daily execution you can see.">
      <label class="tg-l">About you</label><textarea id="tg-bio" placeholder="Who you coach, how you work…">${esc(p.bio || '')}</textarea>
      <label class="tg-l">Apply button label</label><input id="tg-cta" value="${esc(p.cta_label || 'Apply to work with me')}" placeholder="Apply to work with me">
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn ghost sm" id="tg-save" style="width:auto;padding:0 16px;height:38px">Save</button>
        <button class="btn ${published ? 'ghost' : 'green'} sm" id="tg-pub" style="width:auto;padding:0 16px;height:38px">${published ? 'Unpublish' : 'Save & publish'}</button>
        <span id="tg-msg" class="ls" style="align-self:center"></span>
      </div>
    </section>

    <div class="eyebrow">Get paid</div>
    <section class="card" style="padding:16px">
      ${F.connect && !G.connect ? sectionErr('your Stripe status') : connectSection()}
    </section>

    <div class="eyebrow">Your offers</div>
    <section class="card" style="padding:6px 16px">
      ${F.offers && !(G.offers || []).length ? sectionErr('your offers') : ''}
      ${(G.offers || []).length ? (G.offers).map(o => UI.editing === o.id ? offerForm(o) : `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(o.name)} ${o.active ? '' : '<span class="ls">· hidden</span>'}</div>
          <div class="ls">${esc(priceLabel(o))}${o.blurb ? ' · ' + esc(o.blurb) : ''}</div></div>
        <button class="btn ghost sm" data-tg="edit" data-id="${esc(o.id)}" style="width:auto;padding:0 12px;height:32px">Edit</button>
      </div>`).join('') : (F.offers ? '' : `<div class="ls" style="padding:10px 0">No offers yet. Add your first package — prospects apply to it from your page.</div>`)}
      ${UI.editing === 'new' ? offerForm(null) : `<div style="padding:10px 0"><button class="btn ghost sm" data-tg="add" style="width:auto;padding:0 14px;height:34px">${icon('plus', 15)} Add an offer</button></div>`}
    </section>

    <div class="eyebrow">Applications ${newApps() ? `<span class="status-pill" style="background:rgba(var(--blue-rgb),0.14);color:var(--blue-bright);margin-left:6px">${newApps()} new</span>` : ''}</div>
    <section class="card" style="padding:6px 16px">
      ${F.apps && !(G.apps || []).length ? sectionErr('applications') : ''}
      ${(G.apps || []).length ? (G.apps).map(a => `
      <div class="lrow" style="cursor:default;align-items:flex-start">
        <div class="lm" style="flex:1">
          <div class="lt">${esc(a.applicant_name)} <span class="ls">· ${esc(a.applicant_contact)}</span></div>
          ${a.message ? `<div class="ls" style="margin-top:2px">${esc(a.message)}</div>` : ''}
          <div class="ls" style="margin-top:3px;color:var(--text-3)">${a.status === 'new' ? 'New' : a.status === 'accepted' ? 'Accepted' : 'Declined'} · ${timeAgo(a.created_at)}</div>
        </div>
        ${a.status === 'new' ? `
        <div style="display:flex;gap:6px;flex:none">
          <button class="btn ghost sm" data-tg="decline" data-id="${esc(a.id)}" style="width:auto;padding:0 10px;height:30px">Decline</button>
          <button class="btn green sm" data-tg="accept" data-id="${esc(a.id)}" style="width:auto;padding:0 10px;height:30px">Accept</button>
        </div>` : ''}
      </div>`).join('') : (F.apps ? '' : `<div class="ls" style="padding:10px 0">No applications yet. Publish your page and share the link — applications land here.</div>`)}
      ${(G.apps || []).some(a => a.status === 'accepted') && RT.practice && RT.practice.code ? `
      <div class="sidebox" style="margin:10px 0"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
        <div><div class="tt">Connect an accepted client</div><div class="ts">Send them your practice code <b>${esc(RT.practice.code)}</b> — they enter it after signing up to join your practice and unlock coaching.</div></div></div>` : ''}
    </section>

    ${F.claims && !(G.claims || []).length ? `
    <div class="eyebrow">Paid — waiting to join</div>
    <section class="card" style="padding:6px 16px">${sectionErr('pending buyers')}</section>` : ''}
    ${(G.claims || []).length ? `
    <div class="eyebrow">Paid — waiting to join <span class="status-pill" style="background:rgba(var(--amber-rgb),0.16);color:var(--amber-bright);margin-left:6px">${(G.claims).length}</span></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default;padding:6px 0 10px">
        <div class="lm"><div class="lt">They have paid you but haven't set up their app</div>
          <div class="ls">Until they enter the code they're being billed for something they can't open. Read them the code, or refund them from Payments below.</div></div>
      </div>
      ${(G.claims).map(c => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(c.payer_email || 'Buyer')}</div>
          <div class="ls">${c.offer_name ? esc(c.offer_name) + ' · ' : ''}waiting ${esc(String(c.days_waiting))}d</div></div>
        <button class="btn ghost sm" data-tg="copycode" data-code="${esc(c.code)}" style="width:auto;padding:0 12px;height:32px;font-family:var(--mono,monospace)">${esc(c.code)}</button>
      </div>`).join('')}
    </section>` : ''}

    ${G.connect && G.connect.status === 'active' ? `
    <div class="eyebrow">Covered clients</div>
    <section class="card" style="padding:6px 16px">
      ${F.funded && !(G.funded || []).length ? sectionErr('covered clients') : fundedSection()}
    </section>

    <div class="eyebrow">Payments</div>
    <section class="card" style="padding:6px 16px">
      ${F.payments && !(G.payments || []).length ? sectionErr('payments') : ''}
      ${(G.payments || []).length ? (G.payments).map(p => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">$${(p.amount_cents / 100).toFixed(2)} <span class="ls">${p.status === 'refunded' ? '· refunded' : ''}</span></div>
          <div class="ls">${timeAgo(p.created_at)} · fee $${(p.application_fee_cents / 100).toFixed(2)}${p.beneficiary_name ? ` · parent-funded for ${esc(p.beneficiary_name)}` : ''}</div>
          ${UI.confirmRefund === p.id ? `<div class="ls" style="color:var(--red);margin-top:2px">Sends $${(p.amount_cents / 100).toFixed(2)} back to the client. This can't be undone.</div>` : ''}</div>
        ${p.status === 'paid' ? (UI.confirmRefund === p.id ? `
        <div style="display:flex;gap:6px;flex:none">
          <button class="btn ghost sm" data-tg="refundkeep" style="width:auto;padding:0 10px;height:30px">Keep</button>
          <button class="btn sm" data-tg="refundgo" data-id="${esc(p.id)}" style="width:auto;padding:0 12px;height:30px;background:var(--danger-solid);color:#fff;border:none">Confirm refund</button>
        </div>` : `<button class="btn ghost sm" data-tg="refund" data-id="${esc(p.id)}" style="width:auto;padding:0 12px;height:30px">Refund</button>`) : ''}
      </div>`).join('') : (F.payments ? '' : `<div class="ls" style="padding:10px 0">No payments yet.</div>`)}
      ${UI.payMsg ? `<div class="ls" style="color:var(--red);padding:6px 0 10px">${esc(UI.payMsg)}</div>` : ''}
    </section>` : ''}
    <div style="height:16px"></div>
    `;
  },
  mount(root) {
    loadGrow();
    const pid = practiceId();
    const $ = (id) => root.querySelector('#' + id);
    const msg = (t, err) => { const m = $('tg-msg'); if (m) { m.textContent = t; m.style.color = err ? 'var(--red)' : 'var(--green-bright)'; } };

    const connectBtn = $('tg-connect');
    if (connectBtn) connectBtn.addEventListener('click', async () => {
      const cmsg = $('tg-connect-msg');
      const status = (G.connect && G.connect.status) || 'none';
      if (status === 'active') { roles.openExternal('https://dashboard.stripe.com/express'); return; }
      UI.connecting = true; if (window.__render) window.__render();
      const r = await roles.startConnectOnboarding(pid);
      UI.connecting = false;
      if (r && r.url) { roles.openExternal(r.url); await loadGrow(true); }
      else { if (cmsg) cmsg.textContent = (r && r.error) || 'Could not start setup'; if (window.__render) window.__render(); }
    });

    const copyBtn = $('tg-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const v = $('tg-link') && $('tg-link').value;
      if (v) { navigator.clipboard.writeText(v).then(() => { copyBtn.textContent = 'Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 1400); }).catch(() => {}); }
    });

    function pageFields() {
      return {
        display_name: ($('tg-name') || {}).value || '', specialty: ($('tg-spec') || {}).value || '',
        headline: ($('tg-head') || {}).value || '', bio: ($('tg-bio') || {}).value || '',
        cta_label: ($('tg-cta') || {}).value || 'Apply to work with me',
      };
    }
    const saveBtn = $('tg-save');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true; msg('Saving…');
      const r = await roles.saveMyTrainerPage(pid, pageFields());
      saveBtn.disabled = false;
      if (r.ok) { msg('Saved'); await loadGrow(true); } else msg(r.error || 'Save failed', true);
    });
    const pubBtn = $('tg-pub');
    if (pubBtn) pubBtn.addEventListener('click', async () => {
      pubBtn.disabled = true; msg('Saving…');
      await roles.saveMyTrainerPage(pid, pageFields());               // persist fields first
      const willPublish = !(G.page && G.page.published);
      const r = await roles.publishMyTrainerPage(pid, willPublish);
      pubBtn.disabled = false;
      if (r.ok) { msg(willPublish ? 'Published' : 'Unpublished'); await loadGrow(true); } else msg(r.error || 'Failed', true);
    });

    // offer add/edit/delete
    root.querySelectorAll('[data-tg]').forEach(b => b.addEventListener('click', async () => {
      const act = b.getAttribute('data-tg'), id = b.getAttribute('data-id');
      if (act === 'copycode') {
        const code = b.getAttribute('data-code') || '';
        // navigator.clipboard is UNDEFINED in any non-secure context, which includes the WebView
        // this app actually runs in on some Android builds — so the bare `.writeText()` threw a
        // TypeError synchronously, before any .catch() could see it, and the tap did nothing with
        // an error in the console. Same try/catch shape coach-home.js already uses for its code.
        // The code stays on screen either way: a trainer can always read it aloud, which is the
        // primary way this is used.
        if (code) {
          try {
            await navigator.clipboard.writeText(code);
            b.textContent = 'Copied';
            setTimeout(() => { b.textContent = code; }, 1400);
          } catch { /* no clipboard here — the code is already legible on the button */ }
        }
        return;
      }
      if (act === 'add') { UI.editing = 'new'; if (window.__render) window.__render(); return; }
      if (act === 'edit') { UI.editing = id; if (window.__render) window.__render(); return; }
      if (act === 'cancel') { UI.editing = null; if (window.__render) window.__render(); return; }
      if (act === 'del') {
        b.disabled = true; await roles.deleteOffer(id); UI.editing = null; await loadGrow(true); return;
      }
      if (act === 'osave') {
        b.disabled = true;
        const g = (s) => { const e = root.querySelector('.tg-of #' + s); return e ? e.value : ''; };
        const dollars = g('of-price').trim();
        const offer = {
          id: id === 'new' ? undefined : id, practice_id: pid,
          name: g('of-name').trim() || 'Package', blurb: g('of-blurb').trim(),
          price_cents: dollars === '' ? null : Math.round(parseFloat(dollars) * 100),
          cadence: g('of-cad') || 'month',
          features: g('of-feat').split('\n').map(s => s.trim()).filter(Boolean),
          active: root.querySelector('.tg-of #of-active').checked,
          sort: (G.offers || []).length,
        };
        if (offer.price_cents != null && !isFinite(offer.price_cents)) offer.price_cents = null;
        const r = await roles.saveOffer(offer);
        if (r.ok) { UI.editing = null; await loadGrow(true); } else { b.disabled = false; }
        return;
      }
      if (act === 'accept' || act === 'decline') {
        b.disabled = true; b.textContent = '…';
        await roles.setApplicationStatus(id, act === 'accept' ? 'accepted' : 'declined');
        await loadGrow(true);
      }
      // Refund is two-tap, inline: first tap arms it (the row states the consequence), the
      // explicit "Confirm refund" executes. No window.confirm/alert — the app's own surface
      // carries both the warning and the failure message.
      if (act === 'refund') { UI.confirmRefund = id; UI.payMsg = ''; if (window.__render) window.__render(); return; }
      if (act === 'refundkeep') { UI.confirmRefund = null; if (window.__render) window.__render(); return; }
      if (act === 'refundgo') {
        b.disabled = true; b.textContent = '…';
        const r = await roles.refundOfferPayment(id);
        UI.confirmRefund = null;
        if (!r || !r.ok) { UI.payMsg = (r && r.error) || "The refund didn't go through. Nothing was returned; try again."; if (window.__render) window.__render(); return; }
        UI.payMsg = '';
        await loadGrow(true);
      }
      if (act === 'retry') {
        b.disabled = true; b.textContent = '…';
        await loadGrow(true);
      }
    }));
    // Screen-level error / offline retry (errorState renders a #tg-retry button).
    const retryBtn = $('tg-retry');
    if (retryBtn) retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      if (!G.loaded) { if (window.__render) window.__render(); }
      await loadGrow(true);
    });
  },
};

/* Inline offer editor (create or edit). One-per-line features; price in dollars, blank = "contact". */
function offerForm(o) {
  o = o || {};
  const dollars = o.price_cents == null ? '' : (o.price_cents / 100);
  const cad = o.cadence || 'month';
  const opt = (v, l) => `<option value="${v}" ${cad === v ? 'selected' : ''}>${l}</option>`;
  return `<div class="tg-of">
    <label class="tg-l">Name</label><input id="of-name" value="${esc(o.name || '')}" placeholder="Light Accountability">
    <label class="tg-l">One-line description</label><input id="of-blurb" value="${esc(o.blurb || '')}" placeholder="Automated analysis + a weekly read on your week.">
    <div class="row2">
      <div style="flex:1"><label class="tg-l">Price ($, blank = contact)</label><input id="of-price" inputmode="decimal" value="${dollars}" placeholder="29"></div>
      <div style="width:130px"><label class="tg-l">Per</label><select id="of-cad">${opt('month', 'month')}${opt('week', 'week')}${opt('one-time', 'one-time')}${opt('session', 'session')}</select></div>
    </div>
    <div class="ls" style="margin-top:8px;color:var(--text-3)">${cad === 'month' || cad === 'week'
      ? 'Priced monthly or weekly, so clients can buy this straight from your page — and their OnStandard membership is included at no seat cost to you.'
      : 'One-time and per-session packages are apply-only: membership is covered for as long as a package renews, so a one-off has no period to cover.'}</div>
    <label class="tg-l">What's included (one per line)</label><textarea id="of-feat" placeholder="Weekly check-in&#10;Direct meal feedback">${esc((o.features || []).join('\n'))}</textarea>
    <label class="tg-l" style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="of-active" ${o.active === false ? '' : 'checked'} style="width:auto"> Visible on your page</label>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn green sm" data-tg="osave" data-id="${esc(o.id || 'new')}" style="width:auto;padding:0 16px;height:34px">Save offer</button>
      <button class="btn ghost sm" data-tg="cancel" style="width:auto;padding:0 14px;height:34px">Cancel</button>
      ${o.id ? `<button class="btn ghost sm" data-tg="del" data-id="${esc(o.id)}" style="width:auto;padding:0 12px;height:34px;color:var(--red);margin-left:auto">Delete</button>` : ''}
    </div>
  </div>`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
