/* Plan — the athlete's personal nutrition intelligence hub (2026-08-06 redesign).
 *
 * The page answers exactly two questions:
 *   1. "What am I supposed to hit?"  — a compact strip of ONLY the targets actually set.
 *   2. "What does OnStandard already know about how I eat?" — Food Memory: usual meals,
 *      saved orders, the places behind them, and what's been learned from corrections.
 *
 * Memory is built PASSIVELY: repeats surface as one-tap "save it as your usual?" prompts
 * computed from the shared recent-meals cache — the athlete never maintains a database.
 * Saved meals re-log through the same #meal-analysis confirm gate every other path uses
 * (WS7: review before it counts), with no photo and no AI call.
 *
 * The old "Build Your Plate" / "Approved Swaps" cards rendered hardcoded demo constants —
 * the last fabricated content on this screen (flagged in the 2026-07-12 founder worklist).
 * Replaced by Coach Rules, which renders only REAL data (restrictions, coach requirement
 * rows) and says so honestly when there is none. */
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc, composer, planStyleCard } from '../components.js';
import { PROOF, IMPACT_LABEL, freqLabel, fmtMin } from '../requirements.js';
import { foodMemory } from '../food-memory-data.js';
import { recentRows } from '../recent-meals.js';
import { findRepeats, mealSignature, rankForRemaining, remainingToday } from '../food-memory.js';

/* Learned facts (athlete_memory_facts) for the Memory tab — module cache, loaded in mount. */
let FACTS = { uid: null, rows: null };

function tabs(active) {
  const T = [['overview', 'Overview'], ['nutrition', 'Nutrition'], ['schedule', 'Schedule'], ['memory', 'Memory']];
  return `<div class="ptabs">${T.map(([k, l]) =>
    `<div class="pt ${k === active ? 'on' : ''}" data-go="plan/${k}">${l}</div>`).join('')}</div>`;
}

// Intuitive plans surface no numeric targets, so "Targets set by your coach" would contradict
// the body copy — say "Plan style set by …" instead.
const HEAD_SUBTITLE = (who, hasTargets) => ({
  set: hasTargets ? `Targets set by your ${who}` : `Plan style set by your ${who}`,
  loading: 'Loading your targets…',
  offline: 'Targets will show when you reconnect',
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

/* ---------------- shared honest-state cards ---------------- */
const loadingCard = () => `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
  <div><div class="tt">Loading your targets…</div><div class="ts">Reading what your ${S.coach.noun} set.</div></div></div>`;
const offlineCard = () => `<div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
  <div class="sd-t">Can't reach your plan</div>
  <div class="sd-s">Your targets will show when you reconnect — nothing is lost.</div>
  <div class="sd-cta"><button class="btn ghost sm" data-act="retryProfile">Retry</button></div></div>`;

/* ---------------- "What am I supposed to hit?" — the compact strip ----------------
   Only targets that are actually SET render a chip; meals/day is always real (the standard).
   Style gates hold: an Intuitive athlete sees tracked signals, never numbers. */
function compactTargets() {
  const state = S.planTargetsState;
  if (state === 'loading') return loadingCard();
  if (state === 'offline') return offlineCard();
  const PS = S.planStyle;
  if (!PS.showMacros && !PS.showCalories) {
    const tracked = (S.trackedSignalLabels || []).join(' · ');
    return `<div class="macro-row">
      <div class="macro" style="flex:2"><div class="mv" style="font-size:15px;line-height:1.35">${tracked ? esc(tracked) : 'Check-in signals'}</div><div class="mk">What you're tracking</div></div>
      <div class="macro"><div class="mv">${S.mealsRequiredCount}</div><div class="mk">Meals/day</div></div>
    </div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.5">Your plan doesn't set calorie or macro targets. Your ${esc(S.coach.noun)} can still see the full numbers.</div>`;
  }
  const T = S.planTargets || {};
  const band = PS.knobs && PS.knobs.nutrition;
  const asRange = (v, b) => (v == null ? null : (b > 0 ? `${Math.round(v * (1 - b))}–${Math.round(v * (1 + b))}` : String(v)));
  const chips = [];
  if (PS.showMacros && T.protein != null) {
    chips.push([band && band.protein === 'range' ? asRange(T.protein, band.proteinBand) : `${T.protein}g`, 'Protein']);
  }
  if (PS.showCalories && T.calories != null) {
    chips.push([band && band.calorie === 'range' ? asRange(T.calories, band.calorieBand) : String(T.calories), 'Calories']);
  }
  const w = T.weight != null ? T.weight : S.weight.target;
  if (PS.showMacros && w != null) chips.push([`${w} lb`, 'Target wt']);
  chips.push([String(S.mealsRequiredCount), 'Meals/day']);
  const note = state === 'unset'
    ? (S.coach.hasCoach ? `No targets set yet — your ${S.coach.noun} can add them any time.` : 'No targets set yet. Your score is built from the standard itself.')
    : '';
  // `.macro-row.four` is the design system's own 4-up density step (18px value, 10px label —
  // same as the coach macro strip). A range like "2464–3136" is 9 chars and still clips even
  // there, so values past 8 chars take one more step down. Scale, never clip.
  const mv = (v) => `<div class="mv"${String(v).length > 8 ? ' style="font-size:14px;letter-spacing:-0.02em"' : ''}>${esc(String(v))}</div>`;
  return `<div class="macro-row${chips.length >= 4 ? ' four' : ''}">
    ${chips.map(([v, k]) => `<div class="macro">${mv(v)}<div class="mk">${k}</div></div>`).join('')}
  </div>
  ${note ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0">${note}</div>` : ''}`;
}

/* ---------------- Food Memory plumbing (render-time reads of the shared caches) ---------------- */
const activeItems = () => {
  const fm = foodMemory(RT.userId);
  return fm ? fm.items.filter((i) => i.status !== 'archived') : null; // null = not loaded yet
};
const placesList = () => {
  const fm = foodMemory(RT.userId);
  return fm ? (fm.places || []).filter((p) => p.status !== 'archived') : [];
};
const savedSignature = (it) => mealSignature(Array.isArray(it.items) && it.items.length ? it.items : [it.name]);
/* findRepeats scans every recent meal; render calls suggestions() more than once. Memoized on
   the CACHE ARRAYS' identity (recent-meals and food-memory both hand out one stable array per
   fetch), plus the handled-count — so it recomputes exactly when underlying data actually
   changed, and a render pass costs one Map lookup. */
let SUG = { rows: null, itemsRef: null, handled: -1, val: [] };
function suggestions() {
  const rows = recentRows(RT.userId);
  const fm = foodMemory(RT.userId);
  if (!rows || !fm) return [];
  const handled = (RT.fmHandled || []).length;
  if (SUG.rows === rows && SUG.itemsRef === fm.items && SUG.handled === handled) return SUG.val;
  const items = fm.items.filter((i) => i.status !== 'archived');
  SUG = {
    rows, itemsRef: fm.items, handled,
    val: findRepeats(rows, new Set(items.map(savedSignature)), new Set(RT.fmHandled || [])).slice(0, 2),
  };
  return SUG.val;
}
const placeName = (id) => {
  const p = placesList().find((x) => x.id === id);
  return p ? p.name : null;
};
const macroLine = (it) => {
  const bits = [];
  if (it.protein) bits.push(`${it.protein}g protein`);
  if (it.kcal) bits.push(`${it.kcal} cal`);
  return bits.join(' · ') || '—';
};
const verifiedBadge = (it) => (it.verified_at
  ? `<span class="bd-weight" style="color:var(--green-bright);display:inline-flex;align-items:center;gap:4px">${icon('check', 12)} ${esc(S.coach.noun === 'trainer' ? 'Trainer' : 'Coach')} verified</span>` : '');

/* One saved item row.
   Overview variant: the row exists to be RE-LOGGED — one primary Log button, nothing else.
   Manage variant (Memory tab): the WHOLE ROW is the tap target and opens the edit sheet
   (chevron affordance); Forget lives inside the sheet. Two buttons per row crushed the meal
   name into an ellipsis and turned a review list into a control panel. */
function itemRow(it, { manage = false } = {}) {
  const pl = it.place_id ? placeName(it.place_id) : null;
  const inner = `
    <div class="req-icon b" style="width:40px;height:40px;flex:none">${icon(it.kind === 'supplement' ? 'bolt' : 'utensils', 18)}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:14.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(macroLine(it))}${pl ? ` · ${esc(pl)}` : ''}${it.times_logged > 1 ? ` · logged ${it.times_logged}×` : ''}</div>
      ${it.verified_at ? `<div style="margin-top:5px">${verifiedBadge(it)}</div>` : ''}
    </div>`;
  if (manage) {
    return `
  <div class="bd-row" data-fm-edit="${esc(it.id)}" style="display:flex;align-items:center;gap:12px;cursor:pointer">
    ${inner}
    ${icon('chevron', 16, 'style="color:var(--text-3);flex:none"')}
  </div>`;
  }
  return `
  <div class="bd-row" style="display:flex;align-items:center;gap:12px">
    ${inner}
    <button class="btn primary sm" data-fm-log="${esc(it.id)}" style="width:auto;padding:0 16px;height:36px;flex:none">Log</button>
  </div>`;
}

/* Passive learning surfaced: "you've eaten this 3× — save it?" One tap either way, never a nag
   (a handled signature is remembered in RT). */
function suggestionCards() {
  const sugs = suggestions();
  if (!sugs.length) return '';
  return sugs.map((g) => `
  <div class="lrow" style="margin-bottom:10px;background:rgba(59,130,246,0.08);border:1px solid var(--hairline);border-radius:14px;padding:12px 13px;cursor:default">
    <div class="xico sm" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('sparkle', 16)}</div>
    <div class="xr"><div class="xa">You've eaten this ${g.count}× lately</div>
    <div class="xb">${esc(g.name)} · ${g.protein}g protein · ${g.kcal} cal. Save it as a usual and log it in one tap.</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn primary sm" data-fm-save-sug="${esc(g.signature)}" style="width:auto;padding:0 16px;height:36px">Save it</button>
      <button class="btn ghost sm" data-fm-dismiss-sug="${esc(g.signature)}" style="width:auto;padding:0 16px;height:36px">No thanks</button>
    </div></div>
  </div>`).join('');
}

/* ---------------- What Should I Eat? — Plan useful BEFORE the meal ----------------
   Remaining numbers only for targets actually set; candidates are the athlete's OWN saved
   meals ranked by fit — never generic "healthy foods" they've never logged. */
function whatToEat() {
  const items = activeItems();
  const T = S.planTargets || {};
  const consumed = S.dayConsumed;
  const rem = remainingToday({
    proteinSoFar: consumed.protein, kcalSoFar: consumed.kcal,
    proteinTarget: S.planStyle.showMacros ? T.protein : null,
    kcalTarget: S.planStyle.showCalories ? T.calories : null,
  });
  const parts = [];
  if (rem.kcal != null) parts.push(`~${rem.kcal} calories`);
  if (rem.protein != null) parts.push(`${rem.protein}g protein`);
  const headline = parts.length
    ? `You have ${parts.join(' and ')} left today.`
    : 'Your next meal, from what you actually eat.';
  const noneLeft = S.mealDayProgress.mealsRemaining === 0;
  let body;
  if (noneLeft) {
    body = `<div style="font-size:13px;font-weight:600;color:var(--text-2);line-height:1.5">All required meals are in for today. Anything extra still counts toward your totals.</div>`;
  } else if (items === null) {
    body = ''; // memory not loaded (offline / first paint) — never fake an empty state
  } else if (!items.length) {
    body = `<div style="font-size:13px;font-weight:600;color:var(--text-2);line-height:1.5">As OnStandard learns your usual meals, your best next options show up here ranked against what's left of your day.</div>`;
  } else {
    const ranked = rankForRemaining(items, rem, 3);
    body = ranked.map(({ item, over }) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--hairline-soft)">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px"><span style="overflow:hidden;text-overflow:ellipsis">${esc(item.name)}</span>${item.verified_at ? `<span style="color:var(--green-bright);flex:none;display:inline-flex">${icon('check', 13)}</span>` : ''}</div>
          <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-top:1px">${esc(macroLine(item))}${over ? ' · runs past what’s left' : ''}</div>
        </div>
        <button class="btn ghost sm" data-fm-log="${esc(item.id)}" style="width:auto;padding:0 16px;height:36px;flex:none">Log</button>
      </div>`).join('');
  }
  return `
  <div class="eyebrow">What Should I Eat?</div>
  <section class="card pad">
    <div style="font-size:15px;font-weight:800;letter-spacing:-0.01em">${esc(headline)}</div>
    ${body ? `<div style="margin-top:8px">${body}</div>` : ''}
  </section>`;
}

/* ---------------- Food Memory + Places I Eat (Overview slices) ---------------- */
function foodMemorySection() {
  const items = activeItems();
  if (items === null) return ''; // not loaded — show nothing rather than a false empty state
  const top = items.slice(0, 4);
  return `
  <div class="eyebrow">Your usual meals
    <span class="link" data-go="memory-edit/new">+ Add one</span></div>
  ${suggestionCards()}
  ${top.length ? `<section class="card" style="padding:4px 16px">${top.map((it) => itemRow(it)).join('')}</section>
    ${items.length > top.length ? `<div class="link" style="font-size:12.5px;margin:10px 2px 0;padding:6px 0;cursor:pointer" data-go="plan/memory">See all ${items.length} saved meals</div>` : ''}`
    : (suggestions().length ? '' : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('utensils', 17)}</div>
      <div><div class="tt">OnStandard learns what you eat</div><div class="ts">Log meals like normal. Repeats get offered as one-tap usuals — no database to maintain.</div></div></div>`)}`;
}

function placesSection() {
  const places = placesList();
  const items = activeItems() || [];
  if (!places.length) return '';
  const ordersAt = (pid) => items.filter((i) => i.place_id === pid).length;
  const KIND_LABEL = { restaurant: 'Restaurant', campus: 'Campus dining', team: 'Team dining', home: 'Home', store: 'Grocery', other: '' };
  return `
  <div class="eyebrow">Places you eat</div>
  <section class="card" style="padding:4px 16px">
    ${places.slice(0, 5).map((p) => {
      const n = ordersAt(p.id);
      return `<div class="bd-row" style="display:flex;align-items:center;gap:12px">
        <div class="req-icon p" style="width:38px;height:38px;flex:none">${icon('pin', 17)}</div>
        <div style="flex:1">
          <div style="font-size:14.5px;font-weight:800">${esc(p.name)}</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${KIND_LABEL[p.kind] || ''}${n ? `${KIND_LABEL[p.kind] ? ' · ' : ''}${n} saved order${n === 1 ? '' : 's'}` : ''}</div>
        </div>
      </div>`;
    }).join('')}
  </section>`;
}

/* No dangling controls: "Ask Coach" only when a coach actually exists. */
function askButtons() {
  const linked = S.coach.hasCoach;
  const Who = S.coach.noun === 'trainer' ? 'Trainer' : 'Coach';
  return `${linked ? `<button class="btn ghost sm" style="flex:1" data-go="messages">${icon('message', 17)} Ask ${Who}</button>` : ''}
    <button class="btn primary sm" style="flex:1" data-go="plan/memory">${icon('sparkle', 17)} Ask AI</button>`;
}

/* One-time "plan styles exist now" prompt (0142 release mechanics) — grandfathered accounts only. */
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

const overview = () => `
  ${legacyStylePrompt()}
  ${compactTargets()}
  ${whatToEat()}
  ${foodMemorySection()}
  ${placesSection()}
  ${planStyleCard(S.planStyle, { onChange: 'plan-style' })}
  <div class="eyebrow">Need clarity?</div>
  <div class="btn-row">${askButtons()}</div>
  <div style="height:10px"></div>`;

/* ---------------- Nutrition tab: full targets + Coach Rules (real data only) ---------------- */
const NUTRITION_EYEBROW_SUFFIX = { set: '', loading: ' · loading…', offline: ' · offline', unset: ' · not set yet' };

function targetsRow() {
  const state = S.planTargetsState;
  if (state === 'loading') return loadingCard();
  if (state === 'offline') return offlineCard();
  const T = S.planTargets || {};
  const PS = S.planStyle;
  if (!PS.showMacros && !PS.showCalories) {
    const tracked = (S.trackedSignalLabels || []).join(' · ');
    return `<div class="macro-row">
      <div class="macro" style="flex:2"><div class="mv" style="font-size:15px;line-height:1.35">${tracked ? esc(tracked) : 'Check-in signals'}</div><div class="mk">What you're tracking</div></div>
    </div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin-top:8px;line-height:1.5">Your plan doesn't set calorie or macro targets. Your ${esc(S.coach.noun)} can still see the full numbers.</div>`;
  }
  const band = PS.knobs && PS.knobs.nutrition;
  const asRange = (v, b) => (v == null ? '—' : (b > 0 ? `${Math.round(v * (1 - b))}–${Math.round(v * (1 + b))}` : String(v)));
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

/* Coach Rules: ONLY sections with real data render. Restrictions come from the athlete's own
   structured profile (spec §18.1); meal timing rules come from the real requirement catalog. */
function coachRules() {
  const r = RT.restrictions || {};
  const blocks = [];
  const chips = (list, tone) => list.map((x) => `<span class="bd-weight" ${tone ? `style="color:var(--${tone})"` : ''}>${esc(typeof x === 'string' ? x : `${x.name}${x.severity === 'severe' ? ' · severe' : ''}`)}</span>`).join(' ');
  if (Array.isArray(r.allergies) && r.allergies.length) {
    blocks.push(`<div style="padding:10px 0"><div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">Allergies</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${chips(r.allergies, 'red-bright')}</div></div>`);
  }
  if (Array.isArray(r.intolerances) && r.intolerances.length) {
    blocks.push(`<div style="padding:10px 0"><div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">Intolerances</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${chips(r.intolerances)}</div></div>`);
  }
  if (Array.isArray(r.preferences) && r.preferences.length) {
    blocks.push(`<div style="padding:10px 0"><div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">Preferences</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${chips(r.preferences)}</div></div>`);
  }
  const mealReqs = (S.scheduleCatalog || []).filter((x) => x.impact && (x.impact.comp === 'nutrition' || x.impact.kind === 'component' && x.impact.comp === 'nutrition'));
  if (mealReqs.length) {
    blocks.push(`<div style="padding:10px 0"><div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3)">Timing rules</div>
      ${mealReqs.slice(0, 6).map((x) => `<div style="font-size:13.5px;font-weight:700;margin-top:6px">${esc(x.title)} <span style="color:var(--text-3);font-weight:600">· ${esc(x.window.label || ('due by ' + fmtMin(x.window.due)))}</span></div>`).join('')}</div>`);
  }
  return `
  <div class="eyebrow">Coach Rules</div>
  ${blocks.length ? `<section class="card" style="padding:6px 16px">${blocks.join('<div style="border-top:1px solid var(--hairline-soft)"></div>')}</section>`
    : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">No food rules yet</div><div class="ts">${S.coach.hasCoach ? `When your ${S.coach.noun} adds food guidance, restrictions, or timing rules, they show up here.` : 'Restrictions you add in your profile and any coach guidance show up here.'}</div></div></div>`}`;
}

const nutrition = () => `
  <div class="eyebrow">${S.planStyle.showMacros ? 'Macro Targets' : 'What Your Plan Tracks'}${NUTRITION_EYEBROW_SUFFIX[S.planTargetsState]}</div>
  ${targetsRow()}
  ${coachRules()}
  <div style="height:10px"></div>`;

/* ---------------- Schedule tab (unchanged rulebook) ---------------- */
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

/* ---------------- Memory tab: "What OnStandard Knows" ----------------
   Full review + control: every saved meal and place, editable and forgettable. Learning is
   passive; this tab exists so nothing about it is ever invisible or unremovable. */
function memoryTab() {
  const items = activeItems();
  const places = placesList();
  const facts = (FACTS.uid === RT.userId && Array.isArray(FACTS.rows) ? FACTS.rows : []).filter((f) => f && f.status === 'active');
  return `
  <div class="eyebrow">What OnStandard knows
    <span class="link" data-go="memory-edit/new">+ Add</span></div>
  <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.5;margin:2px 2px 12px">Built automatically as you log — used to read your meals more accurately and recommend food you actually eat. Tap a meal to fix its details or forget it.</div>
  ${items === null ? loadingCard() : items.length
    ? `<section class="card" style="padding:4px 16px">${items.map((it) => itemRow(it, { manage: true })).join('')}</section>`
    : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('utensils', 17)}</div>
      <div><div class="tt">Nothing saved yet</div><div class="ts">Keep logging like normal. When a meal repeats, OnStandard offers to remember it — or add one yourself above.</div></div></div>`}
  ${places.length ? `<div class="eyebrow">Places</div>
  <section class="card" style="padding:4px 16px">
    ${places.map((p) => `<div class="bd-row" style="display:flex;align-items:center;gap:12px">
      <div class="req-icon p" style="width:36px;height:36px;flex:none">${icon('pin', 16)}</div>
      <div style="flex:1"><div style="font-size:14px;font-weight:800">${esc(p.name)}</div></div>
    </div>`).join('')}
  </section>` : ''}
  ${facts.length ? `<div class="eyebrow">Learned from your corrections</div>
  <section class="card pad">
    ${facts.slice(0, 8).map((f) => `<div style="font-size:13.5px;font-weight:700;padding:6px 0">${esc(String((f.value && (f.value.name || f.value.value)) || f.value || '').slice(0, 60))} <span style="color:var(--text-3);font-weight:600">· ${esc(String(f.kind).replace(/_/g, ' '))}</span></div>`).join('')}
  </section>` : ''}
  ${composer({ inputId: '', placeholder: 'Ask about the plan…', sendLabel: 'Send' })}
  <div style="height:10px"></div>`;
}

/* ---------------- wiring ---------------- */
async function warmCaches() {
  const roles = await import('../roles.js');
  const rm = await import('../recent-meals.js');
  const fmd = await import('../food-memory-data.js');
  await Promise.all([
    fmd.warmFoodMemory(roles, RT.userId),
    rm.warmRecent(roles, RT.userId),
    (async () => {
      if (FACTS.uid === RT.userId && FACTS.rows) return;
      const rows = await roles.fetchMyMemoryFacts(RT.userId).catch(() => null);
      if (Array.isArray(rows)) FACTS = { uid: RT.userId, rows };
    })(),
  ]);
}

export default {
  tab: 'plan',
  render({ sub }) {
    const t = sub === 'notes' ? 'memory' : (sub || 'overview'); // legacy #plan/notes links land on Memory
    const body = t === 'nutrition' ? nutrition() : t === 'schedule' ? schedule() : t === 'memory' ? memoryTab() : overview();
    return `${head()}${tabs(t)}${body}`;
  },
  async mount(root, { sub }) {
    const t = sub === 'notes' ? 'memory' : (sub || 'overview');
    if (t === 'memory') {
      const { wireComposer } = await import('./settings.js');
      wireComposer(root, 'ai', 'OnStandard AI', 'Based on your plan: yes, that fits — keep protein on target and get your water in before practice.');
    }
    const explore = root.querySelector('#ps-intro-explore');
    const dismiss = root.querySelector('#ps-intro-dismiss');
    if (explore) explore.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__navigate('plan-style'); });
    if (dismiss) dismiss.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__render(); });

    // Food Memory actions (router only wires data-go/data-act; these need delegation).
    root.addEventListener('click', async (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-fm-log],[data-fm-edit],[data-fm-save-sug],[data-fm-dismiss-sug]');
      if (!el) return;
      if (el.dataset.fmLog) {
        if (act.stageSavedMeal(el.dataset.fmLog)) location.hash = '#meal-analysis';
        return;
      }
      // The whole row navigates to the edit sheet (Forget lives inside it, behind its own
      // two-tap confirm) — a review list, not a control panel.
      if (el.dataset.fmEdit) { window.__go('memory-edit/' + el.dataset.fmEdit); return; }
      if (el.dataset.fmSaveSug) {
        const sug = suggestions().find((g) => g.signature === el.dataset.fmSaveSug);
        if (!sug) return;
        el.disabled = true; el.textContent = 'Saving…';
        await act.saveMemorySuggestion(sug);
        await warmCaches().catch(() => {});
        if (location.hash.startsWith('#plan')) window.__render();
        return;
      }
      if (el.dataset.fmDismissSug) {
        act.dismissMemorySuggestion(el.dataset.fmDismissSug);
        if (location.hash.startsWith('#plan')) window.__render();
      }
    });

    // Warm the shared caches, then repaint EXACTLY ONCE when they transition from empty to
    // loaded. The guard must compare stable loaded-ness booleans, never array identity:
    // activeItems() filters a FRESH array every call, so an identity compare is always
    // "changed" and mount→render→mount becomes a self-sustaining loop (~10 renders/sec,
    // measured) — the WebView reads as frozen. Same freeze class as the roll-call loop.
    // On a failed warm both booleans stay false: no repaint, no loop, honest empty screen.
    const loadedBefore = !!(foodMemory(RT.userId) && recentRows(RT.userId));
    await warmCaches().catch(() => {});
    const loadedAfter = !!(foodMemory(RT.userId) && recentRows(RT.userId));
    if (!loadedBefore && loadedAfter && location.hash.startsWith('#plan')) window.__render();
  },
};
