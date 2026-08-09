/* Ask OnStandard — the answer engine behind the Plan page's ask surface.
 *
 * WHY THIS IS NOT A CHATBOT. Every question the founder named — "What should I eat for lunch?",
 * "Can I eat Subway and stay on plan?", "Why do I weigh in Monday?", "What do I normally order at
 * Chipotle?" — is answerable EXACTLY from data this app already holds: the requirement catalog,
 * the athlete's targets, today's consumed macros, and Food Memory. An LLM asked those questions
 * would paraphrase the same facts at a delay, for money, with a chance of inventing one. So the
 * ask surface answers them itself, instantly, from the real numbers.
 *
 * The rule that keeps it honest: when the engine cannot answer from real data it says so and
 * hands the question to a human (or to the meal thread, where a real model does read plates).
 * It never fills a gap with plausible nutrition advice. The screen that used to sit here did the
 * opposite — a keyword matcher that replied "From your plan's approved list: Chipotle bowl
 * (double chicken, rice, beans)" to an athlete who had never logged Chipotle and had no such list.
 *
 * Pure and Node-importable: no DOM, no state, no network (tested in plan-ask.test.mjs).
 */

import { rankForRemaining } from './food-memory.js';

const norm = (v) => String(v == null ? '' : v).toLowerCase();
const tokens = (v) => norm(v).split(/[^a-z0-9]+/).filter(Boolean);

/* Slot words the athlete actually types. Maps onto the meal requirement ids so "what should I eat
   for lunch" can name the real window rather than answering about the day in general. */
const SLOT_WORDS = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', supper: 'dinner', snack: 'snack',
};

/* Words that point at a requirement without naming it. The catalog titles carry the rest.
   Score v2: the deleted "weekly check-in" ritual had id 'weekly' here; no catalog requirement
   carries that id anymore, so its synonym entry matched nothing and is gone with it. */
const REQ_SYNONYMS = {
  weight: ['weigh', 'weighin', 'weighing', 'scale', 'weight'],
  recovery: ['recovery', 'sleep', 'soreness', 'readiness', 'bed', 'nightly'],
};

const round = (n) => Math.round(Number(n) || 0);

/** "980 calories and 55g protein" from the remaining shape; '' when no target is set. */
export function remainingPhrase(rem) {
  const parts = [];
  if (rem && rem.kcal != null) parts.push(`${round(rem.kcal)} calories`);
  if (rem && rem.protein != null) parts.push(`${round(rem.protein)}g protein`);
  return parts.join(' and ');
}

/** One saved item, as a sentence fragment: "Usual Subway order · 720 cal · 42g protein". */
export function itemPhrase(it) {
  const bits = [];
  if (it.kcal) bits.push(`${round(it.kcal)} cal`);
  if (it.protein) bits.push(`${round(it.protein)}g protein`);
  return bits.length ? `${it.name} · ${bits.join(' · ')}` : String(it.name);
}

/** Longest place/brand name mentioned in the question, or null. Matched on the athlete's OWN
 *  places and the places attached to their saved items — never a global restaurant list, because
 *  a name this app has never seen is exactly the case that must answer "I don't know that yet". */
export function matchPlace(question, ctx) {
  const q = norm(question);
  const names = new Set();
  for (const p of ctx.places || []) if (p && p.name) names.add(String(p.name));
  for (const it of ctx.items || []) if (it && it.place) names.add(String(it.place));
  let best = null;
  for (const n of names) {
    const t = norm(n);
    if (t.length < 3 || !q.includes(t)) continue;
    if (!best || t.length > norm(best).length) best = n;
  }
  return best;
}

/** The saved items belonging to one place. */
export function itemsAtPlace(place, ctx) {
  const p = norm(place);
  return (ctx.items || []).filter((it) => it && norm(it.place) === p);
}

/** Best-matching requirement for a question, or null. Title tokens first, then the synonym
 *  table, so "why do I weigh in Monday" finds Morning Weight without the word "morning". */
export function matchRequirement(question, ctx) {
  const qt = new Set(tokens(question));
  let best = null, bestScore = 0;
  for (const r of ctx.requirements || []) {
    let score = 0;
    for (const w of tokens(r.title)) if (w.length > 2 && qt.has(w)) score += 2;
    for (const w of REQ_SYNONYMS[r.id] || []) if (qt.has(w)) score += 2;
    // A day name only counts when the requirement actually runs on named days, so "Monday"
    // in "why do I weigh in Monday" resolves the weigh-in and not the nightly check-in.
    if (r.dayWords && r.dayWords.some((d) => qt.has(norm(d)))) score += 1;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

/* ---------------- suggestions ---------------- */

/** Context-aware starters. Every one is a question this engine can really answer, and the ones
 *  that name a place only appear once the athlete HAS that place — a suggestion the app then
 *  answers "I don't know that yet" to would be a trap it set for itself. */
export function askSuggestions(ctx, area = 'overview') {
  const out = [];
  const place = (ctx.places || [])[0];
  const slot = ctx.nextSlot || null;
  if (area === 'nutrition') {
    if (ctx.hasTargets) out.push("What's left for me today?");
    out.push('How is my nutrition scored?');
    if (place) out.push(`Can I eat ${place.name} and stay on plan?`);
    out.push('What is my plan style?');
  } else if (area === 'requirements') {
    out.push('How is my score built?');
    const w = (ctx.requirements || []).find((r) => r.id === 'weight');
    if (w) out.push('Why do I weigh in?');
    const scored = (ctx.requirements || []).find((r) => r.scored);
    if (scored) out.push(`Why is ${scored.title} on my standard?`);
    out.push("What's due today?");
  } else if (area === 'memory') {
    if (place) out.push(`What do I normally order at ${place.name}?`);
    out.push('What has OnStandard learned about me?');
    out.push('What should I eat next?');
    if (place) out.push(`Can I eat ${place.name} and stay on plan?`);
  } else {
    out.push(slot ? `What should I eat for ${norm(slot)}?` : 'What should I eat next?');
    out.push("What's due today?");
    if (place) out.push(`Can I eat ${place.name} and stay on plan?`);
    out.push('How is my score built?');
  }
  return out.slice(0, 4);
}

/* ---------------- answers ---------------- */

const A = (title, lines, chips = []) => ({ kind: 'answer', title, lines: lines.filter(Boolean), chips });

function answerWhatToEat(question, ctx) {
  const q = norm(question);
  const named = Object.keys(SLOT_WORDS).find((w) => q.includes(w));
  const slotTitle = named ? (ctx.slotTitles && ctx.slotTitles[SLOT_WORDS[named]]) || named : null;
  const phrase = remainingPhrase(ctx.remaining);
  const lines = [];
  if (phrase) lines.push(`You have ${phrase} left today.`);
  else lines.push(`Your plan doesn't set calorie or protein numbers, so there's no gap to close. Eat a real meal and log it.`);
  if (slotTitle && ctx.slotDue && ctx.slotDue[SLOT_WORDS[named]]) {
    lines.push(`${cap(slotTitle)} is due by ${ctx.slotDue[SLOT_WORDS[named]]}.`);
  }
  const ranked = rankForRemaining(ctx.items || [], ctx.remaining || {}, 3);
  if (ranked.length) {
    lines.push('From what you actually eat:');
    for (const { item, over } of ranked) lines.push(`• ${itemPhrase(item)}${over ? ' (runs past what\'s left)' : ''}`);
  } else {
    lines.push('Nothing is saved in your Food Memory yet, so there\'s nothing of yours to suggest. Log a few meals and the repeats show up here.');
  }
  return A('What to eat', lines, [{ label: 'Log a meal', go: 'camera' }]);
}

function answerPlaceFit(question, place, ctx) {
  const at = itemsAtPlace(place, ctx);
  const phrase = remainingPhrase(ctx.remaining);
  const lines = [];
  if (at.length) {
    const best = rankForRemaining(at, ctx.remaining || {}, 3);
    lines.push(`What you order at ${place}:`);
    for (const { item } of best) lines.push(`• ${itemPhrase(item)}`);
    const top = best[0];
    if (top && phrase) {
      // `over` is rankForRemaining's own verdict — the SAME flag the What-to-eat card prints,
      // so the ask surface and the card can never disagree about whether a plate fits.
      lines.push(top.over
        ? `You have ${phrase} left, so your usual runs over. It still counts. Log it honestly and the day tells the truth.`
        : `You have ${phrase} left, so your usual fits.`);
    } else if (phrase) {
      lines.push(`You have ${phrase} left today.`);
    }
  } else {
    lines.push(`Nothing from ${place} is saved yet, so OnStandard can't tell you what you normally get there.`);
    if (phrase) lines.push(`You have ${phrase} left today. That's the number to order against.`);
    lines.push('Log it once and it becomes part of your Food Memory, numbers and all.');
  }
  return A(place, lines, [{ label: 'Log a meal', go: 'camera' }, { label: 'Food Memory', go: 'plan/memory' }]);
}

function answerRequirement(req, ctx) {
  const lines = [`${req.freqLabel} · ${req.dueLabel}.`];
  if (req.proofLabel) lines.push(`Proof: ${req.proofLabel}.`);
  lines.push(req.scored
    ? `It feeds ${req.impactLabel}.`
    : `${req.impactLabel}. It never moves your daily number.`);
  if (req.note) lines.push(`"${req.note}"`);
  if (req.setBy) lines.push(`Set by ${req.setBy}${req.effectiveDate ? `, effective ${req.effectiveDate}` : ''}.`);
  else lines.push('This one is part of the OnStandard baseline, not something your coach added.');
  return A(req.title, lines, [{ label: 'Open the rule', go: `requirement/${req.id}` }]);
}

function answerScore(ctx) {
  const lines = ['Your daily number is four parts:'];
  let total = 0;
  for (const c of ctx.weights || []) { lines.push(`• ${c.key}: ${c.pct}%`); total += c.pct; }
  lines.push(`That's ${total}% of the score, and nothing else counts toward it.`);
  if ((ctx.requirements || []).some((r) => !r.scored)) {
    lines.push('Weight and any coach task are tracked, not scored. Your coach sees them; your number doesn\'t move.');
  }
  return A('How your score is built', lines, [{ label: 'See the breakdown', go: 'score-breakdown' }]);
}

function answerDueToday(ctx) {
  const today = (ctx.today || []);
  if (!today.length) return A('Today', ['Nothing is on your list right now.']);
  const open = today.filter((t) => !t.done);
  const lines = [];
  if (!open.length) lines.push('Everything on today\'s standard is in. Anything extra still counts.');
  else for (const t of open) lines.push(`• ${t.title}: ${t.sub}`);
  const done = today.filter((t) => t.done).length;
  lines.push(`${done} of ${today.length} done.`);
  return A("Today's standard", lines, [{ label: 'Go to Home', go: 'home' }]);
}

function answerNutritionScoring(ctx) {
  const lines = [];
  lines.push(`You're on ${ctx.styleName}. ${ctx.styleHow}`);
  if (ctx.nutritionParts && ctx.nutritionParts.length) {
    lines.push('Inside the nutrition part:');
    for (const p of ctx.nutritionParts) lines.push(`• ${p.label}: ${p.pct}%`);
  }
  const nut = (ctx.weights || []).find((w) => /nutrition/i.test(w.key));
  if (nut) lines.push(`Nutrition is ${nut.pct}% of your daily score.`);
  if (!ctx.hasTargets) {
    lines.push(ctx.hasCoach
      ? `No calorie or protein target is set, so nothing is graded against a number. Your ${ctx.coachNoun} can add one any time.`
      : 'No calorie or protein target is set, so nothing is graded against a number.');
  }
  return A('How nutrition is scored', lines, [{ label: 'Plan style', go: 'plan-style' }]);
}

function answerMemory(ctx) {
  const items = ctx.items || [];
  const places = ctx.places || [];
  const facts = ctx.facts || [];
  if (!items.length && !places.length && !facts.length) {
    return A('What OnStandard knows', [
      'Nothing yet. Memory is built from your own logging. When a meal repeats, OnStandard offers to remember it.',
    ], [{ label: 'Add one yourself', go: 'memory-edit/new' }]);
  }
  const lines = [];
  if (items.length) lines.push(`${items.length} saved ${items.length === 1 ? 'meal' : 'meals'}, ready to log in one tap.`);
  if (places.length) lines.push(`Places: ${places.map((p) => p.name).slice(0, 6).join(', ')}.`);
  if (facts.length) lines.push(`${facts.length} thing${facts.length === 1 ? '' : 's'} learned from your corrections.`);
  return A('What OnStandard knows', lines, [{ label: 'Open Food Memory', go: 'plan/memory' }]);
}

function answerTargets(ctx, leadWithRemaining = false) {
  if (!ctx.hasTargets) {
    return A('Your targets', [
      ctx.hasCoach
        ? `No targets are set. Your ${ctx.coachNoun} can set protein, calories and a target weight any time.`
        : 'No targets are set. Your score is built from the standard itself, so it works without them.',
    ], [{ label: 'Nutrition', go: 'plan/nutrition' }]);
  }
  const t = ctx.targets || {};
  const phrase = remainingPhrase(ctx.remaining);
  const targetLines = [];
  if (t.protein != null) targetLines.push(`Protein: ${t.protein}g`);
  if (t.calories != null) targetLines.push(`Calories: ${t.calories}`);
  if (t.weight != null) targetLines.push(`Target weight: ${t.weight} lb`);
  // "What's left?" is a question about the gap; "what are my targets?" is a question about the
  // numbers. Same facts, and whichever was asked leads.
  const lines = leadWithRemaining && phrase
    ? [`You have ${phrase} left today.`, ...targetLines]
    : [...targetLines, phrase ? `Left today: ${phrase}.` : ''];
  return A(leadWithRemaining && phrase ? 'What’s left today' : 'Your targets', lines,
    [{ label: 'Nutrition', go: 'plan/nutrition' }]);
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/**
 * THE ROUTER. Order is the whole design:
 *   1. a question naming one of the athlete's OWN places is about that place — "can I eat Subway"
 *      is not a question about the day in general;
 *   2. eat-intent beats requirement matching, or "what should I eat for lunch" would be answered
 *      as the rulebook entry for Lunch;
 *   3. a named requirement beats the generic "what's due today", so "when is lunch due" gets the
 *      one row it asked about instead of the whole list.
 */
export function answerAsk(question, ctx) {
  const q = norm(question).trim();
  if (!q) return null;
  const c = ctx || {};

  const place = matchPlace(q, c);
  if (place && /(eat|order|get|usual|stay on|fit|have)/.test(q)) return answerPlaceFit(q, place, c);

  if (/(how|what).*(score|points?).*(built|work|made|come)/.test(q) || /^how is my score/.test(q)
      || /(score breakdown|how am i scored|what counts toward)/.test(q)) return answerScore(c);

  if (/(nutrition|meals?).*(scored|score|counts|graded)/.test(q) || /(plan style|what style)/.test(q)
      || /how is nutrition/.test(q)) return answerNutritionScoring(c);

  if (/(what.*eat|should i eat|hungry|meal idea|what to eat|next meal|eat next)/.test(q)) {
    return answerWhatToEat(q, c);
  }

  const req = matchRequirement(q, c);
  if (req && /(why|when|how|what|do i|must i|have to|happens)/.test(q)) return answerRequirement(req, c);

  if (/(target|macro|how much protein|how many calories|what.?s left|left today|left for me|remaining|calories left|protein left)/.test(q)) {
    return answerTargets(c, /(left|remaining)/.test(q));
  }

  if (/(due|left to do|still open|on my list|what.*today)/.test(q)) return answerDueToday(c);

  if (/(know about me|learned|remember|memory|usual|normally)/.test(q)) return answerMemory(c);

  if (req) return answerRequirement(req, c);

  /* Nothing real to answer with. Say so — and route to the two places where a real answer
     lives: a human who knows them, or the meal thread where a model actually reads plates. */
  const chips = [];
  if (c.hasCoach) chips.push({ label: `Ask your ${c.coachNoun}`, go: 'messages' });
  chips.push({ label: 'Nutrition chat', go: 'nutrition-chat' });
  return {
    kind: 'unknown',
    title: "That one's outside what I can answer",
    lines: [
      'I answer from your plan: your requirements, your targets, today\'s progress, and what OnStandard has learned about how you eat. I won\'t guess at anything else.',
      c.hasCoach
        ? `Your ${c.coachNoun} can answer this one, or ask it on a meal where the AI Nutritionist is reading the plate.`
        : 'Ask it on a meal and the AI Nutritionist will answer with the plate in front of it.',
    ],
    chips,
  };
}
