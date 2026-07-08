import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* ---------- Coach Dashboard (role view; mirrors the RN coach side + Copilot) ---------- */
export const coach = {
  nav: 'coach', tab: 'team',
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

    <div style="height:14px"></div>
    <div class="ai-note" style="border-color:rgba(245,165,36,0.35);background:linear-gradient(120deg, rgba(245,165,36,0.10), rgba(59,130,246,0.04))">
      <div class="av" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204">${icon('sparkle', 18)}</div>
      <div>
        <div class="who" style="color:var(--amber-bright)">Morning Briefing · 6:00 AM · pushed before practice</div>
        <p><b>K. Bell</b> is your conversation today: no logs since Tuesday, trending down two weeks. <b>Reyes</b> is hydration-short three days running. <b>Woods</b> is at ${jihadScore} with ${S.remainingCount === 0 ? 'a finished day' : S.remainingCount + ' still open tonight'}. Everyone else held the standard.</p>
      </div>
    </div>

    ${attention.length ? `
    <div class="eyebrow">Needs attention</div>
    ${attention.map(r => `
    <div class="notif critical" data-go="copilot" style="cursor:pointer">
      <div class="nic">${icon('bell', 19)}</div>
      <div style="flex:1">
        <div class="nt">${r.name} · ${r.unit}</div>
        <div class="nb">${r.note}</div>
      </div>
      <span class="nw">${r.score}</span>
    </div>`).join('')}` : ''}

    <div class="eyebrow">Roster · live scores</div>
    <section class="card" style="padding:2px 0">
      ${S.roster.map(r => {
        // J. Woods' row is LIVE: score, logs, and note derive from his actual state
        const score = r.you ? jihadScore : r.score;
        const logs = r.you ? `${S.metCount}/${S.reqTotal}` : r.logs;
        const note = r.you
          ? (S.remainingCount === 0 ? `Finished day · ${S.tier.name}` : `${S.remainingCount} still open tonight`)
          : r.note;
        const flag = r.you ? (score >= 80 ? (S.remainingCount === 0 ? 'g' : 'y') : 'y') : r.flag;
        return `
        <div class="roster-row" ${r.you ? 'data-go="coach-athlete"' : 'style="cursor:default"'}>
          <div class="flagdot ${flag}"></div>
          <div class="rn">
            <div class="t">${r.name} <small style="color:var(--text-3);font-weight:700">· ${r.unit}</small>${r.you ? ' <span class="status-pill b" style="font-size:9.5px;padding:2px 8px">REVIEW</span>' : ''}</div>
            <div class="s">${note}</div>
          </div>
          <span class="rl">${logs}</span>
          <span class="rs" style="color:${score >= 80 ? 'var(--green-bright)' : score >= 60 ? 'var(--amber-bright)' : 'var(--red)'}">${score}</span>
        </div>`;
      }).join('')}
    </section>

    <div class="eyebrow">Leaderboard · what the athletes see</div>
    <section class="card pad" style="display:flex;align-items:center;gap:14px">
      <div style="flex:1">
        <div style="font-size:14.5px;font-weight:800">Board scope</div>
        <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-top:2px">Changes their Squad view the moment you pick.</div>
      </div>
      <div class="seg" style="width:190px">
        <button class="${RT.squadScope === 'team' ? 'on' : ''}" data-act="setSquadScope:team" data-then="coach">Team</button>
        <button class="${RT.squadScope === 'position' ? 'on' : ''}" data-act="setSquadScope:position" data-then="coach">Room</button>
        <button class="${RT.squadScope === 'off' ? 'on' : ''}" data-act="setSquadScope:off" data-then="coach">Off</button>
      </div>
    </section>

    <div class="eyebrow">Coach tools</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="coach-assign">
        <div class="lic" style="background:rgba(52,211,153,0.16);color:var(--green-bright)">${icon('plus', 18)}</div>
        <div class="lm"><div class="lt">Assign a requirement</div><div class="ls">Post-workout meal, supplements, body photo, sleep, custom</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="coach-plan">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Edit the game plan</div><div class="ls">Targets, weekly focus · publishing notifies him</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="copilot">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 18)}</div>
        <div class="lm"><div class="lt">Copilot</div><div class="ls">Who needs attention? Who's improving? Team summary.</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="team-diet">
        <div class="lic" style="background:var(--red-surface);color:var(--red)">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Team dietary sheet</div><div class="ls">Allergies & restrictions · 2 severe on roster</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="safety">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('heart', 17)}</div>
        <div class="lm"><div class="lt">Wellness flags</div><div class="ls">Protective patterns · no flags this week</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bars', 17)}</div>
        <div class="lm"><div class="lt">Log game stats</div><div class="ls">Feeds the execution ↔ performance card</div></div>
        <span class="status-pill b">Fri</span>
      </div>
      <div class="lrow" data-go="coach-profile">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:13px">M</div>
        <div class="lm"><div class="lt">Coach profile & team code</div><div class="ls">Identity, share code, team settings</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Coach assign flow: template -> lands on the athlete's Home ---------- */
export const coachAssign = {
  nav: 'coach', tab: 'assign',
  render() {
    const already = (id) => RT.assigned.some(a => a.id === id);
    const T = [
      { id: 'pwm',  icon: 'utensils', t: 'Post-Workout Meal', s: 'Photo proof · within 45 min of lifting' },
      { id: 'supp', icon: 'check',    t: 'Supplement Log', s: 'One-tap confirm · with dinner' },
      { id: 'body', icon: 'camera',   t: 'Body Photo', s: 'Coach-only · same pose, same light' },
      { id: 'sleep',icon: 'moon',     t: 'Sleep Target · 8h', s: 'This week · lights out 10:30' },
    ];
    return `
    ${backHead('Assign to J. Woods', 'It lands on his Home the moment you send it', 'coach')}

    <div class="eyebrow">Templates</div>
    <section class="card" style="padding:6px 16px">
      ${T.map(x => `
        <div class="lrow" ${already(x.id) ? '' : `data-act="assignReq:${x.id}" data-then="coach"`}>
          <div class="lic" style="${already(x.id) ? 'background:var(--green-surface);color:var(--green-bright)' : ''}">${icon(already(x.id) ? 'check' : x.icon, 17)}</div>
          <div class="lm"><div class="lt">${x.t}</div><div class="ls">${already(x.id) ? 'Assigned · on his Home now' : x.s}</div></div>
          ${already(x.id) ? '<span class="status-pill g">Sent</span>' : `<span class="status-pill b">Assign</span>`}
        </div>`).join('')}
    </section>

    <div class="eyebrow">Custom task</div>
    <div class="composer" style="margin-top:2px">
      <input id="custom-task" placeholder="Name it… e.g. Extra water at practice" />
      <div class="send" id="custom-send" style="background:linear-gradient(150deg, var(--green-bright), #16a34a);color:#04140b">${icon('plus', 19)}</div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
      <div><div class="tt">Tasks don't mint points</div>
      <div class="ts">The score stays four honest components. Assigned tasks are part of the plan his commitment answer covers, and you see completion either way.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const input = root.querySelector('#custom-task');
    const send = root.querySelector('#custom-send');
    const submit = () => { if (input.value.trim()) { window.__act.assignCustom(input.value); location.hash = '#coach'; } };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};

/* ---------- Coach plan editor: adjust targets, publish -> athlete's Plan·Notes + notification ---------- */
export const coachPlan = {
  nav: 'coach', tab: 'plan',
  render() {
    return `
    ${backHead('Edit Game Plan', 'J. Woods · Lean Mass Phase · Week 2 of 6', 'coach')}

    <div class="eyebrow">Targets</div>
    <section class="card" style="padding:6px 16px">
      ${[['Protein', 'plan-protein', 190, 'g'], ['Calories', 'plan-cals', 2400, ''], ['Water', 'plan-water', 120, ' oz']].map(([k, id, v, u]) => `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${k}</div></div>
          <span class="wb2" data-step="${id}" data-d="-1" style="padding:6px 13px">−</span>
          <span id="${id}" data-u="${u}" style="font-size:16px;font-weight:800;width:74px;text-align:center">${v}${u}</span>
          <span class="wb2" data-step="${id}" data-d="1" style="padding:6px 13px">+</span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">This week's focus</div>
    <div class="composer" style="margin-top:2px">
      <input id="focus-input" value="Hydration is the standard this week. 120 oz, water with every meal." />
      <div class="send" style="display:none"></div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bell', 17)}</div>
      <div><div class="tt">Publishing notifies Jihad</div>
      <div class="ts">The update lands in his Plan · Notes and his notifications the moment you send it. Nothing silent.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="publish-plan">${icon('check', 19)} Publish Update</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const el = root.querySelector('#' + b.getAttribute('data-step'));
      const u = el.getAttribute('data-u');
      const step = b.getAttribute('data-step') === 'plan-cals' ? 50 : 5;
      el.textContent = (parseInt(el.textContent) + step * +b.dataset.d) + u;
    }));
    const pub = root.querySelector('#publish-plan');
    if (pub) pub.addEventListener('click', () => {
      const focus = root.querySelector('#focus-input').value.trim() || 'Plan updated.';
      const p = parseInt(root.querySelector('#plan-protein').textContent);
      const w = parseInt(root.querySelector('#plan-water').textContent);
      window.__act.publishPlanUpdate(`${focus} Targets: ${p}g protein · ${w} oz water.`);
      location.hash = '#coach';
    });
  },
};

/* ---------- Copilot: deterministic roster reads, AI-narrated (mirrors RN assist fn) ---------- */
export const copilot = {
  nav: 'coach', tab: 'copilot',
  render() {
    return `
    ${backHead('Copilot', 'Deterministic roster reads, narrated', 'coach')}

    <div class="eyebrow">Ask</div>
    <div class="chip-row">
      <span class="chp on">Who needs attention?</span>
      <span class="chp" data-go="copilot">Who's improving?</span>
      <span class="chp" data-go="copilot">Team summary</span>
    </div>

    <div style="height:16px"></div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">Copilot</div>
      <p><b>K. Bell</b> is the outlier: no logs since Tuesday, score 58, trending down two weeks straight. Text him tonight, not Friday. <b>M. Reyes</b> is a smaller fix: hydration short 3 days running, everything else holds. Everyone else is on standard or one habit away.</p></div>
    </div>

    <div class="eyebrow">The numbers behind it</div>
    <section class="card" style="padding:2px 0">
      ${S.roster.filter(r => r.flag !== 'g').map(r => `
        <div class="roster-row" style="cursor:default">
          <div class="flagdot ${r.flag}"></div>
          <div class="rn"><div class="t">${r.name}</div><div class="s">${r.note}</div></div>
          <span class="rs" style="color:${r.score >= 60 ? 'var(--amber-bright)' : 'var(--red)'}">${r.score}</span>
        </div>`).join('')}
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Coach → athlete detail (review Jihad's day, comment on a log) ---------- */
export const coachAthlete = {
  nav: 'coach', tab: 'team',
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
        <div class="act-card" ${a.route && a.route.startsWith('meal-detail') ? `data-go="${a.route}"` : 'style="cursor:default"'}>
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
      <div class="msg-status">In Jihad's meal thread · he sees it on the log</div>
      ${RT.coachComments.map(t => `<div class="msg coach"><div class="av">M</div><div><div class="who">You</div><div class="bubble">${t.replace(/</g, '&lt;')}</div></div></div>`).join('')}
    </div>
    <div class="composer">
      <input placeholder="Comment on Jihad's lunch…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireComposer } = await import('./settings.js');
    // The send is REAL in-sim: it lands in the athlete's meal thread (state.coachComments).
    wireComposer(root, 'delivery', '', "Delivered to Jihad's meal thread", (text) => window.__act.coachComment(text));
  },
};

/* ---------- Trainer view: clients, not a team. Scope = recovery + readiness + nutrition consistency ---------- */
export const trainer = {
  nav: 'trainer', tab: 'clients',
  render() {
    const clients = [
      { name: 'J. Woods', tag: 'WR · lean mass', ready: 84, consist: 87, flag: 'g', you: true },
      { name: 'S. Carter', tag: 'Volleyball · perform', ready: 71, consist: 78, flag: 'y' },
      { name: 'R. Nunez', tag: 'Wrestling · cut', ready: 62, consist: 91, flag: 'y' },
    ];
    return `
    ${backHead('Trainer view', 'Your clients · recovery, readiness, consistency', 'profile')}

    <section class="card" style="padding:2px 0">
      ${clients.map(c => `
        <div class="roster-row" ${c.you ? 'data-go="trainer-client"' : 'style="cursor:default"'}>
          <div class="flagdot ${c.flag}"></div>
          <div class="rn">
            <div class="t">${c.name}${c.you ? ' <span class="status-pill b" style="font-size:9.5px;padding:2px 8px">OPEN</span>' : ''}</div>
            <div class="s">${c.tag}</div>
          </div>
          <span class="rl" title="readiness">${c.ready}</span>
          <span class="rs" style="color:${c.consist >= 80 ? 'var(--green-bright)' : 'var(--amber-bright)'}">${c.consist}%</span>
        </div>`).join('')}
    </section>
    <div style="display:flex;justify-content:space-between;padding:8px 18px 0;font-size:10.5px;font-weight:700;color:var(--text-3);letter-spacing:0.05em">
      <span></span><span>READINESS · CONSISTENCY</span>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Trainer scope</div>
      <div class="ts">You see recovery, readiness, and nutrition consistency. Team scores, coach comments, and body photos stay in the coach lane.</div></div>
    </div>

    <div style="height:12px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="trainer-profile">
        <div class="lic" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff;font-weight:800;font-size:13px">T</div>
        <div class="lm"><div class="lt">Trainer profile & client code</div><div class="ls">Practice, share code, scope</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Trainer -> client detail (Jihad as client) ---------- */
export const trainerClient = {
  nav: 'trainer', tab: 'note',
  render() {
    return `
    ${backHead('J. Woods', 'Client · lean mass phase', 'trainer')}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:var(--blue-bright)">${S.weekly.readiness != null ? S.weekly.readiness : '—'}</div><div class="k">Readiness</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">87%</div><div class="k">Consistency</div></div>
      <div class="coach-stat"><div class="v" style="color:${RT.recoveryDone ? 'var(--green-bright)' : 'var(--amber-bright)'}">${RT.recoveryDone ? 'In' : 'Open'}</div><div class="k">Tonight's recovery</div></div>
    </div>

    <div class="eyebrow">Recovery pattern · this week</div>
    <section class="card pad">
      <div class="consist">
        ${[['Sleep quality', 78, 'b'], ['Soreness load', 64, 'a'], ['Recovery check-ins', 71, 'p'], ['Hydration', 80, 'b']].map(([k, v, a]) => `
          <div class="cons-row">
            <span class="k" style="width:120px">${k}</span>
            <div class="track"><div class="fillb" style="width:${v}%;background:linear-gradient(90deg,${a === 'p' ? '#7e22ce,var(--purple-bright)' : a === 'a' ? '#b45309,var(--amber-bright)' : 'var(--blue-deep),var(--blue-bright)'})"></div></div>
            <span class="v">${v}%</span>
          </div>`).join('')}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:14px">Soreness tracks his two missed recovery nights. Night habits are the coaching point, not effort.</div>
    </section>

    <div class="eyebrow">Note to client</div>
    <div class="thread"></div>
    <div class="composer">
      <input placeholder="Note for Jihad…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireComposer } = await import('./settings.js');
    // REAL in-sim: the note lands in the client's notifications
    wireComposer(root, 'delivery', '', "Delivered · Jihad sees it in his notifications", (text) => window.__act.trainerNote(text));
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

    <div class="eyebrow">Sunday digest · pushed 7 PM</div>
    <section class="card pad">
      <div style="font-size:12px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px">This week's summary</div>
      <p style="font-size:14.5px;font-weight:600;line-height:1.55">Jihad finished 5 of 7 days on standard, his best week of the phase. Meals are nearly automatic now. The habit still forming: the nightly recovery check-in. If you ask one question this week, ask about sleep.</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline-soft)">
        <span style="font-size:12.5px;font-weight:700;color:var(--text-2)">Delivered Sundays · push + email</span>
        <div class="seg" style="width:104px" data-toggle-group><button class="on">On</button><button>Off</button></div>
      </div>
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
  async mount(root) { const { wireToggles } = await import('./settings.js'); wireToggles(root); },
};
