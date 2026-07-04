import { S } from '../state.js';
import { icon } from '../icons.js';

export default {
  tab: 'profile',
  render() {
    const t = S.trustPass;
    return `
    <div class="screen-title">Profile</div>

    <section class="card id-card">
      <div class="big-av">${S.athlete.initials}</div>
      <div style="flex:1">
        <div class="nm">${S.athlete.first} ${S.athlete.last}</div>
        <div class="meta">${S.athlete.sport} · ${S.athlete.position}</div>
        <div class="meta" style="margin-top:1px">${S.athlete.school}</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </section>

    ${t.active ? `
    <div style="height:12px"></div>
    <div class="trust">
      <div class="ic">${icon('shield', 20)}</div>
      <div style="flex:1">
        <div class="tt">Trust Pass active · day ${t.day} of ${t.length}</div>
        <div class="ts">Earned with 7 on-standard days. Spot-check every 5th day; credit decays if it goes stale.</div>
      </div>
    </div>` : ''}

    <div class="eyebrow">Coach Connection</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:14px">M</div>
        <div class="lm"><div class="lt">${S.coach.name}</div><div class="ls">${S.coach.team}</div></div>
        <span class="status-pill g">Connected</span>
      </div>
      <div class="lrow" data-go="connect">
        <div class="lic">${icon('key', 18)}</div>
        <div class="lm"><div class="lt">Enter coach code</div><div class="ls">Join another coach or trainer group</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Squad · WR room</div>
    <section class="card" style="padding:6px 0">
      ${S.squad.map(a => `
        <div class="lb-row ${a.you ? 'you' : ''}">
          <span class="lb-rank">${a.rank}</span>
          <span class="lb-name">${a.name} <small style="color:var(--text-3);font-weight:700">· ${a.unit}</small></span>
          <span class="lb-score" style="color:${a.score >= 80 ? 'var(--green-bright)' : 'var(--text-2)'}">${a.score}</span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Accountability</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="notifications">
        <div class="lic">${icon('bell', 18)}</div>
        <div class="lm"><div class="lt">Notifications</div><div class="ls">Reminder level: High</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow">
        <div class="lic" style="color:var(--amber-bright)">${icon('flame', 18)}</div>
        <div class="lm"><div class="lt">Streak</div><div class="ls">${S.streakDays} days on standard · 1 grace per 7 days</div></div>
        <span class="lv">${S.streakDays}d</span>
      </div>
      <div class="lrow" data-go="progress">
        <div class="lic">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Requirement history</div><div class="ls">Every log, every day</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow"><div class="lic">${icon('user', 18)}</div><div class="lm"><div class="lt">Goals & body metrics</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Privacy</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic">${icon('gear', 18)}</div><div class="lm"><div class="lt">Units & preferences</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};
