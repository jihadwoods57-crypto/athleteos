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
import { esc, composer, planStyleCard, emptyState, skeletonRows, errorState } from '../components.js';
import { PROOF, IMPACT_LABEL, freqLabel, fmtMin } from '../requirements.js';
import { accentVar } from '../score-band.js';
import { foodMemory } from '../food-memory-data.js';
import { recentRows } from '../recent-meals.js';
import { findRepeats, mealSignature, rankForRemaining, remainingToday } from '../food-memory.js';

/* Learned facts (athlete_memory_facts) for the Memory tab — module cache, loaded in mount. */
let FACTS = { uid: null, rows: null };

const PLAN_SUBS = ['overview', 'nutrition', 'schedule', 'memory'];
function planSub(sub) {
  const t = sub === 'notes' ? 'memory' : (sub || 'overview'); // legacy #plan/notes lands on Memory
  if (PLAN_SUBS.includes(t)) return t;
  console.warn('[plan] unknown sub-tab', JSON.stringify(sub), '- showing Overview');
  return 'overview';
}

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
  unset: S.coach.hasCoach ? `Log meals. Your ${who} can set targets any time` : 'Log meals. Your score works without targets',
});
function head(t) {
  const goal = S.planGoalLabel;
  // ONE line under the title. "Your nutrition plan" restated the screen title and the tab
  // label; the state subtitle is the only sentence here doing work.
  // Schedule and Memory describe THEIR OWN content: the targets-fetch subtitle used to leak
  // onto them, so "Loading your targets…" sat over a schedule that was fully rendered below
  // it — the header contradicting the page.
  const sub = t === 'schedule' ? 'Every requirement and its window'
    : t === 'memory' ? 'What OnStandard knows about how you eat'
      : HEAD_SUBTITLE(S.coach.noun, S.planStyle.showMacros || S.planStyle.showCalories)[S.planTargetsState];
  return `
  <div class="screen-title">Plan</div>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2)">${sub}</div>
    ${/* "Goal · Perform", not a bare "Perform" — an unlabeled word in an outlined pill reads as
          a status you were assigned, not the goal you picked. One word of context decodes it. */''}
    ${goal ? `<span class="status-pill b" style="flex:none">Goal · ${esc(goal)}</span>` : ''}
  </div>`;
}

/* ---------------- shared honest-state cards ----------------
   These were two hand-rolled one-offs (a sidebox for loading, a bespoke .state-demo for offline)
   sitting next to components.js's skeletonRows/errorState, which every coach screen already used.
   Same states, two vocabularies. The primitives now do both, so a change to how the app expresses
   "loading" or "we couldn't reach this" lands on Plan too. */
const loadingCard = () => skeletonRows(2, 'Loading your targets');
const offlineCard = () => errorState({
  title: "Can't reach your plan",
  body: 'Your targets will show when you reconnect. Nothing is lost, and logging still counts in the meantime.',
  retryId: 'plan-retry',
});

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
      <div class="macro"><div class="mv">${S.mealsRequiredCount}</div><div class="mk">Required meals</div></div>
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
  // "Meals/day" read as a contradiction next to a Home that tracks four slots. It counts the
  // REQUIRED ones (snack is the loggable bonus, founder standard) — label it as what it is.
  chips.push([String(S.mealsRequiredCount), 'Required meals']);
  const note = state === 'unset'
    ? (S.coach.hasCoach ? `No targets set yet. Your ${S.coach.noun} can add them any time.` : 'No targets set yet. Your score is built from the standard itself.')
    : '';
  // With no targets set, `chips` holds ONLY the required-meals count — and a lone .macro tile
  // made a static config value ("3") the single largest element on the tab, sitting directly
  // above "No targets set yet". A number that never changes and asks for nothing must not
  // out-shout everything that does. One sentence carries both facts at body weight.
  if (chips.length === 1) {
    return `<div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55;margin:2px 2px 0">
      Your standard: <b style="color:var(--text)">${S.mealsRequiredCount} required meals a day</b>, logged with a photo.
      ${esc(note)}</div>`;
  }
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
   Overview variant: exists to be RE-LOGGED — name (inline check when verified), macros, one
   Log button. Frequency counts and the full verified badge are management detail and live on
   the Memory tab only.
   Manage variant (Memory tab): the WHOLE ROW opens the edit sheet (chevron); Forget lives
   inside the sheet. Two buttons per row crushed names into ellipsis. */
function itemRow(it, { manage = false } = {}) {
  const pl = it.place_id ? placeName(it.place_id) : null;
  const check = it.verified_at
    ? `<span style="color:var(--green-bright);flex:none;display:inline-flex">${icon('check', 13)}</span>` : '';
  const name = `<div style="font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:5px;min-width:0">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>${manage ? '' : check}</div>`;
  if (manage) {
    return `
  <div class="bd-row" data-fm-edit="${esc(it.id)}" style="display:flex;align-items:center;gap:12px;cursor:pointer">
    <div class="req-icon b" style="width:40px;height:40px;flex:none">${icon(it.kind === 'supplement' ? 'bolt' : 'utensils', 18)}</div>
    <div style="flex:1;min-width:0">
      ${name}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(macroLine(it))}${pl ? ` · ${esc(pl)}` : ''}${it.times_logged > 1 ? ` · logged ${it.times_logged}×` : ''}</div>
      ${it.verified_at ? `<div style="margin-top:5px">${verifiedBadge(it)}</div>` : ''}
    </div>
    ${icon('chevron', 16, 'style="color:var(--text-3);flex:none"')}
  </div>`;
  }
  return `
  <div class="bd-row" style="display:flex;align-items:center;gap:12px">
    <div class="req-icon b" style="width:40px;height:40px;flex:none">${icon(it.kind === 'supplement' ? 'bolt' : 'utensils', 18)}</div>
    <div style="flex:1;min-width:0">
      ${name}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(macroLine(it))}${pl ? ` · ${esc(pl)}` : ''}</div>
    </div>
    <button class="btn primary sm" data-fm-log="${esc(it.id)}" style="width:auto;padding:0 16px;height:36px;flex:none">Log</button>
  </div>`;
}

/* Passive learning surfaced. ONE card at a time (the top repeat), one question, the facts,
   two buttons. Save and dismiss both remember the answer, so it never nags. */
function suggestionCards() {
  const g = suggestions()[0];
  if (!g) return '';
  return `
  <div class="lrow" style="margin-bottom:10px;background:rgba(59,130,246,0.08);border:1px solid var(--hairline);border-radius:14px;padding:12px 13px;cursor:default">
    <div class="xico sm" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('sparkle', 16)}</div>
    <div class="xr"><div class="xa">Save this as a usual?</div>
    <div class="xb">${esc(g.name)} · ${g.protein}g protein · ${g.kcal} cal · eaten ${g.count}×</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn primary sm" data-fm-save-sug="${esc(g.signature)}" style="width:auto;padding:0 16px;height:36px">Save</button>
      <button class="btn ghost sm" data-fm-dismiss-sug="${esc(g.signature)}" style="width:auto;padding:0 16px;height:36px">No thanks</button>
    </div></div>
  </div>`;
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
    body = `<div style="font-size:13px;font-weight:600;color:var(--text-2);line-height:1.5">All meals are in. Anything extra still counts.</div>`;
  } else if (items === null || !items.length) {
    // No saved meals to rank: the card is the remaining numbers, or nothing. The usuals
    // section below already explains how memory fills in — never two empty states in a row.
    if (!parts.length) return '';
    body = '';
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
  <div class="eyebrow">Your usual meals</div>
  ${suggestionCards()}
  ${top.length ? `<section class="card" style="padding:4px 16px">${top.map((it) => itemRow(it)).join('')}</section>
    ${items.length > top.length ? `<div class="link" style="font-size:12.5px;margin:10px 2px 0;padding:6px 0;cursor:pointer" data-go="plan/memory">See all ${items.length}</div>` : ''}`
    : (suggestions().length ? '' : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('utensils', 17)}</div>
      <div><div class="tt">OnStandard learns what you eat</div><div class="ts">Repeated meals show up here for one-tap logging.</div></div></div>`)}`;
}

/* Places, distilled to a chip row: the names ARE the information here. Kind labels, icons,
   and per-place order counts are management detail — the Memory tab carries them. */
function placesSection() {
  const places = placesList();
  if (!places.length) return '';
  return `
  <div class="eyebrow">Places you eat</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    ${places.slice(0, 6).map((p) => `<span class="bd-weight" data-go="plan/memory" style="cursor:pointer;padding:8px 13px">${esc(p.name)}</span>`).join('')}
  </div>`;
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

/* Overview answers the two questions and stops: what to hit (strip), what to eat next
   (recommendations + usuals + places). The plan-style card moved to Nutrition — it explains
   HOW the plan measures, which is that tab's whole subject — and the ask buttons stand
   without a "Need clarity?" label restating them. */
const overview = () => `
  ${legacyStylePrompt()}
  ${compactTargets()}
  ${whatToEat()}
  ${foodMemorySection()}
  ${placesSection()}
  <div class="btn-row" style="margin-top:26px">${askButtons()}</div>
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
  // Nothing set at all: teach, don't render placeholders. This used to fall through to the three
  // .macro tiles below, each holding a single "—" — an identical-card grid saying nothing three
  // times, on the screen whose entire job is telling the athlete what to hit. An empty state that
  // explains the situation and offers the one real action is the honest shape.
  const T0 = T.protein == null && T.calories == null && (T.weight == null && S.weight.target == null);
  if (state === 'unset' || T0) {
    return emptyState({
      icon: 'target',
      title: 'No targets set yet',
      body: S.coach.hasCoach
        ? `Your ${S.coach.noun} can set protein, calories and a target weight any time. Until then your score comes from the standard itself: log your meals and it still counts in full.`
        : 'Your score is built from the standard itself, so it works without targets. Connect a coach and they can set protein, calories and a target weight for you.',
      action: S.coach.hasCoach ? { label: 'Log a meal', go: 'camera' } : { label: 'Connect a coach', go: 'connect' },
    });
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
      <div><div class="tt">No food rules yet</div><div class="ts">${S.coach.hasCoach ? `Your ${S.coach.noun}'s food guidance will show up here.` : 'Restrictions you add in your profile show up here.'}</div></div></div>`}`;
}

const nutrition = () => `
  <div class="eyebrow">${S.planStyle.showMacros ? 'Macro Targets' : 'What Your Plan Tracks'}${NUTRITION_EYEBROW_SUFFIX[S.planTargetsState]}</div>
  ${targetsRow()}
  ${planStyleCard(S.planStyle, { onChange: 'plan-style' })}
  ${coachRules()}
  <div style="height:10px"></div>`;

/* ---------------- Schedule tab (unchanged rulebook) ---------------- */
const rulesEyebrow = () => ((RT.reqSets || []).length && S.coach.hasCoach
  ? `The rules, set by ${esc(S.coach.nameMid)}`
  : 'The rules of your Standard');

const schedule = () => `
  <div class="eyebrow">${rulesEyebrow()} · tap one for the why</div>
  <section class="card" style="padding:6px 16px">
    ${/* Chronological, not catalog order. The catalog places Morning Weight at index 2, so a
          list HEADED by its own timekeeping ("Due by …") rendered a 9:00 AM item third — between
          a 2:00 PM lunch and an 8:30 PM dinner. Ordering is the one thing a list says for free;
          this one was saying something false. Day-anchored rows (weekly) sort by due within the
          day; unwindowed rows keep their catalog position at the end. */''}
    ${[...S.scheduleCatalog].sort((a, b) => (a.window && a.window.due || 24 * 60) - (b.window && b.window.due || 24 * 60)).map(r => {
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
          <span class="bd-weight" style="color:${accentVar(r.accent)}">${impact}</span>
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
  <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.5;margin:2px 2px 12px">Learned from your logging. Tap a meal to fix or forget it.</div>
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
    // Normalize the sub-route through ONE list. An unknown SUB used to be swallowed silently:
    // #plan/bogus rendered Overview's content with NO tab lit, so the strip showed four
    // inactive tabs — an unknown ROUTE gets a first-class not-found screen (router.js), but an
    // unknown sub left the navigation lying. Unknowns now land on Overview WITH its tab lit,
    // and warn in the console so the bad link gets fixed instead of surviving unreported.
    const t = planSub(sub);
    const body = t === 'nutrition' ? nutrition() : t === 'schedule' ? schedule() : t === 'memory' ? memoryTab() : overview();
    return `${head(t)}${tabs(t)}${body}`;
  },
  async mount(root, { sub }) {
    // A bad sub landed on Overview with the tab lit (render's planSub), but the wrong hash was
    // still in the bar — rewrite it so the address agrees with the pixels, replace() so the bad
    // link never enters history.
    if (sub && planSub(sub) === 'overview' && sub !== 'overview' && sub !== '') {
      if (!PLAN_SUBS.includes(sub) && sub !== 'notes') { location.replace('#plan'); return; }
    }
    // Loading must never be a terminal state. profileLoading defaults TRUE until the first
    // hydrate settles it — so any path where the hydrate never runs (or never returns) left this
    // screen saying "Loading your targets…" forever, with the offline card it should fall to
    // sitting unreached ten lines up. Eight seconds is the ceiling; past it the honest answer is
    // "can't reach your plan", with the Retry this screen already wires.
    if (S.planTargetsState === 'loading') {
      setTimeout(() => {
        if (!root.isConnected || S.planTargetsState !== 'loading') return;
        RT.profileOffline = true; RT.profileLoading = false;
        window.__render();
      }, 8000);
    }

    const t = planSub(sub);
    if (t === 'memory') {
      const { wireComposer } = await import('./settings.js');
      wireComposer(root, 'ai', 'OnStandard AI', 'Based on your plan: yes, that fits — keep protein on target and get your water in before practice.');
    }
    // errorState() hands the caller a button id rather than a data-act, so the shared primitive
    // stays free of any one screen's action vocabulary. Wire it to the same recovery the bespoke
    // offline card used to call directly.
    const retry = root.querySelector('#plan-retry');
    if (retry) retry.addEventListener('click', async () => { await act.retryProfile(); window.__render(); });

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
