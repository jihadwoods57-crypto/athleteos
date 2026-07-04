import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* ---------- Coach Dashboard (role view; mirrors the RN coach side + Copilot) ---------- */
export const coach = {
  hideTabs: true,
  render() {
    const avg = Math.round(S.roster.reduce((a, r) => a + r.score, 0) / S.roster.length);
    const attention = S.roster.filter(r => r.flag === 'r');
    const jihadScore = S.score;
    return `
    ${backHead('Coach view', `${S.coach.team} · today`, 'profile')}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v">${avg}</div><div class="k">Team avg</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${S.roster.filter(r => r.score >= 80).length}</div><div class="k">On standard</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--red)">${attention.length}</div><div class="k">Need attention</div></div>
    </div>

    ${attention.length ? `
    <div class="eyebrow">Needs attention</div>
    ${attention.map(r => `
    <div class="notif critical">
      <div class="nic">${icon('bell', 19)}</div>
      <div style="flex:1">
        <div class="nt">${r.name} · ${r.unit}</div>
        <div class="nb">${r.note}</div>
      </div>
      <span class="nw">${r.score}</span>
    </div>`).join('')}` : ''}

    <div class="eyebrow">Roster · live scores</div>
    <section class="card" style="padding:2px 0">
      ${S.roster.map(r => `
        <div class="roster-row" ${r.you ? 'data-go="coach-athlete"' : ''}>
          <div class="flagdot ${r.flag}"></div>
          <div class="rn">
            <div class="t">${r.name} <small style="color:var(--text-3);font-weight:700">· ${r.unit}</small>${r.you ? ' <span class="status-pill b" style="font-size:9.5px;padding:2px 8px">REVIEW</span>' : ''}</div>
            <div class="s">${r.note}</div>
          </div>
          <span class="rl">${r.logs}</span>
          <span class="rs" style="color:${r.score >= 80 ? 'var(--green-bright)' : r.score >= 60 ? 'var(--amber-bright)' : 'var(--red)'}">${r.you ? jihadScore : r.score}</span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Coach tools</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow">
        <div class="lic" style="background:rgba(52,211,153,0.16);color:var(--green-bright)">${icon('plus', 18)}</div>
        <div class="lm"><div class="lt">Assign a requirement</div><div class="ls">Meal, weight, recovery, film, custom task</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Edit the game plan</div><div class="ls">Targets, meal windows, weekly focus</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 18)}</div>
        <div class="lm"><div class="lt">Copilot</div><div class="ls">Who needs attention? Who's improving? Team summary.</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Coach → athlete detail (review Jihad's day, comment on a log) ---------- */
export const coachAthlete = {
  hideTabs: true,
  render() {
    return `
    ${backHead('J. Woods · WR', `Today · ${S.score} ${S.tier.name}`, 'coach')}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v">${S.score}</div><div class="k">Score now</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${S.metCount}/${S.reqTotal}</div><div class="k">Requirements</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--amber-bright)">${S.streakDays}d</div><div class="k">Streak</div></div>
    </div>

    <div class="eyebrow">Today's proof</div>
    <div class="hscroll">
      ${S.activity.filter(a => a.img).map(a => `
        <div class="act-card">
          <div class="act-time">${a.time}</div>
          <div class="act-media" style="background-image:url('${a.img}')">${a.dim ? `<div class="dim">${icon('moon', 30)}</div>` : ''}</div>
          <div class="act-body"><div class="act-type">${a.type}</div><div class="act-value ${a.vClass}">${a.value}</div></div>
        </div>`).join('')}
    </div>

    <div class="eyebrow">What's open</div>
    <section class="card" style="padding:6px 16px">
      ${S.requirements.filter(r => !r.done).length
        ? S.requirements.filter(r => !r.done).map(r => `
          <div class="lrow" style="cursor:default">
            <div class="lic" style="color:var(--amber-bright)">${icon(r.icon, 17)}</div>
            <div class="lm"><div class="lt">${r.title}</div><div class="ls">${r.sub}</div></div>
            <span class="status-pill ${r.statusColor}">${r.status}</span>
          </div>`).join('')
        : `<div class="lrow" style="cursor:default"><div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
           <div class="lm"><div class="lt">Everything is in</div><div class="ls">Finished day · ${S.score} ${S.tier.name}</div></div></div>`}
    </section>

    <div class="eyebrow">Comment on the lunch log</div>
    <div class="thread">
      <div class="msg coach"><div class="av">M</div><div><div class="who">You</div><div class="bubble">Great lunch. Keep this structure.</div></div></div>
      <div class="msg ai"><div class="av">${icon('sparkle', 15)}</div><div><div class="who">OnStandard AI</div><div class="bubble">Sent to Jihad. I'll reinforce the same structure at dinner.</div></div></div>
    </div>
    <div class="composer">
      <input placeholder="Message Jihad about today…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Parent view — simple accountability, not surveillance ---------- */
export const parent = {
  hideTabs: true,
  render() {
    return `
    ${backHead('Parent view', 'Jihad · this week', 'profile')}

    <section class="card pad" style="text-align:center">
      <div style="font-size:13px;font-weight:700;color:var(--text-2)">Today</div>
      <div style="font-size:58px;font-weight:800;letter-spacing:-0.04em;margin-top:4px">${S.score}</div>
      <span class="tier-chip ${S.tier.cls}">${S.tier.name}</span>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:12px">${S.metCount} of ${S.reqTotal} requirements done · ${S.streakDays}-day streak</div>
    </section>

    <div class="eyebrow">This week</div>
    <section class="card pad">
      <div class="bigstat"><span class="n" style="font-size:34px">5 of 7</span><span class="d">days on standard</span></div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:6px">Jihad is showing up. Meals are consistent; night recovery check-ins are the habit still being built.</div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What parents see</div>
      <div class="ts">Scores, streaks, and completion only. Meal photos, weight, and check-in answers stay between Jihad and his coach by default.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
