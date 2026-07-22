/* Trainer "Grow" tab — the monetization wedge in-app surface (0114). Three jobs in one screen:
   (1) build + publish a public acquisition page (get a shareable link), (2) manage offers/packages,
   (3) work inbound applications (accept/decline). Owner-scoped by RLS; best-effort reads via roles.js,
   repaint via window.__render(). Reuses the shared .card/.lrow/.btn/.state-demo/.status-pill system. */
import { RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, titleHead } from '../components.js';
import * as roles from '../roles.js';

const SHARE_BASE = 'https://onstandard.app/t?t=';

// Local cache + light UI state (which offer is being edited). Repaint after any load/change.
let G = { practiceId: null, page: null, offers: null, apps: null, loaded: false };
let UI = { editing: null };  // null | 'new' | <offer id>

function practiceId() { return (RT.practice && RT.practice.id) || G.practiceId || null; }

async function loadGrow(force) {
  if (G.loaded && !force) return;
  let pid = practiceId();
  if (!pid) { const id = await roles.fetchMyPracticeIdentity(); if (id && id.id) { G.practiceId = pid = id.id; } }
  if (!pid) { G.loaded = true; if (window.__render) window.__render(); return; }
  const [page, offers, apps] = await Promise.all([
    roles.fetchMyTrainerPage(pid), roles.fetchMyOffers(pid), roles.fetchMyApplications(pid),
  ]);
  G.page = page && !page.error ? page : (page && page.error ? G.page : null);
  G.offers = Array.isArray(offers) ? offers : [];
  G.apps = Array.isArray(apps) ? apps : [];
  G.loaded = true;
  if (window.__render) window.__render();
}

function priceLabel(o) {
  if (o.price_cents == null) return 'Contact for pricing';
  const d = o.price_cents / 100; const n = Number.isInteger(d) ? d : d.toFixed(2);
  const per = o.cadence === 'one-time' ? ' one-time' : o.cadence === 'session' ? ' / session' : o.cadence === 'week' ? ' / wk' : ' / mo';
  return `$${n}${per}`;
}

function newApps() { return (G.apps || []).filter(a => a.status === 'new').length; }

export const trainerGrow = {
  nav: 'trainer', tab: 'grow',
  badge() { return newApps(); },
  render() {
    if (!G.loaded) {
      return `${titleHead('Grow', 'Your page, offers & applications')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Loading…</div></div></div>`;
    }
    if (!practiceId()) {
      return `${titleHead('Grow', 'Your page, offers & applications')}
      <div class="state-demo" data-go="trainer-profile" style="cursor:pointer"><div class="sd-ic">${icon('heart', 24)}</div>
      <div class="sd-t">Set up your practice first</div>
      <div class="sd-s">Your public page and offers hang off your practice. Finish your trainer profile to get started.</div></div>`;
    }
    const p = G.page || {};
    const published = !!p.published;
    const slug = p.public_slug || '';
    const shareUrl = slug ? SHARE_BASE + slug : '';

    return `${titleHead('Grow', 'Your page, offers & applications')}

    <div class="eyebrow">Your public page</div>
    <section class="card" style="padding:16px">
      <div class="lrow" style="cursor:default;padding:0 0 10px">
        <div class="lm"><div class="lt">Acquisition page</div>
          <div class="ls">${published ? 'Live — anyone with your link can apply' : 'Draft — publish to get a shareable link'}</div></div>
        <span class="status-pill" style="background:${published ? 'var(--green-surface)' : 'var(--surface-2)'};color:${published ? 'var(--green-bright)' : 'var(--text-3)'}">${published ? 'Published' : 'Draft'}</span>
      </div>
      ${published && shareUrl ? `
      <div class="code-boxes" style="display:flex;gap:8px;align-items:center;margin:4px 0 12px">
        <input id="tg-link" readonly value="${esc(shareUrl)}" style="flex:1;font-size:12px;letter-spacing:0;text-align:left;padding:0 10px;height:36px">
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

    <div class="eyebrow">Your offers</div>
    <section class="card" style="padding:6px 16px">
      ${(G.offers || []).length ? (G.offers).map(o => UI.editing === o.id ? offerForm(o) : `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${esc(o.name)} ${o.active ? '' : '<span class="ls">· hidden</span>'}</div>
          <div class="ls">${esc(priceLabel(o))}${o.blurb ? ' · ' + esc(o.blurb) : ''}</div></div>
        <button class="btn ghost sm" data-tg="edit" data-id="${esc(o.id)}" style="width:auto;padding:0 12px;height:32px">Edit</button>
      </div>`).join('') : `<div class="ls" style="padding:10px 0">No offers yet. Add your first package — prospects apply to it from your page.</div>`}
      ${UI.editing === 'new' ? offerForm(null) : `<div style="padding:10px 0"><button class="btn ghost sm" data-tg="add" style="width:auto;padding:0 14px;height:34px">${icon('plus', 15)} Add an offer</button></div>`}
    </section>

    <div class="eyebrow">Applications ${newApps() ? `<span class="status-pill" style="background:var(--red-surface);color:var(--red-bright);margin-left:6px">${newApps()} new</span>` : ''}</div>
    <section class="card" style="padding:6px 16px">
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
      </div>`).join('') : `<div class="ls" style="padding:10px 0">No applications yet. Publish your page and share the link — applications land here.</div>`}
      ${(G.apps || []).some(a => a.status === 'accepted') && RT.practice && RT.practice.code ? `
      <div class="sidebox" style="margin:10px 0"><div class="req-icon b" style="width:34px;height:34px">${icon('lock', 15)}</div>
        <div><div class="tt">Connect an accepted client</div><div class="ts">Send them your practice code <b>${esc(RT.practice.code)}</b> — they enter it after signing up to join your practice and unlock coaching.</div></div></div>` : ''}
    </section>
    <div style="height:16px"></div>
    <style>
      .tg-l{display:block;font-size:11px;color:var(--text-3);margin:12px 0 5px;letter-spacing:.02em}
      #trainer-grow input,#trainer-grow textarea,.tg-of input,.tg-of textarea,.tg-of select{width:100%;background:var(--surface-2);border:1px solid var(--line);color:var(--text-1);border-radius:10px;padding:10px 12px;font:inherit}
      .tg-of{padding:12px 0;border-top:1px solid var(--line)}
      .tg-of .row2{display:flex;gap:8px}
    </style>
    `;
  },
  mount(root) {
    loadGrow();
    const pid = practiceId();
    const $ = (id) => root.querySelector('#' + id);
    const msg = (t, err) => { const m = $('tg-msg'); if (m) { m.textContent = t; m.style.color = err ? 'var(--red-bright)' : 'var(--green-bright)'; } };

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
    }));
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
    <label class="tg-l">What's included (one per line)</label><textarea id="of-feat" placeholder="Weekly check-in&#10;Direct meal feedback">${esc((o.features || []).join('\n'))}</textarea>
    <label class="tg-l" style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="of-active" ${o.active === false ? '' : 'checked'} style="width:auto"> Visible on your page</label>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn green sm" data-tg="osave" data-id="${esc(o.id || 'new')}" style="width:auto;padding:0 16px;height:34px">Save offer</button>
      <button class="btn ghost sm" data-tg="cancel" style="width:auto;padding:0 14px;height:34px">Cancel</button>
      ${o.id ? `<button class="btn ghost sm" data-tg="del" data-id="${esc(o.id)}" style="width:auto;padding:0 12px;height:34px;color:var(--red-bright);margin-left:auto">Delete</button>` : ''}
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
