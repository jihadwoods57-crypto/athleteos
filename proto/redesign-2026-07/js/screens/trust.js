import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* ---------- Trust Pass detail: the earned camera-free reward, rules visible ---------- */
export const trust = {
  tab: 'home',
  render() {
    const t = S.trustPass;
    if (!t.active) {
      return `${backHead('Trust Pass', 'Not earned yet')}
      <div class="state-demo">
        <div class="sd-ic">${icon('shield', 24)}</div>
        <div class="sd-t">Earn it with 7 on-standard days</div>
        <div class="sd-s">Show the pattern with photos first. Then your coach can grant camera-free days credited from your real history.</div>
      </div>`;
    }
    // decay curve: full credit through day 10, then -5%/day
    const pts = Array.from({ length: 14 }, (_, i) => {
      const d = i + 1;
      const pct = d <= 10 ? 1 : Math.max(0, 1 - (d - 10) * 0.05);
      return [16 + (i / 13) * 268, 74 - pct * 54];
    });
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const youX = 16 + ((t.day - 1) / 13) * 268;
    return `
    ${backHead('Trust Pass', `Day ${t.day} of ${t.length} · camera-free, honestly`)}

    <section class="card pad" style="border-color:var(--purple-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon p" style="width:52px;height:52px;border-radius:16px">${icon('shield', 26)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">Active · earned, not given</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:3px">Granted by ${S.coach.name} after 7 on-standard days with photo proof.</div>
        </div>
      </div>
    </section>

    <div class="eyebrow">How today gets credited</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--purple-surface);color:var(--purple-bright)">${icon('bars', 17)}</div>
        <div class="lm"><div class="lt">Your trailing-10 median</div><div class="ls">Credit comes from your last 10 real photo-earned days. One hero plate can't inflate it.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Your answer scales it</div><div class="ls">Yes = full credit · Partial = 60% · No = zero. Honesty is the input.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('camera', 17)}</div>
        <div class="lm"><div class="lt">Spot-check every 5th day</div><div class="ls">Day 5 and day 10 the camera comes back. Next check: day 5.</div></div>
      </div>
    </section>

    <div class="eyebrow">Credit decays if it goes stale</div>
    <section class="card pad">
      <svg width="100%" viewBox="0 0 300 84">
        <path d="${path}" fill="none" stroke="url(#tg)" stroke-width="2.5" stroke-linecap="round"/>
        <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#A855F7"/><stop offset="70%" stop-color="#A855F7"/><stop offset="100%" stop-color="#F5A524"/>
        </linearGradient></defs>
        <line x1="${youX}" y1="14" x2="${youX}" y2="76" stroke="rgba(168,85,247,0.4)" stroke-width="1.5" stroke-dasharray="3 3"/>
        <circle cx="${youX}" cy="${(16 + ((t.day - 1) / 13) * 268) <= 220 ? 20 : 20}" r="0"/>
        <text x="${youX}" y="10" fill="#C084FC" font-size="9" font-weight="800" text-anchor="middle" font-family="Plus Jakarta Sans">YOU · DAY ${t.day}</text>
        <text x="16" y="82" fill="#64748B" font-size="8.5" font-weight="700" font-family="Plus Jakarta Sans">DAY 1</text>
        <text x="220" y="82" fill="#64748B" font-size="8.5" font-weight="700" font-family="Plus Jakarta Sans">DAY 10</text>
        <text x="284" y="82" fill="#64748B" font-size="8.5" font-weight="700" text-anchor="end" font-family="Plus Jakarta Sans">14</text>
      </svg>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:8px">Full credit through day 10, then it bleeds about 4 points a day. Fresh photos reset the baseline.</div>
    </section>

    <div style="height:14px"></div>
    <div class="coachnote">
      <div class="who"><div class="av">M</div><div><div class="nm">${S.coach.name}</div><div class="rl">On granting it</div></div></div>
      <p>“You showed me the pattern. I don't need a photo of every plate to know who you are. Don't make me take it back.”</p>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="home">Back Home</button>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Streak detail: the honest streak, grace visible ---------- */
export const streak = {
  tab: 'home',
  render() {
    const days = [
      { d: 'Sun', s: 90, on: true }, { d: 'Mon', s: 84, on: true }, { d: 'Tue', s: 90, on: true },
      { d: 'Wed', s: 72, on: false, grace: false }, { d: 'Thu', s: 86, on: true },
      { d: 'Fri', s: S.score, on: S.score >= 80, today: true },
    ];
    // honest framing: Wednesday was sub-80; streak survived because Thu-Fri rebuilt it? No —
    // seeded truth: streak = 5 counting from after Wednesday's grace day.
    return `
    ${backHead('Streak', `${S.streakDays} days on standard · grace intact`)}

    <section class="card pad" style="text-align:center">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <span style="color:var(--amber-bright)">${icon('flame', 26)}</span>
        <span style="font-size:52px;font-weight:800;letter-spacing:-0.04em">${S.streakDays}</span>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text-2);margin-top:4px">days at 80 or better</div>
      ${S.score >= 80
        ? `<div style="font-size:12.5px;font-weight:600;color:var(--green-bright);margin-top:10px">Today is above the bar. Day ${S.streakDays + 1} locks at midnight.</div>`
        : `<div style="font-size:12.5px;font-weight:600;color:var(--amber-bright);margin-top:10px">Today is below 80. Finish tonight's requirements or this ends honestly.</div>`}
    </section>

    <div class="eyebrow">This week</div>
    <section class="card pad">
      <div style="display:flex;gap:8px">
        ${days.map(x => `
          <div style="flex:1;text-align:center">
            <div style="height:52px;border-radius:12px;display:grid;place-items:center;font-size:14px;font-weight:800;
              ${x.on ? 'background:rgba(52,211,153,0.16);color:var(--green-bright);border:1px solid var(--green-border)'
                     : 'background:rgba(245,165,36,0.12);color:var(--amber-bright);border:1px solid var(--amber-border)'}
              ${x.today ? ';box-shadow:0 0 14px rgba(52,211,153,0.25)' : ''}">${x.s}</div>
            <div style="font-size:10.5px;font-weight:700;color:var(--text-3);margin-top:6px">${x.d}${x.today ? ' · now' : ''}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:14px">Wednesday's 72 ended the last run. This streak started Thursday, built honestly since.</div>
    </section>

    <div class="eyebrow">The rules</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">80 is the bar</div><div class="ls">On standard means 80+. Not close, not almost.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">One grace per 7 days</div><div class="ls">One rough day inside a week is forgiven, bridged, never counted. Yours is unused.</div></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--amber-surface);color:var(--amber-bright)">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Absent days count as misses</div><div class="ls">Not opening the app isn't a loophole. The calendar is the judge.</div></div>
      </div>
    </section>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="home">Back Home</button>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Meal History: the proof trail across days ---------- */
export const history = {
  tab: 'progress',
  render() {
    const todayMeals = S.activity.filter(a => a.img && a.type !== 'Recovery Check-In' && a.type !== 'Morning Weight');
    const dayBlock = (label, score, tierName, meals, note) => `
      <div class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline">
        <span>${label}</span>
        <span style="text-transform:none;letter-spacing:0;font-size:13px;font-weight:800;color:${score >= 90 ? 'var(--green-bright)' : score >= 75 ? 'var(--blue-bright)' : 'var(--amber-bright)'}">${score} · ${tierName}</span>
      </div>
      ${note ? `<div style="font-size:12px;font-weight:600;color:var(--amber-bright);margin:-6px 2px 10px">${note}</div>` : ''}
      <div class="hscroll">
        ${meals.map(m => `
          <div class="act-card" style="cursor:default">
            <div class="act-time">${m.type}</div>
            <div class="act-media" style="background-image:url('${m.img}')"></div>
            <div class="act-body"><div class="act-type">Meal score</div><div class="act-value ${m.score >= 85 ? 'g' : 'b'}">${m.score}</div></div>
          </div>`).join('')}
      </div>`;
    return `
    ${backHead('Meal History', 'The proof trail, day by day', 'progress')}
    ${dayBlock('Today · Friday', S.score, S.tier.name, todayMeals.map(m => ({ type: m.type, img: m.img, score: +String(m.value).replace(/\D/g, '') || 90 })))}
    ${S.history.map(d => dayBlock(`${d.day} · ${d.date}`, d.score, d.tier, d.meals, d.note)).join('')}
    <div style="height:10px"></div>
    `;
  },
};
