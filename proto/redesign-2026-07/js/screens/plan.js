import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc, composer, planStyleCard } from '../components.js';
import { PROOF, IMPACT_LABEL, freqLabel, fmtMin } from '../requirements.js';

const P = S.plan;

function tabs(active) {
  const T = [['overview','Overview'],['nutrition','Nutrition'],['schedule','Schedule'],['notes','Notes']];
  return `<div class="ptabs">${T.map(([k, l]) =>
    `<div class="pt ${k === active ? 'on' : ''}" data-go="plan/${k}">${l}</div>`).join('')}</div>`;
}

// Intuitive plans surface no numeric targets, so "Targets set by your coach" would contradict
// the body copy — say "Plan style set by …" instead. `hasTargets` is the same showCalories/
// showMacros surface gate the style turns off.
const HEAD_SUBTITLE = (who, hasTargets) => ({
  set: hasTargets ? `Targets set by your ${who}` : `Plan style set by your ${who}`,
  loading: 'Loading your targets…',
  offline: 'Targets will show when you reconnect',
  // An unlinked athlete has no one who "can set targets any time" — don't name a person who
  // doesn't exist. Same rule as the Ask buttons below.
  unset: S.coach.hasCoach ? `Log meals — your ${who} can set targets any time` : 'Log meals — your score works without targets',
});
function head() {
  const goal = S.planGoalLabel;
  return `
  <div class="screen-title">Plan</div>
  <div style="display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:800">Your nutrition plan</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:3px">${HEAD_SUBTITLE(S.coach.noun, S.planStyle.showMacros || S.planStyle.showCalories)[S.planTargetsState]}</div>
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
    <div><div class="tt">Loading your targets…</div><div class="ts">Reading what your ${S.coach.noun} set.</div></div></div>`;
  }
  if (state === 'offline') {
    return `<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your plan</div>
    <div class="sd-s">Your targets will show when you reconnect — nothing is lost.</div>
    <div class="sd-cta"><button class="btn ghost sm" data-act="retryProfile">Retry</button></div></div>`;
  }
  const T = S.planTargets || {};
  const PS = S.planStyle;

  // INTUITIVE: no calorie or macro number reaches the athlete. The targets still EXIST and the
  // professional still sees them (catching genuine under-fueling is a safety concern) — this is
  // a presentation gate, never a data one. What the athlete gets instead is what their plan
  // actually measures: the signals they're tracking and their hydration.
  if (!PS.showMacros && !PS.showCalories) {
    const tracked = (S.trackedSignalLabels || []).join(' · ');
    return `<div class="macro-row">
      <div class="macro"><div class="mv">${esc(String(S.hydrationTargetLabel || '—'))}</div><div class="mk">Hydration</div></div>
      <div class="macro" style="flex:2"><div class="mv" style="font-size:15px;line-height:1.35">${tracked ? esc(tracked) : 'Check-in signals'}</div><div class="mk">What you're tracking</div></div>
    </div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.5">Your plan doesn't set calorie or macro targets. Your ${esc(S.coach.noun)} can still see the full numbers.</div>`;
  }

  // GUIDED: the same targets expressed as the RANGE the plan actually scores, so the number the
  // athlete reads is the number they're measured against — not a point they'll always miss.
  const band = PS.knobs && PS.knobs.nutrition;
  const asRange = (v, b) => (v == null ? '—' : (b > 0
    ? `${Math.round(v * (1 - b))}–${Math.round(v * (1 + b))}`
    : String(v)));
  const rangeMode = band && (band.protein === 'range' || band.calorie === 'range');
  const protein = band && band.protein === 'range' ? asRange(T.protein, band.proteinBand) : (T.protein != null ? esc(T.protein) + 'g' : '—');
  const calories = band && band.calorie === 'range' ? asRange(T.calories, band.calorieBand) : (T.calories != null ? esc(T.calories) : '—');
  return `<div class="macro-row">
    <div class="macro"><div class="mv">${esc(String(protein))}</div><div class="mk">Protein${rangeMode ? ' range' : ''}</div></div>
    <div class="macro"><div class="mv">${esc(String(calories))}</div><div class="mk">Calories${rangeMode ? ' range' : ''}</div></div>
    <div class="macro"><div class="mv">${T.weight != null ? esc(T.weight) + ' lb' : '—'}</div><div class="mk">Target wt</div></div>
  </div>
  ${rangeMode ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.5">Anywhere in the range scores full credit — that's the point of a flexible plan.</div>` : ''}`;
}

// Objective-card copy per honest state — loading/offline never assert the coach set nothing.
// Meal count is standard-aware (coach standards run 1–6 meals; classic is 3) — never a
// hardcoded "three" (WS7 audit fix). Numbers live in the summary tiles, not repeated here.
const MEAL_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const mealsPhrase = () => {
  const n = S.mealsRequiredCount;
  return `${MEAL_WORD[n] || n} meal${n === 1 ? '' : 's'} with photo proof`;
};
const OBJECTIVE_COPY = {
  // Same gate as head() and targetsRow(): "no numbers reach the athlete" is showMacros OR
  // showCalories being off — gating on showMacros alone contradicted the other two whenever a
  // pro override left calories on with macros hidden.
  set: (who) => (!S.planStyle.showMacros && !S.planStyle.showCalories ? {
    title: 'Fuel well, log every meal',
    // An Intuitive plan has no targets to "hit" — promising some would be the one dishonest
    // sentence on the screen.
    body: `Your plan tracks how food leaves you feeling rather than numbers. Nutrition is ${S.nutritionWeightPct}% of your score — showing up consistently is the win.`,
  } : {
    title: 'Hit your targets, log every meal',
    // Never a hardcoded 50%: the nutrition weight moves with the athlete's style x goal profile.
    body: `Your ${who} set your targets — they're in the summary below. Nutrition is ${S.nutritionWeightPct}% of your score — consistency is the win.`,
  }),
  loading: () => ({
    title: 'Log every meal, on time',
    body: `Loading your targets… Consistency is the plan either way: ${mealsPhrase()} and your recovery check-in each day.`,
  }),
  offline: () => ({
    title: 'Log every meal, on time',
    body: `Your targets will show when you reconnect. Consistency is the plan either way: ${mealsPhrase()} and your recovery check-in each day.`,
  }),
  unset: (who) => ({
    title: 'Log every meal, on time',
    body: `${S.coach.hasCoach ? `Your ${who} hasn’t set targets yet.` : 'No targets are set.'} Consistency is the plan: ${mealsPhrase()} and your recovery check-in each day.`,
  }),
};
// Footnote under the Coach Targets card — stays silent for loading/offline since targetsRow()
// already renders the full loading/offline card there; never repeats the "not set" claim.
const COACH_TARGETS_NOTE = (who) => ({
  set: `Set by your ${who}. Live progress lives on Home.`,
  loading: '',
  offline: '',
  unset: S.coach.hasCoach ? `No targets set yet — your ${who} can add them any time.` : 'No targets set yet. Your score is built from the standard itself.',
});

/* One-time "plan styles exist now" prompt (0142 release mechanics) — shown ONLY to a
 * grandfathered account (S.planStyle.source === 'legacy': real scored history, never made an
 * explicit style choice) so existing athletes learn the new spectrum without their score moving
 * a single point on release day. Dismissible and never reappears once dismissed OR once the
 * athlete engages the picker — this is an announcement, not a recurring nag. Deliberately lives
 * here rather than on Home: Home enforces exactly one attention card (sync/injury), and this is
 * lower-priority than either. */
function legacyStylePrompt() {
  if (RT.planStylePromptSeen || S.planStyle.source !== 'legacy') return '';
  return `
  <div class="lrow" id="ps-intro" style="margin-bottom:10px;background:rgba(59,130,246,0.08);border:1px solid var(--hairline);border-radius:14px;padding:12px 13px;cursor:default">
    <div class="xico sm" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('sparkle', 16)}</div>
    <div class="xr"><div class="xa">Your plan style: Structured</div>
    <div class="xb">OnStandard now supports Guided and Intuitive too — different ways of measuring the same standard. Your score hasn't changed.</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn primary sm" id="ps-intro-explore" style="width:auto;padding:0 14px;height:32px">Explore styles</button>
      <button class="btn ghost sm" id="ps-intro-dismiss" style="width:auto;padding:0 14px;height:32px">Not now</button>
    </div></div>
  </div>`;
}

const overview = () => {
  const state = S.planTargetsState;
  const T = S.planTargets;
  const obj = OBJECTIVE_COPY[state](S.coach.noun);
  // ONE home per number (WS7/WS8 dedup): the summary tiles carry goal/weight/protein here;
  // the full targets row lives on the Nutrition tab only (it used to render on BOTH tabs,
  // and protein/goal appeared up to 3× on this screen).
  return `
  ${legacyStylePrompt()}
  ${planStyleCard(S.planStyle, { onChange: 'plan-style' })}
  <div class="eyebrow">Today's Objective</div>
  <section class="card pad" style="display:flex;gap:14px;align-items:flex-start">
    <div class="req-icon b" style="width:44px;height:44px;border-radius:14px">${icon('bolt', 21)}</div>
    <div>
      <div style="font-size:17px;font-weight:800;letter-spacing:-0.01em">${obj.title}</div>
      <p style="font-size:14px;font-weight:600;color:var(--text-2);line-height:1.5;margin-top:6px">${obj.body}</p>
    </div>
  </section>

  ${planSummary(state, T)}

  ${everythingUnset(state)
    ? ''
    : `<div class="eyebrow">Need clarity?</div>
  <div class="btn-row">${askButtons()}</div>`}
  <div style="height:10px"></div>`;
};

/* A tile with nothing in it should say so, not render an em-dash at the same 20px/800 weight as
   a real number. `Not set yet` is a state noun, deliberately not the imperative "Set" — the
   athlete isn't the one who sets these. */
const tile = (k, value) => value == null
  ? `<div class="tile unset"><div class="k">${k}</div><div class="v">Not set yet</div></div>`
  : `<div class="tile"><div class="k">${k}</div><div class="v">${value}</div></div>`;

/* Every summary value is absent AND the absence is real (not merely un-hydrated). The weight is
   self-logged and independent of the coach, so a logged weight alone keeps the grid. */
function everythingUnset(state) {
  return state === 'unset'
    && !S.planGoalLabel
    && S.weight.current == null
    && S.weight.target == null
    && !(S.planTargets && (S.planTargets.weight != null || S.planTargets.protein != null));
}

/* No dangling controls: "Ask Coach" used to render for an athlete with no coach and no trainer,
   pointing at a person who doesn't exist. Gate on hasCoach, not on the noun. */
function askButtons() {
  const linked = S.coach.hasCoach;
  const Who = S.coach.noun === 'trainer' ? 'Trainer' : 'Coach';
  return `${linked ? `<button class="btn ghost sm" style="flex:1" data-go="messages">${icon('message', 17)} Ask ${Who}</button>` : ''}
    <button class="btn primary sm" style="flex:1" data-go="plan/notes">${icon('sparkle', 17)} Ask AI</button>`;
}

/* Overview used to render the tile grid with em-dash fallbacks in ALL FOUR target states, so an
   athlete who was merely offline saw exactly what one whose coach had set nothing saw. The
   Nutrition tab's targetsRow() has resolved these states honestly for a while; this mirrors it. */
function planSummary(state, T) {
  if (state === 'loading') {
    return `<div class="eyebrow">Plan Summary</div>
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
    <div><div class="tt">Loading your plan…</div><div class="ts">Reading what your ${S.coach.noun} set.</div></div></div>`;
  }
  if (state === 'offline') {
    return `<div class="eyebrow">Plan Summary</div>
    <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your plan</div>
    <div class="sd-s">Your targets will show when you reconnect — nothing is lost.</div>
    <div class="sd-cta"><button class="btn ghost sm" data-act="retryProfile">Retry</button></div></div>`;
  }
  if (everythingUnset(state)) {
    const who = S.coach.noun;
    return `<div class="eyebrow">Plan Summary</div>
    <section class="state-demo">
      <div class="sd-ic">${icon('clipboard', 24)}</div>
      <div class="sd-t">No targets yet</div>
      <div class="sd-s">${S.coach.hasCoach
        ? `Your ${who} hasn't set numbers yet. Keep logging — your score doesn't wait for them, and they'll appear here the moment they land.`
        : `You're not linked to a coach or trainer yet. Keep logging — OnStandard scores your day against the standard itself, with or without numbers.`}</div>
      <div class="sd-cta" style="display:flex;gap:8px;margin-top:16px">${askButtons()}</div>
    </section>`;
  }
  const w = (T && T.weight != null) ? T.weight : S.weight.target;
  return `<div class="eyebrow">Plan Summary</div>
  <div class="tiles2">
    ${tile('Goal', S.planGoalLabel ? esc(S.planGoalLabel) : null)}
    ${S.planStyle.showMacros ? tile('Target weight', w != null ? w + ' lb' : null) : ''}
    ${tile('Current', S.weight.current != null ? S.weight.current + ' lb' : null)}
    ${S.planStyle.showMacros
      ? tile('Protein target', T && T.protein != null ? T.protein + 'g' : null)
      : tile('Hydration', esc(String(S.hydrationTargetLabel)))}
  </div>
  ${noteFor(state)}`;
}

function noteFor(state) {
  const n = COACH_TARGETS_NOTE(S.coach.noun)[state];
  return n ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0">${n}</div>` : '';
}

// Nutrition-tab eyebrow suffix per honest state — the false "not set yet" claim only ever
// shows for a genuinely unset coach, never while loading or offline.
const NUTRITION_EYEBROW_SUFFIX = { set: '', loading: ' · loading…', offline: ' · offline', unset: ' · not set yet' };

const nutrition = () => `
  <div class="eyebrow">${S.planStyle.showMacros ? 'Macro Targets' : 'What Your Plan Tracks'}${NUTRITION_EYEBROW_SUFFIX[S.planTargetsState]}</div>
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

  <div style="height:10px"></div>`;

/* Attribute the rules to a person ONLY when that person actually set them. Having a coach or
   trainer is not enough: RT.reqSets is only loaded for a team link, so a trainer's client saw
   "The rules, set by Sam" over the app's BUILT-IN defaults their trainer has never seen. Gate on
   real requirement rows and the sentence is true in every case. */
const rulesEyebrow = () => ((RT.reqSets || []).length && S.coach.hasCoach
  ? `The rules, set by ${esc(S.coach.nameMid)}`
  : 'The rules of your Standard');

const schedule = () => `
  <div class="eyebrow">${rulesEyebrow()} · tap one for the why</div>
  <section class="card" style="padding:6px 16px">
    ${S.scheduleCatalog.map(r => {
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
            <div style="font-size:15px;font-weight:800">${esc(a.title)} <small style="color:var(--blue-bright);font-weight:700">· from ${S.coach.noun}</small></div>
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
    <div><div class="tt">No plan updates yet</div><div class="ts">When your ${S.coach.noun} changes your targets, the update shows up here. You can still ask the AI about your plan below.</div></div></div>`}
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
    const explore = root.querySelector('#ps-intro-explore');
    const dismiss = root.querySelector('#ps-intro-dismiss');
    if (explore) explore.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__navigate('plan-style'); });
    if (dismiss) dismiss.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__render(); });
  },
};
