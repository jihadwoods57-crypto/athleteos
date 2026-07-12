import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { esc, composer } from '../components.js';
import { CATALOG, PROOF, IMPACT_LABEL, freqLabel, fmtMin } from '../requirements.js';

const P = S.plan;

function tabs(active) {
  const T = [['overview','Overview'],['nutrition','Nutrition'],['schedule','Schedule'],['notes','Notes']];
  return `<div class="ptabs">${T.map(([k, l]) =>
    `<div class="pt ${k === active ? 'on' : ''}" data-go="plan/${k}">${l}</div>`).join('')}</div>`;
}

const HEAD_SUBTITLE = {
  set: 'Targets set by your coach',
  loading: 'Loading your targets…',
  offline: 'Targets will show when you reconnect',
  unset: 'Log meals — your coach can set targets any time',
};
function head() {
  const goal = S.planGoalLabel;
  return `
  <div class="screen-title">Plan</div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:800">Your nutrition plan</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:3px">${HEAD_SUBTITLE[S.planTargetsState]}</div>
    </div>
    ${goal ? `<span class="status-pill b">${esc(goal)}</span>` : ''}
  </div>`;
}

// Real coach-set targets when present; a loading card while hydrating; an honest offline card
// with retry when the fetch failed and nothing is cached; honest dashes when genuinely unset.
function targetsRow() {
  const state = S.planTargetsState;
  if (state === 'loading') {
    return `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
    <div><div class="tt">Loading your targets…</div><div class="ts">Reading what your coach set.</div></div></div>`;
  }
  if (state === 'offline') {
    return `<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your plan</div>
    <div class="sd-s">Your targets will show when you reconnect — nothing is lost.</div>
    <div class="sd-cta"><button class="btn ghost sm" data-act="retryProfile">Retry</button></div></div>`;
  }
  const T = S.planTargets || {};
  return `<div class="macro-row">
    <div class="macro"><div class="mv">${T.protein != null ? esc(T.protein) + 'g' : '—'}</div><div class="mk">Protein</div></div>
    <div class="macro"><div class="mv">${T.calories != null ? esc(T.calories) : '—'}</div><div class="mk">Calories</div></div>
    <div class="macro"><div class="mv">${T.weight != null ? esc(T.weight) + ' lb' : '—'}</div><div class="mk">Target wt</div></div>
  </div>`;
}

// Objective-card copy per honest state — loading/offline never assert the coach set nothing.
const OBJECTIVE_COPY = {
  set: (T) => ({
    title: 'Hit your targets, log every meal',
    body: `Your coach set ${T.protein != null ? T.protein + 'g protein' : 'your targets'}${T.calories != null ? ` and ${T.calories} calories` : ''}. Nutrition is 50% of your score — consistency is the win.`,
  }),
  loading: () => ({
    title: 'Log every meal, on time',
    body: 'Loading your targets… Consistency is the plan either way: three meals with photo proof and your recovery check-in each day.',
  }),
  offline: () => ({
    title: 'Log every meal, on time',
    body: 'Your targets will show when you reconnect. Consistency is the plan either way: three meals with photo proof and your recovery check-in each day.',
  }),
  unset: () => ({
    title: 'Log every meal, on time',
    body: 'Your coach hasn’t set targets yet. Consistency is the plan: three meals with photo proof and your recovery check-in each day.',
  }),
};
// Footnote under the Coach Targets card — stays silent for loading/offline since targetsRow()
// already renders the full loading/offline card there; never repeats the "not set" claim.
const COACH_TARGETS_NOTE = {
  set: 'Set by your coach. Live progress lives on Home.',
  loading: '',
  offline: '',
  unset: 'No targets set yet — your coach can add them any time.',
};

const overview = () => {
  const state = S.planTargetsState;
  const T = S.planTargets;
  const obj = OBJECTIVE_COPY[state](T);
  return `
  <div class="eyebrow">Today's Objective</div>
  <section class="card pad" style="display:flex;gap:14px;align-items:flex-start">
    <div class="req-icon b" style="width:44px;height:44px;border-radius:14px">${icon('bolt', 21)}</div>
    <div>
      <div style="font-size:17px;font-weight:800;letter-spacing:-0.01em">${obj.title}</div>
      <p style="font-size:14px;font-weight:600;color:var(--text-2);line-height:1.5;margin-top:6px">${obj.body}</p>
    </div>
  </section>

  <div class="eyebrow">Plan Summary</div>
  <div class="tiles2">
    <div class="tile"><div class="k">Goal</div><div class="v">${esc(S.planGoalLabel || '—')}</div></div>
    <div class="tile"><div class="k">Target weight</div><div class="v">${S.weight.target != null ? S.weight.target + ' lb' : '—'}</div></div>
    <div class="tile"><div class="k">Current</div><div class="v">${S.weight.current != null ? S.weight.current + ' lb' : '—'}</div></div>
    <div class="tile"><div class="k">Protein target</div><div class="v">${T && T.protein != null ? T.protein + 'g' : '—'}</div></div>
  </div>

  <div class="eyebrow">Coach Targets</div>
  <section class="card pad">
    ${targetsRow()}
    ${COACH_TARGETS_NOTE[state] ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:8px">${COACH_TARGETS_NOTE[state]}</div>` : ''}
  </section>

  <div class="eyebrow">Need clarity?</div>
  <div class="btn-row">
    <button class="btn ghost sm" style="flex:1" data-go="messages">${icon('message', 17)} Ask Coach</button>
    <button class="btn primary sm" style="flex:1" data-go="plan/notes">${icon('sparkle', 17)} Ask AI</button>
  </div>
  <div style="height:10px"></div>`;
};

// Nutrition-tab eyebrow suffix per honest state — the false "not set yet" claim only ever
// shows for a genuinely unset coach, never while loading or offline.
const NUTRITION_EYEBROW_SUFFIX = { set: '', loading: ' · loading…', offline: ' · offline', unset: ' · not set yet' };

const nutrition = () => `
  <div class="eyebrow">Macro Targets${NUTRITION_EYEBROW_SUFFIX[S.planTargetsState]}</div>
  ${targetsRow()}

  <div class="eyebrow">Build Your Plate</div>
  <section class="card pad" style="display:flex;gap:8px">
    ${P.plate.map(p => `<div class="tile" style="flex:1;text-align:center;padding:13px 4px"><div class="v" style="font-size:13.5px;margin-top:0">${p}</div></div>`).join('')}
  </section>

  <div class="eyebrow">Approved Swaps</div>
  <section class="card pad">
    ${P.swaps.map((s, i) => `
      <div style="padding:10px 0;${i < P.swaps.length - 1 ? 'border-bottom:1px solid var(--hairline-soft)' : ''}">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">${s.k}</div>
        <div style="font-size:14px;font-weight:700;margin-top:5px;line-height:1.5">${s.v}</div>
      </div>`).join('')}
  </section>

  <div class="eyebrow">Hydration</div>
  <div class="sidebox">
    <div class="req-icon b" style="width:38px;height:38px;color:var(--cyan);background:var(--cyan-surface)">${icon('droplet', 18)}</div>
    <div><div class="tt">Water with every meal</div>
    <div class="ts">Get some in before practice, drink with each meal, and finish before bed so sleep stays clean. General guidance — not a scored target.</div></div>
  </div>

  <div style="height:16px"></div>
  <button class="btn ghost sm" data-go="plan/notes">${icon('sparkle', 17)} Ask about this nutrition plan</button>
  <div style="height:10px"></div>`;

const schedule = () => `
  <div class="eyebrow">${S.coach.hasCoach ? `The rules, set by ${esc(S.coach.nameMid)}` : 'The rules of your Standard'} · tap one for the why</div>
  <section class="card" style="padding:6px 16px">
    ${CATALOG.map(r => {
      const impact = IMPACT_LABEL[r.impact.kind === 'component' ? r.impact.comp : r.impact.kind];
      const due = r.window.label || `Due by ${fmtMin(r.window.due)}`;
      return `
      <div class="bd-row" data-go="requirement/${r.id}" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="req-icon ${r.accent}" style="width:40px;height:40px">${icon(r.icon, 19)}</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800">${esc(r.title)}${r.required ? '' : ' <small style="color:var(--text-3);font-weight:700">· optional</small>'}</div>
            <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${freqLabel(r.freq)} · ${due}</div>
          </div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <span class="bd-weight">${PROOF[r.proof].label}</span>
          <span class="bd-weight" style="color:var(--${r.accent === 'g' ? 'green-bright' : r.accent === 'p' ? 'purple-bright' : r.accent === 'b' ? 'blue-bright' : 'amber-bright'})">${impact}</span>
        </div>
      </div>`;
    }).join('')}
    ${RT.assigned.map(a => `
      <div class="bd-row" data-go="requirement/${a.id}" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="req-icon ${a.done ? 'g' : 'b'}" style="width:40px;height:40px">${icon(a.icon || 'clipboard', 18)}</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800">${esc(a.title)} <small style="color:var(--blue-bright);font-weight:700">· from coach</small></div>
            <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">One-time · ${a.dueLabel}</div>
          </div>
          ${icon('chevron', 16, 'style="color:var(--text-3)"')}
        </div>
      </div>`).join('')}
  </section>
  <div style="height:6px"></div>
  <div class="sidebox">
    <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 18)}</div>
    <div><div class="tt">Where you complete these</div><div class="ts">This tab is the rulebook. You execute from Home; every requirement above shows up there on its day.</div></div>
  </div>
  <div style="height:10px"></div>`;

const notes = () => `
  <div class="eyebrow">Plan history & updates</div>
  ${P.notes.length ? '' : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
    <div><div class="tt">No plan updates yet</div><div class="ts">When your coach changes your targets, the update shows up here. You can still ask the AI about your plan below.</div></div></div>`}
  <div class="thread">
    ${P.notes.map(n => `
      <div class="msg ${n.who}">
        <div class="av">${n.who === 'coach' ? 'M' : icon('sparkle', 15)}</div>
        <div>
          <div class="who">${esc(n.name)} · ${esc(n.when)}</div>
          <div class="bubble">${esc(n.text)}</div>
        </div>
      </div>`).join('')}
  </div>
  ${composer({ inputId: '', placeholder: 'Ask about the plan…', sendLabel: 'Send' })}
  <div style="height:10px"></div>`;

export default {
  tab: 'plan',
  render({ sub }) {
    const t = sub || 'overview';
    const body = t === 'nutrition' ? nutrition() : t === 'schedule' ? schedule() : t === 'notes' ? notes() : overview();
    return `${head()}${tabs(t)}${body}`;
  },
  async mount(root, { sub }) {
    if ((sub || 'overview') === 'notes') {
      const { wireComposer } = await import('./settings.js');
      wireComposer(root, 'ai', 'OnStandard AI', 'Based on your plan: yes, that fits — keep protein on target and get your water in before practice.');
    }
  },
};
