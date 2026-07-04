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

    <div class="eyebrow">Other views</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="coach">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204">${icon('users', 18)}</div>
        <div class="lm"><div class="lt">Coach view</div><div class="ls">Roster, live scores, who needs attention</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="parent">
        <div class="lic">${icon('heart', 17)}</div>
        <div class="lm"><div class="lt">Parent view</div><div class="ls">Simple accountability, privacy-scoped</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="checkin">
        <div class="lic">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Weekly check-in</div><div class="ls">${S.weekly.status}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow"><div class="lic">${icon('user', 18)}</div><div class="lm"><div class="lt">Goals & body metrics</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Privacy</div><div class="ls">Role-scoped visibility · photos private by default</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Plan & billing</div><div class="ls">Individual athlete · team plans available</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic">${icon('gear', 18)}</div><div class="lm"><div class="lt">Units & preferences</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>

    <div class="eyebrow">Prototype controls</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="welcome">
        <div class="lic">${icon('sparkle', 17)}</div>
        <div class="lm"><div class="lt">View onboarding</div><div class="ls">Welcome, Standard setup, Day 1 empty states</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="states">
        <div class="lic">${icon('grid', 17)}</div>
        <div class="lm"><div class="lt">Design states gallery</div><div class="ls">Empty, loading, error, and tier states</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-act="reset" data-then="home">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('flip', 17)}</div>
        <div class="lm"><div class="lt">Reset the demo day</div><div class="ls">Back to 10:20 PM, 82, dinner + recovery open</div></div>
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};
