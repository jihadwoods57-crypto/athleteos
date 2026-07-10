import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg } from '../components.js';
import { DAY } from '../day.js';

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
  return `<section class="xnow ${od ? 'red' : ''}">
    <div class="xlab"><span class="xl">${od ? 'OVERDUE' : 'NOW'}</span><span class="xpill ${n.color}">${n.pill}</span></div>
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

function strip(e) {
  return `<section class="xstrip" data-go="score-breakdown">
    ${scoreRing({ score: e.score, size: 52, stroke: 6, glow: false, showCenter: false, uid: 'strip' })}
    <span class="xsc">${e.score}</span>
    <div class="xmid">
      <div class="xrow"><span class="status-pill ${S.tier.cls}">${S.tier.name}</span>${S.streakDays > 0 ? `<span style="font-size:11px;font-weight:700;color:var(--text-2)">🔥 ${S.streakDays} day streak</span>` : ''}</div>
      <div class="xsegs">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>
    </div>
    <div class="xmeta">${e.met} of ${e.total} in<br>${e.score} → ${e.possible}</div>
  </section>`;
}

function celebration(e) {
  return `<div class="xcelebwrap">
    <section class="hero" style="padding-bottom:8px">
      ${scoreRing({ score: e.score, delta: (S.scoreYesterday != null && e.score > S.scoreYesterday) ? `+${e.score - S.scoreYesterday} pts` : null, streak: S.streakDays > 0 ? `${S.streakDays} day streak` : null, tierName: S.tier.name, tierCls: S.tier.cls })}
    </section>
    <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px">You're OnStandard.</div>
    <div style="font-size:12.5px;color:var(--text-2);line-height:1.55;max-width:34ch;margin-top:5px">Every requirement is in. Day <b>${S.streakDays + 1}</b> of your streak locks at midnight.</div>
    <div style="height:14px"></div>
    <div class="eyebrow" style="align-self:flex-start">Today's record</div>
    <div class="xrecord" style="width:100%;box-sizing:border-box">
      ${e.doneItems.map((d) => `<div class="xrec"><span class="xtk">${icon('check', 12)}</span>${esc(d.title)}<span class="xtm">${esc((d.sub || '').replace('Logged ', ''))}</span></div>`).join('')}
    </div>
    ${RT.hydrationOz < 120 ? `<div style="width:100%;margin-top:10px"><div class="xrow-item" data-go="log"><div class="xico sm gray">${icon('droplet', 16)}</div><div class="xr"><div class="xa">Add water</div><div class="xb">${RT.hydrationOz} of 120 oz — optional, still counts with coach</div></div><span class="xpill gray">Open</span></div></div>` : ''}
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
      ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${t.note}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
      <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
      <div class="hscroll">${S.activity.map(actCard).join('')}</div>
      <div style="height:20px"></div>`;
    }

    const t = S.trustPass;
    const nextRows = e.next ? [e.next] : [];
    return `
    ${appHead()}
    ${strip(e)}
    ${e.overdue.filter((o) => !e.now || o.id !== e.now.id).map(row).join('')}
    ${e.now ? nowCard(e) : ''}
    ${nextRows.length ? `<div class="xgrp">Next</div>${nextRows.map(row).join('')}` : ''}
    ${e.later.length ? `<div class="xgrp">Later · ${e.later.length}</div>${e.later.map(row).join('')}` : ''}
    ${e.doneItems.length ? `<div class="xgrp">Done · ${e.doneItems.length}</div>${e.doneItems.map(row).join('')}` : ''}
    ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px"><div class="ic">${icon('shield', 20)}</div><div style="flex:1"><div class="tt">Trust Pass · day ${t.day} of ${t.length}</div><div class="ts">${t.note}</div></div>${icon('chevron', 18, 'style="color:var(--text-3)"')}</div>` : ''}
    ${RT.injured ? `
    <div style="height:12px"></div>
    <div class="trust" data-go="injury" style="cursor:pointer;background:linear-gradient(100deg, rgba(245,165,36,0.14), rgba(59,130,246,0.05));border-color:var(--amber-border)">
      <div class="ic" style="background:rgba(245,165,36,0.2);color:var(--amber-bright)">${icon('bolt', 20)}</div>
      <div style="flex:1"><div class="tt">Injury mode · hamstring, week 2 of 4</div>
      <div class="ts">Your Standard adapted. Rehab is on the list; coach and AT see the same bar.</div></div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}
    <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
    <div class="hscroll">${S.activity.map(actCard).join('')}</div>
    <div style="height:20px"></div>`;
  },
  mount(root) {
    animateRing(root);
    act.syncNotifications();
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
