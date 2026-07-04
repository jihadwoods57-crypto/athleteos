import { S } from '../state.js';
import { icon, checkFill } from '../icons.js';
import { appHead, scoreRing, animateRing, mealMedia } from '../components.js';

function reqRow(r) {
  const iconEl = r.done ? checkFill(24) : icon(r.icon, 22);
  return `<div class="req-row ${r.done ? 'done' : ''}" data-go="${r.route}">
    <div class="req-icon ${r.accent}">${iconEl}</div>
    <div class="req-main">
      <div class="req-title">${r.title}</div>
      <div class="req-sub ${r.subColor}">${r.sub}</div>
    </div>
    <div class="req-right">
      <span class="status-pill ${r.statusColor}">${r.status}</span>
      <span class="req-meta">${r.meta}</span>
    </div>
    ${icon('chevron', 18, 'class="req-chev"')}
  </div>`;
}

function actCard(a) {
  let media;
  if (a.media === 'meal') media = mealMedia(a.hue);
  else if (a.media === 'water') media = `<div class="act-media icon" style="background:var(--cyan-surface);color:var(--cyan)">${icon('droplet', 34)}</div>`;
  else media = `<div class="act-media icon" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('moon', 32)}</div>`;
  return `<div class="act-card" ${a.route ? `data-go="${a.route}"` : ''}>
    <div class="act-time">${a.time}</div>
    ${media}
    <div class="act-body">
      <div class="act-type">${a.type}</div>
      <div class="act-value ${a.vClass}">${a.value}</div>
    </div>
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const t = S.trustPass;
    return `
    ${appHead()}

    <section class="hero" data-go="score-breakdown">
      ${scoreRing({ score: S.score })}
      <div class="hero-meta">
        <div class="delta">
          <span class="up">${icon('arrowUp', 16)} +${S.score - S.scoreYesterday} pts</span>
          <span class="muted">vs yesterday</span>
        </div>
        <div class="streak-pill">${icon('flame', 15, 'class="flame"')} ${S.streakDays} day streak</div>
      </div>
      <div class="hero-foot"><b>2 requirements</b> remaining to reach <b>${S.possible}</b>.</div>
    </section>

    ${t.active ? `<div class="trust" data-go="profile">
      <div class="ic">${icon('shield', 20)}</div>
      <div style="flex:1">
        <div class="tt">Trust Pass · day ${t.day} of ${t.length}</div>
        <div class="ts">${t.note}</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}

    <div class="eyebrow">Today's Requirements</div>
    <div class="req">${S.requirements.map(reqRow).join('')}</div>

    <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
    <div class="hscroll">${S.activity.map(actCard).join('')}</div>

    <div class="eyebrow">Finish Today</div>
    <section class="card finish">
      <div class="finish-grid">
        <div class="finish-cell"><div class="k">Current score</div><div class="v">${S.finish.current}</div></div>
        <div class="finish-cell"><div class="k">Possible score</div><div class="v g">${S.finish.possible}</div></div>
        <div class="finish-cell"><div class="k">Requirements met</div><div class="v b">${S.finish.met}</div></div>
        <div class="finish-cell"><div class="k">Next biggest move</div><div class="v" style="font-size:16px">${S.finish.nextMove} <small>+${S.finish.nextGain}</small></div></div>
        <div class="finish-cell wide">
          <div>
            <div class="k">Highest risk</div>
            <div class="v" style="font-size:16px;color:var(--purple-bright)">${S.finish.risk}</div>
            <div class="sub">${S.finish.riskSub}</div>
          </div>
          <div class="btn green sm" style="width:auto;padding:0 20px" data-go="recovery">Do it now</div>
        </div>
      </div>
    </section>
    `;
  },
  mount(root) { animateRing(root); },
};
