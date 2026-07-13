import { S, RT, act } from '../state.js';
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
        <div class="st"><div class="t">Saved on your phone</div><div class="s">Not synced yet — we’ll keep trying. Your logs are safe and count locally.</div></div>
      </div>` : '';

    if (e.celebration) {
      return `
      <div class="sheet-scrim" data-go="home"></div>
      <div class="sheet">
        <div class="grab"></div>
        ${head}${segs}${syncRow}
        <div class="hub-celeb">
          <div class="n">${e.score}</div>
          <div style="font-size:15px;font-weight:800;margin-top:2px">You're OnStandard.</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:4px;line-height:1.5">Every requirement is in. Day ${S.streakDays} locks at midnight.</div>
        </div>
        ${RT.hydrationOz < 120 ? `
        <div class="sheet-row">
          <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
          <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz · optional</div></div>
          <div class="water-btns"><span class="wb2" data-water="8">+8</span><span class="wb2" data-water="16">+16</span></div>
        </div>` : ''}
        <div class="cancel" data-go="home">Close</div>
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

    const hydro = e.items.find((i) => i.id === 'hydration');
    const weight = e.items.find((i) => i.id === 'weight');
    const recovery = e.items.find((i) => i.id === 'recovery');
    const weeklyToday = new Date().getDay() === 0;

    return `
    <div class="sheet-scrim" data-go="home"></div>
    <div class="sheet">
      <div class="grab"></div>
      ${head}${segs}${syncRow}
      ${hero}
      <div class="xgrp" style="margin:0 2px 7px">Quick logs</div>
      ${hydro && hydro.state !== 'done' ? `
      <div class="sheet-row">
        <div class="si" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 20)}</div>
        <div class="st"><div class="t">Log Water</div><div class="s">${RT.hydrationOz} of 120 oz today</div></div>
        <div class="water-btns"><span class="wb2" data-water="8">+8</span><span class="wb2" data-water="16">+16</span></div>
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
  // Water taps are the highest-frequency action on this sheet — patch the counter in place
  // instead of going through the router's [data-act] auto-wire+re-render, which replayed the
  // 320ms sheet entrance and reset scroll on every +8/+16 (SETTLED mount()-self-wire pattern).
  mount(root) {
    root.querySelectorAll('.water-btns [data-water]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        try { if (navigator.vibrate) navigator.vibrate(14); } catch { /* no-op */ }
        const oz = +btn.getAttribute('data-water');
        act.addWater(oz);
        // Crossing the goal is a genuine state change (hydration row flips to done) — the one
        // case where a real re-render is correct, not the high-frequency in-place path below.
        if (RT.hydrationOz >= 120) { window.__render(); return; }
        const s = btn.closest('.sheet-row').querySelector('.st .s');
        const i = s.textContent.indexOf(' of ');
        if (i >= 0) s.textContent = RT.hydrationOz + s.textContent.slice(i);
      });
    });
  },
};
