import { S } from '../state.js';
import { icon } from '../icons.js';

const DAYS = ['M','T','W','T','F','S','S'];

export default {
  tab: 'progress',
  render() {
    const P = S.progress;
    const accent = { g: 'linear-gradient(90deg,#16a34a,var(--green-bright))', b: 'linear-gradient(90deg,var(--blue-deep),var(--blue-bright))', p: 'linear-gradient(90deg,#7e22ce,var(--purple-bright))', a: 'linear-gradient(90deg,#b45309,var(--amber-bright))' };
    return `
    <div class="screen-title">Progress</div>
    <div class="seg" style="margin-top:6px">
      <button class="on">Week</button><button>Month</button><button>Season</button>
    </div>

    <div class="eyebrow">Weekly OnStandard Score</div>
    <section class="card pad">
      <div class="bigstat"><span class="n">${P.weekAvg}</span><span class="d">${P.weekDelta} vs last week</span></div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${P.onDays} days on standard (≥80)</div>
      <div class="weekbars">
        ${P.weekScores.map((v, i) => `
          <div class="wb ${v >= 80 ? 'hi' : ''}">
            <div class="bar" style="height:${Math.round((v / 100) * 86)}px"></div>
            <span class="d">${DAYS[i]}</span>
          </div>`).join('')}
      </div>
    </section>

    <div class="eyebrow">Requirements Consistency</div>
    <section class="card pad">
      <div class="bigstat"><span class="n">${P.consistency}%</span><span class="d">${P.consDelta}</span></div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin:2px 0 16px">${P.consDone} completed this week</div>
      <div class="consist">
        ${P.consBreak.map(c => `
          <div class="cons-row">
            <span class="k">${c.k}</span>
            <div class="track"><div class="fillb" style="width:${c.v}%;background:${accent[c.accent]}"></div></div>
            <span class="v">${c.v}%</span>
          </div>`).join('')}
      </div>
    </section>

    <div class="eyebrow">Biggest Pattern</div>
    <div class="insight">
      <div class="req-icon g" style="width:38px;height:38px;flex:none">${icon('bolt', 18)}</div>
      <p>${P.pattern}</p>
    </div>

    <div class="eyebrow">Nutrition Progress</div>
    <section class="card pad">
      <div class="macro-row">
        <div class="macro"><div class="mv">93</div><div class="mk">Avg meal</div></div>
        <div class="macro"><div class="mv">96%</div><div class="mk">Protein</div></div>
        <div class="macro"><div class="mv">88%</div><div class="mk">On time</div></div>
        <div class="macro"><div class="mv" style="color:var(--amber-bright)">80%</div><div class="mk">Hydration</div></div>
      </div>
      <div style="font-size:13.5px;font-weight:700;color:var(--text-2);margin-top:14px">${P.nutritionInsight}</div>
    </section>

    <div class="eyebrow">Weight Trend</div>
    <section class="card pad" data-go="weight" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="bigstat"><span class="n" style="font-size:32px">${S.weight.current}</span><span class="d">${S.weight.deltaMonth} this month</span></div>
        <span class="status-pill g">${S.weight.pace}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">Goal ${S.weight.target} lb · doesn't affect the daily score</div>
    </section>

    <div class="eyebrow">Where You Lost Points</div>
    <section class="card losttable" style="padding:6px 16px">
      ${P.lost.map(l => `
        <div class="lrow2">
          <span style="color:var(--text-2)">${l.k}</span>
          <span class="amt" style="color:var(--${l.accent === 'p' ? 'purple-bright' : 'amber-bright'})">${l.v}${l.note ? ` <small style="color:var(--text-3);font-weight:700">· ${l.note}</small>` : ''}</span>
        </div>`).join('')}
    </section>

    <div class="eyebrow">Coach Feedback</div>
    <div class="coachnote">
      <div class="who"><div class="av">M</div><div><div class="nm">${S.coach.name}</div><div class="rl">This week</div></div></div>
      <p>“${P.coachFeedback}”</p>
    </div>

    <div class="eyebrow">AI Summary</div>
    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">This week</div><p>${P.aiSummary}</p></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
