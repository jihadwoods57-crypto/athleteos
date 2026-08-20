/* Become an OnStandard Coach — the application AND its status, one screen. Editable while
   draft/info_needed (auto-created on first save), read-only progress otherwise. Approval is
   human: everything here lands in the Command Center queue, and only the admin RPC can flip
   status — this screen never asserts anything about outcomes. */
import { backHead, esc, errorState, skeletonRows } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { roleNav } from '../state.js';
import { track, EVENTS } from '../analytics.js';
import { isApplicationEditable } from '../marketplace-rules.js';

const CATS = [
  { key: 'accountability', label: 'Accountability coach', sub: 'Consistency, habits, follow-through. No credential needed — trained on the OnStandard method.', locked: true },
  { key: 'cpt', label: 'Certified personal trainer', sub: 'NASM, ACE, ISSA or equivalent — upload the certificate below.' },
  { key: 'snc', label: 'Strength & conditioning', sub: 'CSCS or equivalent — upload the certificate below.' },
];
const STATUS_COPY = {
  submitted: { t: 'Application received', s: 'A person on the OnStandard team reviews every application. We usually respond within a few days.' },
  under_review: { t: 'Under review', s: 'Your application is being reviewed right now. Nothing more is needed from you yet.' },
  info_needed: { t: 'We need a little more', s: 'Update your application below and submit again — check your email for what was missing.' },
  approved: { t: 'You’re in — welcome to the Partner Program', s: 'Set up your listing: your headline, plans and pricing. Publish when you’re ready to take clients.' },
  rejected: { t: 'Not this time', s: 'We couldn’t approve this application. You’re welcome to reach out to support if you believe we got it wrong.' },
};

let G = { app: null, loaded: false, failed: false };
let UI = { saving: false, submitting: false, uploading: null, msg: '', err: '' };

async function load(force) {
  if (G.loaded && !force) return;
  const app = await roles.fetchMyCoachApplication();
  // { error:true } = the read FAILED. Rendering the blank application form to a coach whose
  // application is submitted or approved misstates their standing and invites a duplicate.
  G = (app && app.error) ? { app: G.app, loaded: true, failed: true } : { app, loaded: true, failed: false };
  if (window.__render) window.__render();
}

function field(id, label, value, placeholder, textarea) {
  const labelHtml = `<label for="${id}" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin:14px 0 6px">${label}</label>`;
  return textarea
    ? `${labelHtml}<textarea id="${id}" placeholder="${esc(placeholder)}" style="width:100%;min-height:84px;border-radius:var(--r-card-sm);background:var(--surface-1);border:1.5px solid var(--hairline);color:var(--text);font-family:var(--font);font-size:15px;padding:12px 14px;outline:none;resize:vertical">${esc(value || '')}</textarea>`
    : `${labelHtml}<input id="${id}" class="ob-input" value="${esc(value || '')}" placeholder="${esc(placeholder)}">`;
}

function editableForm(a) {
  const cats = (a && a.categories) || ['accountability'];
  const creds = (a && a.credentials) || [];
  return `
    <div class="eyebrow">About you</div>
    <section class="card" style="padding:16px">
      ${field('ca-legal', 'Legal name (never shown publicly)', a && a.legal_name, 'Your full legal name')}
      ${field('ca-name', 'Coaching name (what clients see)', a && a.display_name, 'How you want to appear in the directory')}
      ${field('ca-bio', 'Who you are as a coach', a && a.bio, 'Who you coach, what keeps your clients consistent, what working with you feels like… (40+ characters)', true)}
      ${field('ca-exp', 'Relevant experience', a && a.experience, 'Years coaching, clients kept on track, programs run… (20+ characters)', true)}
      ${field('ca-style', 'Coaching style, comma-separated', a && a.style, 'direct, encouraging, structured')}
      ${field('ca-langs', 'Languages, comma-separated', (a && a.languages || []).join(', '), 'English, Spanish')}
      ${field('ca-tz', 'Time zone', a && a.timezone, 'America/New_York')}
      <label for="ca-cap" style="display:block;font-size:12.5px;font-weight:700;color:var(--text-2);margin:14px 0 6px">Client capacity (how many you can genuinely serve)</label>
      <input id="ca-cap" class="ob-input" type="number" min="1" max="100" value="${esc(String((a && a.capacity) || 10))}">
    </section>

    <div class="eyebrow">What you're applying as</div>
    <section class="card" style="padding:6px 16px">
      ${CATS.map((c) => {
        const on = cats.includes(c.key);
        const cred = creds.find((x) => x.category === c.key);
        return `
      <div class="lrow" ${c.locked ? 'style="cursor:default"' : `data-ca-cat="${c.key}"`}>
        <div class="lic"${on ? ' style="background:var(--blue-bright);color:var(--ink-on-accent)"' : ''}>${icon(on ? 'check' : 'shield', 16)}</div>
        <div class="lm"><div class="lt">${c.label}</div><div class="ls">${c.sub}</div>
          ${on && !c.locked ? (cred
            ? `<div class="ls" style="margin-top:3px;color:var(--green-bright)">${icon('check', 12)} ${esc(cred.title || 'Document uploaded')} · ${cred.status === 'verified' ? 'verified' : 'awaiting review'}</div>`
            : `<div style="margin-top:6px"><input type="file" id="ca-doc-${c.key}" accept="image/*,.pdf" style="display:none">
               <button class="btn ghost micro" data-ca-upload="${c.key}" style="width:auto">${UI.uploading === c.key ? 'Uploading…' : 'Upload certificate'}</button></div>`) : ''}
        </div>
      </div>`; }).join('')}
    </section>

    <div class="eyebrow">The deal</div>
    <section class="card" style="padding:12px 16px;font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.7">
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} You stay inside your approved scope — accountability is coaching, not treatment</div>
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} Clients, payments and communication stay on OnStandard</div>
      <div>${icon('check', 14, 'style="color:var(--green-bright)"')} You follow the safeguarding and communication policies</div>
      <div class="ls" style="margin-top:6px">Submitting is your agreement to all three.</div>
    </section>

    <div style="padding:0 16px 14px">
      ${UI.err ? `<div style="color:var(--red);font-size:12.5px;font-weight:600;padding-bottom:8px">${esc(UI.err)}</div>` : ''}
      ${UI.msg ? `<div style="color:var(--green-bright);font-size:12.5px;font-weight:600;padding-bottom:8px">${esc(UI.msg)}</div>` : ''}
      <div style="display:flex;gap:10px">
        <button class="btn ghost sm" data-ca-save style="width:auto;padding:0 18px">${UI.saving ? 'Saving…' : 'Save draft'}</button>
        <button class="btn primary sm" data-ca-submit style="width:auto;padding:0 18px">${UI.submitting ? 'Submitting…' : 'Submit application'}</button>
      </div>
    </div>`;
}

function statusView(a) {
  const c = STATUS_COPY[a.status] || STATUS_COPY.submitted;
  const approved = a.status === 'approved';
  return `
    <section class="state-demo"><div class="sd-ic" style="color:${approved ? 'var(--green-bright)' : a.status === 'rejected' ? 'var(--red)' : 'var(--blue-bright)'}">${icon(approved ? 'check' : a.status === 'rejected' ? 'x' : 'clipboard', 24)}</div>
    <div class="sd-t">${c.t}</div><div class="sd-s">${c.s}</div>
    ${approved ? `<div class="sd-cta"><button class="btn primary sm" data-go="coach-listing-editor" style="width:auto;padding:0 20px">Set up your listing</button></div>` : ''}</section>
    ${(a.credentials || []).length ? `
    <div class="eyebrow">Your credentials</div>
    <section class="card" style="padding:6px 16px">
      ${(a.credentials).map((cr) => `
      <div class="lrow" style="cursor:default">
        <div class="lic"${cr.status === 'verified' ? ' style="background:var(--green-surface);color:var(--green-bright)"' : ''}>${icon('shield', 16)}</div>
        <div class="lm"><div class="lt">${esc(cr.title || cr.category.toUpperCase())}</div>
          <div class="ls">${cr.status === 'verified' ? 'Verified by OnStandard' : cr.status === 'rejected' ? 'Not accepted — contact support for why' : 'Awaiting review'}</div></div>
      </div>`).join('')}
    </section>` : ''}`;
}

export default {
  // Shared screen: an athlete OR a trainer can apply — render in the signed-in role's chrome.
  get nav() { return roleNav(); },
  render() {
    if (!G.loaded) return `${backHead('Become a coach', 'OnStandard Coach Partner Program', 'profile')}${skeletonRows(3, 'Loading your application')}`;
    if (G.failed && !G.app) {
      return `${backHead('Become a coach', 'OnStandard Coach Partner Program', 'profile')}
      ${errorState({
        title: "Couldn't check your application",
        body: 'If you already applied, your application is safe. Reconnect before starting a new one.',
        retryId: 'ca-retry',
      })}`;
    }
    const a = G.app;
    // Tested in marketplace-rules.test.mjs — a locally-merged object carries no `status`, and
    // reading that as "not editable" is what once flipped a never-submitted application to
    // "Application received" (3277745).
    const editable = isApplicationEditable(a);
    return `${backHead('Become a coach', 'OnStandard Coach Partner Program', 'profile')}
    ${editable ? `
    <section class="card pad">
      <div style="font-size:15.5px;font-weight:800">Get paid to hold people to their standard.</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Every application is reviewed by a person. Approved coaches get a listing in the directory, tools built for accountability, and payouts through Stripe.</div>
    </section>
    ${editableForm(a)}` : statusView(a)}`;
  },
  mount(root) {
    load();
    const caRetry = root.querySelector('#ca-retry');
    if (caRetry) caRetry.addEventListener('click', () => { G = { app: null, loaded: false, failed: false }; window.__render(); load(true); });
    const collect = () => ({
      legal_name: (root.querySelector('#ca-legal') || {}).value || '',
      display_name: (root.querySelector('#ca-name') || {}).value || '',
      bio: (root.querySelector('#ca-bio') || {}).value || '',
      experience: (root.querySelector('#ca-exp') || {}).value || '',
      style: (root.querySelector('#ca-style') || {}).value || '',
      languages: ((root.querySelector('#ca-langs') || {}).value || '').split(',').map((s) => s.trim()).filter(Boolean),
      timezone: (root.querySelector('#ca-tz') || {}).value || '',
      capacity: Math.max(1, Math.min(100, Number((root.querySelector('#ca-cap') || {}).value) || 10)),
      categories: (G.app && G.app.categories) || ['accountability'],
    });
    const save = async (quiet) => {
      UI.saving = true; UI.err = ''; UI.msg = '';
      const r = await roles.saveCoachApplication(collect());
      UI.saving = false;
      if (r && r.error) { UI.err = r.error; if (window.__render) window.__render(); return null; }
      G.app = { ...(G.app || {}), ...r };
      if (!quiet) { UI.msg = 'Draft saved'; if (window.__render) window.__render(); }
      return r;
    };
    root.querySelectorAll('[data-ca-cat]').forEach((el) => el.addEventListener('click', () => {
      const key = el.getAttribute('data-ca-cat');
      const cats = new Set((G.app && G.app.categories) || ['accountability']);
      if (cats.has(key)) cats.delete(key); else cats.add(key);
      cats.add('accountability');
      // keep what's typed: the form repaints from G.app, so fold the live field values in first.
      // collect() has no `status` field — without pinning it explicitly, a brand-new (never-saved)
      // application goes from G.app===null (editable) to a status-less object, and render()'s
      // `!a || a.status==='draft'` check reads that as NOT editable, flipping the screen to the
      // "submitted" status view before the applicant ever saved anything.
      G.app = { ...(G.app || {}), ...collect(), status: (G.app && G.app.status) || 'draft', categories: [...cats] };
      if (window.__render) window.__render();
    }));
    root.querySelectorAll('[data-ca-upload]').forEach((btn) => btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // the row itself toggles the category — an upload tap must not
      const key = btn.getAttribute('data-ca-upload');
      // the application row must exist before a credential can reference it
      const saved = G.app && G.app.id ? G.app : await save(true);
      if (!saved) return;
      const input = root.querySelector(`#ca-doc-${key}`);
      if (!input) return;
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        UI.uploading = key; if (window.__render) window.__render();
        const r = await roles.uploadCredential(G.app.id, key, file.name, file);
        UI.uploading = null;
        if (r && r.error) UI.err = r.error;
        else await load(true);
        if (window.__render) window.__render();
      };
      input.click();
    }));
    const saveBtn = root.querySelector('[data-ca-save]');
    if (saveBtn) saveBtn.addEventListener('click', () => save());
    const submitBtn = root.querySelector('[data-ca-submit]');
    if (submitBtn) submitBtn.addEventListener('click', async () => {
      if (UI.submitting) return;
      const saved = await save(true);
      if (!saved) return;
      UI.submitting = true; UI.err = '';
      if (window.__render) window.__render();
      const r = await roles.submitCoachApplication();
      UI.submitting = false;
      if (r && r.error) UI.err = r.error;
      else { G.app = { ...(G.app || {}), ...r }; track(EVENTS.MKT_APPLICATION_SUBMITTED); }
      if (window.__render) window.__render();
    });
  },
};
