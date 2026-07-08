import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { appHead, scoreRing, animateRing, esc, safeImg } from '../components.js';

/* status badge glyph per row state (mini-dot on the icon tile corner) */
function badgeFor(r) {
  if (r.done) return `<div class="req-badge g">${icon('check', 11)}</div>`;
  const glyph = r.id === 'recovery' ? 'moon' : 'clock';
  return `<div class="req-badge ${r.accent}">${icon(glyph, 10)}</div>`;
}

function reqRow(r) {
  return `<div class="req-row ${r.done ? 'done' : ''}" data-go="${r.route}">
    <div class="req-icon ${r.accent}">${icon(r.icon, 20)}${badgeFor(r)}</div>
    <div class="req-main">
      <div class="req-title">${esc(r.title)}</div>
      <div class="req-sub ${r.subColor}">${r.sub}</div>
    </div>
    <div class="req-right">
      <span class="status-pill ${r.statusColor}">${r.status}</span>
      <span class="req-meta ${r.done ? 'g' : r.missed ? 'dim' : r.accent}">${r.meta}</span>
    </div>
    ${icon('chevron', 18, 'class="req-chev"')}
  </div>`;
}

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

function nextActionBlock() {
  const next = S.nextMove;
  if (!next) {
    return `<div class="day-done">
      <div class="req-icon g" style="width:44px;height:44px">${icon('check', 21)}</div>
      <div><div class="tt">You're OnStandard. Nothing left today.</div>
      <div class="ts">Every requirement is in. Day ${S.streakDays + 1} of your streak locks at midnight.</div></div>
    </div>`;
  }
  const cls = next.accent === 'p' ? 'p-accent' : 'green';
  return `<div class="next-cta">
    <button class="btn ${cls}" data-go="${next.route}">
      ${icon(next.accent === 'p' ? 'moon' : 'camera', 20)} ${next.label}${next.gain ? ` · +${next.gain} pts` : ''}
    </button>
  </div>`;
}

export default {
  tab: 'home',
  render() {
    const t = S.trustPass;
    const remaining = S.remainingCount;
    const foot = remaining === 0
      ? `Day complete at <b>${S.score}</b>. That's the standard.`
      : `<b>${remaining} requirement${remaining > 1 ? 's' : ''}</b> remaining to reach <b>${S.possible}</b>.`;

    // Day-0 (fresh athlete) empty-state variant
    if (RT.day0 && !RT.day0Breakfast) {
      return `
      ${appHead()}
      <section class="hero" data-go="score-breakdown">
        ${scoreRing({ score: S.score, tierName: 'Day one', tierCls: 'b' })}
        <div class="hero-foot">Your score starts moving with your <b>first log</b>.</div>
      </section>
      <div class="next-cta"><button class="btn green" data-go="camera">${icon('camera', 20)} Log First Meal</button></div>

      <div class="eyebrow">Today's Requirements</div>
      <section class="reqcard"><div class="rc-title">Your Standard · set in onboarding</div>
        ${S.requirements.map(reqRow).join('')}<div style="height:6px"></div>
      </section>

      <div class="eyebrow">Recent Activity</div>
      <div class="state-demo">
        <div class="sd-ic">${icon('camera', 24)}</div>
        <div class="sd-t">No logs yet</div>
        <div class="sd-s">Your proof trail builds here as you log. Take a photo to begin today's standard.</div>
      </div>
      <div style="height:8px"></div>
      `;
    }

    return `
    ${appHead()}

    <section class="hero" data-go="score-breakdown">
      ${scoreRing({ score: S.score, delta: (S.scoreYesterday != null && S.score > S.scoreYesterday) ? `+${S.score - S.scoreYesterday} pts` : null, streak: (!RT.day0 && S.streakDays > 0) ? `${S.streakDays} day streak` : null, tierName: S.tier.name, tierCls: S.tier.cls })}
      <div class="hero-foot">${foot}</div>
    </section>

    ${nextActionBlock()}

    ${t.active ? `<div class="trust" data-go="trust" style="margin-top:14px">
      <div class="ic">${icon('shield', 20)}</div>
      <div style="flex:1">
        <div class="tt">Trust Pass · day ${t.day} of ${t.length}</div>
        <div class="ts">${t.note}</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}

    <div style="height:10px"></div>
    <section class="reqcard">
      <div class="rc-title">Today's Requirements</div>
      ${S.requirements.map(reqRow).join('')}
      <div style="height:6px"></div>
    </section>

    ${RT.injured ? `
    <div style="height:12px"></div>
    <div class="trust" data-go="injury" style="cursor:pointer;background:linear-gradient(100deg, rgba(245,165,36,0.14), rgba(59,130,246,0.05));border-color:var(--amber-border)">
      <div class="ic" style="background:rgba(245,165,36,0.2);color:var(--amber-bright)">${icon('bolt', 20)}</div>
      <div style="flex:1">
        <div class="tt">Injury mode · hamstring, week 2 of 4</div>
        <div class="ts">Your Standard adapted. Rehab is on the list; coach and AT see the same bar.</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}

    <div class="eyebrow">Recent Activity <span class="link" data-go="progress">View all</span></div>
    <div class="hscroll">${S.activity.map(actCard).join('')}</div>

    <div style="height:20px"></div>
    <section class="card finish">
      <div class="finish-head" style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:9px">${icon('target', 17)}<span class="t">Finish Today</span></span>
        <span style="font-size:12px;font-weight:800;color:var(--text-2)">${S.metCount} of ${S.reqTotal} in</span>
      </div>
      <div class="finish-segs">
        ${Array.from({ length: S.reqTotal }, (_, i) => `<div class="fseg ${i < S.metCount ? 'on' : ''}"></div>`).join('')}
      </div>
      <div class="finish-score-line">
        <span class="fs-now">${S.finish.current}</span>
        <div class="fs-bridge">
          <div class="fs-track"><div class="fs-fill" style="width:${Math.round((S.finish.current / S.finish.possible) * 100)}%"></div></div>
          <span class="fs-note">${S.remainingCount === 0 ? 'everything is in' : `+${S.finish.possible - S.finish.current} still on the table`}</span>
        </div>
        <span class="fs-goal">${S.finish.possible}</span>
      </div>
      ${S.nextMove ? `
      <div class="finish-moves">
        <div class="fmove" data-go="${S.nextMove.route}">
          <div class="req-icon ${S.nextMove.accent}" style="width:36px;height:36px">${icon(S.nextMove.accent === 'p' ? 'moon' : 'bowl', 17)}</div>
          <div style="flex:1"><div class="fm-t">${S.finish.nextMove}</div><div class="fm-s">next biggest move</div></div>
          <span class="fm-v">+${S.finish.nextGain}</span>
        </div>
        ${RT.recoveryDone ? '' : `
        <div class="fmove" data-go="recovery">
          <div class="req-icon a" style="width:36px;height:36px">${icon('clock', 17)}</div>
          <div style="flex:1"><div class="fm-t">${S.finish.risk}</div><div class="fm-s">highest risk · keeps the streak</div></div>
          <span class="fm-v" style="color:var(--purple-bright)">tonight</span>
        </div>`}
      </div>` : `
      <div class="day-done" style="margin-top:14px">
        <div class="req-icon g" style="width:40px;height:40px">${icon('check', 19)}</div>
        <div><div class="tt">Done at ${S.score}. That's the standard.</div></div>
      </div>`}
    </section>
    `;
  },
  mount(root) { animateRing(root); },
};
