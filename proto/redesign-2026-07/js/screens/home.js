import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg, collapseSection } from '../components.js';
import { DAY } from '../day.js';
import { fetchMyDayReceipts } from '../roles.js';

function actCard(a) {
  let media;
  if (a.img && safeImg(a.img)) {
    media = `<div class="act-media" style="background-image:url('${safeImg(a.img)}')">${a.dim ? `<div class="dim">${icon('moon', 30)}</div>` : ''}</div>`;
  } else {
    media = `<div class="act-media icon" style="background:linear-gradient(150deg, rgba(56,189,248,0.28), rgba(37,99,235,0.16));color:var(--cyan)">${icon('droplet', 34)}</div>`;
  }
  return `<div class="act-card" ${a.route ? `data-go="${a.route}"` : ''}>
    <div class="act-time">${a.time}</div>
    ${media}
    <div class="act-body">
      <div class="act-type">${a.type}</div>
      <div class="act-value ${a.vClass}">${a.value}</div>
    </div>
  </div>`;
}

const whyHtml = (why) => esc(why).replace(/\*\*(.+?)\*\*/, '<b>$1</b>');

function nowCard(e) {
  const n = e.now;
  const od = n.state === 'overdue';
  const VERB = { form: 'Complete', scale: 'Log', photo: 'Log', counter: 'Add' };
  const CTA_ICON = { form: 'moon', scale: 'scale', photo: 'camera', counter: 'droplet' };
  // check-type / assigned items (no proof) read "Mark ⟨title⟩ done"
  const isCheck = !n.proof || n.proof === 'check';
  const label = isCheck ? `Mark ${esc(n.title)} done` : `${VERB[n.proof]} ${esc(n.title)}${od ? ' late' : ''}`;
  const ctaIcon = isCheck ? 'check' : CTA_ICON[n.proof];
  // Overdue already announces itself three ways (label + pill + "Late") — the pill is the
  // redundant one when it just repeats the label; keep it only when it says something new.
  const pill = od && String(n.pill).toUpperCase() === 'OVERDUE' ? '' : `<span class="xpill ${n.color}">${n.pill}</span>`;
  return `<section class="xnow ${od ? 'red' : ''}">
    <div class="xlab"><span class="xl">${od ? 'OVERDUE' : 'NOW'}</span>${pill}</div>
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

const row = (i) => `<div class="xrow-item ${i.color === 'green' ? 'green' : i.color === 'red' ? 'red' : ''}" data-go="${i.route}">
    <div class="xico sm ${i.color}">${icon(i.icon, 17)}</div>
    <div class="xr"><div class="xa">${esc(i.title)}</div><div class="xb">${esc(i.sub)}</div></div>
    <span class="xpill ${i.color}">${i.pill}</span>
  </div>`;

/* Honest sync/consent banner. A provable minor awaiting guardian approval sees a "stays on this
   phone" prompt that routes to the guardian screen; a failed push (offline/RLS) shows "saved on
   your phone, not synced yet." Both replace the OLD silent console.warn — an athlete can no
   longer log all week into a void without knowing. Nothing renders when sync is fine. */
function syncBanner() {
  const issue = S.syncIssue;
  if (issue === 'blocked') {
    const em = S.consent.guardianEmail;
    return `<div class="lrow" data-go="guardian" style="margin:2px 0 10px;background:rgba(245,165,36,0.10);border:1px solid var(--amber-border);border-radius:14px;padding:12px 13px">
      <div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('lock', 16)}</div>
      <div class="xr"><div class="xa">${em ? 'Waiting on your parent' : 'One step before your day syncs'}</div>
      <div class="xb">${em ? 'Everything you log is safe on this phone until they approve.' : 'You’re under 18 — a parent approves before your day reaches your coach. Tap to send it.'}</div></div>
      ${icon('chevron', 16, 'style="color:var(--text-3)"')}
    </div>`;
  }
  if (issue === 'error') {
    return `<div class="lrow" style="margin:2px 0 10px;background:rgba(59,130,246,0.08);border:1px solid var(--hairline);border-radius:14px;padding:12px 13px;cursor:default">
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

function strip(e) {
  return `<section class="xstrip" data-go="score-breakdown">
    ${scoreRing({ score: e.score, size: 64, stroke: 7, glow: false, showCenter: false, centerNum: true, uid: 'strip' })}
    <div class="xmid">
      <div class="xrow"><span class="status-pill ${S.tier.cls}">${S.tier.name}</span>${streakPill()}</div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
      <div class="seglabel"><b>${e.met}</b> of ${e.total} in · reach <b>${e.possible}</b> today</div>
    </div>
  </section>`;
}

// Streak-at-risk ribbon: a sibling of strip() (never a child — strip() owns
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
      ${e.doneItems.map((d) => `<div class="xrec"><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace('Logged ', ''))}</span></div>`).join('')}
    </div>
    ${RT.hydrationOz < 120 ? `<div style="width:100%;margin-top:10px"><div class="xrow-item" style="cursor:default"><div class="xico sm gray">${icon('droplet', 16)}</div><div class="xr"><div class="xa">Add water</div><div class="xb" id="home-water-sub">${RT.hydrationOz} of 120 oz — optional, still counts with coach</div></div><div class="water-btns"><span class="wb2" data-water="8">+8</span><span class="wb2" data-water="16">+16</span></div></div></div>` : ''}
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const e = S.exec;

    if (RT.day0 && !RT.day0Breakfast) {
      return `
      ${appHead()}
      ${strip(e)}
      ${syncBanner()}
      <section class="xnow">
        <div class="xlab"><span class="xl">NOW</span><span class="xpill gold">Start here</span></div>
        <div class="xmain"><div class="xico gold">${icon('camera', 21)}</div>
        <div><div class="xt">Log First Meal</div><div class="xwhy">Your score starts moving with your first log. <b>Nutrition · 50% of score.</b></div></div></div>
        <div style="height:10px"></div>
        <button class="xcta" data-go="camera">${icon('camera', 18)} Log First Meal</button>
      </section>
      <div class="xgrp">Later</div>
      ${e.items.filter((i) => i.id !== 'breakfast').map(row).join('')}
      <div class="eyebrow">Recent Activity</div>
      <div class="state-demo"><div class="sd-ic">${icon('camera', 24)}</div><div class="sd-t">No logs yet</div>
      <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div></div>
      <div style="height:8px"></div>`;
    }

    if (e.celebration) {
      const t = S.trustPass;
      return `
      ${appHead()}
      ${celebration(e)}
      <div id="seen-row" style="width:100%"></div>
      ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${esc(t.note)}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
      <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
      <div class="hscroll">${S.activity.map(actCard).join('')}</div>
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
    <div class="trust" data-go="injury" style="cursor:pointer;margin:2px 0 10px;background:linear-gradient(100deg, rgba(245,165,36,0.14), rgba(59,130,246,0.05));border-color:var(--amber-border)">
      <div class="ic" style="background:rgba(245,165,36,0.2);color:var(--amber-bright)">${icon('bolt', 20)}</div>
      <div style="flex:1"><div class="tt">Injury mode · active</div>
      <div class="ts">Your Standard adapted. Rehab is on the list while you heal.</div></div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : '';
    const trustCard = t.active ? `<div class="trust" data-go="trust" style="margin:2px 0 10px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${esc(t.note)}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : '';
    const attention = sync || injuryCard || trustCard;
    // Whatever lost the attention slot demotes to a quiet one-line row below the ladder.
    const demoted = [
      attention !== injuryCard && RT.injured
        ? `<div class="xrow-item" data-go="injury"><div class="xico sm" style="background:rgba(245,165,36,0.18);color:var(--amber-bright)">${icon('bolt', 16)}</div><div class="xr"><div class="xa">Injury mode active</div><div class="xb">Your Standard adapted while you heal</div></div><span class="xpill gold">On</span></div>` : '',
      attention !== trustCard && t.active
        ? `<div class="xrow-item" data-go="trust"><div class="xico sm green">${icon('shield', 16)}</div><div class="xr"><div class="xa">Trust Pass · day ${t.day} of ${t.length}</div><div class="xb">Camera-free today</div></div><span class="xpill green">Active</span></div>` : '',
    ].filter(Boolean).join('');

    const laterHtml = e.later.length
      ? collapseSection('later', 'Later', e.later.length, e.later.map(row).join(''), open.later === true)
      : '';
    const doneHtml = e.doneItems.length
      ? collapseSection('done', 'Done', e.doneItems.length, e.doneItems.map(row).join(''), open.done === true)
      : '';

    return `
    ${appHead()}
    ${strip(e)}
    <div id="seen-row"></div>
    ${streakPrompt(e)}
    ${attention}
    ${e.overdue.filter((o) => o.id !== (e.now && e.now.id) && o.id !== (e.next && e.next.id)).map(row).join('')}
    ${e.now ? nowCard(e) : ''}
    ${nextRows.length ? `<div class="xgrp">${e.next.state === 'overdue' ? 'Also overdue' : 'Next'}</div>${nextRows.map(row).join('')}` : ''}
    ${laterHtml}
    ${doneHtml}
    ${demoted}
    <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
    <div class="hscroll">${S.activity.map(actCard).join('')}</div>
    <div style="height:20px"></div>`;
  },
  mount(root) {
    animateRing(root);
    act.syncNotifications();
    // WS6: persist collapse state per section so the 30s exec-tick re-render (and tomorrow's
    // fresh render) honors what the athlete left open. `toggle` only fires on user changes,
    // never on the initial `open` attribute — no save loop.
    root.querySelectorAll('details.xcollapse').forEach((d) => {
      d.addEventListener('toggle', () => act.setHomeSection(d.getAttribute('data-sec'), d.open));
    });
    // One-tap water on Home (WS8): the highest-frequency micro-action used to cost two taps
    // and a sheet animation. Same in-place patch pattern as the Action Hub — no re-render churn.
    root.querySelectorAll('.water-btns [data-water]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ }
        act.addWater(+btn.getAttribute('data-water'));
        if (RT.hydrationOz >= 120) { window.__render(); return; }
        const sub = root.querySelector('#home-water-sub');
        if (sub) sub.textContent = `${RT.hydrationOz} of 120 oz — optional, still counts with coach`;
      });
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
        seenRow.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 4px 2px;font-size:12px;font-weight:700;color:var(--text-2)">
            <span style="color:var(--green-bright);display:inline-flex">${icon('users', 14)}</span>
            <span>Seen by ${esc(who)}${esc(extra)} · ${fmt(first.seen_at)}</span>
          </div>`;
      }).catch(() => { /* best-effort — the row simply doesn't render */ });
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
