import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';

/* Action Hub — the FAB's execution dashboard. One question, always answered:
   "what is the single most important thing I should do right now?" */
export default {
  tab: 'camera',
  hideTabs: true,
  bleed: true,
  render() {
    const e = S.exec;
    const segs = `<div class="xsegs" style="margin:0 2px 12px">${Array.from({ length: e.total }, (_, i) => `<i class="${i < e.met ? 'on' : ''}"></i>`).join('')}</div>`;
    const head = `<div class="hub-head"><span class="a">${e.met} of ${e.total} in</span><span class="b">${e.score} → <em>${e.possible} possible</em></span></div>`;

    if (e.celebration) {
      return `
      <div class="sheet-scrim" data-go="home"></div>
      <div class="sheet">
        <div class="grab"></div>
        ${head}${segs}
        <div class="hub-celeb">
          <div class="n">${e.score}</div>
          <div style="font-size:15px;font-weight:800;margin-top:2px">You're OnStandard.</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:4px;line-height:1.5">Every requirement is in. Day ${S.streakDays + 1} locks at midnight.</div>
        </div>
        ${RT.hydrationOz < 120 ? `
        <div class="sheet-row">
          <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
          <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz · optional</div></div>
          <div class="water-btns"><span class="wb2" data-act="addWater:8" data-then="log">+8</span><span class="wb2" data-act="addWater:16" data-then="log">+16</span></div>
        </div>` : ''}
        <div class="cancel" data-go="home">Close</div>
      </div>`;
    }

    const n = e.now;
    // Proof-aware hero icon (matches Home's nowCard): assigned/check items get a check, not a camera.
    const CTA_ICON = { form: 'moon', scale: 'scale', photo: 'camera', counter: 'droplet' };
    const heroIcon = n ? ((!n.proof || n.proof === 'check') ? 'check' : CTA_ICON[n.proof]) : '';
    const hero = n ? `
      <div class="hub-hero ${n.state === 'overdue' ? 'red' : ''}" data-go="${n.route}">
        <div class="xico ${n.color}" style="width:44px;height:44px">${icon(heroIcon, 20)}</div>
        <div class="ht">
          <div class="a">${n.state === 'overdue' ? `Log ${esc(n.title)} late` : `Log ${esc(n.title)}`}</div>
          <div class="b">${n.state === 'overdue' ? esc(n.sub) : `⏱ ${n.countdown || '—'} · ${esc(n.dueLabel)}`}</div>
        </div>
        ${icon('chevron', 16, 'style="color:var(--text-3)"')}
      </div>` : '';

    const hydro = e.items.find((i) => i.id === 'hydration');
    const weight = e.items.find((i) => i.id === 'weight');
    const recovery = e.items.find((i) => i.id === 'recovery');
    const weeklyToday = new Date().getDay() === 0;

    return `
    <div class="sheet-scrim" data-go="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      ${head}${segs}
      ${hero}
      <div class="xgrp" style="margin:0 2px 7px">Quick logs</div>
      ${hydro && hydro.state !== 'done' ? `
      <div class="sheet-row">
        <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
        <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz today</div></div>
        <div class="water-btns"><span class="wb2" data-act="addWater:8" data-then="log">+8</span><span class="wb2" data-act="addWater:16" data-then="log">+16</span></div>
      </div>` : `
      <div class="sheet-row" style="background:linear-gradient(90deg, rgba(52,211,153,0.14), transparent 85%);border-radius:16px">
        <div class="si" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 20)}</div>
        <div class="st"><div class="t">Hydration standard hit</div><div class="s">${RT.hydrationOz} oz · this week's focus, handled.</div></div>
      </div>`}
      ${weight && !(e.now && e.now.id === 'weight') ? `
      <div class="sheet-row" data-go="weight">
        <div class="si" style="background:${weight.state === 'done' ? 'var(--green-surface);color:var(--green-bright)' : 'var(--surface-2);color:var(--text-3)'}">${icon(weight.state === 'done' ? 'check' : 'scale', 20)}</div>
        <div class="st"><div class="t">Log Weight</div><div class="s">${weight.state === 'done' ? 'In for today · trend only' : 'Trend only · never moves the daily score'}</div></div>
        <span class="sv" style="color:var(--text-3)">trend</span>
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
      ${e.doneItems.length ? `<div class="hub-fold" data-go="home">${icon('check', 13)} ${e.doneItems.length} in — view on Home</div>` : ''}
      <div class="cancel" data-go="home">Cancel</div>
    </div>`;
  },
};
