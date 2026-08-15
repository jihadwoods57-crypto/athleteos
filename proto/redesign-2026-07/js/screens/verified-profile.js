/* Verified Profile: the athlete's side of the recruiter-facing public page (design
   docs/design/2026-08-11-verified-profile-design.md, migration 0199, verified-profile function).

   The page itself is web/landing/v.html and every number on it is computed server-side; this
   screen only carries the athlete's intent through the states that matter, in the order the
   athlete can fix them: not enabled (the all-or-nothing contract, in plain words, BEFORE the
   switch), building the record (30 logged days before publish exists), guardian consent for a
   minor, plan if the founder has flipped the paywall secret, then publish / live.

   Module shape mirrors monthly-report.js: CACHE + load() -> roles wrapper -> window.__render(). */
import { backHead, esc, skeletonRows, copyText } from '../components.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import * as roles from '../roles.js';
import { drawScoreCard, shareScoreCard, shareWeek, profileCardPayload } from '../share-card.js';
import { track, EVENTS } from '../analytics.js';

let CACHE = { st: null, loaded: false, busy: false, paywallFired: false, copied: false };

async function load(force) {
  if (CACHE.loaded && !force) return;
  CACHE.st = await roles.verifiedProfileStatus();
  CACHE.loaded = true;
  const st = CACHE.st;
  if (st && !st.error && st.requiresPlan && !st.paid && !CACHE.paywallFired) {
    CACHE.paywallFired = true;
    track(EVENTS.PAYWALL_VIEWED, { variant: 'verified_profile_locked', cadence: 'annual' });
  }
  if (window.__render) window.__render();
}

function fmtDate(iso) {
  if (!iso) return '';
  // UTC on purpose, matching the public page: the record's start date must read the same on the
  // athlete's phone and on a recruiter's laptop.
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function row(ic, title, sub, right) {
  return `<div class="lrow">
    <div class="lic">${icon(ic, 17)}</div>
    <div class="lm"><div class="lt">${esc(title)}</div><div class="ls">${esc(sub)}</div></div>
    ${right || ''}
  </div>`;
}

function contractCard() {
  return `<section class="card" style="padding:16px">
    <div class="tt" style="margin-bottom:6px">How it works, straight</div>
    <div class="ts" style="margin-bottom:10px">From the day you turn this on, every day counts. Recruiters see your whole record: the good months and the rough ones. You choose whether the page exists, never which weeks of it show. That is exactly why a coach can trust it.</div>
    <div class="ts" style="margin-bottom:10px">You can take the page down any time, in one tap, all of it. Turning it back on later keeps the same record; the clock never restarts.</div>
    <div class="ts">Nothing personal leaves the app: no meals, no photos, no locations, no schedule. The page shows your name, sport, team, and the numbers.</div>
  </section>`;
}

function progressCard(st) {
  const r = (st.profile && st.profile.record) || {};
  const have = r.daysOnRecord || 0;
  const need = st.minDays || 30;
  const pct = Math.min(100, Math.round((have / need) * 100));
  return `<section class="card" style="padding:16px">
    <div class="tt" style="margin-bottom:4px">Building your record</div>
    <div class="ts" style="margin-bottom:12px">A page goes live at ${need} logged days. One good week means nothing to a recruiter; a month of showing up does.</div>
    <div style="height:8px;border-radius:4px;background:var(--surface-3);overflow:hidden">
      <div style="height:100%;width:100%;border-radius:4px;background:var(--blue);transform-origin:left;transform:scaleX(${pct / 100})"></div>
    </div>
    <div class="ts" style="margin-top:8px">${have} of ${need} days on record${r.enabledAt ? `, counting since ${esc(fmtDate(r.enabledAt))}` : ''}</div>
  </section>`;
}

function previewCard(st) {
  const p = st.profile || {};
  const r = p.record || {};
  const acc = r.accountability;
  const stat = (k, v) => `<div style="flex:1;min-width:0"><div style="font-size:var(--t-2xl);font-weight:800;letter-spacing:-.02em">${v}</div><div class="ts">${esc(k)}</div></div>`;
  return `<section class="card" style="padding:16px">
    <div class="eyebrow" style="margin-bottom:8px">What recruiters will see</div>
    <div class="tt">${esc(p.name || 'Your name')}</div>
    <div class="ts" style="margin-bottom:14px">${esc([p.sport, p.position].filter(Boolean).join(' · '))}${p.team ? `${p.sport || p.position ? ' · ' : ''}${esc(p.team.name)}` : ''}</div>
    <div style="display:flex;gap:14px;margin-bottom:12px">
      ${stat('Days on record', r.daysOnRecord != null ? esc(r.daysOnRecord) : '—')}
      ${stat('At standard', r.onStandardPct != null ? esc(r.onStandardPct) + '%' : '—')}
      ${stat('30-day avg', r.avg30 != null ? esc(r.avg30) : '—')}
    </div>
    <div class="ts">${acc && acc.possible > 0 ? 'Plus your verified commitments: arrivals, roll calls, completions.' : 'No verified commitments yet. When your coach schedules them, they join the page automatically.'}${p.team && p.team.coachName ? ` Roster-verified under ${esc(p.team.coachName)}.` : ''}</div>
  </section>`;
}

export default {
  tab: 'profile',
  render() {
    const head = backHead('Verified Profile', 'Your record, where recruiters can check it', 'profile');
    if (!CACHE.loaded) {
      return `${head}${skeletonRows(3, 'Loading your Verified Profile')}`;
    }
    const st = CACHE.st || {};
    if (st.error) {
      return `${head}
      <section class="card" style="padding:16px">
        <div class="tt">Couldn't load your profile</div>
        <div class="ts" style="margin:6px 0 12px">${esc(st.error)}</div>
        <button class="btn ghost" id="vp-retry">Try again</button>
      </section>`;
    }

    // Not enabled: the contract comes BEFORE the switch, in words a 16-year-old reads once.
    if (!st.enabled) {
      return `${head}
      <section class="card" style="padding:16px">
        <div class="tt" style="margin-bottom:6px">One link that proves you show up</div>
        <div class="ts">A public page recruiters can open from your Twitter: days on record, your rate at standard, verified arrivals and roll calls. Computed by OnStandard, so it reads as proof, not a claim.</div>
      </section>
      ${contractCard()}
      <button class="btn primary" id="vp-enable" style="width:100%">Start my record</button>`;
    }

    const blocks = [];

    // The gates, in the order the athlete can fix them.
    if (st.minor && !st.consentOk) {
      blocks.push(`<section class="card" style="padding:16px">
        <div class="tt" style="margin-bottom:4px">A parent or guardian has to approve first</div>
        <div class="ts" style="margin-bottom:12px">Because a public page with your name on it is a big deal, and you're under 18. One email, one approve button.</div>
        <button class="btn ghost" data-go="guardian" style="width:100%">Send the approval request</button>
      </section>`);
    }
    if (st.requiresPlan && !st.paid) {
      blocks.push(`<section class="card" style="padding:16px">
        <div class="tt" style="margin-bottom:4px">The public page rides with Individual Plus</div>
        <div class="ts" style="margin-bottom:12px">Weekly share cards stay free for everyone. The live page recruiters can open is part of the plan that carries your portable record.</div>
        <button class="btn primary" data-go="paywall" style="width:100%">See plans</button>
      </section>`);
    }

    if (!st.eligible) {
      blocks.push(progressCard(st));
      blocks.push(previewCard(st));
      return head + blocks.join('');
    }

    if (!st.published) {
      blocks.push(previewCard(st));
      const gated = (st.minor && !st.consentOk) || (st.requiresPlan && !st.paid);
      if (!gated) {
        blocks.push(`<button class="btn primary" id="vp-publish" style="width:100%"${CACHE.busy ? ' disabled' : ''}>${CACHE.busy ? 'Publishing…' : 'Publish my page'}</button>
        <div class="ts" style="text-align:center;margin-top:8px">Live the moment you tap. Down in one tap whenever you say.</div>`);
      }
      return head + blocks.join('');
    }

    // Published: the link is the product now.
    const url = st.url || '';
    blocks.unshift(`<section class="card" style="padding:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--green)"></span>
        <div class="tt">Your page is live</div>
      </div>
      <div class="ts" style="margin-bottom:12px;word-break:break-all">${esc(url)}</div>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="vp-share" style="flex:1">Share my page</button>
        <button class="btn ghost" id="vp-copy" style="flex:1">${CACHE.copied ? 'Copied' : 'Copy link'}</button>
      </div>
    </section>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="vp-share-week" role="button" tabindex="0">
        <div class="lic">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Share this week</div><div class="ls">The weekly card, free forever, link rides along</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" id="vp-refresh" role="button" tabindex="0">
        <div class="lic">${icon('flip', 17)}</div>
        <div class="lm"><div class="lt">Refresh the preview card</div><div class="ls">Redraws the image your link unfurls with</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>`);
    blocks.push(previewCard(st));
    blocks.push(`<button class="btn ghost" id="vp-unpublish" style="width:100%;color:var(--red-bright)"${CACHE.busy ? ' disabled' : ''}>Take my page down</button>`);
    return head + blocks.join('');
  },

  mount(root) {
    load();
    const st = CACHE.st || {};
    const on = (id, fn) => { const el = root.querySelector(id); if (el) el.addEventListener('click', fn); };

    on('#vp-retry', () => { CACHE.loaded = false; load(true); if (window.__render) window.__render(); });
    on('#vp-enable', async () => {
      if (CACHE.busy) return; CACHE.busy = true;
      CACHE.st = await roles.verifiedProfileEnable();
      CACHE.busy = false; CACHE.loaded = true;
      if (window.__render) window.__render();
    });
    on('#vp-publish', async () => {
      if (CACHE.busy) return; CACHE.busy = true;
      if (window.__render) window.__render();
      const dataUrl = await drawScoreCard(profileCardPayload(st.profile && st.profile.record));
      const r = dataUrl ? await roles.verifiedProfilePublish(dataUrl) : { error: 'could not draw the card' };
      CACHE.busy = false;
      if (r && !r.error) { await load(true); } else { CACHE.loaded = true; if (window.__render) window.__render(); }
    });
    on('#vp-share', () => {
      const p = profileCardPayload(st.profile && st.profile.record);
      void shareScoreCard(p, `My verified record: ${st.url || ''}`);
    });
    on('#vp-copy', async () => {
      if (await copyText(st.url || '')) { CACHE.copied = true; if (window.__render) window.__render(); } // on failure the share sheet still works
    });
    on('#vp-share-week', () => {
      const pg = S.progress || {};
      const m = String(pg.onDays || '').match(/(\d+)\s+of\s+(\d+)/);
      void shareWeek({
        avg: pg.weekAvg != null ? pg.weekAvg : null,
        onDays: m ? Number(m[1]) : null,
        total: m ? Number(m[2]) : null,
        delta: typeof pg.weekDelta === 'string' ? pg.weekDelta : null,
      });
    });
    on('#vp-refresh', async () => {
      if (CACHE.busy) return; CACHE.busy = true;
      const dataUrl = await drawScoreCard(profileCardPayload(st.profile && st.profile.record));
      if (dataUrl) await roles.verifiedProfileRefreshCard(dataUrl);
      CACHE.busy = false;
      if (window.__render) window.__render();
    });
    on('#vp-unpublish', async () => {
      if (CACHE.busy) return; CACHE.busy = true;
      const r = await roles.verifiedProfileUnpublish();
      CACHE.busy = false;
      if (r && !r.error) await load(true); else if (window.__render) window.__render();
    });
  },
};
