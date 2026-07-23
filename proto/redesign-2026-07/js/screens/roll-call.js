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

/* The most recent "couldn't confirm" reason, so the card can say WHY rather than just failing.
   Cleared on the next successful verification. */
let LAST_VERIFY_REASON = null;

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
    const line = d.stage === 'unverified' && LAST_VERIFY_REASON
      ? `Couldn’t verify — ${LAST_VERIFY_REASON}` : d.confirmLine;
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
  </section>`;
}

/** Shown instead of an empty slot when the fetch failed. "Nothing scheduled" and "we couldn't
 *  reach the server" mean opposite things to an athlete at 4:40 AM, and the app must not confuse
 *  them. Deliberately does NOT claim they're checked in, and points at the one thing that helps. */
export function commitmentOfflineCard() {
  return `<div class="xrow-item" data-go="home" style="border-color:var(--amber-border)">
    <div class="xico sm" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('bolt', 16)}</div>
    <div class="xr"><div class="xa">Can’t reach OnStandard</div>
    <div class="xb">If your coach scheduled a check-in, it isn’t loading — try again when you have signal.</div></div>
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
      const ok = await fn(el.getAttribute(attr));
      if (ok) { try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ } }
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
    if (r && r.within) { track(EVENTS.VC_ARRIVED, { source: 'manual' }); return true; }
    LAST_VERIFY_REASON = (r && r.reason) || null;
    track(EVENTS.VC_UNVERIFIED, { reason: LAST_VERIFY_REASON || 'unknown' });
    return true;
  })));
  root.querySelectorAll('[data-vc-open]').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    location.hash = `#/roll-call/${el.getAttribute('data-vc-open')}`;
  }));
}

/* ---------------------------------------------------------------- detail screen */

export default {
  tab: 'home',
  render({ sub }) {
    const row = VC.instance(sub);
    if (!row) {
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
    if (!VC.instance(sub)) {
      loadMine(true).then(() => { if (root.isConnected) window.__render && window.__render(); });
    }
    mountCommitmentCard(root, () => window.__render && window.__render());

    const dis = root.querySelector('#vc-dispute');
    if (dis) dis.addEventListener('click', async () => {
      dis.disabled = true; dis.textContent = 'Sending…';
      const ok = await disputeResponse(sub, 'Athlete reports this record is wrong.');
      if (ok) { track(EVENTS.VC_DISPUTED, {}); window.__render && window.__render(); }
      else { dis.disabled = false; dis.textContent = 'Something wrong? Tell your coach'; }
    });
  },
};
