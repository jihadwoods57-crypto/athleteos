import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg, collapseSection } from '../components.js';
import { DAY } from '../day.js';
import { fetchMyDayReceipts } from '../roles.js';

// Per-type icon media tints (a photo-less card shows its own icon — never someone else's).
const ACT_MEDIA = {
  droplet: ['rgba(56,189,248,0.28)', 'rgba(37,99,235,0.16)', 'var(--cyan)'],
  moon: ['rgba(168,85,247,0.24)', 'rgba(59,130,246,0.10)', 'var(--purple-bright)'],
  scale: ['rgba(59,130,246,0.22)', 'rgba(37,99,235,0.10)', 'var(--blue-bright)'],
  utensils: ['rgba(245,165,36,0.22)', 'rgba(245,165,36,0.08)', 'var(--amber-bright)'],
};
// Micro-label above a non-quality result value — names what the number IS.
const RES_K = { 'Hydration': 'Total today', 'Morning Weight': 'This morning', 'Recovery Check-In': 'Status' };
/* Recent RESULTS card (2-up grid): photo or icon media, then the outcome as labeled
   key/value lines. Meals show BOTH numbers — Meal Quality (the plate read, tiered color)
   and the honest computed Daily Score credit — because keeping those two ideas separate
   is the core of how the product grades. */
function resCard(a) {
  const [c1, c2, fg] = ACT_MEDIA[a.icon] || ACT_MEDIA.droplet;
  const media = a.img && safeImg(a.img)
    ? `<div class="res-media" style="background-image:url('${safeImg(a.img)}')"></div>`
    : `<div class="res-media icon" style="background:linear-gradient(150deg, ${c1}, ${c2});color:${fg}">${icon(a.icon || 'droplet', 30)}</div>`;
  const metrics = a.qualityLabel
    ? `<div class="res-m"><span class="k">Meal Quality</span><span class="v ${a.vClass}">${a.value}<small>${a.unit}</small></span></div>
      ${a.impact > 0 ? `<div class="res-m"><span class="k">Daily Score</span><span class="v g">+${a.impact}</span></div>` : ''}`
    : `<div class="res-m"><span class="k">${RES_K[a.type] || 'Status'}</span><span class="v ${a.vClass}">${a.value}</span></div>`;
  return `<div class="res-card" ${a.route ? `data-go="${a.route}"` : ''}>
    ${media}
    <div class="res-body">
      <div class="res-t">${esc(a.type)}</div>
      <div class="res-time">${esc(a.time)}</div>
      ${metrics}
    </div>
  </div>`;
}
// Results are things that HAPPENED — a not-yet-submitted check-in isn't one.
// Lateral snap rail (founder call 2026-07-16): cards share one anatomy and height, the
// next card peeks at the screen edge, and scroll snaps card-to-card.
const recentResults = () => {
  const rows = S.activity.filter((a) => !a.dim);
  return rows.length ? `
    <div class="eyebrow">Recent Results <span class="link" data-go="progress">View all</span></div>
    <div class="res-rail">${rows.map(resCard).join('')}</div>` : '';
};

const whyHtml = (why) => esc(why).replace(/\*\*(.+?)\*\*/, '<b>$1</b>');

const VERB = { form: 'Complete', scale: 'Log', photo: 'Log', counter: 'Add' };
const CTA_ICON = { form: 'moon', scale: 'scale', photo: 'camera', counter: 'droplet' };

function nowCard(e) {
  const n = e.now;
  const od = n.state === 'overdue';
  // Closing-soon: inside the last 45 minutes the window itself becomes the message — the
  // label names it and the countdown breathes. "Due 8:30 PM" is a fact; "42 min left on a
  // closing window" is what actually gets a tired athlete to log.
  const closing = !od && n.minsLeft != null && n.minsLeft <= 45;
  // check-type / assigned items (no proof) read "Mark ⟨title⟩ done"
  const isCheck = !n.proof || n.proof === 'check';
  const label = isCheck ? `Mark ${esc(n.title)} done` : `${VERB[n.proof]} ${esc(n.title)}${od ? ' late' : ''}`;
  const ctaIcon = isCheck ? 'check' : CTA_ICON[n.proof];
  // Overdue already announces itself three ways (label + pill + "Late") — the pill is the
  // redundant one when it just repeats the label; keep it only when it says something new.
  // Closing-soon drops the pill too: "CLOSING SOON" + the hot countdown says it all.
  const pill = (od && String(n.pill).toUpperCase() === 'OVERDUE') || closing ? '' : `<span class="xpill ${n.color}">${n.pill}</span>`;
  return `<section class="xnow ${od ? 'red' : ''}${closing ? ' closing' : ''}">
    <div class="xlab"><span class="xl">${od ? 'OVERDUE' : closing ? 'NOW · CLOSING SOON' : 'NOW'}</span>${pill}</div>
    <div class="xmain">
      <div class="xico ${n.color}">${icon(n.icon, 21)}</div>
      <div><div class="xt">${esc(n.title)}</div><div class="xwhy">${whyHtml(n.why)}</div></div>
    </div>
    <div class="xcount">
      ${od ? `<span class="xcd">Late</span><span class="xdl">${esc(n.sub)}</span>`
           : `<span class="xcd" data-cd>${esc(n.countdown)}</span><span class="xdl">${esc(n.dueLabel)}</span>`}
    </div>
    <button class="xcta" data-go="${n.route}">${icon(ctaIcon, 18)} ${label}</button>
  </section>`;
}

// hidePill: inside the Later/Done collapse sections the pill often restates what the sub
// already says ("Upcoming" vs "Opens 6:00 PM", "Logged" vs "Logged 1:10 PM") — callers drop
// it there so every element on the row carries new information.
const row = (i, hidePill) => `<div class="xrow-item ${i.color === 'green' ? 'green' : i.color === 'red' ? 'red' : ''}" data-go="${i.route}">
    <div class="xico sm ${i.color}">${icon(i.icon, 17)}</div>
    <div class="xr"><div class="xa">${esc(i.title)}</div><div class="xb">${esc(i.sub)}</div></div>
    ${hidePill ? '' : `<span class="xpill ${i.color}">${i.pill}</span>`}
  </div>`;

/* Honest sync/consent banner. A provable minor awaiting guardian approval sees a "stays on this
   phone" prompt that routes to the guardian screen; a failed push (offline/RLS) shows "saved on
   your phone, not synced yet." Both replace the OLD silent console.warn — an athlete can no
   longer log all week into a void without knowing. Nothing renders when sync is fine. */
function syncBanner() {
  const issue = S.syncIssue;
  if (issue === 'blocked') {
    const em = S.consent.guardianEmail;
    return `<div class="lrow" data-go="guardian" style="margin:12px 0 10px;background:rgba(245,165,36,0.10);border:1px solid var(--amber-border);border-radius:14px;padding:12px 13px">
      <div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('lock', 16)}</div>
      <div class="xr"><div class="xa">${em ? 'Waiting on your parent' : 'One step before your day syncs'}</div>
      <div class="xb">${em ? 'Everything you log is safe on this phone until they approve.' : 'You’re under 18 — a parent approves before your day reaches your coach. Tap to send it.'}</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>`;
  }
  if (issue === 'error') {
    return `<div class="lrow" style="margin:12px 0 10px;background:rgba(59,130,246,0.08);border:1px solid var(--hairline);border-radius:14px;padding:12px 13px;cursor:default">
      <div class="xico sm gray">${icon('wifiOff', 16)}</div>
      <div class="xr"><div class="xa">Saved on your phone</div>
      <div class="xb">Not synced yet — we’ll keep trying. Your logs are safe and count locally.</div></div>
    </div>`;
  }
  return '';
}

// Tiered streak pill: while today isn't locked in yet, a 2+ day streak reads as "at risk"
// (amber, this week's grace already used) or "covered" (blue, grace still intact) instead of
// the flat passive 🔥-N-day badge — the badge should feel different the day it's actually on
// the line. Once today counts (or the streak hasn't started), the old passive pill returns.
function streakPill() {
  const st = S.streak;
  if (st.days >= 2 && !st.todayCounted) {
    return st.graceUsedRecently
      ? `<span class="stk-pill risk">${icon('flame', 11)} ${st.days}-DAY · AT RISK</span>`
      : `<span class="stk-pill safe">${icon('shield', 11)} ${st.days}-DAY · COVERED</span>`;
  }
  if (st.days >= 2 && st.todayCounted) {
    return `<span class="stk-pill secured">${icon('check', 11)} ${st.days}-DAY · SECURED</span>`;
  }
  return S.streakDays > 0 ? `<span style="font-size:11px;font-weight:700;color:var(--text-2)">🔥 ${S.streakDays} day streak</span>` : '';
}

/* One line under the greeting that orients before the number does. */
function headSub(e) {
  if (e.celebration) return 'Every requirement is in';
  const left = e.total - e.met;
  return `${left} requirement${left === 1 ? '' : 's'} remaining today`;
}

/* The single next move, named inside the score card. It deliberately repeats what the NOW
   card below is — the score card TELLS you, the NOW card is where you DO it. */
function nextLabel(e) {
  const n = e.now;
  if (n) return (!n.proof || n.proof === 'check') ? `Mark ${n.title} done` : `${VERB[n.proof]} ${n.title}`;
  const hydro = e.items.find((i) => i.id === 'hydration' && i.state === 'ready');
  if (hydro) return 'Complete hydration';
  const locked = e.later.find((i) => i.state === 'locked');
  if (locked) return `${locked.title} · ${locked.sub.charAt(0).toLowerCase()}${locked.sub.slice(1)}`;
  return '';
}

/* "▲ 8 vs yesterday" — trajectory against yesterday's REAL score. Renders nothing when
   there is no yesterday row (never compares against a different day) or the scores tie.
   Down-days show honestly in muted amber; never a screaming red. */
function deltaChip(score) {
  const y = S.scoreYesterday;
  if (y == null || score === y) return '';
  const up = score > y;
  return `<span class="xh-delta ${up ? 'up' : 'down'}">${icon(up ? 'arrowUp' : 'arrowDown', 11)} ${Math.abs(score - y)} <span class="m">vs yesterday</span></span>`;
}

/* The last score this Home render showed — lets the next render know a log just moved the
   number, so the hero can float an honest "+N". Module-level on purpose: survives route
   changes within the session, resets with a fresh page load (no stale cross-day pops). */
let lastHomeScore = null;

/* Entrance-choreography gate: the staggered settle plays only when the athlete ARRIVES at
   Home (fresh load or navigating back), never on the 30s exec-tick's in-place re-render.
   The router exposes no route-transition signal, so watch the hash ourselves: leaving Home
   arms the next mount; tick re-renders never touch the hash. */
let homeEntrance = true;
window.addEventListener('hashchange', () => {
  if ((location.hash || '#home').slice(1).split('/')[0] !== 'home') homeEntrance = true;
});

/* Daily Score hero — the score owns the screen. Ring keeps the signature green→teal→blue
   sweep (status lives in the tier pill, never in the ring color). Label, completion,
   ceiling, the four-part formula, and the next move all live inside the one card; the
   whole surface opens the breakdown (chevron + press state carry the affordance). */
function hero(e) {
  const next = nextLabel(e);
  // The formula bar is S.breakdown verbatim — the same values and accent colors as the
  // breakdown screen, so the two surfaces can never disagree. Segments sum to /100.
  // Deliberately UNLABELED (founder call 2026-07-16): the bar is a one-stroke teaser of
  // where the points sit; the tap-through breakdown owns names and numbers. No legend.
  const parts = S.breakdown;
  const segs = parts.filter((b) => b.earned > 0)
    .map((b) => `<i class="${b.accent}" style="width:${b.earned}%"></i>`).join('');
  const gain = lastHomeScore != null && e.score > lastHomeScore ? e.score - lastHomeScore : 0;
  lastHomeScore = e.score;
  return `<section class="xhero" data-go="score-breakdown" role="button" aria-label="Daily Score ${e.score}, ${S.tier.name}. ${e.met} of ${e.total} completed. Open score breakdown">
    <div class="xh-main">
      ${scoreRing({ score: e.score, size: 102, stroke: 10, glow: false, showCenter: false, centerNum: true, uid: 'hero' })}
      ${gain > 0 ? `<span class="xh-float" aria-hidden="true">+${gain}</span>` : ''}
      <div class="xh-body">
        <div class="xh-k">Daily Score</div>
        <div class="xrow"><span class="status-pill ${S.tier.cls}">${S.tier.name}</span>${deltaChip(e.score)}${streakPill()}</div>
        <div class="xh-line"><b>${e.met}</b> of <b>${e.total}</b> completed <span class="sep">·</span> max today <b>${e.possible}</b></div>
      </div>
      <span class="xstrip-chev">${icon('chevron', 16)}</span>
    </div>
    <div class="xh-formula">
      <div class="xf-bar" role="img" aria-label="Score parts: ${parts.map((b) => `${b.key} ${b.earned} of ${b.possible}`).join(', ')}">${segs}</div>
    </div>
    ${next ? `<div class="xh-next">${icon('arrowRight', 14)}<span>Next: <b>${esc(next)}</b></span></div>` : ''}
  </section>`;
}

/* Grouped-card row: Upcoming/Completed rows share ONE card, split by hairlines, instead of
   a stack of separate bordered cards. Completed rows read status-first (green check) with a
   chevron into the receipt. */
const grow = (i, { hidePill, chev, checkIcon } = {}) => `<div class="xg-row" data-go="${i.route}">
    <div class="xico sm ${i.color}">${icon(checkIcon ? 'checkCircle' : i.icon, 17)}</div>
    <div class="xr"><div class="xa">${esc(i.title)}</div><div class="xb">${esc(i.sub)}</div></div>
    ${hidePill ? '' : `<span class="xpill ${i.color}">${i.pill}</span>`}
    ${chev ? icon('chevron', 16, 'style="color:var(--text-3)"') : ''}
  </div>`;

/* Hydration as the NOW card when nothing required is actionable. ONE NOW system (founder
   call 2026-07-16): whatever holds the slot wears the same gold card with the internal NOW
   label — no separate green section header, no second design language. Hydration's
   optional-ness stays honest via the "Optional" pill, and its special powers (live progress
   + quick-adds + custom amount) live inside the card. Never rendered when a required item
   holds the NOW slot (hydration then stays a quiet Upcoming row). */
function hydroNow(h) {
  const pct = Math.min(100, Math.round(((h.oz || 0) / 120) * 100));
  return `<section class="xnow hyd-now">
    <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Optional</span></div>
    <div class="xmain">
      <div class="xico gold">${icon('droplet', 21)}</div>
      <div><div class="xt">Hydration</div><div class="xwhy" id="hyd-sub">${esc(h.sub)}</div></div>
    </div>
    <div class="hn-row">
      <div class="hn-bar" role="progressbar" aria-valuenow="${h.oz || 0}" aria-valuemin="0" aria-valuemax="120" aria-label="Hydration progress"><i id="hyd-fill" style="width:${pct}%"></i></div>
      <span class="hn-pct" id="hyd-pct">${pct}%</span>
    </div>
    <div class="hn-chips">
      <button class="hchip" data-water="8">+8 oz</button>
      <button class="hchip" data-water="16">+16 oz</button>
      <button class="hchip" data-water="24">+24 oz</button>
      <button class="hchip ghost" id="hyd-other" aria-expanded="false">Other</button>
    </div>
    <div class="hn-custom" id="hyd-custom" hidden>
      <input id="hyd-oz" type="number" inputmode="numeric" min="1" max="200" placeholder="How many oz?" aria-label="Ounces of water">
      <button class="hchip solid" id="hyd-add">Add</button>
    </div>
  </section>`;
}

// Streak-at-risk ribbon: a sibling of hero() (never a child — hero() owns
// data-go="score-breakdown" and a nested data-go would fight it, though the router's
// per-element stopPropagation would keep them independent regardless). Self-retires once
// today counts, the streak hasn't reached day 2, or the day is already a celebration (that
// path has its own "locks at midnight" copy — no double message).
function streakPrompt(e) {
  const st = S.streak;
  if (!(st.days >= 2 && !st.todayCounted) || e.celebration) return '';
  const strong = st.graceUsedRecently;
  // When every remaining requirement is time-locked (no now/overdue), a "Log …" CTA would be a
  // no-op promise — route to the score breakdown as "View standard" instead.
  const next = e.now || e.overdue[0] || null;
  const target = next ? next.route : 'score-breakdown';
  const title = strong ? `Your ${st.days}-day streak ends tonight` : `Keep your ${st.days}-day run alive`;
  const body = strong
    ? `This week’s grace day is already used — hit 80 before midnight or the streak resets.`
    : `Hit 80 before midnight to extend your ${st.days}-day run.`;
  return `<div class="streak-ribbon ${strong ? 'strong' : 'mild'}" data-go="${target}">
    <div class="sr-ic">${icon(strong ? 'flame' : 'shield', 18)}</div>
    <div class="sr-body"><div class="sr-t">${esc(title)}</div><div class="sr-s">${esc(body)}</div></div>
    <span class="sr-cta">${next ? `Log ${esc(next.title)}` : 'View standard'}</span>
  </div>`;
}

function celebration(e) {
  return `<div class="xcelebwrap">
    <section class="hero" style="padding-bottom:8px">
      ${scoreRing({ score: e.score, delta: (S.scoreYesterday != null && e.score > S.scoreYesterday) ? `+${e.score - S.scoreYesterday} pts` : null, streak: S.streakDays > 0 ? `${S.streakDays} day streak` : null, tierName: S.tier.name, tierCls: S.tier.cls })}
    </section>
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px">You're OnStandard.</div>
    <div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:34ch;margin-top:5px">Every requirement is in. Day <b>${S.streakDays}</b> of your streak locks at midnight.</div>
    <div style="height:14px"></div>
    <div class="eyebrow" style="align-self:flex-start">Today's record</div>
    <div class="xrecord" style="width:100%;box-sizing:border-box">
      ${e.doneItems.map((d) => `<div class="xrec"><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace(/^Logged at /, ''))}</span></div>`).join('')}
    </div>
    ${RT.hydrationOz < 120 ? `<div style="width:100%;margin-top:10px"><div class="xrow-item" style="cursor:default"><div class="xico sm gray">${icon('droplet', 16)}</div><div class="xr"><div class="xa">Add water</div><div class="xb" id="home-water-sub">${RT.hydrationOz} of 120 oz — optional, still counts with coach</div></div><div class="water-btns"><span class="wb2" data-water="8">+8</span><span class="wb2" data-water="16">+16</span></div></div></div>` : ''}
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const e = S.exec;

    if (RT.day0 && !RT.day0Breakfast) {
      const rest = e.items.filter((i) => i.id !== 'breakfast');
      return `
      ${appHead(headSub(e))}
      ${hero(e)}
      ${syncBanner()}
      <section class="xnow">
        <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Start here</span></div>
        <div class="xmain"><div class="xico gold">${icon('camera', 21)}</div>
        <div><div class="xt">Log First Meal</div><div class="xwhy">Your score starts moving with your first log. <b>Nutrition · 50% of score.</b></div></div></div>
        <div style="height:10px"></div>
        <button class="xcta" data-go="camera">${icon('camera', 18)} Log First Meal</button>
      </section>
      <div class="xgrp">Upcoming</div>
      <div class="xgroup">${rest.map((i) => grow(i, { hidePill: i.state === 'locked' })).join('')}</div>
      <div class="eyebrow">Recent Results</div>
      <div class="state-demo"><div class="sd-ic">${icon('camera', 24)}</div><div class="sd-t">No logs yet</div>
      <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div></div>
      <div style="height:8px"></div>`;
    }

    if (e.celebration) {
      const t = S.trustPass;
      return `
      ${appHead(headSub(e))}
      ${celebration(e)}
      <div id="seen-row" style="width:100%"></div>
      ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${esc(t.note)}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
      ${recentResults()}
      <div style="height:20px"></div>`;
    }

    // ---- WS6: four zones instead of a free-stack of 10+ blocks. ----
    // Header (strip + at-risk ribbon) → ONE attention card (priority: sync > injury > trust;
    // the losers demote to one-line rows below the fold) → action ladder (overdue/NOW/Next
    // open; Later + Done collapsed by default) → below the fold (demoted rows + activity).
    const t = S.trustPass;
    const nextRows = e.next ? [e.next] : [];
    const open = RT.homeOpenSections || {};

    // Attention slot — exactly one card. syncBanner returns '' when sync is fine.
    const sync = syncBanner();
    const injuryCard = RT.injured ? `
    <div class="trust" data-go="injury" style="cursor:pointer;margin:12px 0 10px;background:linear-gradient(100deg, rgba(245,165,36,0.14), rgba(59,130,246,0.05));border-color:var(--amber-border)">
      <div class="ic" style="background:rgba(245,165,36,0.2);color:var(--amber-bright)">${icon('bolt', 20)}</div>
      <div style="flex:1"><div class="tt">Injury mode · active</div>
      <div class="ts">Your Standard adapted. Rehab is on the list while you heal.</div></div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : '';
    const trustCard = t.active ? `<div class="trust" data-go="trust" style="margin:12px 0 10px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${esc(t.note)}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : '';
    const attention = sync || injuryCard || trustCard;
    // Whatever lost the attention slot demotes to a quiet one-line row below the ladder.
    const demoted = [
      attention !== injuryCard && RT.injured
        ? `<div class="xrow-item" data-go="injury"><div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('bolt', 16)}</div><div class="xr"><div class="xa">Injury mode active</div><div class="xb">Your Standard adapted while you heal</div></div><span class="xpill gold">On</span></div>` : '',
      attention !== trustCard && t.active
        ? `<div class="xrow-item" data-go="trust"><div class="xico sm green">${icon('shield', 16)}</div><div class="xr"><div class="xa">Trust Pass · day ${t.day} of ${t.length}</div><div class="xb">Camera-free today</div></div><span class="xpill green">Active</span></div>` : '',
    ].filter(Boolean).join('');

    // Hydration takes the NOW slot only when no required item holds it — the one actionable
    // thing on an otherwise-locked screen gets the inline control instead of hiding in a fold.
    const hydro = e.items.find((i) => i.id === 'hydration');
    const hydroIsNow = !e.now && hydro && hydro.state === 'ready';
    const upcoming = e.later.filter((i) => !(hydroIsNow && i.id === 'hydration'));

    const laterHtml = upcoming.length
      ? collapseSection('later', 'Upcoming', upcoming.length, `<div class="xgroup">${upcoming.map((i) => grow(i, { hidePill: i.state === 'locked' })).join('')}</div>`, open.later === true)
      : '';
    const doneHtml = e.doneItems.length
      ? collapseSection('done', 'Completed', e.doneItems.length, `<div class="xgroup">${e.doneItems.map((i) => grow(i, { hidePill: true, chev: true, checkIcon: true })).join('')}</div>`, open.done === true)
      : '';

    return `
    ${appHead(headSub(e))}
    ${hero(e)}
    <div id="seen-row"></div>
    ${streakPrompt(e)}
    ${attention}
    ${e.overdue.filter((o) => o.id !== (e.now && e.now.id) && o.id !== (e.next && e.next.id)).map(row).join('')}
    ${e.now ? nowCard(e) : hydroIsNow ? hydroNow(hydro) : ''}
    ${nextRows.length ? `<div class="xgrp">${e.next.state === 'overdue' ? 'Also overdue' : 'Next'}</div>${nextRows.map(row).join('')}` : ''}
    ${laterHtml}
    ${doneHtml}
    ${demoted}
    ${recentResults()}
    <div style="height:20px"></div>`;
  },
  mount(root) {
    animateRing(root);
    act.syncNotifications();
    // Entrance choreography: hero settles first, then each block ~45ms behind, done in
    // about a third of a second. Plays only on ARRIVAL (homeEntrance gate) — the exec
    // tick's in-place re-render never replays it. Reduced-motion skips entirely.
    const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (homeEntrance && !reduceMotion) {
      const view = root.querySelector('#view');
      if (view) Array.from(view.children).slice(0, 9).forEach((el, i) => {
        el.style.animation = `home-in .38s var(--ease-out) ${i * 45}ms backwards`;
      });
    }
    homeEntrance = false;
    // WS6: persist collapse state per section so the 30s exec-tick re-render (and tomorrow's
    // fresh render) honors what the athlete left open. `toggle` only fires on user changes,
    // never on the initial `open` attribute — no save loop.
    root.querySelectorAll('details.xcollapse').forEach((d) => {
      d.addEventListener('toggle', () => act.setHomeSection(d.getAttribute('data-sec'), d.open));
    });
    // One-tap water on Home (WS8): the highest-frequency micro-action used to cost two taps
    // and a sheet animation. Same in-place patch pattern as the Action Hub — no re-render
    // churn. patchWater covers BOTH surfaces (the NOW card and the celebration row): it
    // rewrites whichever sub is present, plus the NOW card's live % and bar fill.
    const patchWater = () => {
      const oz = RT.hydrationOz;
      for (const sel of ['#hyd-sub', '#home-water-sub']) {
        const s = root.querySelector(sel);
        if (s) { const t = s.textContent, i = t.indexOf(' of '); if (i >= 0) s.textContent = oz + t.slice(i); }
      }
      const pct = Math.min(100, Math.round((oz / 120) * 100));
      const p = root.querySelector('#hyd-pct'); if (p) p.textContent = `${pct}%`;
      const f = root.querySelector('#hyd-fill'); if (f) f.style.width = `${pct}%`;
      const bar = root.querySelector('.hn-bar'); if (bar) bar.setAttribute('aria-valuenow', String(oz));
    };
    const logWater = (oz) => {
      const before = RT.hydrationOz;
      act.addWater(oz);
      // Haptic grammar: a light tick per add; a distinct double-notch the moment the goal
      // is crossed (physical feedback is the premium tell — Fitness/Whoop class).
      try {
        if (navigator.vibrate) navigator.vibrate(before < 120 && RT.hydrationOz >= 120 ? [18, 60, 26] : 14);
      } catch { /* no-op */ }
      // Crossing the goal is a real state change (hydration flips to Completed) — the one
      // case where a full re-render is correct.
      if (RT.hydrationOz >= 120) { window.__render(); return; }
      patchWater();
    };
    root.querySelectorAll('[data-water]').forEach((btn) => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); logWater(+btn.getAttribute('data-water')); });
    });
    // "Other" reveals a real amount input inline — no prompt(), no detour.
    const other = root.querySelector('#hyd-other');
    if (other) other.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const c = root.querySelector('#hyd-custom');
      const show = c.hidden;
      c.hidden = !show;
      other.setAttribute('aria-expanded', String(show));
      if (show) { const inp = root.querySelector('#hyd-oz'); if (inp) inp.focus(); }
    });
    const addCustom = () => {
      const inp = root.querySelector('#hyd-oz');
      const oz = Math.round(+((inp && inp.value) || 0));
      if (!oz || oz < 1) return;
      if (inp) inp.value = '';
      logWater(Math.min(200, oz));
    };
    const addBtn = root.querySelector('#hyd-add');
    if (addBtn) addBtn.addEventListener('click', (ev) => { ev.stopPropagation(); addCustom(); });
    const ozInput = root.querySelector('#hyd-oz');
    if (ozInput) ozInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); } });
    // Coach-seen receipt (0043, athlete side): "something visibly came back" — the row shows
    // ONLY when a real linked human actually opened this day. Nothing is ever fabricated;
    // no receipts → no row. Fetched per-mount (cheap indexed read), injected async.
    const seenRow = root.querySelector('#seen-row');
    if (seenRow && RT.userId) {
      fetchMyDayReceipts(RT.userId, String(DAY.date)).then((rows) => {
        if (!rows.length || !seenRow.isConnected) return;
        const fmt = (iso) => {
          const d = new Date(iso);
          let h = d.getHours() % 12; if (h === 0) h = 12;
          return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
        };
        const first = rows[0];
        const who = (first.viewer_name || S.coach.name).trim() || S.coach.name;
        const extra = rows.length > 1 ? ` + ${rows.length - 1} more` : '';
        // Elevated 2026-07-16: a tinted card right under the score, not a whisper of a
        // text row — proof someone who matters opened the day is the core differentiator.
        seenRow.innerHTML = `
          <div class="seen-receipt">
            <span class="sic">${icon('eye', 15)}</span>
            <span class="stx"><b>${esc(who)}</b> saw your day${esc(extra)}</span>
            <span class="stm">${fmt(first.seen_at)}</span>
          </div>`;
      }).catch(() => { /* best-effort — the card simply doesn't render */ });
    }
    // Live loop: re-render when the derived state changes (minute ticks, state
    // transitions, day rollover). Cheap: derive → compare → maybe render. The router
    // clears window.__execTick on every route change.
    const key = () => {
      const e = S.exec;
      return JSON.stringify([e.now && e.now.id, e.now && e.now.countdown, e.met, e.celebration, e.overdue.map((o) => o.id), e.items.map((i) => i.id + ':' + i.state)]);
    };
    let last = key();
    let rolling = false;
    window.__execTick = setInterval(() => {
      const t = new Date();
      const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      if (iso !== String(DAY.date)) {
        // Day rolled over while the app was open: reload the real day, then repaint.
        if (rolling) return; // hydrate already in flight — the re-render resets this closure
        rolling = true;
        act.hydrateDay().then(() => window.__render()).catch(() => { rolling = false; });
        return;
      }
      const k = key();
      if (k !== last) { last = k; window.__render(); }
    }, 30000);
  },
};
