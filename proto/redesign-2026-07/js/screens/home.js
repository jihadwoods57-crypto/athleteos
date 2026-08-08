import { S, RT, act, slotHasPhoto, liveWeightPct } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, esc, safeImg, collapseSection, emailVerifyBanner, wireEmailVerifyBanner, emptyState } from '../components.js';
import { reveal } from '../motion.js';
import { maybeShowLock } from '../lock-moment.js';
import { DAY, MEAL_KEYS } from '../day.js';
import { fetchMyDayReceipts, fetchRecentMeals, signedMealPhotoUrl, daysAgoISO, todayISO } from '../roles.js';
import { warmMealPhotos, todayMealPhotoPath } from '../photo-store.js';
import { shouldNudge, nudgeSignature, nudgeData } from '../coach-nudge.js';
import { deriveCommitment } from '../commitments.js';
import { VC, loadMine, todayISO as vcToday } from '../commitment-data.js';
import { commitmentCard, mountCommitmentCard, commitmentOfflineCard } from './roll-call.js';
import { armIfPermitted } from './location-consent.js';
import { standardsCard, mountStandardsCard, standardsOfflineCard } from './connected-standards.js';
import { CS, loadMine as loadStandards, todayISO as csToday } from '../connected-standard-data.js';
import { maybeStartTour } from '../tour.js';
import { pressTilt } from '../tilt.js';

/* Verified Commitments on Home. Renders every commitment the athlete has today that is currently
   visible — usually zero or one, occasionally a roll call plus an afternoon study hall.
   commitmentCard() escapes every coach-authored string, so assigning its return value is the same
   discipline the rest of this file follows for rendered markup. */
function paintCommitments(root) {
  const slot = root.querySelector('#vc-slot');
  if (!slot) return;
  const paint = () => {
    if (!slot.isConnected) return;
    const now = new Date().toISOString();
    const html = VC.today(vcToday())
      .map((r) => commitmentCard(deriveCommitment(r, now)))
      .filter(Boolean).join('');
    // An outage must never render as "you have nothing scheduled". For an athlete whose coach is
    // counting on a 5:15 AM response, silence and a failed fetch look identical and mean opposite
    // things — so when the fetch failed and we have nothing cached, say so.
    slot.innerHTML = html || (VC.mineError ? commitmentOfflineCard() : '');
    if (html) mountCommitmentCard(slot, () => paintCommitments(root));
  };
  paint();                       // instant repaint from cache
  loadMine().then((rows) => {    // then reconcile with the server
    // Hand the rows to RT so state.js's exec derivation can plan commitment reminders. This is the
    // one place they cross over: commitment-data.js deliberately never imports state.js (the same
    // module cycle coach-data.js documents, which makes RT undefined at eval time in an ESM
    // WebView), so the screen that owns the fetch is what publishes the result.
    RT.vcRows = rows;
    paint();
    // Keep the OS watching only what is inside its window right now. No-op without background
    // permission (and on any build without expo-location), and it registers nothing for an
    // athlete with no located commitments today.
    if (rows.some((r) => r.asks_arrival)) armIfPermitted();
  });
}

/* Connected Standards on Home (0155). Same shape as the commitments slot above: paint instantly
   from cache, then reconcile with the server.

   The feature needs no client-side flag check. cs_enabled is enforced inside the materialize RPC
   and fails CLOSED, so with the feature off nothing is materialized, the payload is empty, and
   standardsCard() returns '' — the slot stays a zero-height div. */
function paintStandards(root) {
  const slot = root.querySelector('#cs-slot');
  if (!slot) return;
  const paint = () => {
    if (!slot.isConnected) return;
    const html = standardsCard(CS.mine, csToday());
    // An outage must never render as "you have no standards". For an athlete whose coach set a
    // deadline today, silence and a failed fetch look identical and mean opposite things.
    slot.innerHTML = html || (CS.mineError ? standardsOfflineCard() : '');
    if (html) mountStandardsCard(slot);
  };
  paint();
  loadStandards().then(() => {
    // Hand the rows to RT so state.js can plan progress-aware reminders and write the
    // days.tasks lane. connected-standard-data.js deliberately never imports state.js (the
    // module cycle coach-data.js documents), so the screen that owns the fetch publishes it.
    RT.csRows = CS.mine;
    paint();
  });
}

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
const RES_K = { 'Morning Weight': 'This morning', 'Recovery Check-In': 'Status' };
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
/* Client Home leads with the OUTCOME they hired a trainer for (a team athlete leads with the
   score ring + team frame instead — see hero() above). Entirely derived from S.weight, which
   the Progress screen already computes from real logged/historical rows — no new fetch, no
   invented number. Renders nothing until there's a real current AND a real starting point;
   never a placeholder "0.0 lb" on day one. Direction is never colored by sign (progress.js's
   own rule, `S.weight.pace` is the honest signal — a gain can be the goal or the setback
   depending on what the client is working toward). */
function outcomeBand() {
  if (S.audience !== 'client') return '';
  const W = S.weight;
  if (W.current == null || W.start == null) return '';
  const delta = Number(W.current) - W.start;
  const deltaLabel = Math.abs(delta) < 0.05 ? 'No change yet' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lb since you started`;
  const days = S.streakDays;
  return `<section class="card pad" data-go="progress" style="cursor:pointer;margin-top:12px">
    <div class="eyebrow" style="margin:0 0 8px">Your progress</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <div class="bigstat"><span class="n" style="font-size:30px">${esc(W.current)}<small style="font-size:13px;font-weight:700;color:var(--text-3)"> lb</small></span></div>
      ${W.pace ? `<span class="status-pill ${W.pace === 'On pace' ? 'g' : 'a'}">${W.pace}</span>` : ''}
    </div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(deltaLabel)}${W.target != null ? ` · goal ${W.target} lb` : ''}</div>
    ${days > 0 ? `<div style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:800;color:var(--amber-bright);margin-top:8px">${icon('flame', 14)}${days}-day streak</div>` : ''}
  </section>`;
}

/* Past-days activity (founder 2026-08-04): Recent Results shows up to THREE days, not just
   today. Real logged meals from the athlete's own `meals` rows, one fetch per mount per user
   (60s cache), photos signed onto the row; the mount repaints once when rows land. */
let PAST = { uid: null, rows: null, at: 0 };
async function warmPastResults(uid) {
  if (!uid || !window.sb) return;
  if (PAST.uid === uid && PAST.rows && Date.now() - PAST.at < 60000) return;
  const today = todayISO();
  const rows = (await fetchRecentMeals(uid, daysAgoISO(2)).catch(() => [])) || [];
  const past = rows.filter((r) => r && r.day_date && String(r.day_date) < today);
  await Promise.all(past.map(async (r) => {
    if (r.photo_path) r._img = await signedMealPhotoUrl(r.photo_path).catch(() => null);
  }));
  PAST = { uid, rows: past, at: Date.now() };
  if (/^#?(home)?$/.test(location.hash)) window.__render && window.__render();
}
const tsClock = (ts) => {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const h = ((d.getHours() + 11) % 12) + 1;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};
const pastDayLabel = (isoStr) => {
  const [y, m, dd] = String(isoStr).split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  if (isNaN(d)) return String(isoStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  return diff === 1 ? 'Yesterday'
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
};
/* Yesterday + the day before, each its own labeled rail.
   Routing: a past card opens `meal-view/<id>` — the read-only past-meal screen (trust.js), which
   renders from the fetched `meals` ROW and carries its own comment thread. It must NOT use
   `meal-detail/<slot>` like today's card: mealDetail() reads the in-memory DAY singleton, which is
   always TODAY, so a past slot would silently render today's plate under a "Yesterday" label.
   These cards used to route to `progress` to dodge exactly that — but the tap then dropped the
   athlete on a tab with no meal on it (and reset the nav stack getting there), which reads as the
   card being broken. `meal-view` is the destination that was always correct: Activity History and
   the push deep-links both already use it, and its mount falls back to fetchMealById() when the
   history cache is cold, so opening one straight from Home works on a fresh launch. */
const pastResults = () => {
  const rows = (PAST.uid === RT.userId && PAST.rows) ? PAST.rows : [];
  if (!rows.length) return '';
  const byDay = new Map();
  for (const r of rows) {
    const k = String(r.day_date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  return [...byDay.keys()].sort().reverse().slice(0, 2).map((d) => {
    const label = pastDayLabel(d);
    const cards = byDay.get(d).map((r) => {
      const clock = r.logged_at ? tsClock(r.logged_at) : '';
      return resCard({
        noPhoto: !r.photo_path,
        time: clock ? `${label} · ${clock}` : label,
        type: r.type || 'Meal', icon: 'utensils',
        value: r.quality != null ? String(r.quality) : 'Logged',
        unit: r.quality != null ? '/100' : null,
        qualityLabel: r.quality != null,
        vClass: r.quality != null ? (r.quality >= 80 ? 'g' : r.quality >= 50 ? 'a' : 'r') : 'muted',
        impact: 0,
        img: r._img || null,
        route: r.id ? `meal-view/${r.id}` : 'history',
      });
    }).join('');
    return `<div class="eyebrow" style="margin-top:14px">${esc(label)}</div><div class="res-rail">${cards}</div>`;
  }).join('');
};

const recentResults = () => {
  const rows = S.activity.filter((a) => !a.dim);
  const past = pastResults();
  if (!rows.length && !past) return '';
  return `
    ${rows.length ? `
    <div class="eyebrow">Recent Results <span class="link" data-go="progress">View all</span></div>
    <div class="res-rail">${rows.map(resCard).join('')}</div>` : `
    <div class="eyebrow">Recent Results <span class="link" data-go="progress">View all</span></div>`}
    ${past}`;
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
  // A missed day and a savable one are different facts, and this card used to paint them the same:
  // any 'overdue' state got the red treatment. exec.js is deliberate about this — a required window
  // past its close stays AMBER ("Late", still savable) until the day is DECIDED, and only then turns
  // red ("Missed"). Trusting n.color instead of the raw state is what keeps the card from arguing
  // with its own pill, which is how an athlete who can still fix their day saw the same alarm as one
  // who can't.
  const missed = od && n.color === 'red';
  // Overdue announced itself four ways at once (eyebrow + pill + a display-size "Late" + the sub).
  // The eyebrow names the state and the sub explains it; the pill only ever restated one of them,
  // so it goes in both overdue cases. Closing-soon drops it too: "CLOSING SOON" + the hot countdown
  // says it all.
  const pill = od || closing ? '' : `<span class="xpill ${n.color}">${n.pill}</span>`;
  return `<section class="xnow ${missed ? 'red' : ''}${closing ? ' closing' : ''}">
    <div class="xlab"><span class="xl">${od ? (missed ? 'MISSED' : 'LATE') : closing ? 'NOW · CLOSING SOON' : 'NOW'}</span>${pill}</div>
    <div class="xmain">
      <div class="xico ${n.color}">${icon(n.icon, 21)}</div>
      <div><div class="xt">${esc(n.title)}</div><div class="xwhy">${whyHtml(n.why)}</div></div>
    </div>
    <div class="xcount">
      ${od ? `<span class="xdl lead">${esc(n.sub)}</span>`
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
/* The "your record stays yours" card — the churn parachute. Renders on exactly one state: this
   account HAS been on a roster (RT.hadRoster, set only on a confirmed link) and now has none
   (both links confirmed empty). That is the moment an athlete's coach churned, they graduated,
   or they were removed — the highest-intent consumer conversion moment the product has, and
   until now nothing marked it. Once dismissed it never returns; an athlete who rejoins a roster
   simply stops matching. Honest by construction: the free record really does stay theirs — the
   card sells CONTINUING (Individual Plus's portable record + written coaching), not ransom. */
function keepRecordCard() {
  if (!RT.hadRoster || RT.keepRecordSeen) return '';
  if ((RT.myCoach && RT.myCoach.teamId) || (RT.myTrainer && RT.myTrainer.practiceId)) return '';
  return `<div class="lrow" id="keep-record" style="margin:12px 0 10px;background:linear-gradient(100deg, rgba(var(--green-rgb),0.10), rgba(var(--blue-rgb),0.05));border:1px solid var(--green-border);border-radius:14px;padding:12px 13px;cursor:pointer">
    <div class="xico sm green">${icon('shield', 16)}</div>
    <div class="xr"><div class="xa">Your record stays yours</div>
    <div class="xb" style="white-space:normal;line-height:1.45">Your roster ended — every day you proved is still here. Keep it going.</div></div>
    <span class="xpill green">Keep it</span>
  </div>`;
}

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
/* The greeting's second line. It deliberately does NOT restate progress: the score card owns
   that fact, and Home used to state it three times above the fold — here, "N of M done", and
   "N to go — your day is still open". Saying it once and giving the athlete their bearings
   instead is worth more than saying it three ways. */
function headSub(e) {
  if (e.celebration) return 'Locked in for today';
  const d = new Date();
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  const team = RT.myCoach && RT.myCoach.teamName;
  return team ? `${day} · ${team}` : day;
}

/* The single next move, named inside the score card. It deliberately repeats what the NOW
   card below is — the score card TELLS you, the NOW card is where you DO it. */
function nextLabel(e) {
  const n = e.now;
  if (n) return (!n.proof || n.proof === 'check') ? `Mark ${n.title} done` : `${VERB[n.proof]} ${n.title}`;
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
  // Signed. "↑ 82 vs yesterday" is a plausible SCORE, so on a big swing the delta could be read
  // as the number itself; "+82" cannot.
  return `<span class="xh-delta ${up ? 'up' : 'down'}">${icon(up ? 'arrowUp' : 'arrowDown', 11)} ${up ? '+' : '−'}${Math.abs(score - y)} <span class="m">vs yesterday</span></span>`;
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
/* `backdrop` means "this paint is scenery behind a sheet, not the screen the athlete is on."
   The only render-time side effect on this whole screen is the lastHomeScore write below, and
   consuming it from a backdrop paint would silently eat the "+N" float on the NEXT real render:
   the athlete logs a meal, the score moves, and the one moment that rewards them never fires.
   Guarding it is what makes it safe for #log to render the real day behind its scrim. */
function hero(e, backdrop = false) {
  const next = nextLabel(e);
  // The formula bar is S.breakdown verbatim — the same values and accent colors as the
  // breakdown screen, so the two surfaces can never disagree. Segments sum to /100.
  // Deliberately UNLABELED (founder call 2026-07-16): the bar is a one-stroke teaser of
  // where the points sit; the tap-through breakdown owns names and numbers. No legend.
  const parts = S.breakdown;
  const segs = parts.filter((b) => b.earned > 0)
    .map((b) => `<i class="${b.accent}" style="width:${b.earned}%"></i>`).join('');
  const gain = !backdrop && lastHomeScore != null && e.score > lastHomeScore ? e.score - lastHomeScore : 0;
  if (!backdrop) lastHomeScore = e.score;
  // data-band is gone along with the ambient wash it drove (screens.css) — the ring's own arc
  // gradient already carries the band, so the attribute had no reader left.
  return `<section class="xhero" data-tour="score" data-go="score-breakdown" role="button" aria-label="Daily Score ${e.score}, ${S.tier.name}. ${e.met} of ${e.total} completed. Open score breakdown">
    <div class="xh-main">
      ${scoreRing({ score: e.score, possible: e.possible, size: 128, stroke: 11, showCenter: false, centerNum: true, uid: 'hero' })}
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
  // ONE line, not two. This used to render "<b>N</b> of <b>M</b> done" and, beneath it,
  // "N to go — your day is still open" — the same fact twice, under a header that had already
  // said it a third time. The reassurance ("still open") is the part worth keeping; the count
  // carries it.
  // The "In progress" chip above already carries the reassurance that the day is not lost, so
  // this line is the count and nothing else. Home previously said it three ways above the fold.
  const line = e.met === 0 && left > 0
    ? 'Log your first requirement to start your score'
    : `<b>${e.met}</b> of <b>${e.total}</b> done today`;
  return `<section class="xhero" data-tour="score" data-go="score-breakdown" role="button" aria-label="Daily Score ${e.score}, in progress. ${e.met} of ${e.total} completed. Open score breakdown">
    <div class="xh-main">
      ${scoreRing({ score: e.score, possible: e.possible, size: 128, stroke: 11, showCenter: false, centerNum: true, uid: 'hero' })}
      <div class="xh-body">
        <div class="xh-k">Daily Score</div>
        <div class="xrow"><span class="status-pill inprog">In progress</span></div>
        <div class="xh-flow">${line}</div>
      </div>
      <span class="xstrip-chev">${icon('chevron', 16)}</span>
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

// Streak ribbon removed (founder call 2026-07-16): the streak's home surfaces are the
// celebration screen and notifications — Home stays focused on score + next action.

/* The day-complete hero. It used to be the ONE state where the score was not tappable: no
   data-go, no role, no aria-label, while the in-progress heroes above have all three. The record
   rows were inert divs too, and the FAB's sheet offered only "Close". So finishing every
   requirement — the exact behaviour this product exists to produce — was rewarded by the app
   going dead under your thumb, on the night you most want to look at your own numbers. */
function celebration(e) {
  return `<div class="xcelebwrap">
    <section class="hero" style="padding-bottom:8px" data-go="score-breakdown" role="button"
      aria-label="Daily Score ${e.score}, ${S.tier.name}. Every requirement complete. Open score breakdown">
      ${scoreRing({ score: e.score, tierName: S.tier.name, tierCls: S.tier.cls })}
    </section>
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px">You're OnStandard.</div>
    <!-- One meta line, no echoes: the ring already says the score and (by color) the tier; the
         record list below already proves every requirement is in. Everything left that's UNIQUE
         lives here — delta, streak day, and when it locks. -->
    <div style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-2);margin-top:6px">
      ${/* deltaChip(), not a second inline copy of it. The copy that lived here rendered ONLY when
            today beat yesterday, so a day where you completed everything and still came in lower
            showed no delta at all — the app quietly hiding the one number that says you slipped,
            on the screen celebrating you. deltaChip already handles a down-day honestly (muted
            amber, never a screaming red) and has since it was written ten lines above. */''}
      ${(() => { const d = deltaChip(e.score); return d ? `${d}<span style="opacity:.45">·</span>` : ''; })()}
      ${S.streakDays > 0
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-weight:700;color:var(--amber-bright)">${icon('flame', 13)} Day ${S.streakDays}</span><span style="opacity:.45">·</span><span>locks at midnight</span>`
        : `<span>your streak starts when today locks at midnight</span>`}
    </div>
    <div style="height:14px"></div>
    <div class="eyebrow" style="align-self:flex-start">Today's record</div>
    <div class="xrecord" style="width:100%;box-sizing:border-box">
      ${/* Each row opens the thing it logged, the same as its in-progress .xitem equivalent. They
            were inert divs, so on a complete day tapping your own dinner did nothing. */''}
      ${e.doneItems.map((d) => `<div class="xrec"${d.route ? ` data-go="${esc(d.route)}"` : ''}><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace(/^Logged at /, ''))}</span></div>`).join('')}
    </div>
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
    <div class="xlab"><span class="xl">NOW</span><span class="note">Start here</span></div>
    <div class="xmain"><div class="xico gold">${icon(n.icon, 21)}</div>
      <div><div class="xt">${esc(n.title)}</div><div class="xwhy">Your score starts moving with your first log. ${whyHtml(n.why)}</div></div></div>
    <div style="height:10px"></div>
    <button class="xcta" data-go="${n.route}">${icon(ctaIcon, 18)} ${label}</button>
  </section>`;
}

/* The one sentence that makes first-day scoring feel fair — states the join time and that
   nothing before it counts. */
function fairnessNote(activationMin) {
  const t = fmtClock(activationMin);
  return `<div class="sidebox" style="margin-top:12px">
    <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
    <div><div class="tt">You're set up${t ? ` — you joined at ${t}` : ''}</div>
    <div class="ts">Anything scheduled before now won't count against you today. Your first full score starts fresh tomorrow.</div></div>
  </div>`;
}

export default {
  tab: 'home',
  render({ backdrop = false } = {}) {
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
      const upcoming = [...(e.next ? [e.next] : []), ...e.later].filter((i) => i.state !== 'not_required');
      const excused = e.items.filter((i) => i.state === 'not_required');
      const grp = (label, rows, opts) => rows.length
        ? `<div class="xgrp">${label}</div><div class="xgroup">${rows.map((i) => grow(i, opts || {})).join('')}</div>` : '';
      return `
      ${appHead('Your standard is ready', trustShield())}
      ${emailVerifyBanner()}
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
      ${emailVerifyBanner()}
      ${(!S.dayDecided && S.tier.cls === 'r') ? inProgressHero(e) : hero(e, backdrop)}
      ${syncBanner()}
      <section class="xnow">
        <div class="xlab"><span class="xl">NOW</span><span class="note">Start here</span></div>
        <div class="xmain"><div class="xico gold">${icon('camera', 21)}</div>
        <div><div class="xt">Log First Meal</div><div class="xwhy">Your score starts moving with your first log. <b>Nutrition · ${liveWeightPct('nutrition')}% of score.</b></div></div></div>
        <div style="height:10px"></div>
        <button class="xcta" data-go="camera">${icon('camera', 18)} Log First Meal</button>
      </section>
      ${lateRows.length ? `<div class="xgrp">${e.decided ? 'Missed today' : 'Late — still counts'}</div>${lateRows.map(row).join('')}` : ''}
      ${upcoming.length ? `<div class="xgrp">Upcoming</div>
      <div class="xgroup">${upcoming.map((i) => grow(i, { hidePill: i.state === 'locked' })).join('')}</div>` : ''}
      <div class="eyebrow">Recent Results</div>
      ${emptyState({
    icon: 'camera',
    title: 'No logs yet',
    body: "Your proof trail builds here as you log. Take a photo to begin today's standard.",
    action: { label: 'Log a meal', go: 'camera' },
  })}
      <div style="height:8px"></div>`;
    }

    if (e.celebration) {
      return `
      ${appHead(headSub(e), trustShield())}
      ${emailVerifyBanner()}
      ${celebration(e)}
      ${outcomeBand()}
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
    // Keep-record joins the priority ladder LAST: a sync problem or an injury outranks a
    // conversion moment — pitching a membership over a broken sync would read as tone-deaf.
    const attention = sync || injuryCard || keepRecordCard();
    // Whatever lost the attention slot demotes to a quiet one-line row below the ladder.
    const demoted = [
      attention !== injuryCard && RT.injured
        ? `<div class="xrow-item" data-go="injury"><div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('bolt', 16)}</div><div class="xr"><div class="xa">Injury mode active</div><div class="xb">Your Standard adapted while you heal</div></div><span class="xpill gold">On</span></div>` : '',
    ].filter(Boolean).join('');

    const upcoming = e.later;

    const laterHtml = upcoming.length
      ? collapseSection('later', 'Upcoming', upcoming.length, `<div class="xgroup">${upcoming.map((i) => grow(i, { hidePill: i.state === 'locked' })).join('')}</div>`, open.later === true)
      : '';
    const doneHtml = e.doneItems.length
      ? collapseSection('done', 'Completed', e.doneItems.length, `<div class="xgroup">${e.doneItems.map((i) => grow(i, { hidePill: true, chev: true, checkIcon: true })).join('')}</div>`, open.done === true)
      : '';

    return `
    ${appHead(headSub(e), trustShield())}
    ${emailVerifyBanner()}
    ${(!S.dayDecided && S.tier.cls === 'r') ? inProgressHero(e) : hero(e, backdrop)}
    ${outcomeBand()}
    <div id="seen-row" data-tour="coach-seen"></div>
    <div id="vc-slot"></div>
    <div id="cs-slot" data-tour="standards"></div>
    ${attention}
    <div id="cv-nudge">${cachedNudge(e)}</div>
    ${e.overdue.filter((o) => o.id !== (e.now && e.now.id) && o.id !== (e.next && e.next.id)).map(row).join('')}
    ${e.now ? nowCard(e) : ''}
    ${nextRows.length ? `<div class="xgrp">${e.next.state === 'overdue' ? 'Also overdue' : 'Next'}</div>${nextRows.map(row).join('')}` : ''}
    ${laterHtml}
    ${doneHtml}
    ${demoted}
    ${recentResults()}
    <div style="height:20px"></div>`;
  },
  mount(root) {
    wireEmailVerifyBanner(root);
    // The hero score, revealed once per value. This was an unconditional animateRing(root), so
    // every async paint that reaches Home — commitments landing, standards landing, the coach
    // receipt arriving, the exec tick — wound the ring back to empty and re-counted the number from
    // zero. The signature moment played four times a visit, which is how it stopped reading as a
    // moment. Keying on the score (not just the day) keeps the part worth replaying: when the
    // number actually CHANGES because something was logged, it draws again.
    reveal(root, { key: `day:${DAY.date}:${S.exec.score}`, haptic: null });
    // The score hero answers a press with depth (tilt.js) — the one surface that earns it.
    pressTilt(root.querySelector('.xhero'));
    // Keep-your-record: tapping goes to the plans (Individual Plus is the portable-record pitch);
    // either way it is marked seen — a conversion card that nags is a churn card.
    const keep = root.querySelector('#keep-record');
    if (keep) keep.addEventListener('click', () => {
      act.markKeepRecordSeen();
      if (window.__go) window.__go('paywall'); else location.hash = '#paywall';
    });
    // Yesterday's answer. The app tells an athlete "Day N locks at midnight" the night before and
    // never followed up; this closes that loop, once, on the next open. Guarded on a persisted
    // marker, so calling it from every Home mount is safe. Says nothing when yesterday has no row.
    maybeShowLock(S.streakDays);
    act.syncNotifications();
    // Verified Commitments (0138): injected async into #vc-slot rather than rendered inline, so a
    // slow network never delays the score hero — the same seam #seen-row uses. An athlete with no
    // coach-scheduled commitments has an empty slot and Home is byte-identical to before.
    paintCommitments(root);
    // Connected Standards (0155): same async seam. An athlete with no activity standards — which
    // is everyone until a coach sets one or the feature is switched on — has an empty slot and
    // Home is byte-identical to before.
    paintStandards(root);
    // Coach Voice nudge: best-effort, fire-and-forget over today's deterministic exec state.
    maybeCoachNudge(S.exec);
    // Resolve today's stored meal photos (signed URLs) so Recent Results shows the real
    // plates after a reload — repaints once when the batch lands (spec §7.1).
    if (RT.userId) {
      warmMealPhotos(MEAL_KEYS.filter((k) => DAY.meals[k] && slotHasPhoto(k))
        .map((k) => todayMealPhotoPath(RT.userId, String(DAY.date), k)));
      // Past-days rails (up to 3 days of Recent Results) — fire-and-forget, repaints once.
      warmPastResults(RT.userId);
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
    // The first-run tour. Safe on every repaint — it is guarded by a singleton, a pending flag,
    // and a seen flag written at first paint, so the exec tick above can never restart it.
    maybeStartTour();
  },
};
