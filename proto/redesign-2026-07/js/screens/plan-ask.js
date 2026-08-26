/* Ask OnStandard — the Plan page's answer surface.
 *
 * The engine is plan-ask.js (pure, tested). This screen is only its keyboard and its transcript:
 * it assembles the real context out of S/RT, prints the answer, and — when the engine declines —
 * hands the question to a person or to the meal thread rather than improvising.
 *
 * WHY NOT A MODEL. Every question this answers is a lookup against the athlete's own data, so a
 * paid round trip would buy latency and a chance of a wrong number. The two places a model DOES
 * belong are already wired and are exactly where the decline routes: the meal thread (meal-chat,
 * which reads the plate) and the coach.
 */
import { S, RT } from '../state.js';
import { backHead, esc, composer } from '../components.js';
import { foodMemory } from '../food-memory-data.js';
import { PROOF, IMPACT_LABEL, freqLabel, fmtMin } from '../requirements.js';
import { remainingToday } from '../food-memory.js';
import { answerAsk, askSuggestions } from '../plan-ask.js';

/* The transcript for this visit. Module-level, so tapping a suggestion chip on Plan lands here
   with the question already asked, and a repaint (the router re-renders on state changes) does
   not wipe what was answered. Cleared when the screen is opened fresh from the ask bar. */
let THREAD = [];
let AREA = 'overview';
let SEED = null;
// Leaving the route clears the transcript (the same hashchange pattern redeem-code.js uses):
// module state survives repaints on purpose, but a return visit hours later should start fresh,
// not greet the athlete with a stale conversation about a different question.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').slice(1).split('/')[0] !== 'plan-ask') { THREAD = []; SEED = null; }
  });
}

/** Plan taps a suggestion chip → the question rides here, and mount asks it. */
export function seedAsk(q) { SEED = String(q || '').trim() || null; }

const AREA_LABEL = {
  overview: 'your plan', nutrition: 'your nutrition', requirements: 'your requirements', memory: 'your food memory',
};

/* ---------------- the real context ---------------- */

function planAskContext() {
  const PS = S.planStyle;
  const T = S.planTargets || {};
  const c = S.dayConsumed;
  const fm = foodMemory(RT.userId);
  const places = fm ? (fm.places || []).filter((p) => p.status !== 'archived') : [];
  const placeById = new Map(places.map((p) => [p.id, p.name]));
  const items = fm ? fm.items.filter((i) => i.status !== 'archived') : [];
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const gov = S.governingStandard;

  const requirements = (S.scheduleCatalog || []).map((r) => {
    const scored = r.impact.kind === 'component';
    return {
      id: r.id,
      title: r.title,
      freqLabel: freqLabel(r.freq),
      dueLabel: r.window && r.window.due != null ? (r.window.label || `due by ${fmtMin(r.window.due)}`) : (r.window && r.window.label) || 'no deadline',
      proofLabel: PROOF[r.proof] ? PROOF[r.proof].label : 'One-tap check',
      impactLabel: IMPACT_LABEL[scored ? r.impact.comp : r.impact.kind] || 'Tracked, not scored',
      scored,
      note: r.note || '',
      // The days this rule names, so "why do I weigh in Monday" resolves the weigh-in rather
      // than whichever rule happens to share a word with the question.
      dayWords: r.freq.type === 'days' ? (r.freq.days || []).map((d) => DAY_NAMES[d])
        : r.freq.type === 'weekly' ? [DAY_NAMES[r.freq.day]] : [],
      setBy: gov ? (gov.setBy || `your ${S.coach.noun}`) : null,
      effectiveDate: gov ? gov.effectiveDate : null,
    };
  });

  let today = [];
  try {
    // Score v2: the nightly recovery check-in is an ordinary S.exec item now, so it's already in
    // this list. There is no separate "weekly check-in" row to append anymore.
    today = S.exec.items.map((i) => ({ title: i.title, sub: i.sub || i.dueLabel, done: i.state === 'done' || i.state === 'done_late' }));
  } catch { today = []; }

  const slotTitles = {}, slotDue = {};
  for (const r of S.scheduleCatalog || []) {
    if (r.impact.comp !== 'nutrition') continue;
    slotTitles[r.id] = r.title;
    if (r.window && r.window.due != null) slotDue[r.id] = fmtMin(r.window.due);
  }

  const nextSlotId = S.currentSlot;
  return {
    hasCoach: S.coach.hasCoach,
    coachNoun: S.coach.noun,
    styleName: S.planStyle.name,
    styleHow: S.planStyle.how,
    hasTargets: !!((PS.showMacros && T.protein != null) || (PS.showCalories && T.calories != null)),
    targets: {
      protein: PS.showMacros ? T.protein : null,
      calories: PS.showCalories ? T.calories : null,
      weight: T.weight != null ? T.weight : S.weight.target,
    },
    remaining: remainingToday({
      proteinSoFar: c.protein, kcalSoFar: c.kcal,
      proteinTarget: PS.showMacros ? T.protein : null,
      kcalTarget: PS.showCalories ? T.calories : null,
    }),
    weights: (S.breakdown || []).map((b) => ({ key: b.key, pct: b.weightPct })),
    nutritionParts: (S.nutritionFormula.parts || []).map((p) => ({ label: p.label, pct: p.pct })),
    items: items.map((it) => ({
      id: it.id, name: it.name, place: it.place_id ? (placeById.get(it.place_id) || null) : null,
      kcal: it.kcal, protein: it.protein, times_logged: it.times_logged, verified_at: it.verified_at,
    })),
    places: places.map((p) => ({ name: p.name })),
    facts: [],
    requirements,
    today,
    slotTitles,
    slotDue,
    nextSlot: nextSlotId && slotTitles[nextSlotId] ? slotTitles[nextSlotId] : null,
  };
}

/* ---------------- rendering ---------------- */

function answerHtml(a) {
  const chips = (a.chips || []).map((ch) =>
    `<button class="btn ghost sm" data-go="${esc(ch.go)}" style="width:auto;padding:0 14px;height:44px">${esc(ch.label)}</button>`).join('');
  return `<div class="pa-ans">
    <div class="pa-h">${esc(a.title)}</div>
    ${(a.lines || []).map((l) => `<div class="pa-l${l.startsWith('•') ? ' bullet' : ''}">${esc(l)}</div>`).join('')}
    ${chips ? `<div class="pa-chips">${chips}</div>` : ''}
  </div>`;
}

function threadHtml() {
  if (!THREAD.length) {
    return `<div class="msg-status">Ask about ${esc(AREA_LABEL[AREA] || 'your plan')}. Every answer comes from your own data. Nothing here is guessed.</div>`;
  }
  return THREAD.map((t) => t.q
    ? `<div class="msg athlete"><div class="stack"><div class="bubble">${esc(t.q)}</div></div></div>`
    : `<div style="margin:6px 0 14px">${answerHtml(t.a)}</div>`).join('');
}

export default {
  tab: 'plan',
  render({ sub }) {
    AREA = ['overview', 'nutrition', 'requirements', 'memory'].includes(sub) ? sub : 'overview';
    const qs = askSuggestions(planAskContext(), AREA);
    return `
    ${backHead('Ask OnStandard', 'Answers from your plan, never a guess', 'plan')}
    <div class="thread" id="pa-thread" style="gap:0" role="log" aria-label="Plan answers">${threadHtml()}</div>
    <div class="pl-qs" id="pa-chips" style="margin:12px 0 6px">
      ${qs.map((q) => `<span class="pl-q" data-ask="${esc(q)}">${esc(q)}</span>`).join('')}
    </div>
    ${composer({ inputId: 'pa-in', sendId: 'pa-send', placeholder: 'Ask about your plan…', sendLabel: 'Ask', atEnd: true })}
    <div style="height:10px"></div>`;
  },

  mount(root, { sub }) {
    AREA = ['overview', 'nutrition', 'requirements', 'memory'].includes(sub) ? sub : 'overview';
    const threadEl = root.querySelector('#pa-thread');
    const input = root.querySelector('#pa-in');

    const paint = () => {
      if (!threadEl) return;
      threadEl.innerHTML = threadHtml();
      const last = threadEl.lastElementChild;
      if (last) last.scrollIntoView({ block: 'end' });
    };

    const ask = (text) => {
      const q = String(text || '').trim();
      if (!q) return;
      const a = answerAsk(q, planAskContext());
      if (!a) return;
      THREAD = [...THREAD, { q }, { a }];
      if (input) input.value = '';
      paint();
    };

    if (SEED) { const q = SEED; SEED = null; THREAD = []; ask(q); }

    root.addEventListener('click', (e) => {
      const chip = e.target && e.target.closest && e.target.closest('[data-ask]');
      if (chip) { ask(chip.dataset.ask); return; }
      const send = e.target && e.target.closest && e.target.closest('#pa-send');
      if (send) ask(input && input.value);
    });
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });
  },
};
