/* Verified Profile: the ONE screen for "what a recruiter can see about me".
   (design docs/design/2026-08-11-verified-profile-design.md, migration 0199/0200,
   verified-profile edge function; plus the discipline record from migration 0138.)

   WHY THIS SCREEN CARRIES TWO SECTIONS
   The athlete used to have two unrelated screens for the same question, each with its own
   sharing switch, and neither one mentioned the other: #verified-profile (the public page) and
   #verified-discipline (the discipline aggregate, reached from Settings). An athlete who turned
   one on had no way to know the other existed, let alone that it was still off. The two screens
   are folded together here, in that order, because that is the order a recruiter meets them: the
   page is the front door, the record is what the page is made of.

   THE TWO SWITCHES ARE NEVER MERGED. They are different server contracts and they release
   different things, so they stay two controls with two labels:

     1. The public page (0199/0200, verified-profile function). Publish / take down. Releases a
        PAGE at a public URL carrying the athlete's name, sport, team and headline numbers. The
        whole record or none of it; the athlete never picks the weeks.
     2. The discipline record (0138, verified_discipline(), profiles.share_verified_discipline via
        setShareDiscipline). Shared / Private. Releases FOUR NUMBERS to a recruiter who asks
        OnStandard for them. No page, no name, no URL. The server refuses the read outright while
        this switch is off, and the function is structurally incapable of returning an event, a
        location, a class name, a time of day, or a schedule.

   Turning one on does not turn the other on. Turning one off does not turn the other off. Both
   controls say so in their own copy, because a consent switch a reader can misattribute is worse
   than no switch at all.

   EACH SECTION OWNS ITS OWN LOADING AND ITS OWN FAILURE. CACHE is the page's status (one edge
   function call); VD is the discipline record (one RPC). A dead network on one renders that
   section's error and its retry and leaves the other section fully usable. That is the point of
   two caches rather than one combined fetch.

   The discipline read is lazy in the sense that costs something: it is module-scoped, so it runs
   ONCE per app session on the first render of its section, never again on a revisit, and never at
   all from any other screen. It is deliberately not folded into load() below, since a failed
   page-status read must not also cost the athlete their numbers.

   Module shape mirrors monthly-report.js: caches + load() -> roles wrapper -> window.__render(). */
import { backHead, esc, skeletonRows, errorState, copyText } from '../components.js';
import { icon } from '../icons.js';
import { S, RT } from '../state.js';
import * as roles from '../roles.js';
import { drawScoreCard, shareScoreCard, shareWeek, profileCardPayload } from '../share-card.js';
import { track, EVENTS } from '../analytics.js';
import { loadVerifiedDiscipline, setShareDiscipline, loadShareDiscipline, todayISO, shiftISO } from '../commitment-data.js';

let CACHE = { st: null, loaded: false, busy: false, paywallFired: false, copied: false };

/* The discipline record's own state, kept apart from CACHE on purpose (see the header).
   data: null while unread; failed: the read came back null, which is NOT "no record yet";
   share: null until the profile row lands, then true or false. */
let VD = { data: null, failed: false, share: null, shareLoaded: false };

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

/* The ONE stat tile both sections use. A single "no reading yet" dash literal lives here rather
   than once per section, which is also what keeps the file inside its dash ceiling. */
function stat(label, value, suffix = '') {
  const v = value == null ? '—' : esc(String(value)) + suffix;
  return `<div class="stat"><div class="v">${v}</div><div class="k">${esc(label)}</div></div>`;
}

function contractCard() {
  return `<section class="card pad">
    <div class="tt" style="margin-bottom:var(--s1h)">How it works, straight</div>
    <div class="ts" style="margin-bottom:var(--s2h)">From the day you turn this on, every day counts. Recruiters see your whole record: the good months and the rough ones. You choose whether the page exists, never which weeks of it show. That is exactly why a coach can trust it.</div>
    <div class="ts" style="margin-bottom:var(--s2h)">You can take the page down any time, in one tap, all of it. Turning it back on later keeps the same record; the clock never restarts.</div>
    <div class="ts">Nothing personal leaves the app: no meals, no photos, no locations, no schedule. The page shows your name, sport, team, and the numbers.</div>
  </section>`;
}

function progressCard(st) {
  const r = (st.profile && st.profile.record) || {};
  const have = r.daysOnRecord || 0;
  const need = st.minDays || 30;
  const pct = Math.min(100, Math.round((have / need) * 100));
  return `<section class="card pad">
    <div class="tt" style="margin-bottom:var(--s1)">Building your record</div>
    <div class="ts" style="margin-bottom:var(--s3)">A page goes live at ${need} logged days. One good week means nothing to a recruiter; a month of showing up does.</div>
    <div style="height:8px;border-radius:4px;background:var(--surface-3);overflow:hidden">
      <div style="height:100%;width:100%;border-radius:4px;background:var(--blue);transform-origin:left;transform:scaleX(${pct / 100})"></div>
    </div>
    <div class="ts" style="margin-top:var(--s2)">${have} of ${need} days on record${r.enabledAt ? `, counting since ${esc(fmtDate(r.enabledAt))}` : ''}</div>
  </section>`;
}

function previewCard(st) {
  const p = st.profile || {};
  const r = p.record || {};
  const acc = r.accountability;
  return `<section class="card pad">
    <h2 class="eyebrow" style="margin:0 0 var(--s2)">What recruiters will see on the page</h2>
    <div class="tt">${esc(p.name || 'Your name')}</div>
    <div class="ts" style="margin-bottom:var(--s3h)">${esc([p.sport, p.position].filter(Boolean).join(' · '))}${p.team ? `${p.sport || p.position ? ' · ' : ''}${esc(p.team.name)}` : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2h);margin-bottom:var(--s3)">
      ${stat('Days on record', r.daysOnRecord != null ? r.daysOnRecord : null)}
      ${stat('On standard', r.onStandardPct != null ? r.onStandardPct : null, '%')}
      ${stat('30-day avg', r.avg30 != null ? r.avg30 : null)}
    </div>
    <div class="ts">${acc && acc.possible > 0 ? 'Plus your verified commitments: roll calls and completed sessions.' : 'No verified commitments yet. When your coach schedules them, they join the page automatically.'}${p.team && p.team.coachName ? ` Roster-verified under ${esc(p.team.coachName)}.` : ''}</div>
  </section>`;
}

/* --------------------------------------------------------- section 1: the public page (0199) */

function pageSection() {
  if (!CACHE.loaded) return skeletonRows(3, 'Loading your Verified Profile');

  const st = CACHE.st || {};
  if (st.error) {
    // Log the raw failure; never print a server string ("JWT expired") as athlete-facing copy.
    console.warn('[verified-profile]', st.error);
    return errorState({
      title: "Couldn't load your public page",
      body: 'Check your connection and try again. Nothing was lost, and your discipline record below still works.',
      retryId: 'vp-retry',
    });
  }

  // Not enabled: the contract comes BEFORE the switch, in words a 16-year-old reads once.
  if (!st.enabled) {
    return `<section class="card pad">
      <div class="tt" style="margin-bottom:var(--s1h)">One link that proves you show up</div>
      <div class="ts">A public page recruiters can open from your Twitter: days on record, your rate at standard, verified roll calls and completed sessions. Computed by OnStandard, so it reads as proof, not a claim.</div>
    </section>
    ${contractCard()}
    <button class="btn primary" id="vp-enable" style="width:100%">Start my record</button>`;
  }

  const blocks = [];

  // The gates, in the order the athlete can fix them.
  if (st.minor && !st.consentOk) {
    blocks.push(`<section class="card pad">
      <div class="tt" style="margin-bottom:var(--s1)">A parent or guardian has to approve first</div>
      <div class="ts" style="margin-bottom:var(--s3)">Because a public page with your name on it is a big deal, and you're under 18. One email, one approve button.</div>
      <button class="btn ghost" data-go="guardian" style="width:100%">Send the approval request</button>
    </section>`);
  }
  if (st.requiresPlan && !st.paid) {
    blocks.push(`<section class="card pad">
      <div class="tt" style="margin-bottom:var(--s1)">The public page rides with Individual Plus</div>
      <div class="ts" style="margin-bottom:var(--s3)">Weekly share cards stay free for everyone. The live page recruiters can open is part of the plan that carries your portable record.</div>
      <button class="btn primary" data-go="paywall" style="width:100%">See plans</button>
    </section>`);
  }

  if (!st.eligible) {
    blocks.push(progressCard(st));
    blocks.push(previewCard(st));
    return blocks.join('');
  }

  if (!st.published) {
    blocks.push(previewCard(st));
    const gated = (st.minor && !st.consentOk) || (st.requiresPlan && !st.paid);
    if (!gated) {
      blocks.push(`<button class="btn primary" id="vp-publish" style="width:100%"${CACHE.busy ? ' disabled' : ''}>${CACHE.busy ? 'Publishing…' : 'Publish my page'}</button>
      <div class="ts center" style="margin-top:var(--s2)">Live the moment you tap. Down in one tap whenever you say. This publishes the page only; your discipline record below keeps its own switch.</div>`);
    }
    return blocks.join('');
  }

  // Published: the link is the product now.
  const url = st.url || '';
  blocks.unshift(`<section class="card pad">
    <div style="display:flex;align-items:center;gap:var(--s2);margin-bottom:var(--s1h)">
      <span class="status-pill g">Live</span>
      <div class="tt">Your page is live</div>
    </div>
    <div class="ts" style="margin-bottom:var(--s3);word-break:break-all">${esc(url)}</div>
    <div style="display:flex;gap:var(--s2h)">
      <button class="btn primary" id="vp-share" style="flex:1">Share my page</button>
      <button class="btn ghost" id="vp-copy" style="flex:1">${CACHE.copied ? 'Copied' : 'Copy link'}</button>
    </div>
  </section>
  <section class="card" style="padding:var(--s1h) var(--s4)">
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
  blocks.push(`<button class="btn danger" id="vp-unpublish" style="width:100%"${CACHE.busy ? ' disabled' : ''}>Take my page down</button>
  <div class="ts center" style="margin-top:var(--s2)">Takes the page down and nothing else. Your discipline record below stays exactly as you set it.</div>`);
  return blocks.join('');
}

/* ---------------------------------------------- section 2: the discipline record (0138) */

function disciplineBody() {
  // Loading, failed, and "no record yet" are three different facts on a recruiter-facing
  // surface. Four permanent dashes used to stand in for all three.
  if (VD.failed) {
    return errorState({
      title: "Couldn't load your discipline record",
      body: 'Nothing was lost, and your public page above is unaffected. Reconnect and it loads right here.',
      retryId: 'vd-retry',
    });
  }
  if (VD.data === null) return skeletonRows(2, 'Pulling your discipline record');

  const d = VD.data || {};
  const noRecord = ['on_time_arrival_pct', 'morning_response_pct', 'commitments_completed', 'accountability_pct']
    .every((k) => d[k] == null);

  return `<section class="card pad">
    <h2 class="eyebrow" style="margin:0 0 var(--s3)">Your record · last 90 days</h2>
    <div class="vc-stats">
      ${stat('On-time arrival', d.on_time_arrival_pct, '%')}
      ${stat('Morning response', d.morning_response_pct, '%')}
      ${stat('Commitments completed', d.commitments_completed)}
      ${stat('Accountability', d.accountability_pct, '%')}
    </div>
    ${noRecord ? `<div class="ts" style="margin-top:var(--s2h)">No verified commitments in the last 90 days yet. They appear here as your coach schedules them.</div>` : ''}
  </section>`;
}

function disciplineSection() {
  const on = VD.share === true;
  return `<h2 class="eyebrow">Your discipline record <span class="status-pill ${on ? 'g' : 'muted'}">${on ? 'Shared' : 'Private'}</span></h2>
  <section class="card pad">
    <div class="tt">Four numbers, released on their own</div>
    <div class="ts">A separate record with its own switch. This one has no page and no link: a recruiter asks OnStandard, and only if you have shared it do the four numbers below come back. Publishing the page above does not turn this on.</div>
  </section>
  ${disciplineBody()}
  <div class="sidebox mt">
    <div class="req-icon g s38">${icon('shield', 19)}</div>
    <div>
      <div class="tt">What is never shared</div>
      <div class="ts">Recruiters see the four numbers above and nothing else. Not where you were, not which building, not your class schedule, not what time you did anything, not any single day. There is no way for them to ask for it. The record simply doesn't contain it.</div>
    </div>
  </div>
  <section class="card pad" style="display:flex;align-items:center;gap:var(--s3);margin-top:var(--s3h)">
    <div style="flex:1">
      <div class="tt">Share my discipline record</div>
      <div class="ts">Off by default. Only you can turn it on, and you can turn it off any time. This switch covers the four numbers only, never the public page above.</div>
    </div>
    <button class="chip ${on ? 'on' : ''}" id="vd-share" aria-pressed="${on}">${on ? 'Shared' : 'Private'}</button>
  </section>`;
}

export default {
  tab: 'profile',
  render() {
    return `${backHead('Verified Profile', 'Your record, where recruiters can check it', 'profile')}
    <h2 class="eyebrow">Your public page</h2>
    ${pageSection()}
    ${disciplineSection()}`;
  },

  mount(root) {
    load();
    const st = CACHE.st || {};
    const on = (id, fn) => { const el = root.querySelector(id); if (el) el.addEventListener('click', fn); };

    /* ---- section 1: the public page (0199/0200) ---- */
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

    /* ---- section 2: the discipline record (0138). Its own fetch, its own retry, its own
           switch. Nothing below reads CACHE, so a dead page-status read leaves it working. ---- */
    const uid = RT.userId;
    if (uid && VD.data === null && !VD.failed) {
      loadVerifiedDiscipline(uid, shiftISO(todayISO(), -89), todayISO()).then((d) => {
        // null is the data layer's word for "the read failed"; never render it as a record.
        if (d === null) VD.failed = true; else VD.data = d;
        if (root.isConnected && window.__render) window.__render();
      });
    }
    on('#vd-retry', () => { VD.failed = false; if (window.__render) window.__render(); });

    /* The switch states the SERVER's answer, not this device's memory. Until 2026-09-06 the
       column was write-only, so a fresh install showed Private to an athlete whose record
       recruiters could still ask for. RT is the instant paint; the server read corrects it on
       arrival, and a failed read leaves whatever RT knew rather than inventing an off. */
    if (VD.share === null) VD.share = !!RT.shareVerifiedDiscipline;
    if (!VD.shareLoaded) {
      VD.shareLoaded = true;
      loadShareDiscipline().then((server) => {
        if (server === null || server === VD.share) return;
        VD.share = server;
        RT.shareVerifiedDiscipline = server;
        if (root.isConnected && window.__render) window.__render();
      }).catch(() => {});
    }
    const btn = root.querySelector('#vd-share');
    if (btn) btn.addEventListener('click', async () => {
      const next = !(VD.share === true);
      btn.disabled = true; btn.textContent = '…';
      const ok = await setShareDiscipline(next);
      btn.disabled = false;
      if (!ok) { if (window.__render) window.__render(); return; }
      VD.share = next;
      RT.shareVerifiedDiscipline = next;
      if (window.__render) window.__render();
    });
  },
};
