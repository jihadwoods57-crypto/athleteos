/* OnStandard — Verified Commitments, athlete side (0138).
   The Home card and its detail screen. One tap is the whole interaction: the athlete presses the
   coach's button, the server stamps the time, and the card collapses to a receipt.

   VOCABULARY: the athlete never sees the word "commitment". They see the coach's own title
   ("Morning Roll Call", "5 AM Club") and the linked event ("Practice at 6:00 AM"). Every string
   below that isn't structural comes from the coach's row — this file supplies no copy of its own
   beyond labels for state the coach didn't author.

   HONESTY: nothing here claims location proves work happened. "Arrived" means the phone reached
   the place; "Completed" is a separate signal. A failed verification reads "Couldn't verify",
   never "Missed", and always offers a way to say so. */
import { icon } from '../icons.js';
import { track, EVENTS } from '../analytics.js';
import { backHead, esc } from '../components.js';
import { deriveCommitment, TYPE_LABEL } from '../commitments.js';
import { VC, loadMine, ackCommitment, disputeResponse, completeCommitment } from '../commitment-data.js';
import { tapToVerify, armIfPermitted } from './location-consent.js';

/* Per-instance notes, keyed by instance id. A single global here once meant commitment A's
   failure reason painted onto commitment B's card the moment two shared a morning.
   VERIFY_REASON: the last "couldn't confirm" reason, cleared on the next successful verification.
   SAVE_FAILED: a write that came back dead, so the card can SAY so — a button that flashes
   "Saving…" and silently resets leaves an athlete at 4:48 AM not knowing if they're counted. */
const VERIFY_REASON = new Map();
const SAVE_FAILED = new Map();

const ICON_FOR = {
  morning_roll_call: 'sun', practice: 'bolt', strength: 'bolt', speed: 'bolt',
  team_meeting: 'users', study_hall: 'clipboard', tutoring: 'clipboard',
  class: 'clipboard', rehab: 'heart', nutrition: 'utensils',
};
const iconFor = (t) => ICON_FOR[t] || 'clipboard';

/* The three-stage strip. Only the stages this commitment actually asks for are drawn — a roll
   call shows one dot, a workout with a location shows three. */
function stageStrip(d) {
  if (!d.stages || d.stages.length < 2) return '';
  return `<div class="vc-stages" role="list">${d.stages.map((s) => `
    <div class="vc-stage ${s.done ? 'on' : ''}" role="listitem">
      <span class="vc-dot">${s.done ? icon('check', 11) : ''}</span>
      <span class="vc-sl">${esc(s.label)}</span>
      ${s.at ? `<span class="vc-st">${esc(s.at)}</span>` : ''}
    </div>`).join('')}</div>`;
}

/** The live card for Home. Returns '' when the commitment isn't visible yet (before it opens,
 *  or after the coach cancelled it) — Home renders nothing rather than an empty shell. */
export function commitmentCard(d) {
  if (!d || !d.visible) return '';
  const id = esc(d.instance_id || '');

  if (d.collapsed) {
    const cls = d.stage === 'excused' ? '' : 'green';
    const pill = d.stage === 'completed' ? 'Completed'
      : d.stage === 'excused' ? 'Excused' : 'In';
    return `<div class="xrow-item ${cls}" data-go="roll-call/${id}">
      <div class="xico sm" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 16)}</div>
      <div class="xr"><div class="xa">${esc(d.title)}</div>
      <div class="xb">${esc(d.confirmLine)}</div></div>
      <span class="xpill ${d.stage === 'excused' ? 'gray' : 'green'}">${pill}</span>
    </div>`;
  }

  if (d.stage === 'missed' || d.stage === 'unverified') {
    // Never the word "missed" on a verification failure — an absence of evidence is not evidence
    // of absence, and the detail screen offers a one-tap "I was there".
    const reason = d.stage === 'unverified' ? VERIFY_REASON.get(d.instance_id) : null;
    const line = reason ? `Couldn’t verify — ${reason}` : d.confirmLine;
    return `<div class="xrow-item" data-go="roll-call/${id}" style="border-color:var(--amber-border)">
      <div class="xico sm" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('bolt', 16)}</div>
      <div class="xr"><div class="xa">${esc(d.title)}</div>
      <div class="xb">${esc(line)}</div></div>
      <span class="xpill gold">${d.stage === 'unverified' ? 'Unverified' : 'No response'}</span>
    </div>`;
  }

  // Live: the coach's words own this card.
  const action = d.canAck ? `data-vc-ack="${id}"`
    : d.canArrive ? `data-vc-arrive="${id}"`
    : d.canComplete ? `data-vc-complete="${id}"` : '';
  const actionText = d.canAck ? d.actionLabel
    : d.canArrive ? (d.actionLabel && d.stage !== 'open' ? 'I’m here' : d.actionLabel)
    : 'Mark complete';
  const deadline = d.stage === 'awaiting_arrival' && d.arrive_by_min != null
    ? `Arrive by ${esc(d.deadlineLine.replace(/^Arrive by /, ''))}` : esc(d.deadlineLine);

  return `<section class="xnow vc-card" data-vc-open="${id}">
    <div class="xlab">
      <span class="xl">${esc((TYPE_LABEL[d.type] || 'Commitment').toUpperCase())}</span>
      ${deadline ? `<span class="xpill gold">${deadline}</span>` : ''}
    </div>
    <div class="xmain">
      <div class="xico gold">${icon(iconFor(d.type), 21)}</div>
      <div>
        <div class="xt">${esc(d.title)}</div>
        ${d.message ? `<div class="xwhy">${esc(d.message)}</div>` : ''}
      </div>
    </div>
    ${d.contextLine ? `<div class="vc-ctx">${icon('clock', 13)} ${esc(d.contextLine)}</div>` : ''}
    ${d.confirmLine && d.stage === 'awaiting_arrival' ? `<div class="vc-ctx">${icon('check', 13)} ${esc(d.confirmLine)}</div>` : ''}
    ${stageStrip(d)}
    ${action ? `<button class="xcta" ${action}>${icon('check', 18)} ${esc(actionText)}</button>` : ''}
    ${action && SAVE_FAILED.get(d.instance_id) ? `<div class="vc-ctx" style="color:var(--amber-bright)">${icon('bolt', 13)} ${esc(SAVE_FAILED.get(d.instance_id))}</div>` : ''}
  </section>`;
}

/** Shown instead of an empty slot when the fetch failed. "Nothing scheduled" and "we couldn't
 *  reach the server" mean opposite things to an athlete at 4:40 AM, and the app must not confuse
 *  them. Deliberately does NOT claim they're checked in, and points at the one thing that helps. */
export function commitmentOfflineCard() {
  /* Distinct title + a real Retry. This and the standards card were BOTH headlined "Can't reach
     OnStandard" — two identical alarms stacked on Home read as a broken app, not one offline
     moment, and neither offered recovery beyond navigating away and hoping. Each card now names
     the thing that failed and retries its own fetch (wired by the screen that painted it). */
  return `<div class="xrow-item" style="border-color:var(--hairline)">
    <div class="xico sm" style="background:var(--surface-2);color:var(--text-3)">${icon('wifiOff', 16)}</div>
    <div class="xr"><div class="xa">Coach check-in isn’t loading</div>
    <div class="xb">If your coach scheduled one, it shows the moment you reconnect. Nothing is lost.</div></div>
    <button class="btn ghost sm" data-vc-retry style="width:auto;padding:0 14px;height:34px;flex:none">Try again</button>
  </div>`;
}

/** Wire the card's actions. Called by whichever screen rendered it; re-renders on success so the
 *  card collapses to its receipt immediately.
 *
 *  A failure ALSO re-renders rather than restoring saved markup — the card rebuilds from the
 *  cache, which is both simpler and keeps this file free of innerHTML assignment. */
export function mountCommitmentCard(root, rerender) {
  const go = (attr, fn) => root.querySelectorAll(`[${attr}]`).forEach((el) => {
    el.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (el.disabled) return;
      el.disabled = true;
      el.textContent = 'Saving…';
      const id = el.getAttribute(attr);
      // A rejection must never strand the button on "Saving…" — the card rebuilds either way,
      // and a dead write leaves a note the card renders instead of resetting in silence.
      let ok = false;
      try { ok = await fn(id); } catch { ok = false; }
      if (ok) {
        SAVE_FAILED.delete(id);
        try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ }
      } else {
        SAVE_FAILED.set(id, 'Didn’t save. Check your signal and tap again.');
      }
      if (rerender) rerender();
    });
  });
  go('data-vc-ack', (id) => {
    const row = VC.instance(id) || {};
    return ackCommitment(id).then((at) => {
      if (at) track(EVENTS.VC_ACKNOWLEDGED, {
        type: row.type,
        // How early they answered, in minutes — the signal that says whether a deadline is set
        // somewhere useful or whether everyone is scrambling at the buzzer.
        minsEarly: row.respond_by_at
          ? Math.round((Date.parse(row.respond_by_at) - Date.parse(at)) / 60000) : null,
      });
      return !!at;
    });
  });
  go('data-vc-complete', (id) => completeCommitment(id, 'manual').then(Boolean));
  // "I'm here": one fix, compared on device, verdict written server-side. A NEGATIVE verdict is
  // recorded too — as 'unverified' with a reason, never as 'missed' — so the coach sees an honest
  // "couldn't confirm" instead of silence, and the athlete gets a dispute button.
  go('data-vc-arrive', (id) => tapToVerify(id).then((r) => loadMine(true).then(() => {
    if (r && r.within) { VERIFY_REASON.delete(id); track(EVENTS.VC_ARRIVED, { source: 'manual' }); return true; }
    VERIFY_REASON.set(id, (r && r.reason) || 'Couldn’t confirm your location');
    track(EVENTS.VC_UNVERIFIED, { reason: (r && r.reason) || 'unknown' });
    return true;
  })));
  root.querySelectorAll('[data-vc-open]').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    // No leading slash: router.js:86 parses the hash with `raw.split('/')`, so `#/roll-call/<id>`
    // yields an empty route name and silently falls back to Home. The static `data-go` paths in
    // this same file (:53, :66) already use the correct form.
    location.hash = `#roll-call/${el.getAttribute('data-vc-open')}`;
  }));
}

/* ---------------------------------------------------------------- detail screen */

/* Resolving the instance behind a deep link, at most once per id.
   `__render()` re-runs mount(), so an unguarded "not in cache → fetch → re-render" spins
   forever whenever the id never resolves — an instance the coach cancelled, one the nightly
   purge aged out, a push whose route carried an empty id, or simply being offline (loadMine
   swallows the failure and returns an empty list). It looped fast enough to starve the page's
   own event loop: the whole WebView stopped answering, including its own tab bar. Found
   2026-07-31 by the QC sweep, which could not so much as evaluate an expression on the page.
   One fetch in flight at a time, and no second attempt until the cache would have gone stale
   anyway — so an athlete who taps the push again after regaining signal still gets a real try. */
const RESOLVE = new Map();
const RESOLVE_COOLDOWN_MS = 30_000;

/** True when mount() should go to the server for this id. Marks the attempt as in flight. */
export function shouldResolve(sub, now = Date.now(), m = RESOLVE) {
  const k = String(sub || '');
  const s = m.get(k);
  if (s && (s.pending || now - s.at < RESOLVE_COOLDOWN_MS)) return false;
  m.set(k, { at: now, pending: true });
  return true;
}

/** The fetch for this id finished — in either direction. */
export function resolveDone(sub, m = RESOLVE) {
  const s = m.get(String(sub || ''));
  if (s) s.pending = false;
}

/** 'never' before we have asked, 'pending' while a fetch is in flight, 'settled' once one
 *  finished. render() uses it to tell "still loading" apart from "we looked, it's gone". */
export function resolveState(sub, m = RESOLVE) {
  const s = m.get(String(sub || ''));
  return !s ? 'never' : s.pending ? 'pending' : 'settled';
}

export default {
  tab: 'home',
  render({ sub }) {
    const row = VC.instance(sub);
    if (!row) {
      // We went to the server and still have nothing. Say so plainly and let them leave —
      // never sit on "Loading…" forever. A missing record is not a miss, and nothing here
      // counts against the athlete.
      if (resolveState(sub) === 'settled') {
        return `${backHead('Commitment', '', 'home')}
        <section class="card pad">
          <div class="tt">This commitment isn’t available</div>
          <div class="ts" style="padding-top:6px">Your coach may have cancelled it, or it’s old enough that we no longer keep the record. Nothing is counted against you.</div>
        </section>
        <div style="height:12px"></div>
        <button class="btn ghost" data-go="home" style="width:100%">Back to home</button>`;
      }
      return `${backHead('Commitment', 'Loading…', 'home')}
      <section class="card pad"><div class="ts">Loading your commitment…</div></section>`;
    }
    const d = deriveCommitment(row, new Date().toISOString());
    const asksArrival = !!row.asks_arrival;

    const line = (label, time, on) => `
      <div class="vc-line ${on ? 'on' : ''}">
        <span class="vc-dot">${on ? icon('check', 11) : ''}</span>
        <div class="vc-lt"><div class="vc-la">${esc(label)}</div>
        <div class="vc-lb">${on ? esc(time) : '—'}</div></div>
      </div>`;

    return `
    ${backHead(d.title, d.contextLine || TYPE_LABEL[row.type] || '', 'home')}

    ${d.message ? `<div class="coachnote"><p>${esc(d.message)}</p>
      <div class="ts" style="padding-top:6px">From ${esc(row.coach_name || 'your coach')}</div></div>
      <div style="height:12px"></div>` : ''}

    <div class="eyebrow">Today</div>
    <section class="card pad">
      ${line('Acknowledged', d.acknowledged_at ? new Date(d.acknowledged_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', !!row.acknowledged_at)}
      ${asksArrival ? line(`Arrived at ${row.location_name || 'the facility'}`, row.arrived_at ? new Date(row.arrived_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', !!row.arrived_at) : ''}
      ${row.type !== 'morning_roll_call' ? line('Completed', row.completed_at ? new Date(row.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', !!row.completed_at) : ''}
    </section>

    ${d.canAck ? `<div style="height:12px"></div>
      <button class="btn green" data-vc-ack="${esc(row.instance_id)}" style="width:100%">${icon('check', 19)} ${esc(d.actionLabel)}</button>` : ''}
    ${d.canComplete ? `<div style="height:12px"></div>
      <button class="btn green" data-vc-complete="${esc(row.instance_id)}" style="width:100%">${icon('check', 19)} Mark complete</button>` : ''}

    ${asksArrival ? `
    <div class="sidebox" style="margin-top:14px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 19)}</div>
      <div>
        <div class="tt">What arrival actually proves</div>
        <div class="ts">Your phone reached ${esc(row.location_name || 'the facility')} during the scheduled window — that's it. It does not mean the work got done, and nobody is claiming it does. Your location is checked only around this event and never stored.</div>
      </div>
    </div>
    <div style="height:10px"></div>
    <button class="btn ghost" data-go="location-consent" style="width:100%">${icon('target', 17)} How arrival check-in works</button>` : ''}

    ${(d.stage === 'unverified' || d.stage === 'missed' || row.arrived_at) && !row.disputed_at ? `
      <div style="height:14px"></div>
      <button class="btn ghost" id="vc-dispute" style="width:100%">Something wrong? Tell your coach</button>` : ''}
    ${row.disputed_at ? `<div style="height:14px"></div>
      <div class="ts" style="text-align:center">Reported — your coach can see this and correct it.</div>` : ''}
    <div style="height:20px"></div>`;
  },

  mount(root, { sub }) {
    if (!VC.instance(sub) && shouldResolve(sub)) {
      // Settle on BOTH outcomes: a rejection that left `pending` set would strand the screen
      // on "Loading…" with no attempt ever allowed again.
      const settle = () => {
        resolveDone(sub);
        if (root.isConnected) window.__render && window.__render();
      };
      loadMine(true).then(settle, settle);
    }
    mountCommitmentCard(root, () => window.__render && window.__render());

    const dis = root.querySelector('#vc-dispute');
    if (dis) dis.addEventListener('click', async () => {
      dis.disabled = true; dis.textContent = 'Sending…';
      const ok = await disputeResponse(sub, 'Athlete reports this record is wrong.');
      if (ok) { track(EVENTS.VC_DISPUTED, {}); window.__render && window.__render(); }
      // Name the failure — a button that quietly resets reads as "maybe it worked".
      else { dis.disabled = false; dis.textContent = 'Couldn’t send. Tap to try again'; }
    });
  },
};
