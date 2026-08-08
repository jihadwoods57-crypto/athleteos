import { S, liveWeightPct } from '../state.js';
import { DAY } from '../day.js';
import { icon } from '../icons.js';
import { esc, segBar } from '../components.js';
import home from './home.js';

/* The athlete's actual day, painted behind the sheet.

   #log is a transient ROUTE, not an overlay, so by the time the sheet slides up the router has
   already replaced the screen underneath it. The scrim's backdrop-filter therefore had nothing to
   blur and the sheet rose over a flat black void — a bottom sheet with nothing behind it doesn't
   read as a sheet, it reads as a broken modal.

   This paints Home's real markup behind the scrim. Two things make that safe:

   1. `backdrop: true` stops Home's one render-time side effect (the lastHomeScore write that
      drives the "+N" float) from firing, so a scenery paint can never eat the reward moment.
   2. Every interactive and identifying attribute is stripped from the STRING before it reaches
      the DOM. The router wires data-go / data-act / data-back on everything inside #device and
      does so BEFORE mount() runs, so there is no later hook to un-wire them from; and duplicate
      `id`s would break getElementById for the sheet's own controls. Removing them up front means
      no listeners are ever attached, no ids collide, and no `data-tour` anchor resolves to a
      hidden copy sitting earlier in the document. Scenery, and nothing else. */
const dayBackdrop = () => {
  let html;
  try { html = home.render({ backdrop: true }); }
  catch { return ''; }   // scenery must never take the sheet down with it
  return `<div class="sheet-backdrop" aria-hidden="true">${
    html.replace(/\s(?:data-(?:go|act|back|then|tour)|id|tabindex|role)="[^"]*"/g, '')
  }</div>`;
};

/* Action Hub — the FAB's execution dashboard. One question, always answered:
   "what is the single most important thing I should do right now?" */
export default {
  tab: 'camera',
  hideTabs: true,
  bleed: true,
  transient: true, // overlay sheet — closing returns to the exact origin, never a back-target itself
  render() {
    const e = S.exec;
    const segs = segBar(e.met, e.total, `${e.met} of ${e.total} completed today`, 'margin:0 2px 12px');
    // "92 → up to 92" was rendered verbatim on a complete day: an arrow from the score to
    // itself, on the surface that exists to answer "what should I do next". When nothing can
    // move the number, say the honest thing instead of drawing a pointless trajectory.
    const head = `<div class="hub-head"><span class="a">${e.met} of ${e.total} completed</span><span class="b">${e.possible > e.score ? `${e.score} → <em>up to ${e.possible}</em>` : `${e.score} · day complete`}</span></div>`;

    // Mirrors Home's syncBanner honesty (home.js syncBanner): the sheet is the primary write
    // surface, so a sync-blocked minor or a failed push needs the same feedback here, not silence.
    const issue = S.syncIssue;
    const syncRow = issue === 'blocked' ? `
      <div class="sheet-row" data-go="guardian">
        <div class="si" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('lock', 20)}</div>
        <div class="st"><div class="t">${S.consent.guardianEmail ? 'Waiting on your parent' : 'One step before your day syncs'}</div><div class="s">${S.consent.guardianEmail ? 'Everything you log is safe on this phone until they approve.' : 'You’re under 18 — a parent approves before your day reaches your coach. Tap to send it.'}</div></div>
        ${icon('chevron', 16, 'style="color:var(--text-3)"')}
      </div>` : issue === 'error' ? `
      <div class="sheet-row" style="cursor:default">
        <div class="si" style="background:var(--surface-2);color:var(--text-3)">${icon('wifiOff', 20)}</div>
        <div class="st"><div class="t">Waiting to sync</div><div class="s">Your entry is saved and will upload automatically when you reconnect.</div></div>
      </div>` : '';

    if (e.celebration) {
      return `
      ${dayBackdrop()}<div class="sheet-scrim" data-back="home"></div>
      <div class="sheet">
        <div class="grab"></div>
        ${head}${segs}${syncRow}
        <div class="hub-celeb">
          <div class="n">${e.score}</div>
          <div style="font-size:15px;font-weight:800;margin-top:2px">You're OnStandard.</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:4px;line-height:1.5">Every requirement is in. Day ${S.streakDays} locks at midnight.</div>
        </div>
        ${/* The celebration is a HAT on the hub, not a replacement for it. This branch used to
              return here with a single "Close", so the biggest, brightest button in the app
              opened a dead end on the one night the athlete had done everything right — while
              Plan was simultaneously promising "All meals are in. Anything extra still counts."
              A late snack had nowhere to go. Keep the doors open. */''}
        <div class="xgrp" style="margin:14px 2px 7px">Still want to log something?</div>
        <div class="sheet-row" data-go="camera">
          <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('camera', 20)}</div>
          <div class="st"><div class="t">Log an extra meal</div><div class="s">Beyond the standard. It still counts toward your quality.</div></div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
        <div class="sheet-row" data-go="weight">
          <div class="si" style="background:var(--surface-2);color:var(--text-3)">${icon('scale', 20)}</div>
          <div class="st"><div class="t">Log Weight</div><div class="s">Trend only · never moves the daily score</div></div>
          <span class="sv" style="color:var(--text-3)">trend</span>
        </div>
        <div class="cancel" data-back="home">Close</div>
      </div>`;
    }

    const n = e.now;
    // Proof-aware hero icon + verb (matches Home's nowCard): assigned/check items get a
    // check + "Mark ⟨title⟩ done"; forms "Complete", scale/photo "Log", counter "Add".
    const CTA_ICON = { form: 'moon', scale: 'scale', photo: 'camera', counter: 'droplet' };
    const VERB = { form: 'Complete', scale: 'Log', photo: 'Log', counter: 'Add' };
    const isCheck = n ? (!n.proof || n.proof === 'check') : false;
    const heroIcon = n ? (isCheck ? 'check' : CTA_ICON[n.proof]) : '';
    const heroTitle = n ? (isCheck ? `Mark ${esc(n.title)} done` : `${VERB[n.proof]} ${esc(n.title)}${n.state === 'overdue' ? ' late' : ''}`) : '';
    const hero = n ? `
      <div class="hub-hero ${n.state === 'overdue' ? 'red' : ''}" data-go="${n.route}">
        <div class="xico ${n.color}" style="width:44px;height:44px">${icon(heroIcon, 20)}</div>
        <div class="ht">
          <div class="a">${heroTitle}</div>
          <div class="b">${n.state === 'overdue' ? esc(n.sub) : `⏱ ${n.countdown || '—'} · ${esc(n.dueLabel)}`}</div>
        </div>
        ${icon('chevron', 16, 'style="color:var(--text-3)"')}
      </div>` : '';

    const weight = e.items.find((i) => i.id === 'weight');
    const recovery = e.items.find((i) => i.id === 'recovery');
    const weeklyToday = new Date().getDay() === 0;

    return `
    ${dayBackdrop()}<div class="sheet-scrim" data-back="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      ${head}${segs}${syncRow}
      ${hero}
      <div class="xgrp" style="margin:0 2px 7px">Quick logs</div>
      ${weight && !(e.now && e.now.id === 'weight') ? `
      <div class="sheet-row" data-go="weight">
        <div class="si" style="background:${weight.state === 'done' ? 'var(--green-surface);color:var(--green-bright)' : 'var(--surface-2);color:var(--text-3)'}">${icon(weight.state === 'done' ? 'check' : 'scale', 20)}</div>
        <div class="st"><div class="t">Log Weight</div><div class="s">${weight.state === 'done' ? 'In for today · trend only' : 'Trend only · never moves the daily score'}</div></div>
        <span class="sv" style="color:var(--text-3)">trend</span>
      </div>` : ''}
      ${DAY.dailyCommitment == null ? `
      <div class="sheet-row" data-go="commitment">
        <div class="si" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('target', 19)}</div>
        <div class="st"><div class="t">Daily Commitment</div><div class="s">End-of-day reflection · ${liveWeightPct('commitment')}% of your score</div></div>
        <span class="xpill gray">Open</span>
      </div>` : ''}
      <div class="xgrp" style="margin:4px 2px 7px">Forms &amp; check-ins</div>
      ${recovery && !(e.now && e.now.id === 'recovery') ? `
      <div class="sheet-row" data-go="${recovery.route}">
        <div class="si" style="background:${recovery.state === 'done' ? 'var(--green-surface);color:var(--green-bright)' : 'rgba(168,85,247,0.22);color:var(--purple-bright)'}">${icon(recovery.state === 'done' ? 'check' : 'moon', 20)}</div>
        <div class="st"><div class="t">Recovery Check-In</div><div class="s">${recovery.state === 'done' ? 'Submitted tonight' : 'Before bed · 20 seconds · Recovery 25%'}</div></div>
        <span class="xpill ${recovery.color}">${recovery.pill}</span>
      </div>` : ''}
      ${weeklyToday ? `
      <div class="sheet-row" data-go="checkin">
        <div class="si" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 19)}</div>
        <div class="st"><div class="t">Weekly Check-In</div><div class="s">${S.weekly.status}</div></div>
      </div>` : ''}
      ${e.doneItems.length ? `<div class="hub-fold" data-go="home">${icon('check', 13)} ${e.doneItems.length} completed today — view on Home</div>` : ''}
      <div class="cancel" data-back="home">Cancel</div>
    </div>`;
  },
};
