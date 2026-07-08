import { S, RT } from '../state.js';
import { icon } from '../icons.js';

export default {
  tab: 'progress',
  render() {
    const P = S.progress;
    if (RT.day0) {
      return `
      <div class="screen-title">Progress</div>
      <div style="height:14px"></div>
      <div class="state-demo">
        <div class="sd-ic">${icon('bars', 24)}</div>
        <div class="sd-t">Progress builds as you log</div>
        <div class="sd-s">After your first few days, trends, streaks, and patterns show up here. Day one is about one thing: log the meals.</div>
        <div class="sd-cta"><button class="btn green sm" style="width:auto;padding:0 22px" data-go="camera">${icon('camera', 17)} Log a Meal</button></div>
      </div>
      <div class="sidebox">
        <div class="req-icon b" style="width:38px;height:38px">${icon('target', 17)}</div>
        <div><div class="tt">What you'll see here</div>
        <div class="ts">Weekly score trend, requirement consistency, your biggest pattern, weight trend toward the coach target, and where points slipped.</div></div>
      </div>`;
    }
    // Not enough history yet → honest near-empty (today alone isn't a trend).
    if (!P.hasHistory) {
      return `
      <div class="screen-title">Progress</div>
      <div style="height:14px"></div>
      <div class="state-demo">
        <div class="sd-ic">${icon('bars', 24)}</div>
        <div class="sd-t">One day in — trends need a few more</div>
        <div class="sd-s">Your weekly score, streak, and consistency show up here once you have a few days logged. Today counts: you're at ${S.score}.</div>
      </div>

      <div class="eyebrow">Weight Trend</div>
      <section class="card pad" data-go="weight" style="cursor:pointer">
        <div style="font-size:13.5px;font-weight:600;color:var(--text-2)">${S.weight.current != null ? `${S.weight.current} lb logged · builds your season trend` : 'No weight logged yet. Tap to start your trend.'}</div>
      </section>
      <div style="height:10px"></div>`;
    }
    return `
    <div class="screen-title">Progress</div>

    <div class="eyebrow">Recent OnStandard Score</div>
    <section class="card pad">
      <div class="bigstat"><span class="n">${P.weekAvg}</span>${P.weekDelta ? `<span class="d">${P.weekDelta} vs prior week</span>` : ''}</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${P.onDays} days on standard (≥80)</div>
      <div class="weekbars">
        ${P.weekScores.map((v, i) => `
          <div class="wb ${v >= 80 ? 'hi' : ''}">
            <div class="bar" style="height:${Math.round((v / 100) * 86)}px"></div>
            <span class="d">${P.weekDayLabels[i] || ''}</span>
          </div>`).join('')}
      </div>
    </section>

    <div style="height:16px"></div>
    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:var(--amber-bright)">${P.bestStreak}d</div><div class="k">Best streak</div></div>
      ${P.monthConsistency != null ? `<div class="coach-stat"><div class="v">${P.monthConsistency}%</div><div class="k">Consistency (≥80)</div></div>` : ''}
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${P.weekAvg}</div><div class="k">Avg score</div></div>
    </div>

    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('sparkle', 17)}</div>
      <div><div class="tt">More insight as you log</div>
      <div class="ts">Per-requirement consistency, your biggest pattern, and coach + AI summaries turn on once there's enough real history to be honest about. <span class="link" data-go="history">See meal history</span></div></div>
    </div>

    <div class="eyebrow">Weight Trend</div>
    <section class="card pad" data-go="weight" style="cursor:pointer">
      ${S.weight.current != null ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="bigstat"><span class="n" style="font-size:32px">${S.weight.current}</span>${S.weight.deltaMonth ? `<span class="d">${S.weight.deltaMonth}</span>` : ''}</div>
        ${S.weight.pace ? `<span class="status-pill ${S.weight.pace === 'On pace' ? 'g' : 'a'}">${S.weight.pace}</span>` : ''}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:2px">${S.weight.target != null ? `Goal ${S.weight.target} lb · ` : ''}doesn't affect the daily score</div>`
      : `<div style="font-size:13.5px;font-weight:600;color:var(--text-2)">No weight logged yet. Tap to log your first — it builds your season trend, never your daily score.</div>`}
    </section>

    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    root.querySelectorAll('.seg').forEach(g => g.setAttribute('data-toggle-group', ''));
    wireToggles(root);
  },
};
