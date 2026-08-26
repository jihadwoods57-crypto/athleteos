/* Plan — the living definition of the athlete's standard.
 *
 * FOUR TABS, ONE QUESTION EACH. Nothing answers a question another tab owns:
 *   Today         what does today ask of me, and what is left?
 *   Nutrition     what am I supposed to hit, and how is that graded?
 *   Requirements  what are the rules, and which ones move my number?
 *   Food Memory   what has OnStandard learned about how I eat?
 *
 * THE STRUCTURE, WHICH IS THE SAME ON ALL FOUR (2026-08-09 distill pass). Every tab is
 *
 *     eyebrow  ->  content  ->  (group -> rows)*  ->  ask
 *
 * and nothing else. In particular there is no explanatory prose between a heading and the thing
 * it heads. The first build of this page had eighteen grey paragraphs across four tabs, and once
 * body copy sits at every level the eyebrow / row-title / row-sub ladder stops reading as a
 * hierarchy at all. What went, and why it was safe to lose:
 *
 *  · The standard summary on Today ("3 meals a day, a recovery check-in before bed, weigh-ins
 *    Mon / Wed / Fri…") named the same rules the list beneath it states WITH their deadlines and
 *    live status. The list is the standard.
 *  · The nutrition summary printed consumed-of-target in three tiles and then the remainder in a
 *    sentence: the same arithmetic twice, plus a meals-in tile duplicating the count in the
 *    section label. It is now the one number that decides the next meal.
 *  · Plan style carried three lines of `how` and a second paragraph about a differing preference,
 *    under a row that already names the style. `how` explains all three styles on the plan-style
 *    screen, one tap away, which is where somebody goes when they want it.
 *  · The scored-weights strip had a paragraph explaining that four labelled shares adding to 100
 *    are four labelled shares adding to 100.
 *  · Group headers carried a count that the rows underneath already were.
 *  · Ask was an eyebrow, three suggestion chips, a two-line card and a full-width coach button,
 *    repeated on all four tabs. The chips were the ask SCREEN's own opening content, so each tab
 *    rendered a preview of the next screen. It is one row now, two when a coach exists.
 *
 * The honesty rules that survive all of it: weights are read from the live engine and never
 * hardcoded; a rule is attributed to a coach only when a coach requirement_set actually governs;
 * and copy that names a coach is gated on there being one.
 */
import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc, skeletonRows, errorState } from '../components.js';
import { PROOF, freqLabel, fmtMin } from '../requirements.js';
import { accentVar } from '../score-band.js';
import { foodMemory } from '../food-memory-data.js';
import { recentRows } from '../recent-meals.js';
import { findRepeats, mealSignature, rankForRemaining, remainingToday } from '../food-memory.js';
import { askSuggestions } from '../plan-ask.js';

/* Learned facts (athlete_memory_facts) for Food Memory — module cache, loaded in mount. */
let FACTS = { uid: null, rows: null };
/* The goal panel's open state. A module variable on purpose: RT persists to localStorage, so
   putting it there would make "I opened the goal once" a permanent setting. */
let GOAL_OPEN = false;

/* Canonical sub-routes + the aliases that keep every link ever shipped alive. */
const PLAN_SUBS = ['overview', 'nutrition', 'requirements', 'memory'];
const SUB_ALIAS = { notes: 'memory', schedule: 'requirements', food: 'memory' };
function planSub(sub) {
  const raw = sub || 'overview';
  const t = SUB_ALIAS[raw] || raw;
  if (PLAN_SUBS.includes(t)) return t;
  console.warn('[plan] unknown sub-tab', JSON.stringify(sub), '- showing Overview');
  return 'overview';
}

/* "Today", not "Overview": the tab leads with today's required actions, and the shorter word is
   what lets four labels fit a phone without the strip becoming a scroller. The ROUTE KEY stays
   `overview` so no link ever shipped has to change. */
function tabs(active) {
  const T = [['overview', 'Today'], ['nutrition', 'Nutrition'], ['requirements', 'Requirements'], ['memory', 'Food Memory']];
  // The underline is ONE element that travels, not a ::after that appears under whichever tab is
  // lit. Four labels of four different widths meant the marker teleported across the strip with
  // nothing connecting where it was to where it went — the clearest "you are here" signal on the
  // screen, and the only one with no continuity. mount() positions it; it renders at zero width
  // so a frame before measurement shows nothing rather than a bar parked at the left edge.
  return `<div class="ptabs">${T.map(([k, l]) =>
    `<div class="pt ${k === active ? 'on' : ''}" data-go="plan/${k}">${l}</div>`).join('')}<i class="pt-ink" aria-hidden="true"></i></div>`;
}

/* Where the underline was last measured, so a tab change can travel FROM it.
 *
 * Module-level and keyed by tab, for the same reason every reveal in motion.js is keyed:
 * window.__render() re-runs mount(), and Plan repaints for things that have nothing to do with
 * which tab is lit (targets landing, the goal pill opening, the offline timeout). An unguarded
 * slide would replay on every one of those, so the marker would crawl back and forth under a
 * reader who never touched it. Same tab as last time = snap, no transition. */
let INK_AT = null;
let INK_GEO = null;

/* The ink's own width is a fixed 100px and the real width comes from scaleX, so the marker moves
 * and resizes on the compositor. Animating its `width` would have been the more obvious code and
 * is the thing DESIGN.md bans outright; this is the same transform-origin/scaleX idiom the bar
 * fills already use. */
const INK_BASE = 100;

function placeInk(strip, on) {
  if (!strip || !on) return;
  const ink = strip.querySelector('.pt-ink');
  if (!ink) return;
  const key = on.getAttribute('data-go') || '';
  const geo = { left: on.offsetLeft, width: on.offsetWidth };
  // Zero width means the strip has not been laid out yet (fonts still pending, or a detached
  // render in the test harness). Placing the ink now would park it at the left edge at full
  // width; leaving it at scaleX(0) shows nothing, which is the honest state.
  if (!geo.width) return;
  const at = (g) => `translateX(${g.left}px) scaleX(${g.width / INK_BASE})`;
  const travelling = INK_AT && INK_AT !== key && INK_GEO;
  if (travelling) {
    // Start from where the marker actually was, commit that frame, then let it run.
    ink.style.transition = 'none';
    ink.style.transform = at(INK_GEO);
    void ink.offsetWidth;
    ink.style.transition = '';
  } else {
    ink.style.transition = 'none';
  }
  ink.style.transform = at(geo);
  if (!travelling) { void ink.offsetWidth; ink.style.transition = ''; }
  INK_AT = key; INK_GEO = geo;
}

/* ---------------- head: state line + the interactive goal ---------------- */

/* One SHORT line. It shares the row with the goal pill, so anything past ~28 characters wraps and
   crowds a control. The long-form versions of these sentences live where they have room: the
   Nutrition tab states the whole targets situation in full. */
const HEAD_SUBTITLE = (who, hasTargets) => ({
  set: hasTargets ? `Targets set by your ${who}` : `Plan style set by your ${who}`,
  loading: 'Loading your targets…',
  offline: 'Offline · targets return when you reconnect',
  unset: S.coach.hasCoach ? `Your ${who} can set targets` : 'Scored on the standard itself',
});

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00` : iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/* The goal, opened. Every row is real or absent — an athlete who never set a target weight sees
   no target-weight row rather than an em-dash pretending to be data. There is no stored target
   RATE anywhere in the system, so this reports the movement actually measured and whether it
   points at the target, and never invents "1 lb per week". */
function goalPanel() {
  if (!GOAL_OPEN) return '';
  const g = S.planGoal;
  const rows = [];
  const row = (k, v) => rows.push(`<div class="pl-gp-row"><div class="pl-gp-k">${esc(k)}</div><div class="pl-gp-v">${v}</div></div>`);
  row('Goal', esc(g.label || 'Not set'));
  if (g.current != null) row('Current', `${esc(String(g.current))} ${esc(g.unit)}`);
  if (g.target != null) row('Target', `${esc(String(g.target))} ${esc(g.unit)}`);
  if (g.start != null && g.target != null) row('Started at', `${esc(String(g.start))} ${esc(g.unit)}`);
  if (g.moved) row('Moved', `${esc(g.moved)}${g.pace ? ` · ${esc(g.pace)}` : ''}`);
  if (g.startedOn) row('Tracking since', esc(fmtDate(g.startedOn) || g.startedOn));
  row('Set by', g.label ? 'You, at signup' : 'Nobody yet');
  if (g.targetsAreCoachSet) row('Targets', g.targetsSetBy ? `Set by ${esc(g.targetsSetBy)}` : `Set by your ${esc(S.coach.noun)}`);
  else if (g.derivedProtein) row('Targets', `From your goal · ${g.derivedProtein}g protein, ${g.derivedCalories} cal`);
  const note = g.strategy
    ? `${esc(g.strategy)} Weight is tracked for the trend and never counts toward your daily score.`
    : 'Pick a goal in your profile and OnStandard shapes your targets and scoring around it.';
  return `<div class="pl-goalpanel" id="pl-goal-panel">
    ${rows.join('')}
    <div class="pl-gp-note">${note}</div>
    <div style="margin-top:12px"><button class="btn ghost xs" data-go="profile" style="width:auto">Edit in profile</button></div>
  </div>`;
}

function head(t) {
  const goal = S.planGoalLabel;
  // These sit on ONE line beside the goal pill (~30 characters at --t-sm); anything longer wraps
  // and crowds the control next to it.
  const sub = t === 'requirements' ? 'Every rule of your standard'
    : t === 'memory' ? 'What OnStandard has learned'
      : t === 'nutrition' ? 'Targets and scoring'
        : HEAD_SUBTITLE(S.coach.noun, S.planStyle.showMacros || S.planStyle.showCalories)[S.planTargetsState];
  // "Goal · Perform", not a bare "Perform": an unlabeled word in an outlined pill reads as a
  // status you were assigned. It is now a real control, so it also carries a caret.
  const pill = goal
    ? `<button type="button" class="pl-goalpill" id="pl-goal" aria-expanded="${GOAL_OPEN ? 'true' : 'false'}" aria-controls="pl-goal-panel">Goal · ${esc(goal)}<span class="cv">${icon('chevron', 12)}</span></button>`
    : `<button type="button" class="pl-goalpill" data-go="profile">Set a goal<span class="cv">${icon('chevron', 12)}</span></button>`;
  return `
  <div class="screen-title">Plan</div>
  <div class="pl-head"><div class="pl-sub">${esc(sub)}</div>${pill}</div>
  ${goalPanel()}`;
}

/* ---------------- shared honest-state cards ---------------- */
const loadingCard = () => skeletonRows(2, 'Loading your targets');
const offlineCard = () => errorState({
  title: "Can't reach your plan",
  body: 'Your targets will show when you reconnect. Nothing is lost, and logging still counts in the meantime.',
  retryId: 'plan-retry',
});

/* ---------------- Today ----------------
   S.exec is the engine Home's ladder runs on: same items, same states, same deadlines. Plan shows
   the WHOLE day at a glance (Home shows the next move), and tapping a row goes exactly where Home
   would send you.

   This list IS the standard, which is why the prose summary that used to sit above it is gone: it
   named the same meals, the same check-in and the same weigh-in days the rows state with their
   real deadlines and live status, three lines earlier and with less information.

   Score v2 note: this used to append a separate "weekly check-in" row from the catalog. That
   component no longer exists — the nightly recovery check-in is the only check-in in the product,
   and it is an ordinary exec item like every other row here. See the score v2 spec. */
function todayRows() {
  let e;
  try { e = S.exec; } catch { return null; }
  // The icon wears the hue of the THING (green meal, purple recovery) — the same semantic accents
  // the Requirements tab and Home use. Only a real miss goes amber.
  return e.items.map((i) => ({
    id: i.id, title: i.title, icon: i.icon, color: i.color, pill: i.pill, accent: i.accent || 'b',
    sub: i.sub || i.dueLabel, route: i.route, done: i.state === 'done' || i.state === 'done_late',
  }));
}

function todaySection() {
  const rows = todayRows();
  if (!rows || !rows.length) return '';
  const done = rows.filter((r) => r.done).length;
  // The count rides the section label. It used to be its own grey sentence under the eyebrow,
  // which made a two-word fact take a third line and put body copy between a heading and its list.
  return `
  <div class="eyebrow">Today · ${done} of ${rows.length} done <span class="link" data-go="plan/requirements">All rules</span></div>
  <div class="pl-list">
    ${/* data-vt-row so opening the goal panel above pushes this list DOWN rather than teleporting
          it. Keyed on the requirement's route, which is what identifies a row here. */''}
    ${rows.map((r) => `
    <div class="pl-row tap" data-vt-row="req-${esc(r.route.replace(/[^A-Za-z0-9:_.-]/g, '_'))}" data-go="${esc(r.route)}">
      <div class="req-icon ${r.done ? 'g' : r.color === 'red' ? 'a' : esc(r.accent === 'muted' ? 'muted' : r.accent)}" style="width:38px;height:38px;flex:none">${icon(r.icon, 18)}</div>
      <div class="plb">
        <div class="plt"><span class="nm">${esc(r.title)}</span></div>
        <div class="pls">${esc(r.sub)}</div>
      </div>
      <div class="plend"><span class="xpill ${esc(r.color)}">${esc(r.pill)}</span></div>
    </div>`).join('')}
  </div>`;
}

/* ---------------- Today · what's left ----------------
   ONE number per macro, and it is the one that decides the next meal. This was three tiles of
   consumed-of-target followed by a sentence stating the remainder, which is the same arithmetic
   printed twice, plus a meals-in tile duplicating the count in the section label above it.
   With no numeric targets it says so in a line and stops: an Intuitive athlete must never be
   shown a number their plan does not set. */
function nutritionSummary() {
  const state = S.planTargetsState;
  if (state === 'loading') return `<div class="eyebrow">Nutrition today</div>${loadingCard()}`;
  if (state === 'offline') return `<div class="eyebrow">Nutrition today</div>${offlineCard()}`;
  const PS = S.planStyle;
  const T = S.planTargets || {};
  const c = S.dayConsumed;
  const rem = remainingToday({
    proteinSoFar: c.protein, kcalSoFar: c.kcal,
    proteinTarget: PS.showMacros ? T.protein : null,
    kcalTarget: PS.showCalories ? T.calories : null,
  });
  const cells = [];
  if (rem.kcal != null) cells.push([String(rem.kcal), 'Calories left']);
  if (rem.protein != null) cells.push([`${rem.protein}g`, 'Protein left']);
  const eyebrow = `<div class="eyebrow">What's left <span class="link" data-go="plan/nutrition">Targets</span></div>`;
  // A lone tile stretches to the full width and turns one number into the biggest object on the
  // tab. Below two, it is a sentence.
  if (cells.length < 2) {
    const line = cells.length
      ? `<b>${cells[0][0]}</b> ${cells[0][1].toLowerCase()} today.`
      : (PS.showMacros || PS.showCalories
        ? `No calorie or protein target set, so nothing is graded against a number.`
        : `Your plan tracks ${esc((S.trackedSignalLabels || []).join(' · ') || 'your check-in signals')} instead of numbers.`);
    return `${eyebrow}<div class="pl-standard" style="margin-top:0">${line}</div>`;
  }
  return `${eyebrow}
  <div class="macro-row">
    ${cells.map(([v, k]) => `<div class="macro"><div class="mv">${esc(v)}</div><div class="mk">${esc(k)}</div></div>`).join('')}
  </div>`;
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
/* findRepeats scans every recent meal and render calls suggestions() more than once. Memoized on
   the CACHE ARRAYS' identity (recent-meals and food-memory each hand out one stable array per
   fetch) plus the handled-count, so it recomputes exactly when the underlying data changed. */
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

/* One saved item.
   `log` variant: it exists to be RE-LOGGED — name, macros, one button.
   `manage` variant: the WHOLE ROW opens the edit sheet (Forget lives inside it). Two buttons per
   row crushed names into an ellipsis. */
function itemRow(it, { manage = false } = {}) {
  const pl = it.place_id ? placeName(it.place_id) : null;
  const check = it.verified_at
    ? `<span style="color:var(--green-bright);flex:none;display:inline-flex" title="Verified by your ${esc(S.coach.noun)}">${icon('check', 13)}</span>` : '';
  const meta = `${esc(macroLine(it))}${pl && !manage ? ` · ${esc(pl)}` : ''}${manage && it.times_logged > 1 ? ` · logged ${it.times_logged}×` : ''}`;
  const ic = it.kind === 'supplement' ? 'bolt' : it.kind === 'food' ? 'grid' : it.kind === 'order' ? 'pin' : 'utensils';
  return `
  <div class="pl-row${manage ? ' tap' : ''}"${manage ? ` data-fm-edit="${esc(it.id)}"` : ''}>
    <div class="req-icon b" style="width:38px;height:38px;flex:none">${icon(ic, 17)}</div>
    <div class="plb">
      <div class="plt"><span class="nm">${esc(it.name)}</span>${check}</div>
      <div class="pls">${meta}</div>
    </div>
    <div class="plend">${manage
    ? icon('chevron', 16, 'style="color:var(--text-3)"')
    : `<button class="btn primary xs" data-fm-log="${esc(it.id)}" style="width:auto">Log</button>`}</div>
  </div>`;
}

/* Passive learning surfaced. ONE at a time, one question, the facts, two buttons.
   It was a filled blue card with a 32px circular icon, which made it the only box on a page
   otherwise built from hairline rows: the loudest object on the tab was an optional question.
   It keeps a tinted ground and a blue edge (it IS an interruption, and has to read as one) but
   now sits on the same row rhythm as everything around it. */
function suggestionCard() {
  const g = suggestions()[0];
  if (!g) return '';
  return `
  <div class="pl-sug">
    <div class="plb">
      <div class="plt"><span style="color:var(--blue-bright);display:inline-flex;flex:none">${icon('sparkle', 15)}</span><span class="nm">Save this as a usual?</span></div>
      <div class="pls">${esc(g.name)} · ${g.protein}g protein · ${g.kcal} cal · eaten ${g.count}×</div>
    </div>
    <div class="pl-sug-a">
      <button class="btn primary sm" data-fm-save-sug="${esc(g.signature)}" style="width:auto;padding:0 16px;height:44px">Save</button>
      <button class="btn ghost sm" data-fm-dismiss-sug="${esc(g.signature)}" style="width:auto;padding:0 14px;height:44px">No thanks</button>
    </div>
  </div>`;
}

/* Overview's usuals: the four best fits for what's LEFT of the day, because on Overview the
   question is "what do I log next", not "what do I own". The full library is one tap away. */
function usualsSection() {
  const items = activeItems();
  if (items === null) return ''; // not loaded — show nothing rather than a false empty state
  const sug = suggestionCard();
  if (!items.length) {
    return `<div class="eyebrow">Your usual meals</div>${sug}
    ${sug ? '' : `<div class="pl-standard" style="margin-top:0">Log like normal. When a meal repeats, OnStandard offers to remember it, then it's one tap to log.
      <span class="link" data-go="memory-edit/new" style="cursor:pointer">Add one yourself</span></div>`}`;
  }
  const rem = remainingToday({
    proteinSoFar: S.dayConsumed.protein, kcalSoFar: S.dayConsumed.kcal,
    proteinTarget: S.planStyle.showMacros ? (S.planTargets || {}).protein : null,
    kcalTarget: S.planStyle.showCalories ? (S.planTargets || {}).calories : null,
  });
  const top = rankForRemaining(items, rem, 3).map((r) => r.item);
  return `
  <div class="eyebrow">Your usual meals${items.length > top.length ? ` <span class="link" data-go="plan/memory">See all ${items.length}</span>` : ''}</div>
  ${sug}
  <div class="pl-list">${top.map((it) => itemRow(it)).join('')}</div>`;
}

/* ---------------- Ask OnStandard — on every tab ---------------- */
function askContext() {
  const T = S.planTargets || {};
  const PS = S.planStyle;
  return {
    hasCoach: S.coach.hasCoach,
    coachNoun: S.coach.noun,
    hasTargets: !!(PS.showMacros && T.protein != null) || !!(PS.showCalories && T.calories != null),
    places: placesList().map((p) => ({ name: p.name })),
    requirements: (S.scheduleCatalog || []).map((r) => ({ id: r.id, title: r.title, scored: r.impact.kind === 'component' })),
    nextSlot: (() => {
      const slot = S.currentSlot;
      if (!slot) return null;
      const r = (S.scheduleCatalog || []).find((x) => x.id === slot);
      return r ? r.title : null;
    })(),
  };
}

/* ONE row, identical on all four tabs. It was an eyebrow, three suggestion chips, a two-line
   card and a full-width coach button: five elements repeated four times, ~180px of secondary
   navigation under every tab's real content. The suggestions were the worst of it, because they
   are the ask SCREEN's own content and it already opens with them, so the tab was rendering a
   preview of the next screen. */
function askSection(area) {
  const linked = S.coach.hasCoach;
  const Who = S.coach.noun === 'trainer' ? 'trainer' : 'coach';
  // No chevron. Two of these sit side by side on a 362px viewport, and the caret cost 23px of the
  // 103px a label had, which truncated "Ask OnStandard" to "Ask OnStanda…". The tile is a filled
  // row with a lit icon; it does not also need an arrow to read as tappable.
  const tile = (go, ic, label) => `
    <div class="pl-ask" data-go="${esc(go)}" role="button" tabindex="0">
      <span class="pa-i">${icon(ic, 15)}</span>
      <span class="pa-t">${esc(label)}</span>
    </div>`;
  return `
  <div class="pl-asks${linked ? ' two' : ''}">
    ${tile(`plan-ask/${area}`, 'sparkle', 'Ask OnStandard')}
    ${linked ? tile('messages', 'message', `Ask your ${Who}`) : ''}
  </div>
  <div style="height:12px"></div>`;
}

/* One-time "plan styles exist now" prompt (0142 release mechanics) — grandfathered accounts only. */
function legacyStylePrompt() {
  if (RT.planStylePromptSeen || S.planStyle.source !== 'legacy') return '';
  return `
  <div class="lrow" id="ps-intro" style="margin-bottom:10px;background:var(--blue-surface);border:1px solid var(--blue-border);border-radius:var(--r-card-sm);padding:12px 13px;cursor:default">
    <div class="xico sm" style="background:rgba(var(--blue-rgb),0.22);color:var(--blue-bright)">${icon('sparkle', 16)}</div>
    <div class="xr"><div class="xa">Your plan style: Structured</div>
    <div class="xb">OnStandard now supports Guided and Intuitive too: different ways of measuring the same standard. Your score hasn't changed.</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn primary sm" id="ps-intro-explore" style="width:auto;padding:0 14px;height:32px">Explore styles</button>
      <button class="btn ghost sm" id="ps-intro-dismiss" style="width:auto;padding:0 14px;height:32px">Not now</button>
    </div></div>
  </div>`;
}

const overview = () => `
  ${legacyStylePrompt()}
  ${todaySection()}
  ${nutritionSummary()}
  ${usualsSection()}
  ${askSection('overview')}`;

/* ---------------- Nutrition tab ---------------- */

/* Targets, compact. The old version rendered a 3-tile grid of em-dashes when nothing was set —
   an identical-card grid saying nothing three times, on the tab whose job is telling the athlete
   what to hit. Nothing set now falls through to nutritionScoring(), which answers the real
   follow-up question instead of restating the absence at full height. */
function targetsRow() {
  const state = S.planTargetsState;
  if (state === 'loading') return loadingCard();
  if (state === 'offline') return offlineCard();
  const T = S.planTargets || {};
  const PS = S.planStyle;
  if (!PS.showMacros && !PS.showCalories) return '';
  if (T.protein == null && T.calories == null && T.weight == null && S.weight.target == null) return '';
  const band = PS.knobs && PS.knobs.nutrition;
  const asRange = (v, b) => (v == null ? '—' : (b > 0 ? `${Math.round(v * (1 - b))}–${Math.round(v * (1 + b))}` : String(v)));
  const rangeMode = band && (band.protein === 'range' || band.calorie === 'range');
  const cells = [];
  if (PS.showMacros && T.protein != null) {
    cells.push([band && band.protein === 'range' ? asRange(T.protein, band.proteinBand) : `${T.protein}g`, `Protein${rangeMode ? ' range' : ''}`]);
  }
  if (PS.showCalories && T.calories != null) {
    cells.push([band && band.calorie === 'range' ? asRange(T.calories, band.calorieBand) : String(T.calories), `Calories${rangeMode ? ' range' : ''}`]);
  }
  const w = T.weight != null ? T.weight : S.weight.target;
  if (w != null) cells.push([`${w} lb`, 'Target wt']);
  if (!cells.length) return '';
  // A range like "2464–3136" is 9 characters and clips even at the 4-up density step, so values
  // past 8 characters take one more step down. Scale, never clip.
  const mv = (v) => `<div class="mv"${String(v).length > 8 ? ' style="font-size:14px;letter-spacing:-0.02em"' : ''}>${esc(String(v))}</div>`;
  return `<div class="macro-row${cells.length >= 4 ? ' four' : ''}">
    ${cells.map(([v, k]) => `<div class="macro">${mv(v)}<div class="mk">${esc(k)}</div></div>`).join('')}
  </div>
  ${rangeMode ? `<div class="pl-standard">Anywhere in the range scores full credit.</div>` : ''}`;
}

/* "Then what AM I graded on?" — the question a missing target actually raises, answered from the
   engine path that is really running (S.nutritionFormula), never from a constant. */
function nutritionScoring() {
  const f = S.nutritionFormula;
  const pct = S.nutritionWeightPct;
  const PS = S.planStyle;
  const T = S.planTargets || {};
  const noNumbers = !PS.showMacros && !PS.showCalories;
  const unset = !noNumbers && T.protein == null && T.calories == null;
  // One line, and it is the answer to the only question a missing target raises. The three
  // sentences that used to surround it (what the style does on purpose, who can add targets,
  // that logging still counts) all restated things the tab says elsewhere.
  const lead = unset || noNumbers
    ? `No targets set. Nutrition is still <b>${pct}%</b> of your score:`
    : `Nutrition is <b>${pct}%</b> of your score:`;
  const tracked = (S.trackedSignalLabels || []).join(' · ');
  return `
  ${noNumbers && tracked ? `<div class="pl-standard" style="margin-top:0">Tracked instead: <b>${esc(tracked)}</b>.</div>` : ''}
  <div class="pl-standard">${lead}</div>
  <div class="pl-qs" style="margin-top:8px">
    ${f.parts.map((p) => `<span class="bd-weight" style="padding:6px 11px">${esc(p.label)} · ${p.pct}%</span>`).join('')}
  </div>`;
}

/* Plan style as ONE row. It arrived as a 5-line card, then kept a 3-line paragraph of `how`
   underneath and a second paragraph about a differing preference: four lines of explanation
   under a row that names the style. The row now carries the style, what it means in four words
   (`short`), and who set it. The full explanation of all three styles already lives on the
   plan-style screen, which is one tap away and is where a person goes when they want it.
   The locked pill names WHO DECIDES, because that is the only question a control you cannot
   operate actually raises. */
function planStyleRow() {
  const st = S.planStyle;
  if (!st) return '';
  const decider = st.lockedBy || (S.coach.hasCoach ? `Your ${S.coach.noun}` : 'Your coach');
  // Owners keep the explicit Change button. A LOCKED athlete's row is tappable too — the picker
  // is where their stated preference lives (it reaches the coach's roster), and before this the
  // only path to it was a four-tap Ask OnStandard detour. A chevron, not a button: the tap opens
  // a place to say what you'd prefer, it does not change the plan.
  const action = st.canChoose
    ? `<button class="btn ghost sm" data-go="plan-style" style="width:auto;padding:0 14px;height:34px">Change</button>`
    : icon('chevron', 17, 'class="chev-dim"');
  const sub = st.source === 'preference'
    ? `${esc(st.short)} · awaiting your ${esc(S.coach.noun)}'s confirmation`
    : st.canChoose
      ? `${esc(st.short)} · ${esc(st.sourceLabel)}`
      : `${esc(st.short)} · ${esc(decider)} decides`;
  return `
  <div class="eyebrow">Plan style</div>
  <div class="pl-list">
    <div class="pl-row"${st.canChoose ? '' : ' data-go="plan-style"'}>
      <div class="req-icon b" style="width:38px;height:38px;flex:none">${icon('target', 17)}</div>
      <div class="plb">
        <div class="plt"><span class="nm">${esc(st.name)}${st.customized ? ' (customized)' : ''}</span></div>
        <div class="pls">${sub}</div>
      </div>
      <div class="plend">${action}</div>
    </div>
    ${st.preferenceDiffers && st.preferenceName && !st.canChoose ? `
    <div class="pl-row">
      <div class="req-icon muted" style="width:38px;height:38px;flex:none">${icon('message', 16)}</div>
      <div class="plb">
        <div class="plt"><span class="nm">You asked for ${esc(st.preferenceName)}</span></div>
        <div class="pls">Shared with ${esc(st.lockedBy || decider.replace(/^Your /, 'your '))}</div>
      </div>
    </div>` : ''}
  </div>`;
}

/* Coach nutrition rules: ONLY sections with real data render. Restrictions come from the
   athlete's own structured profile; meal-timing rules come from the real requirement catalog. */
function nutritionRules() {
  const r = RT.restrictions || {};
  const blocks = [];
  const chips = (list, tone) => list.map((x) => `<span class="bd-weight" ${tone ? `style="color:var(--${tone})"` : ''}>${esc(typeof x === 'string' ? x : `${x.name}${x.severity === 'severe' ? ' · severe' : ''}`)}</span>`).join(' ');
  const block = (label, inner) => blocks.push(`<div class="pl-row" style="display:block">
      <div class="pl-gp-k">${esc(label)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${inner}</div></div>`);
  if (Array.isArray(r.allergies) && r.allergies.length) block('Allergies', chips(r.allergies, 'red-bright'));
  if (Array.isArray(r.intolerances) && r.intolerances.length) block('Intolerances', chips(r.intolerances));
  if (Array.isArray(r.preferences) && r.preferences.length) block('Preferences', chips(r.preferences));
  /* Meal windows used to render here too. They are the Requirements tab's own rows, with more on
     them (proof, scored category, the coach's why), so this was the same three deadlines printed
     on two tabs. The tab that owns the rules keeps them. */
  if (!blocks.length) {
    return `<div class="eyebrow">Food rules</div>
    <div class="pl-standard" style="margin-top:0">${S.coach.hasCoach
      ? `No food rules set. Your ${esc(S.coach.noun)}'s guidance shows up here when they add it.`
      : 'No food rules yet. Allergies and preferences you add in your profile show up here.'}
    <span class="link" data-go="profile" style="cursor:pointer">Edit profile</span></div>`;
  }
  return `<div class="eyebrow">Food rules</div><div class="pl-list">${blocks.join('')}</div>`;
}

const nutrition = () => `
  ${S.planStyle.showMacros || S.planStyle.showCalories ? `<div class="eyebrow">Your targets</div>` : `<div class="eyebrow">What your plan tracks</div>`}
  ${targetsRow()}
  ${nutritionScoring()}
  ${planStyleRow()}
  ${nutritionRules()}
  ${askSection('nutrition')}`;

/* ---------------- Requirements tab ----------------
   The rules of the standard. Scoring weight is quoted ONCE, at the top, across both scored
   categories — and normalized so the two displayed numbers total exactly 100 (each is
   independently rounded by the engine, so 76/24 can land on 99 or 101 and an athlete who
   adds them up deserves the answer to be 100). */

const CAT_ACCENT = { Nutrition: 'g', Recovery: 'p' };
const CAT_SHORT = { Nutrition: 'Nutrition', Recovery: 'Recovery' };

function scoredWeights() {
  const rows = (S.breakdown || []).map((b) => ({ key: b.key, pct: b.weightPct }));
  if (!rows.length) return null;
  const sum = rows.reduce((a, b) => a + b.pct, 0);
  if (sum !== 100) {
    // Absorb the rounding drift into the largest share — the one where a point is least visible —
    // so the four numbers on screen add to 100 exactly.
    const big = rows.reduce((a, b) => (b.pct > a.pct ? b : a), rows[0]);
    big.pct += 100 - sum;
  }
  return rows;
}

function weightsStrip() {
  const rows = scoredWeights();
  if (!rows) return '';
  // Plain `.macro-row` (no density modifier) — the same base tile the 2-3-up rows elsewhere in the
  // app use (features.js's record strip, meal-view's macro row). `.four`/`.five` only exist to
  // shrink type for denser strips; two tiles is the least dense case there is, so it takes no
  // modifier. Only the value's hue is per-category; nothing bespoke.
  // The strip is self-explanatory: two labelled shares that add to 100, above rules that each
  // carry one of those two labels. The paragraph that used to explain the mechanism was longer
  // than the mechanism.
  return `
  <div class="eyebrow">How your score is built</div>
  <div class="macro-row">
    ${rows.map((r) => `<div class="macro"><div class="mv" style="color:${accentVar(CAT_ACCENT[r.key] || 'b')}">${r.pct}%</div><div class="mk">${esc(CAT_SHORT[r.key] || r.key)}</div></div>`).join('')}
  </div>`;
}

/* One requirement row: name, frequency/deadline, proof, and the category it feeds. Everything
   else — the why, the completion rule, who set it and when it changed — lives one tap deeper.
   `showFreq` is false inside the "Every day" group, where the group header already said it. */
function reqRow(r, showFreq) {
  const scored = r.impact.kind === 'component';
  const tag = scored ? (CAT_SHORT[{ nutrition: 'Nutrition', recovery: 'Recovery' }[r.impact.comp]] || r.impact.comp) : 'Not scored';
  const accent = scored ? ({ nutrition: 'g', recovery: 'p' }[r.impact.comp] || 'b') : '';
  const due = r.window && r.window.due != null ? (r.window.label || `by ${fmtMin(r.window.due)}`) : (r.window && r.window.label) || '';
  const freq = showFreq ? freqLabel(r.freq).replace(/^Required (weekly · |)/, '') : '';
  const sub = [freq, due, PROOF[r.proof] ? PROOF[r.proof].label : 'One-tap check'].filter(Boolean).join(' · ');
  return `
  <div class="pl-row tap" data-go="requirement/${esc(r.id)}">
    <div class="req-icon ${esc(r.accent)}" style="width:38px;height:38px;flex:none">${icon(r.icon, 18)}</div>
    <div class="plb">
      <div class="plt"><span class="nm">${esc(r.title)}</span>${r.required === false ? '<small style="color:var(--text-3);font-weight:700">optional</small>' : ''}</div>
      <div class="pls">${esc(sub)}</div>
    </div>
    <div class="plend"><span class="pl-tag ${accent}">${esc(tag)}</span>${icon('chevron', 15, 'style="color:var(--text-3)"')}</div>
  </div>`;
}

function requirementsTab() {
  const cat = [...(S.scheduleCatalog || [])];
  // Chronological within a group. The catalog places Morning Weight at index 2, so a list headed
  // by its own timekeeping rendered a 9:00 AM item between a 2:00 PM lunch and an 8:30 PM dinner.
  const byDue = (a, b) => ((a.window && a.window.due) || 24 * 60) - ((b.window && b.window.due) || 24 * 60);
  const groups = [
    ['Every day', cat.filter((r) => r.freq.type === 'daily').sort(byDue), false],
    ['Specific days', cat.filter((r) => r.freq.type === 'days').sort(byDue), true],
    ['Weekly', cat.filter((r) => r.freq.type === 'weekly').sort(byDue), true],
    ['Other', cat.filter((r) => !['daily', 'days', 'weekly'].includes(r.freq.type)).sort(byDue), true],
  ].filter(([, rows]) => rows.length);
  const gov = S.governingStandard;
  const assigned = RT.assigned || [];
  return `
  ${weightsStrip()}
  ${groups.map(([label, rows, showFreq]) => `
    <div class="pl-grp">${esc(label)}</div>
    <div class="pl-list">${rows.map((r) => reqRow(r, showFreq)).join('')}</div>`).join('')}
  ${assigned.length ? `
    <div class="pl-grp">From your ${esc(S.coach.noun)}</div>
    <div class="pl-list">${assigned.map((a) => `
      <div class="pl-row tap" data-go="requirement/${esc(a.id)}">
        <div class="req-icon ${a.done ? 'g' : 'b'}" style="width:38px;height:38px;flex:none">${icon(a.icon || 'clipboard', 18)}</div>
        <div class="plb">
          <div class="plt"><span class="nm">${esc(a.title)}</span></div>
          <div class="pls">One-time · ${esc(a.dueLabel || 'On your list')}</div>
        </div>
        <div class="plend"><span class="pl-tag b">Your plan</span>${icon('chevron', 15, 'style="color:var(--text-3)"')}</div>
      </div>`).join('')}</div>` : ''}
  ${/* Provenance as a real row, not a footnote. The old floating sentence ("The OnStandard
        baseline. No coach has replaced these.") read like an apology under the very standard a
        solo athlete is scored on; the row gives the rulebook an author the same way every rule
        above it has a deadline. Same honesty gates: a coach is named only when a coach set
        actually governs. */''}
  <div class="pl-grp">Who set this</div>
  <div class="pl-list">
    <div class="pl-row">
      <div class="req-icon muted" style="width:38px;height:38px;flex:none">${icon('shield', 18)}</div>
      <div class="plb">
        <div class="plt"><span class="nm">${gov
    ? `${esc(gov.scopeLabel)}${gov.setBy ? ` by ${esc(gov.setBy)}` : ''}`
    : 'The OnStandard baseline'}</span></div>
        <div class="pls">${gov
    ? (gov.effectiveDate ? `In effect since ${esc(fmtDate(gov.effectiveDate) || gov.effectiveDate)}` : 'In effect now')
    : (S.coach.hasCoach ? `Yours until your ${esc(S.coach.noun)} sets their own standard` : 'The standard every athlete starts on')}</div>
      </div>
    </div>
  </div>
  ${askSection('requirements')}`;
}

/* ---------------- Food Memory tab ----------------
   A knowledge base, not a list: the four things memory actually holds, each answering a different
   question. Learning stays passive; this tab exists so nothing about it is invisible or
   unremovable. */

/* `count` is passed separately because a group's ROWS are not always its items — Restaurants
   interleaves a place header before each order, and counting rows there would claim four saved
   orders where there are two. */
function memoryGroup(label, rows) {
  if (!rows.length) return '';
  return `<div class="pl-grp">${esc(label)}</div><div class="pl-list">${rows.join('')}</div>`;
}

/* Corrections, in the athlete's language. The raw rows are engine keys ("behavior_pattern /
   portion_underread"); read back untranslated they are noise, and this is the one part of memory
   that changes how their photos are READ, so it has to be legible. */
export function factLabel(f) {
  const kind = String((f && f.kind) || '');
  const raw = (f && f.value && (f.value.name || f.value.value)) || (f && f.value) || '';
  const v = String(typeof raw === 'object' ? '' : raw).slice(0, 60);
  const PATTERN = {
    portion_underread: 'Your portions run bigger than a photo suggests',
    portion_overread: 'Your portions run smaller than a photo suggests',
    cooks_with_oil: 'You cook with oil',
    cooks_with_butter: 'You cook with butter',
  };
  if (kind === 'behavior_pattern') return PATTERN[v] || `Reading habit: ${v.replace(/_/g, ' ')}`;
  if (kind === 'allergy') return `Allergy: ${v}`;
  if (kind === 'dislike') return `You avoid ${v}`;
  if (kind === 'favorite_food') return `You often eat ${v}`;
  if (kind === 'favorite_restaurant') return `You often eat at ${v}`;
  if (kind === 'meal_timing') return `Timing: ${v}`;
  return v || kind.replace(/_/g, ' ');
}

function memoryTab() {
  const items = activeItems();
  const places = placesList();
  const facts = (FACTS.uid === RT.userId && Array.isArray(FACTS.rows) ? FACTS.rows : []).filter((f) => f && f.status === 'active');
  if (items === null) {
    return `<div class="eyebrow">Food Memory</div>${loadingCard()}${askSection('memory')}`;
  }
  const isOrder = (it) => it.kind === 'order' || !!it.place_id;
  const meals = items.filter((it) => !isOrder(it) && (it.kind === 'meal' || !it.kind));
  const orders = items.filter(isOrder);
  const packaged = items.filter((it) => !isOrder(it) && (it.kind === 'food' || it.kind === 'supplement'));
  const placesWithNothing = places.filter((p) => !orders.some((o) => o.place_id === p.id));
  const nothingAtAll = !items.length && !places.length && !facts.length;

  const orderRows = [];
  for (const p of places) {
    const mine = orders.filter((o) => o.place_id === p.id);
    if (!mine.length) continue;
    orderRows.push(`<div class="pl-row" style="padding-bottom:4px;min-height:0"><div class="pl-gp-k">${esc(p.name)}</div></div>`);
    for (const o of mine) orderRows.push(itemRow(o, { manage: true }));
  }
  for (const o of orders.filter((x) => !x.place_id || !places.some((p) => p.id === x.place_id))) {
    orderRows.push(itemRow(o, { manage: true }));
  }
  // Places with nothing saved belong INSIDE this group, as one muted row. As a floating sentence
  // between two groups they broke the list rhythm to say something about the list.
  if (orderRows.length && placesWithNothing.length) {
    orderRows.push(`<div class="pl-row" style="min-height:0;padding:11px 0">
      <div class="req-icon muted" style="width:32px;height:32px;flex:none">${icon('pin', 14)}</div>
      <div class="plb"><div class="pls">Also eaten at ${placesWithNothing.map((p) => esc(p.name)).join(', ')}, nothing saved yet</div></div>
    </div>`);
  }

  /* No intro paragraph. Four labelled groups of the athlete's own food, with a chevron on every
     row, do not need a sentence explaining that memory is built from logging and that rows are
     tappable. The one sentence that survives is the genuinely empty state. */
  return `
  <div class="eyebrow">Food Memory <span class="link" data-go="memory-edit/new">+ Add</span></div>
  ${suggestionCard()}
  ${nothingAtAll ? `<div class="pl-standard" style="margin-top:0">Nothing learned yet. Log a meal three times and OnStandard offers to remember it, numbers and all, so logging it drops to one tap.</div>` : ''}
  ${/* RAW ampersand: memoryGroup runs esc() on the label, so a pre-escaped "&amp;" rendered as
        "&AMP;" on screen. Escape at exactly one layer. */''}
  ${memoryGroup('Frequent meals', meals.map((it) => itemRow(it, { manage: true })))}
  ${memoryGroup('Restaurants & orders', orderRows)}
  ${memoryGroup('Packaged foods', packaged.map((it) => itemRow(it, { manage: true })))}
  ${facts.length ? `<div class="pl-grp">Corrections</div>
    <div class="pl-list">${facts.slice(0, 10).map((f) => `
      <div class="pl-row" style="min-height:0;padding:11px 0">
        <div class="req-icon muted" style="width:32px;height:32px;flex:none">${icon('sparkle', 14)}</div>
        <div class="plb"><div class="pls" style="color:var(--text);font-weight:700;white-space:normal">${esc(factLabel(f))}</div></div>
      </div>`).join('')}</div>` : ''}
  ${askSection('memory')}`;
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
  /* These four subs are a TAB STRIP, not four detail pages, and the router needs to be told:
     without it, `plan/nutrition` is indistinguishable from `connected-standard/csr-steps` and
     gets the forward-push entrance plus a back-stack entry apiece. Declaring them makes a tap
     across the strip a lateral replace. Order is the strip's own left-to-right order, because
     the router derives the travel direction from the index. */
  subs: PLAN_SUBS,
  render({ sub }) {
    const t = planSub(sub);
    const body = t === 'nutrition' ? nutrition()
      : t === 'requirements' ? requirementsTab()
        : t === 'memory' ? memoryTab() : overview();
    return `${head(t)}${tabs(t)}${body}`;
  },
  async mount(root, { sub }) {
    // A bad sub renders Overview with its tab lit; rewrite the address so it agrees with the
    // pixels, replace() so the bad link never enters history. An ALIAS is a real link and must
    // survive — only genuinely unknown subs are rewritten.
    if (sub && !PLAN_SUBS.includes(sub) && !SUB_ALIAS[sub]) { location.replace('#plan'); return; }

    // Loading must never be a terminal state. profileLoading defaults TRUE until the first
    // hydrate settles it, so any path where the hydrate never returns left this screen saying
    // "Loading your targets…" forever with the offline card sitting unreached. Eight seconds is
    // the ceiling; past it the honest answer is "can't reach your plan", with a Retry.
    if (S.planTargetsState === 'loading') {
      setTimeout(() => {
        if (!root.isConnected || S.planTargetsState !== 'loading') return;
        RT.profileOffline = true; RT.profileLoading = false;
        window.__render();
      }, 8000);
    }

    // errorState() hands the caller a button id rather than a data-act, so the shared primitive
    // stays free of any one screen's action vocabulary.
    const retry = root.querySelector('#plan-retry');
    if (retry) retry.addEventListener('click', async () => { await act.retryProfile(); window.__render(); });

    // Four labels ("Overview / Nutrition / Requirements / Food Memory") are wider than a phone,
    // so .ptabs scrolls behind its fade mask. Bring the ACTIVE tab fully into view: landing on
    // Food Memory with its own label half under the mask reads as a rendering fault.
    const strip = root.querySelector('.ptabs');
    const on = strip && strip.querySelector('.pt.on');
    if (strip && on && strip.scrollWidth > strip.clientWidth) {
      // Measure in the SCROLLER's frame. offsetLeft is relative to the offsetParent (the screen,
      // which carries the 20px page gutter), so comparing it to scrollLeft put every tab 20px to
      // the right of where it actually is — enough to leave Overview scrolled 2px off its own
      // left edge, with the fade cutting into the "O".
      const pad = 14;
      const sr = strip.getBoundingClientRect();
      const or = on.getBoundingClientRect();
      const leftIn = or.left - sr.left + strip.scrollLeft;
      const rightIn = leftIn + or.width;
      if (rightIn + pad > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = rightIn + pad - strip.clientWidth;
      else if (leftIn - pad < strip.scrollLeft) strip.scrollLeft = Math.max(0, leftIn - pad);
      // The threshold clears the strip's own 2px padding: `scroll-snap-type: x proximity` snaps
      // the first tab's start edge to the scrollport, which parks scrollLeft at exactly 2 with
      // NOTHING clipped — and a `> 1` test read that as "scrolled" and faded the O in Overview.
      const edge = () => strip.classList.toggle('scrolled', strip.scrollLeft > 3);
      edge();
      strip.addEventListener('scroll', edge, { passive: true });
    }
    placeInk(strip, on);

    const goalBtn = root.querySelector('#pl-goal');
    if (goalBtn) goalBtn.addEventListener('click', () => { GOAL_OPEN = !GOAL_OPEN; window.__restate(); });

    const explore = root.querySelector('#ps-intro-explore');
    const dismiss = root.querySelector('#ps-intro-dismiss');
    if (explore) explore.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__navigate('plan-style'); });
    if (dismiss) dismiss.addEventListener('click', () => { act.dismissPlanStylePrompt(); window.__render(); });

    // Food Memory + ask actions (the router only wires data-go/data-act; these need delegation).
    root.addEventListener('click', async (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-fm-log],[data-fm-edit],[data-fm-save-sug],[data-fm-dismiss-sug],[data-ask]');
      if (!el) return;
      if (el.dataset.ask) {
        const { seedAsk } = await import('./plan-ask.js');
        seedAsk(el.dataset.ask);
        window.__go('plan-ask/' + planSub(sub));
        return;
      }
      if (el.dataset.fmLog) {
        if (act.stageSavedMeal(el.dataset.fmLog)) location.hash = '#meal-analysis';
        return;
      }
      // The whole row navigates to the edit sheet (Forget lives inside it, behind its own two-tap
      // confirm) — a review list, not a control panel.
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

    // Warm the shared caches, then repaint EXACTLY ONCE when they transition from empty to loaded.
    // The guard must compare stable loaded-ness booleans, never array identity: activeItems()
    // filters a FRESH array every call, so an identity compare is always "changed" and
    // mount→render→mount becomes a self-sustaining loop (~10 renders/sec, measured) — the WebView
    // reads as frozen. On a failed warm both booleans stay false: no repaint, no loop.
    const loadedBefore = !!(foodMemory(RT.userId) && recentRows(RT.userId));
    await warmCaches().catch(() => {});
    const loadedAfter = !!(foodMemory(RT.userId) && recentRows(RT.userId));
    if (!loadedBefore && loadedAfter && location.hash.startsWith('#plan')) window.__render();
  },
};
