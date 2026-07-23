import { S, RT, act, slotHasPhoto } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg, collapseSection } from '../components.js';
import { DAY, MEAL_KEYS } from '../day.js';
import { fetchMyDayReceipts } from '../roles.js';
import { warmMealPhotos, todayMealPhotoPath } from '../photo-store.js';
import { shouldNudge, nudgeSignature, nudgeData } from '../coach-nudge.js';

// Coach Voice nudge (0094 consumer): at most one in-flight request; the resolved text is cached on
// RT (persisted) keyed by the slipping-state signature, so we ask the model once per distinct state
// per day and never on a clean day or a team without Coach Voice configured (the edge fn returns
// null, which we cache too). Purely additive — absence leaves Home unchanged.
let nudgeInFlight = null;
function coachNudgeHtml(text) {
  return `
  <div class="trust" style="margin:12px 0 10px;background:linear-gradient(100deg, rgba(168,85,247,0.12), rgba(59,130,246,0.05));border-color:var(--purple-border, rgba(168,85,247,0.35))">
    <div class="ic" style="background:rgba(168,85,247,0.18);color:var(--purple-bright)">${icon('sparkle', 20)}</div>
    <div style="flex:1"><div class="tt" style="display:flex;align-items:center;gap:6px">Your coach<span class="status-pill muted" style="font-size:10px;padding:1px 6px">AI</span></div>
    <div class="ts">${esc(text)}</div></div>
  </div>`;
}
// Server-side render of a cached nudge whose signature still matches TODAY's state — no flash on
// re-render, and it self-drops the instant the state moves (a logged meal changes the signature).
function cachedNudge(e) {
  const c = RT.voiceNudge;
  if (!c || !c.text || !shouldNudge(e)) return '';
  return c.sig === nudgeSignature(String(DAY.date), e) ? coachNudgeHtml(c.text) : '';
}
function maybeCoachNudge(e) {
  const slot = typeof document !== 'undefined' ? document.getElementById('cv-nudge') : null;
  if (!slot) return;
  // Only ask when slipping, signed in, and attached to a team (a coach who could have a voice).
  if (!shouldNudge(e) || !RT.userId || !RT.team || !window.sb) return;
  const sig = nudgeSignature(String(DAY.date), e);
  const cached = RT.voiceNudge;
  if (cached && cached.sig === sig) { if (cached.text) slot.innerHTML = coachNudgeHtml(cached.text); return; }
  if (nudgeInFlight === sig) return;
  nudgeInFlight = sig;
  window.sb.functions.invoke('coach-voice-nudge', { body: { data: nudgeData(e, String(DAY.date)) } })
    .then(({ data }) => {
      nudgeInFlight = null;
      const text = data && typeof data.nudge === 'string' && data.nudge ? data.nudge : null;
      act.setVoiceNudge(sig, text);
      if (!text) return;
      const s = document.getElementById('cv-nudge');
      if (s) s.innerHTML = coachNudgeHtml(text);
    })
    .catch(() => { nudgeInFlight = null; });
}

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
    : `<div class="res-media icon" style="background:linear-gradient(150deg, ${c1}, ${c2});color:${fg}">${icon(a.icon || 'droplet', 30)}${a.noPhoto ? '<span class="res-nophoto">No photo submitted</span>' : ''}</div>`;
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
      <div class="xr"><div class="xa">Waiting to sync</div>
      <div class="xb">Your entry is saved and will upload automatically when you reconnect.</div></div>
    </div>`;
  }
  return '';
}

/* Trust Pass, compressed (founder call 2026-07-16): a purple shield in the header row —
   same 44px metrics as the bell — instead of a full-width card eating the fold. Tap opens
   a quick anchored popup with the essentials; "Full details" goes to the existing trust
   page. Renders ONLY while a real pass is active. */
function trustShield() {
  const t = S.trustPass;
  if (!t.active) return '';
  return `<div class="tp-wrap">
    <button class="iconbtn tp-btn" id="tp-btn" aria-expanded="false" aria-haspopup="true" aria-label="Trust Pass, day ${t.day} of ${t.length}. Show quick info">${icon('shield', 20)}</button>
    <div class="tp-pop" id="tp-pop" hidden>
      <div class="tp-h">${icon('shield', 15)} Trust Pass · <b>day ${t.day} of ${t.length}</b></div>
      <div class="tp-n">${esc(t.note)}</div>
      <div class="tp-link" data-go="trust">Full details ${icon('chevron', 14)}</div>
    </div>
  </div>`;
}

/* One line under the greeting that orients before the number does. */
function headSub(e) {
  if (e.celebration) return 'Locked in for today';
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
        <div class="xrow"><span class="status-pill ${S.tier.cls}">${S.tier.name}</span>${deltaChip(e.score)}</div>
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

/* The hero on a day that is still live but sub-passing: the score is climbing, not failing. Same
   signature ring, but the tier verdict is held — a neutral "In progress" chip + what's left to do,
   never "Off Standard", never a red down-delta. The real tier returns once the day is decided
   (home render gates this) or once a passing tier is earned. */
function inProgressHero(e) {
  const left = e.total - e.met;
  const toGo = left > 0 ? `${left} to go — your day is still open` : 'Log your first requirement to start your score';
  return `<section class="xhero" data-go="score-breakdown" role="button" aria-label="Daily Score ${e.score}, in progress. ${e.met} of ${e.total} completed. Open score breakdown">
    <div class="xh-main">
      ${scoreRing({ score: e.score, size: 102, stroke: 10, glow: false, showCenter: false, centerNum: true, uid: 'hero' })}
      <div class="xh-body">
        <div class="xh-k">Daily Score</div>
        <div class="xrow"><span class="status-pill" style="background:var(--surface-2);color:var(--text-2)">In progress</span></div>
        <div class="xh-line"><b>${e.met}</b> of <b>${e.total}</b> done</div>
        <div class="xh-flow">${esc(toGo)}</div>
      </div>
    </div>
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

// Streak ribbon removed (founder call 2026-07-16): the streak's home surfaces are the
// celebration screen and notifications — Home stays focused on score + next action.

function celebration(e) {
  return `<div class="xcelebwrap">
    <section class="hero" style="padding-bottom:8px">
      ${scoreRing({ score: e.score, delta: (S.scoreYesterday != null && e.score > S.scoreYesterday) ? `+${e.score - S.scoreYesterday} pts` : null, streak: S.streakDays > 0 ? `${S.streakDays} day streak` : null, tierName: S.tier.name, tierCls: S.tier.cls })}
    </section>
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px">You're OnStandard.</div>
    <div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:34ch;margin-top:5px">Every requirement is in.${S.streakDays > 0 ? ` Day <b>${S.streakDays}</b> of your streak locks at midnight.` : ' Your streak starts the moment today locks at midnight.'}</div>
    <div style="height:14px"></div>
    <div class="eyebrow" style="align-self:flex-start">Today's record</div>
    <div class="xrecord" style="width:100%;box-sizing:border-box">
      ${e.doneItems.map((d) => `<div class="xrec"><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace(/^Logged at /, ''))}</span></div>`).join('')}
    </div>
    ${RT.hydrationOz < 120 ? `<div style="width:100%;margin-top:10px"><div class="xrow-item" style="cursor:default"><div class="xico sm gray">${icon('droplet', 16)}</div><div class="xr"><div class="xa">Add water</div><div class="xb" id="home-water-sub">${RT.hydrationOz} of 120 oz — optional, still counts with coach</div></div><div class="water-btns"><span class="wb2" data-water="8">+8</span><span class="wb2" data-water="16">+16</span></div></div></div>` : ''}
  </div>`;
}

/* ---- First-day activation (no retroactive failure) ---- */
function fmtClock(m) {
  if (m == null) return '';
  const h24 = Math.floor(m / 60), mm = m % 60;
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/* The score hero on the athlete's activation day: an honest "Not scored yet" instead of a 0 /
   Off-Standard that would punish them for a day they just joined. Neutral ring (—), no tier,
   no "vs yesterday". Full scoring resumes the next local day. */
function notScoredHero() {
  return `<section class="xhero" style="cursor:default">
    <div class="xh-main">
      <div style="width:102px;height:102px;border-radius:50%;border:10px solid var(--surface-3);display:flex;align-items:center;justify-content:center;flex:0 0 auto">
        <span style="font-size:34px;font-weight:800;color:var(--text-3)">—</span></div>
      <div class="xh-body">
        <div class="xh-k">Daily Score</div>
        <div class="xrow"><span class="status-pill" style="background:var(--surface-2);color:var(--text-2)">Not scored yet</span></div>
        <div class="xh-flow">Ready to begin — your score starts with your next action.</div>
      </div>
    </div>
  </section>`;
}

/* The first real action on the activation day — points at the next actionable requirement
   (never a pre-activation window, which exec.js already excused), framed as a start, not a miss. */
function firstActionCard(n) {
  const isCheck = !n.proof || n.proof === 'check';
  const label = isCheck ? `Mark ${esc(n.title)} done` : `${VERB[n.proof]} ${esc(n.title)}`;
  const ctaIcon = isCheck ? 'check' : CTA_ICON[n.proof];
  return `<section class="xnow">
    <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Start here</span></div>
    <div class="xmain"><div class="xico gold">${icon(n.icon, 21)}</div>
      <div><div class="xt">${esc(n.title)}</div><div class="xwhy">Your score starts moving with your first log. ${whyHtml(n.why)}</div></div></div>
    <div style="height:10px"></div>
    <button class="xcta" data-go="${n.route}">${icon(ctaIcon, 18)} ${label}</button>
  </section>`;
}

/* The one sentence that makes first-day scoring feel fair — states the join time and that
   nothing before it counts. Cumulative goals (hydration) start fresh tomorrow. */
function fairnessNote(activationMin) {
  const t = fmtClock(activationMin);
  return `<div class="sidebox" style="margin-top:12px">
    <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
    <div><div class="tt">You're set up${t ? ` — you joined at ${t}` : ''}</div>
    <div class="ts">Anything scheduled before now won't count against you today. Hydration and your first full score start fresh tomorrow.</div></div>
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const e = S.exec;

    // First-day activation: the athlete's very first day reads "Not scored yet" — they can log
    // (and their coach sees it), but nothing is graded, overdue, or Off-Standard, and cumulative
    // goals defer to tomorrow. Pre-activation windows already resolve to "Not required" in exec.js.
    if (S.notYetScored) {
      const first = e.now;
      const done = e.doneItems;
      // e.next (the 2nd actionable item) lives in neither e.now nor e.later — without this it
      // vanished from the activation-day screen entirely (not in Start here, Later, Logged, or
      // Not counted). Surface it under "Later today", framed positively like the rest of day one.
      const upcoming = [...(e.next ? [e.next] : []), ...e.later].filter((i) => i.state !== 'not_required' && i.id !== 'hydration');
      const excused = e.items.filter((i) => i.state === 'not_required');
      const grp = (label, rows, opts) => rows.length
        ? `<div class="xgrp">${label}</div><div class="xgroup">${rows.map((i) => grow(i, opts || {})).join('')}</div>` : '';
      return `
      ${appHead('Your standard is ready', trustShield())}
      ${notScoredHero()}
      ${syncBanner()}
      ${first
          ? firstActionCard(first)
          : `<div class="sidebox"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 17)}</div><div><div class="tt">You're all set for today</div><div class="ts">Your first scored day begins tomorrow — rest up.</div></div></div>`}
      ${grp('Logged today', done, { checkIcon: true, chev: true })}
      ${grp('Later today', upcoming, { hidePill: false })}
      ${grp('Not counted today', excused)}
      ${fairnessNote(S.activation.activationMin)}
      <div style="height:12px"></div>`;
    }

    if (RT.day0 && !RT.day0Breakfast) {
      const rest = e.items.filter((i) => i.id !== 'breakfast');
      // A required window that already closed is NOT "Upcoming" — it split into its own
      // honestly-labeled, color-coded group (amber "Late" while the day is live, red "Missed"
      // once decided), exactly like the main Home render. Only items still ahead of the athlete
      // (open / not-yet-open / optional) stay under the literal "Upcoming" header.
      const lateRows = rest.filter((i) => i.required && i.state === 'overdue')
        .sort((a, b) => (a.window ? a.window.due : 1e9) - (b.window ? b.window.due : 1e9));
      const upcoming = rest.filter((i) => !(i.required && i.state === 'overdue'));
      return `
      ${appHead(headSub(e), trustShield())}
      ${(!S.dayDecided && S.tier.cls === 'r') ? inProgressHero(e) : hero(e)}
      ${syncBanner()}
      <section class="xnow">
        <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Start here</span></div>
        <div class="xmain"><div class="xico gold">${icon('camera', 21)}</div>
        <div><div class="xt">Log First Meal</div><div class="xwhy">Your score starts moving with your first log. <b>Nutrition · 50% of score.</b></div></div></div>
        <div style="height:10px"></div>
        <button class="xcta" data-go="camera">${icon('camera', 18)} Log First Meal</button>
      </section>
      ${lateRows.length ? `<div class="xgrp">${e.decided ? 'Missed today' : 'Late — still counts'}</div>${lateRows.map(row).join('')}` : ''}
      ${upcoming.length ? `<div class="xgrp">Upcoming</div>
      <div class="xgroup">${upcoming.map((i) => grow(i, { hidePill: i.state === 'locked' })).join('')}</div>` : ''}
      <div class="eyebrow">Recent Results</div>
      <div class="state-demo"><div class="sd-ic">${icon('camera', 24)}</div><div class="sd-t">No logs yet</div>
      <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div></div>
      <div style="height:8px"></div>`;
    }

    if (e.celebration) {
      return `
      ${appHead(headSub(e), trustShield())}
      ${celebration(e)}
      <div id="seen-row" style="width:100%"></div>
      ${recentResults()}
      <div style="height:20px"></div>`;
    }

    // ---- WS6: four zones instead of a free-stack of 10+ blocks. ----
    // Header (hero) → ONE attention card (priority: sync > injury; Trust Pass lives as the
    // header shield, never a card) → action ladder (overdue/NOW/Next open; Upcoming +
    // Completed collapsed by default) → below the fold (demoted rows + results).
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
    const attention = sync || injuryCard;
    // Whatever lost the attention slot demotes to a quiet one-line row below the ladder.
    const demoted = [
      attention !== injuryCard && RT.injured
        ? `<div class="xrow-item" data-go="injury"><div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('bolt', 16)}</div><div class="xr"><div class="xa">Injury mode active</div><div class="xb">Your Standard adapted while you heal</div></div><span class="xpill gold">On</span></div>` : '',
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
    ${appHead(headSub(e), trustShield())}
    ${(!S.dayDecided && S.tier.cls === 'r') ? inProgressHero(e) : hero(e)}
    <div id="seen-row"></div>
    ${attention}
    <div id="cv-nudge">${cachedNudge(e)}</div>
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
    // Coach Voice nudge: best-effort, fire-and-forget over today's deterministic exec state.
    maybeCoachNudge(S.exec);
    // Resolve today's stored meal photos (signed URLs) so Recent Results shows the real
    // plates after a reload — repaints once when the batch lands (spec §7.1).
    if (RT.userId) {
      warmMealPhotos(MEAL_KEYS.filter((k) => DAY.meals[k] && slotHasPhoto(k))
        .map((k) => todayMealPhotoPath(RT.userId, String(DAY.date), k)));
    }
    // Trust Pass shield popup: tap toggles; any tap outside closes. Listeners live on
    // elements inside this render, so they die with the next innerHTML swap — no stacking.
    const tpBtn = root.querySelector('#tp-btn');
    if (tpBtn) {
      const pop = root.querySelector('#tp-pop');
      const setOpen = (open) => { pop.hidden = !open; tpBtn.setAttribute('aria-expanded', String(open)); };
      tpBtn.addEventListener('click', (ev) => { ev.stopPropagation(); setOpen(pop.hidden); });
      const vp = root.querySelector('#viewport');
      if (vp) vp.addEventListener('click', (ev) => {
        if (!pop.hidden && !ev.target.closest('.tp-wrap')) setOpen(false);
      });
    }
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
