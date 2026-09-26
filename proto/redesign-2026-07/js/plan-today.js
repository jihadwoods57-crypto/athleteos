/* Plan > Today, and Plan > Nutrition's food preferences (goals and eating plan, A1, 2026-09-25).
 *
 * Today answers ONE question now: what is my next meal, and what will it be? The hero says where
 * the day stands (protein and calories to go, or the plate for an Intuitive plan), the one card
 * says which meal is up and offers up to three ideas, and one button plans the chosen one. After
 * that the only button is the camera: a plan never logs a meal, and there is no other way to log.
 *
 * LAZY ON PURPOSE. screens/plan.js is in the eager boot graph and the boot budget has well under a
 * kilobyte of headroom (tools/boot-closure-ratchet.mjs), so everything here arrives by dynamic
 * import the first time Plan mounts. plan.js renders a skeleton for the one frame before it lands.
 *
 * The rules live in plan-today-model.js (tested in Node). This file reads the live day, draws, and
 * wires taps. Every figure it prints sits behind its own plan-style flag.
 */
import { S, RT, slotTitle, mealDueState, invokeWithDeadline, seasonPhase } from './state.js';
import { DAY, pushDay, mealScored, slotDeadline, slotGrace, minutesNow } from './day.js';
import { icon } from './icons.js';
import { esc, skeletonRows, errorState } from './components.js';
import { foodMemory } from './food-memory-data.js';
import { recentRows } from './recent-meals.js';
import { PREF_FLAGS, PREF_LIST_MAX, cleanFoodPrefs, cleanPrefItem, prefsKey, avoidWords } from './food-prefs.js';
import {
  slotOrder, buildToday, ringFractions, rankIdeas, ideaMeta, ideaTag, shortName, planHeading,
  slotTargetLine, goalWords, planFromIdea, readIdeasCache, writeIdeasCache, laterLine, planMeta,
} from './plan-today-model.js';
import { aiConsentCached, isConsentSkip, noteAiConsentRequired } from './ai-consent.js';
import { heroGoalLine } from './season-phase.js';
import { suggestionHtml, wireSuggestion, loadMySuggestion } from './target-suggest.js';
import { loadHallMenus, hallMenusDue, hallIdeas } from './dining-today.js';
import { allergenKeysFrom } from './dining-menu.js';
import { planButtonLabel } from './dining-plate-model.js';
import { learning, doneIds, loadLearning } from './learn-data.js';
import { LESSON_IDS, openAssignments } from './lessons-model.js';

/* ---------------- module state (survives every repaint, never persisted) ---------------- */
let SUGGEST_READ = null;       // whose suggestion row was read this session (once, on the first Plan open)
let PICK = {};                 // slot -> the idea id the athlete selected
let FOCUS = null;              // a later slot the athlete tapped to plan now
let NIA = { at: null, state: 'idle', ideas: [], retryAt: 0 };   // Nia's ideas for `at` = uid|day|slot|prefsKey
let PREFS = { uid: null, v: null, note: '' };

const store = () => { try { return window.localStorage; } catch { return null; } };
const PREFS_KEY = (uid) => `os.foodPrefs.${uid}`;

/* ---------------- food preferences: the athlete's own, local first, server second ---------------- */
export function myPrefs() {
  if (PREFS.uid === RT.userId && PREFS.v) return PREFS.v;
  let v = null;
  try { v = JSON.parse((store() && store().getItem(PREFS_KEY(RT.userId))) || 'null'); } catch { v = null; }
  PREFS = { uid: RT.userId, v: cleanFoodPrefs(v && v.p), note: '' };
  return PREFS.v;
}

/** Hydrate from the server once per mount. A read that fails keeps what this phone has; a local
 *  change the server never took is written up first, so a save made offline is not lost. */
export async function loadPrefs() {
  const uid = RT.userId;
  const sb = window.sb;
  if (!uid || !sb) return false;
  let local = null;
  try { local = JSON.parse((store() && store().getItem(PREFS_KEY(uid))) || 'null'); } catch { local = null; }
  if (local && local.pending) return writePrefs(cleanFoodPrefs(local.p));
  try {
    const { data, error } = await sb.from('profiles').select('food_prefs').eq('id', uid).maybeSingle();
    if (error || !data) return false;
    const v = cleanFoodPrefs(data.food_prefs);
    const changed = prefsKey(v) !== prefsKey(myPrefs());
    PREFS = { uid, v, note: '' };
    try { store().setItem(PREFS_KEY(uid), JSON.stringify({ p: v })); } catch { /* quota */ }
    return changed;
  } catch { return false; }
}

async function writePrefs(v) {
  const uid = RT.userId;
  PREFS = { uid, v, note: '' };
  try { store().setItem(PREFS_KEY(uid), JSON.stringify({ p: v, pending: true })); } catch { /* quota */ }
  const sb = window.sb;
  let ok = false;
  try {
    const { error } = sb ? await sb.from('profiles').update({ food_prefs: v }).eq('id', uid) : { error: true };
    ok = !error;
  } catch { ok = false; }
  if (ok) { try { store().setItem(PREFS_KEY(uid), JSON.stringify({ p: v })); } catch { /* quota */ } }
  PREFS.note = ok ? '' : 'Saved on this phone. It syncs when you reconnect.';
  return true;
}

/* ---------------- the live day, as the model sees it ---------------- */
function today() {
  const PS = S.planStyle;
  const order = slotOrder(RT.stdMeals);
  const T = buildToday({
    order,
    meals: DAY.meals,
    scored: (k) => mealScored(DAY, k),
    macros: DAY.slotMacros,
    plans: DAY.plans || {},
    deadline: (k) => slotDeadline(k) + slotGrace(k),
    nowMin: minutesNow(),
    target: { protein: DAY.proteinTarget, kcal: DAY.calTarget },
    consumed: S.dayConsumed,
    focus: FOCUS,
  });
  if (FOCUS && T.upNext !== FOCUS) FOCUS = null;   // the focused slot got logged
  return { PS, order, T, numbers: PS.showMacros || PS.showCalories };
}

const usuals = () => {
  const fm = foodMemory(RT.userId);
  return fm ? fm.items.filter((i) => i.status !== 'archived') : null;
};
const avoid = () => avoidWords(myPrefs(), RT.restrictions);
const niaKey = (slot) => `${RT.userId}|${DAY.date}|${slot}|${prefsKey(myPrefs())}`;

/** The ideas for one slot: today's dining-hall plates (C), then usuals, then Nia's (live for the
 *  up-next slot, cached for the rest). */
function ideasFor(slot, slotTarget, max = 3) {
  const own = usuals() || [];
  let nia = [];
  if (NIA.at === niaKey(slot)) nia = NIA.ideas;
  else {
    const s = store();
    nia = (s && readIdeasCache(s, RT.userId, DAY.date, slot, prefsKey(myPrefs()))) || [];
  }
  const av = avoid();
  // An Intuitive plate is sized by the plate rules (a palm of protein), never by hidden figures:
  // no share, so no "Double" portion.
  const PS = S.planStyle;
  const share = PS.showMacros || PS.showCalories ? slotTarget : {};
  // Allergen TAGS on the menu are checked against the declared allergies and intolerances.
  const hall = hallIdeas({ slot, dayDate: DAY.date, dueMin: slotDeadline(slot), nowMin: minutesNow(), target: share, avoid: av, allergens: allergenKeysFrom(RT.restrictions) });
  return rankIdeas({ usuals: own, nia, hall, slotTarget, avoid: av, max });
}

/* ---------------- ONE door for a plan (Today, the chat picks, search, label, barcode) ----------------
   Every surface that can put a meal in front of the athlete PLANS it here and nowhere else: no meal
   is logged without a photo (founder rule, 2026-09-25). A plan rides DAY.plans -> checkin.plans and
   no scoring path reads it. */
export function setPlan(slot, plan) {
  if (!slot) return false;
  DAY.plans = { ...(DAY.plans || {}), [slot]: plan || null };
  pushDay(RT.userId);
  return true;
}

/** The slot a plan from outside Today lands on: the same "up next" Today would show, never a
 *  slot the athlete tapped into Today's card by hand. */
function nextSlot() {
  const T = buildToday({
    order: slotOrder(RT.stdMeals), meals: DAY.meals, scored: (k) => mealScored(DAY, k), macros: DAY.slotMacros,
    plans: DAY.plans || {}, deadline: (k) => slotDeadline(k) + slotGrace(k), nowMin: minutesNow(),
  });
  return T.upNext;
}

/** Plan any meal for `slot` (or the next open one). Returns { slot, title } or null. */
export function planSlot(slot, { name, protein, kcal, source = 'usual' } = {}) {
  const k = slot && !DAY.meals[slot] ? slot : nextSlot();
  const p = planFromIdea({ name, protein, kcal, source }, new Date().toISOString());
  if (!k || !p) return null;
  setPlan(k, p);
  return { slot: k, title: slotTitle(k) };
}

/** A saved usual from a chat pick: planned for the next open slot. null when the item is gone. */
export function planSavedMeal(itemId) {
  const fm = foodMemory(RT.userId);
  const it = fm && fm.items.find((x) => x.id === itemId && x.status !== 'archived');
  if (!it) return null;
  return planSlot(null, { name: it.name, protein: it.protein, kcal: it.kcal, source: 'usual' });
}

/** The pick among `picks` that is an OPEN slot's plan right now, for the chat's confirmation. */
export function plannedPick(picks) {
  const plans = DAY.plans || {};
  for (const [slot, p] of Object.entries(plans)) {
    if (!p || !p.name || DAY.meals[slot]) continue;
    const hit = (picks || []).find((x) => x && x.name === p.name);
    if (hit) return { slot, title: slotTitle(slot), name: p.name };
  }
  return null;
}

/* ---------------- the hero ---------------- */
function ring(fr, planned) {
  // 112px, stroke 10: the arc is the goal, so it wears the blue->teal signature; the ghost of the
  // planned meals is the same teal at a whisper. Green is reserved for "met".
  const R = 50, C = 2 * Math.PI * R;
  const seg = (from, to) => `stroke-dasharray="${(Math.max(0, to - from) * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-from * C).toFixed(1)}"`;
  return `<svg class="pt-ring-svg" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
    <defs><linearGradient id="pt-rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--ring-c)"/><stop offset="1" stop-color="var(--ring-b)"/></linearGradient></defs>
    <circle class="pt-ring-track" cx="60" cy="60" r="${R}"/>
    ${planned && fr.ghost > fr.fill ? `<circle class="pt-ring-ghost" cx="60" cy="60" r="${R}" ${seg(fr.fill, fr.ghost)}/>` : ''}
    ${fr.fill > 0 ? `<circle class="pt-ring-fill${fr.fill >= 1 ? ' met' : ''}" cx="60" cy="60" r="${R}" ${seg(0, fr.fill)}/>` : ''}
  </svg>`;
}

/** The plate graphic (A1 hero; A2's "Why this plate" draws the same one). */
export function plate() {
  // Half the plate vegetables (right), a quarter protein (top left), a quarter carbs (bottom left).
  return `<svg class="pt-plate-svg" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
    <circle class="pt-plate-rim" cx="60" cy="60" r="56"/>
    <path class="pt-pl-vg" d="M60 12 A48 48 0 0 1 60 108 Z"/>
    <path class="pt-pl-pr" d="M60 60 L60 12 A48 48 0 0 0 12 60 Z"/>
    <path class="pt-pl-cb" d="M60 60 L12 60 A48 48 0 0 0 60 108 Z"/>
  </svg>`;
}

function goalHtml(PS) {
  const g = S.planGoal;
  const T = S.planTargets || {};
  const w = goalWords({
    goalKey: g.key,
    current: S.weight.current,
    target: S.weight.target != null ? S.weight.target : T.weight,
    minor: !!(S.consent && S.consent.minor),
    intuitive: !PS.showMacros && !PS.showCalories,
  });
  // B: the season joins the goal ("Gaining · In-season"); the weight range, when there is one, stays last.
  return w ? `<div class="pt-goal">${esc(heroGoalLine(w.label, seasonPhase(), w.range))}</div>` : '';
}

function heroHtml(ctx) {
  const { PS, T, numbers } = ctx;
  // A2: its own screen (screens/plan-why.js), the real targets explained. Not the goal panel.
  const why = `<button type="button" class="pt-why" id="pt-why" data-go="plan-why">${numbers ? 'Why these numbers' : 'Why this plate'}${icon('chevron', 13)}</button>`;
  if (!numbers) {
    return `<section class="pt-hero" aria-label="How to build a plate">
      <div class="pt-hero-art">${plate()}</div>
      <div class="pt-hero-b">
        <div class="pt-hero-t">Build every plate like this</div>
        <ul class="pt-rules">
          <li><i class="pr"></i>A palm of protein</li>
          <li><i class="cb"></i>A fist of carbs, two after hard training</li>
          <li><i class="vg"></i>Half the plate vegetables</li>
        </ul>
        ${goalHtml(PS)}${why}
      </div>
    </section>`;
  }
  const left = T.left;
  const met = PS.showMacros && left.protein === 0;
  const fr = ringFractions({ target: DAY.proteinTarget, consumed: S.dayConsumed.protein, planned: T.planned.protein });
  const art = PS.showMacros
    ? `<div class="pt-hero-art pt-ring">${ring(fr, T.planned.protein)}
        <div class="pt-ring-c">${met
          ? `<span class="pt-met">${icon('check', 22)}</span><span class="pt-ring-u">protein<br>met</span>`
          : `<b>${esc(String(left.protein))}g</b><span class="pt-ring-u">protein<br>to go</span>`}</div></div>`
    : `<div class="pt-hero-art pt-big"><b>${esc(String(left.kcal))}</b><span class="pt-ring-u">cal to go</span></div>`;
  const cal = PS.showMacros && PS.showCalories && left.kcal != null
    ? `<div class="pt-cal"><b>${esc(left.kcal.toLocaleString('en-US'))}</b> cal to go</div>` : '';
  const planned = PS.showMacros && T.planned.protein > 0 && !met
    ? `<div class="pt-planned"><i></i>${esc(String(T.planned.protein))}g planned</div>` : '';
  return `<section class="pt-hero" aria-label="Where today stands">
    ${art}
    <div class="pt-hero-b">${cal}${planned}${goalHtml(PS)}${why}</div>
  </section>`;
}

/* ---------------- up next ---------------- */
function ideaRow(idea, on, ctx) {
  const tag = ideaTag(idea, ctx.numbers);
  // A dining-hall plate names its hall under the plate, where a long hall name has the row's width
  // (the right-hand pill is sized for one short word).
  const hall = idea.source === 'hall';
  return `<button type="button" class="pt-idea${on ? ' on' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-pt-idea="${esc(idea.id)}">
    <span class="pt-dot" aria-hidden="true"></span>
    <span class="pt-idea-b"><span class="pt-idea-n">${esc(idea.name)}</span><span class="pt-idea-m">${esc(ideaMeta(idea, ctx.PS))}</span>${hall && tag ? `<span class="pt-tag dh-tag">${esc(tag)}</span>` : ''}</span>
    ${tag && !hall ? `<span class="pt-tag${idea.source === 'nia' ? ' nia' : ''}">${esc(tag)}</span>` : ''}
  </button>`;
}

function upNextHtml(ctx) {
  const { T, PS } = ctx;
  const slot = T.slots.find((s) => s.key === T.upNext);
  if (!slot) return '';
  const title = slotTitle(slot.key);
  const due = mealDueState(slot.key);
  const dueHtml = `<span class="pt-due${due.tone === 'late' ? ' late' : due.tone === 'warn' ? ' warn' : ''}">${esc(due.label)}</span>`;
  const snap = `<button type="button" class="btn primary pt-cta" data-go="camera/${esc(slot.key)}">${icon('camera', 18)}Snap it when you eat</button>`;
  if (slot.plan) {
    const p = slot.plan;
    return `<h2 class="eyebrow">Up next</h2>
    <section class="pt-next planned" data-pt-slot="${esc(slot.key)}">
      <div class="pt-next-h"><span class="pt-slot">${esc(planHeading(slot.key, title))}</span>
        <button type="button" class="pt-change" id="pt-change">Change</button></div>
      <div class="pt-plan-n">${esc(p.name)}</div>
      <div class="pt-idea-m">${esc([planMeta(p, PS), due.label].filter(Boolean).join(' · '))}</div>
      ${snap}
    </section>`;
  }
  const ideas = ideasFor(slot.key, T.slotTarget);
  const picked = ideas.find((i) => i.id === PICK[slot.key]) || ideas[0] || null;
  const loading = NIA.at === niaKey(slot.key) && NIA.state === 'loading' && ideas.length < 3;
  const target = slotTargetLine(T.slotTarget, PS);
  return `<h2 class="eyebrow">Up next</h2>
  <section class="pt-next" data-pt-slot="${esc(slot.key)}">
    <div class="pt-next-h"><span class="pt-slot">${esc(title)}</span>${dueHtml}</div>
    ${target ? `<div class="pt-target">${esc(target)}</div>` : ''}
    ${ideas.length || loading ? `<div class="pt-ideas" role="radiogroup" aria-label="${esc(`Ideas for ${title.toLowerCase()}`)}">
      ${ideas.map((i) => ideaRow(i, picked && i.id === picked.id, ctx)).join('')}
      ${loading ? `<div class="pt-idea sk" role="status"><span class="pt-dot" aria-hidden="true"></span><span class="pt-idea-b"><span class="pt-idea-n">Getting ideas from Nia…</span></span></div>` : ''}
    </div>` : `<div class="pt-empty">No ideas yet. Log like normal and your usuals show up here.</div>`}
    ${picked
    ? `<button type="button" class="btn primary pt-cta" id="pt-plan" data-pt-pick="${esc(picked.id)}">${esc(picked.source === 'hall' ? planButtonLabel(picked) : `Plan ${shortName(picked.name)}`)}</button>`
    : snap}
    <button type="button" class="pt-ask" id="pt-ask">${icon('sparkle', 15)}Ask Nia for other ideas</button>
  </section>`;
}

/* ---------------- later + logged + also today ---------------- */
function laterHtml(ctx) {
  const { T } = ctx;
  if (!T.later.length) return '';
  const rows = T.later.map((k) => {
    const title = slotTitle(k);
    const sub = laterLine(T, k, ctx.PS);
    return `<div class="pl-row tap pt-row pt-later" role="button" tabindex="0" data-pt-focus="${esc(k)}">
      <div class="req-icon muted s38">${icon(k === 'breakfast' || k === 'lunch' || k === 'dinner' || k === 'snack' ? k : 'utensils', 18)}</div>
      <div class="plb"><div class="plt"><span class="nm">${esc(title)}</span></div><div class="pls">${esc(sub)}</div></div>
      <div class="plend">${icon('chevron', 15, 'class="chev-dim"')}</div>
    </div>`;
  });
  return `<h2 class="eyebrow">Later today</h2><div class="pl-list">${rows.join('')}</div>`;
}

function loggedHtml(ctx) {
  const { T, PS } = ctx;
  if (!T.logged.length) return '';
  const rows = T.logged.map((k) => {
    const s = T.slots.find((x) => x.key === k);
    const r = s.read || {};
    const bits = r.pending ? ['Reading your photo…'] : r.failed ? ['Logged'] : [
      r.name,
      PS.showMacros && r.protein > 0 ? `${r.protein}g protein` : null,
      r.quality != null ? `Score ${r.quality}` : null,
    ];
    return `<div class="pl-row tap pt-row" data-go="meal-detail/${esc(k)}">
      <div class="req-icon g s38">${icon('check', 17)}</div>
      <div class="plb"><div class="plt"><span class="nm">${esc(slotTitle(k))}</span></div><div class="pls">${esc(bits.filter(Boolean).join(' · ') || 'Logged')}</div></div>
      <div class="plend">${icon('chevron', 15, 'class="chev-dim"')}</div>
    </div>`;
  });
  return `<h2 class="eyebrow">Logged</h2><div class="pl-list">${rows.join('')}</div>`;
}

const PILL_ACCENT = { green: 'g', red: 'r', gold: 'a', gray: 'muted', blue: 'b', purple: 'p' };
function alsoHtml(order) {
  let e;
  try { e = S.exec; } catch { return ''; }
  const meal = new Set(order.all);
  const rows = (e.items || []).filter((i) => !meal.has(i.id));
  if (!rows.length) return '';
  return `<h2 class="eyebrow">Also today <span class="link" data-go="plan/requirements">All rules</span></h2>
  <div class="pl-list">${rows.map((i) => {
    const done = i.state === 'done' || i.state === 'done_late';
    return `<div class="pl-row tap" data-go="${esc(i.route)}">
      <div class="req-icon ${done ? 'g' : i.color === 'red' ? 'a' : esc(i.accent === 'muted' ? 'muted' : (i.accent || 'b'))} s38">${icon(i.icon, 18)}</div>
      <div class="plb"><div class="plt"><span class="nm">${esc(i.title)}</span></div><div class="pls">${esc(i.sub || i.dueLabel || '')}</div></div>
      <div class="plend"><span class="status-pill ${PILL_ACCENT[i.color] || 'muted'}">${esc(i.pill)}</span></div>
    </div>`;
  }).join('')}</div>`;
}

function doneHtml(ctx) {
  const { T, PS } = ctx;
  if (T.upNext) return '';
  const tail = PS.showMacros && T.left.protein > 0 ? ` ${T.left.protein}g of protein is still open, so a protein-forward snack closes it.` : ' Nothing left to plan today.';
  return `<div class="pt-alldone">${icon('checkCircle', 20)}<span>Every meal is in.${esc(tail)}</span></div>`;
}

/** D: the door to Learn, the 60-second lessons, at the foot of Today. */
export function learnDoorHtml() {
  const done = doneIds().filter((id) => LESSON_IDS.includes(id)).length;
  const d = learning();
  const assigned = d ? openAssignments(d.assignments, doneIds()).length : 0;
  const sub = assigned
    ? `${assigned} from your coach · ${done} of ${LESSON_IDS.length} done`
    : done ? `${done} of ${LESSON_IDS.length} done` : 'Eating for your goal, a minute at a time';
  return `<button type="button" class="ln-door" data-go="learn">
    <span class="ln-door-ic" aria-hidden="true">${icon('fileText', 18)}</span>
    <span class="ln-door-tx"><span class="ln-door-t">60-second lessons</span><span class="ln-door-s">${esc(sub)}</span></span>
    ${icon('chevron', 15, 'class="chev-dim"')}
  </button>`;
}

/** The whole Today tab. plan.js wraps it in the row mark its goal panel glides. */
export function todayHtml() {
  if (S.planTargetsState === 'loading') return skeletonRows(3, 'Loading your plan');
  const ctx = today();
  const hero = S.planTargetsState === 'offline'
    ? errorState({ title: "Can't reach your plan", body: 'Your targets will show when you reconnect. Nothing is lost, and logging still counts in the meantime.', retryId: 'plan-retry' })
    : heroHtml(ctx);
  return `<div class="ptd">${hero}${suggestionHtml()}${upNextHtml(ctx)}${doneHtml(ctx)}${laterHtml(ctx)}${loggedHtml(ctx)}${alsoHtml(ctx.order)}${learnDoorHtml()}</div>`;
}

/* ---------------- Nia's ideas: fetched once per athlete, day, slot and prefs ---------------- */
/** How long Plan waits for Nia's ideas before it settles for the usuals alone. */
export const NIA_DEADLINE_MS = 12_000;
/** After an empty or failed answer, a later open may ask again, never sooner than this. */
const NIA_RETRY_MS = 60_000;
/** Tests only: forget the in-session state. */
export function _resetNia() { NIA = { at: null, state: 'idle', ideas: [], retryAt: 0 }; }

/**
 * Start Nia's request for `slot` when one is due and return its promise; null when nothing was
 * started (a cached answer, AI off, or a request already in flight or answered). THE RENDER LOOP
 * RULE (review 2026-09-25): only the caller that started a request may repaint, and only once, when
 * it settles. Marking "loading" and repainting from every wireToday made each render start the next.
 */
function startNia(slot, slotTarget) {
  const uid = RT.userId;
  const at = niaKey(slot);
  if (!uid) return null;
  const retry = (NIA.state === 'empty' || NIA.state === 'error') && Date.now() >= (NIA.retryAt || 0);
  if (NIA.at === at && !retry) return null;
  const s = store();
  // A cached answer is already on screen: ideasFor() reads the same cache while NIA is elsewhere.
  const cached = s && readIdeasCache(s, uid, DAY.date, slot, prefsKey(myPrefs()));
  if (cached) { NIA = { at, state: 'done', ideas: cached, retryAt: 0 }; return null; }
  // Nia only for someone who said yes to AI (0243). Plan never opens the consent sheet.
  if (aiConsentCached(uid) !== true || !window.sb) { NIA = { at, state: 'off', ideas: [], retryAt: 0 }; return null; }
  NIA = { at, state: 'loading', ideas: [], retryAt: 0 };
  const own = (usuals() || []).slice(0, 5).map((u) => cleanPrefItem(String(u.name || '').slice(0, 60))).filter(Boolean);
  // A deadline, not a hope: a hung request settles as an error and Today keeps the usuals.
  return invokeWithDeadline('meal-chat', { planIdeas: {
    slot, slotTitle: slotTitle(slot), dayDate: String(DAY.date),
    proteinTarget: slotTarget.protein || null, kcalTarget: slotTarget.kcal || null, usuals: own,
  } }, NIA_DEADLINE_MS).then(({ data, error }) => {
    if (NIA.at !== at) return;   // the prefs or the day moved on while it was out
    if (isConsentSkip(data)) { noteAiConsentRequired(uid); NIA = { at, state: 'off', ideas: [], retryAt: 0 }; return; }
    const ideas = !error && data && Array.isArray(data.ideas) ? data.ideas : [];
    // Never cache an empty answer (review 2026-09-25): a later open may ask again.
    if (s && ideas.length) writeIdeasCache(s, uid, DAY.date, slot, prefsKey(myPrefs()), ideas);
    NIA = { at, state: ideas.length ? 'done' : (error ? 'error' : 'empty'), ideas, retryAt: ideas.length ? 0 : Date.now() + NIA_RETRY_MS };
  }).catch(() => { if (NIA.at === at) NIA = { at, state: 'error', ideas: [], retryAt: Date.now() + NIA_RETRY_MS }; });
}

/** Ask Nia for more: the nutrition chat with the question already typed, or Plan > Ask for an
 *  athlete with no meal yet (the chat needs a plate to hang a message on). */
async function askNia(slot) {
  const q = `What else could I eat for ${slotTitle(slot).toLowerCase()}?`;
  const rows = recentRows(RT.userId);
  if (rows && rows.length) {
    const { seedComposer } = await import('./screens/nutrition-chat.js');
    seedComposer(q);
    window.__go('nutrition-chat');
    return;
  }
  const { seedAsk } = await import('./screens/plan-ask.js');
  seedAsk(q);
  window.__go('plan-ask/overview');
}

const repaint = () => { if (/^#plan(\/|$)/.test(location.hash)) window.__render(); };

/** Wire Today's taps and start Nia's ideas for the up-next slot when the usuals leave room. */
export function wireToday(root) {
  const pane = root.querySelector('.ptd');
  if (!pane) return;
  // B: a suggested target change (solo: decide it here; on a team: "your coach is reviewing").
  wireSuggestion(root);
  if (SUGGEST_READ !== RT.userId) { SUGGEST_READ = RT.userId; void loadMySuggestion().then((changed) => { if (changed) repaint(); }); }
  // D: the Learn door's counts (my_learning, at most one read per two minutes).
  void loadLearning(false).then((changed) => { if (changed) repaint(); }, () => {});
  pane.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const idea = t.closest('[data-pt-idea]');
    const card = t.closest('[data-pt-slot]');
    if (idea && card) { PICK[card.dataset.ptSlot] = idea.dataset.ptIdea; repaint(); return; }
    if (t.closest('#pt-ask') && card) { void askNia(card.dataset.ptSlot); return; }
    if (t.closest('#pt-change') && card) {
      setPlan(card.dataset.ptSlot, null);
      repaint();
      return;
    }
    const plan = t.closest('#pt-plan');
    if (plan && card) {
      const k = card.dataset.ptSlot;
      const ctx = today();
      const pick = ideasFor(k, ctx.T.slotTarget).find((i) => i.id === plan.dataset.ptPick);
      const p = pick && planFromIdea(pick, new Date().toISOString());
      if (!p) return;
      setPlan(k, p);
      repaint();
      return;
    }
    const later = t.closest('[data-pt-focus]');
    if (later) {
      FOCUS = later.dataset.ptFocus;
      repaint();
      const top = root.querySelector('.pt-next');
      if (top && top.scrollIntoView) top.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  pane.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-pt-focus]')) { e.preventDefault(); e.target.click(); }
  });

  // C: today's published dining-hall menu first (an athlete on a team only; one read per open of
  // the day). Nia is asked only once it is known, so a hall that already fills the list costs nothing.
  if (!hallMenusDue()) { maybeNia(); return; }
  void loadHallMenus().then((changed) => { if (changed) repaint(); else maybeNia(); });
}

function maybeNia() {
  const ctx = today();
  if (!ctx.T.upNext) return;
  const slot = ctx.T.slots.find((s) => s.key === ctx.T.upNext);
  if (!slot || slot.plan) return;
  const own = usuals();
  if (own === null) return;   // Food Memory still loading: ask once it lands, never twice
  if (ideasFor(slot.key, ctx.T.slotTarget).filter((i) => i.source !== 'nia').length >= 3) return;
  const pending = startNia(slot.key, ctx.T.slotTarget);
  if (pending) void pending.then(repaint);
}

/* ---------------- Plan > Nutrition: food preferences ---------------- */
export function prefsHtml() {
  const p = myPrefs();
  const chip = (list, kind) => list.map((x) => `<span class="pt-chip">${esc(x)}<button type="button" class="pt-chip-x" data-pref-rm="${esc(kind)}" data-pref-v="${esc(x)}" aria-label="${esc(`Remove ${x}`)}">${icon('x', 12)}</button></span>`).join('');
  const add = (kind, label) => `<form class="pt-add" data-pref-add="${esc(kind)}">
      <input class="pt-add-in" name="v" maxlength="30" autocomplete="off" placeholder="${esc(label)}" aria-label="${esc(label)}"${p[kind].length >= PREF_LIST_MAX ? ' disabled' : ''}/>
      <button type="submit" class="btn ghost sm pt-add-b"${p[kind].length >= PREF_LIST_MAX ? ' disabled' : ''}>Add</button>
    </form>`;
  return `<h2 class="eyebrow">Food preferences</h2>
  <div class="pt-prefs" id="pt-prefs">
    <div class="pt-flags" role="group" aria-label="What kind of ideas">
      ${PREF_FLAGS.map((f) => `<button type="button" class="pt-flag${p[f.key] ? ' on' : ''}" aria-pressed="${p[f.key] ? 'true' : 'false'}" data-pref-flag="${esc(f.key)}">${p[f.key] ? icon('check', 13) : ''}${esc(f.label)}</button>`).join('')}
    </div>
    <div class="pt-pref-k">Likes</div>
    <div class="pt-chips">${chip(p.likes, 'likes')}</div>
    ${add('likes', 'Add a food you like')}
    <div class="pt-pref-k">Dislikes</div>
    <div class="pt-chips">${chip(p.dislikes, 'dislikes')}</div>
    ${add('dislikes', 'Add a food you skip')}
    <div class="pt-pref-note" role="status">${esc(PREFS.note || 'Shapes your meal ideas. Allergies and food rules always come first.')}</div>
  </div>`;
}

export function wirePrefs(root) {
  const box = root.querySelector('#pt-prefs');
  if (!box) return;
  const save = async (next) => { await writePrefs(cleanFoodPrefs(next)); _resetNia(); window.__render(); };
  box.addEventListener('click', (e) => {
    const f = e.target.closest && e.target.closest('[data-pref-flag]');
    if (f) { const p = myPrefs(); void save({ ...p, [f.dataset.prefFlag]: !p[f.dataset.prefFlag] }); return; }
    const rm = e.target.closest && e.target.closest('[data-pref-rm]');
    if (rm) {
      const p = myPrefs(); const kind = rm.dataset.prefRm;
      void save({ ...p, [kind]: p[kind].filter((x) => x !== rm.dataset.prefV) });
    }
  });
  box.addEventListener('submit', (e) => {
    const form = e.target.closest && e.target.closest('[data-pref-add]');
    if (!form) return;
    e.preventDefault();
    const v = cleanPrefItem(form.querySelector('input').value || '');
    if (!v) return;
    const p = myPrefs(); const kind = form.dataset.prefAdd;
    const other = kind === 'likes' ? 'dislikes' : 'likes';
    void save({ ...p, [kind]: [...p[kind], v], [other]: p[other].filter((x) => x.toLowerCase() !== v.toLowerCase()) });
  });
}
