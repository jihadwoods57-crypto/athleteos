/* OnStandard — WHO IS THIS MESSAGE FOR, and should the AI Nutritionist say anything?
 *
 * THE BUG THIS REPLACES (founder 2026-09-18). Every athlete message in every shared thread called
 * the AI. All three athlete composers ended in an unconditional `askAI(text)`, so the model was
 * handed a turn whether or not anyone had spoken to it. The result is the interaction the founder
 * watched happen in the app:
 *
 *     Coach Alex:      Good job
 *     Athlete:         Thank you Coach
 *     AI Nutritionist: <answers, about protein>
 *
 * Nobody asked it anything. It answered because answering was the only thing it could do.
 *
 * It could not have known better, either: the transcript handed to the model was
 * `[{role, text}]` — no names, no ids, no reply target. "Thank you Coach" arrived as
 * `{role:'athlete', text:'Thank you Coach'}` under a `{role:'coach'}` line, with no way to tell
 * that the thank-you belonged to the line above it rather than to the room.
 *
 * So the fix is two things, and prompt wording is neither of them:
 *   1. carry identity (ai-thread.js builds a transcript with senderId/senderName/senderRole and
 *      reply targets), and
 *   2. decide, before spending a turn, whether the AI is being spoken to at all — here.
 *
 * SILENCE IS THE DEFAULT. A good participant in a group chat is quiet most of the time. Every
 * branch below that stays silent is the feature, not a missed opportunity.
 *
 * PURE, AND MIRRORED. No imports, no DOM, no clock, no fetch — so the identical file runs in the
 * proto (browser ES modules) and in Deno inside meal-chat, which enforces the same decision
 * server-side. supabase/functions/_shared/ai-addressing.mjs is a byte-identical copy and
 * `npm run lint:mirror` fails the build if the two ever drift.
 */

/** What the AI answers to. `nutritionist` is here because the product calls it "AI Nutritionist" —
 *  but see nutritionistIsAmbiguous() below: a human on staff can hold that title too. */
const AI_WORDS = ['ai', 'a.i', 'ai nutritionist', 'nutritionist', 'onstandard'];

/** Words that name a HUMAN in the room. Matching one of these means the message is for a person,
 *  and the AI stays out of it. */
const HUMAN_WORDS = [
  'coach', 'coaches', 'trainer', 'dietitian', 'dietician',
  'mom', 'mum', 'mommy', 'mother', 'dad', 'daddy', 'father', 'parent',
  'fellas', 'team', 'everyone', 'guys', 'yall', "y'all",
];

/** Roles whose holder is a person, not the model. */
const HUMAN_ROLES = ['athlete', 'coach', 'trainer', 'dietitian', 'nutritionist', 'parent', 'guardian', 'staff'];

/* Pure acknowledgement. Not a question, not a request, nothing owed in reply — the conversational
   equivalent of a nod. The founder's list, plus what people actually type in this app. Matched
   against the whole message after normalisation, so "got it" matches and "got it, but how much
   protein?" does not. */
const ACK_PATTERNS = [
  /^(thanks?|thank you|thx|ty|tysm|appreciate (it|you|that)|much appreciated)$/,
  /^(ok|okay|k|kk|aight|ight|alright|cool|nice|word|bet|facts|true|fr|forreal)$/,
  /^(yes|yep|yeah|yup|ya|yessir|yes sir|yeah sir|sure|of course|absolutely|indeed)$/,
  /^(no|nope|nah|negative)$/,
  /^(got it|got you|gotchu|gotcha|i got you|understood|copy|copy that|roger|10-4|heard|heard you|say less)$/,
  /^(will do|on it|im on it|i'm on it|doing it|done|already done|finished)$/,
  /^(sounds good|sounds great|that works|works for me|perfect|great|awesome|love it|lets go|let's go)$/,
  /^(my bad|sorry|apologies|no problem|np|no worries|all good|its all good|it's all good)$/,
  /^(lol|lmao|haha+|hehe+|ha)$/,
  /^(congrats|congratulations|good job|great job|well done|nice work|proud of you)$/,
  /^(good morning|morning|good night|night|goodnight|see you|see ya|later|bye)$/,
  /^(amen|facts|100|fire)$/,
];

/* Cues that the speaker is pushing back on something just said. Paired with "the AI spoke last",
   this is the founder's "athlete corrects something the AI previously said" → the AI owes an
   answer even though the message names nobody. */
const CORRECTION_CUES = [
  'are you sure', 'you sure', "that's wrong", 'thats wrong', 'that is wrong', 'not right',
  'incorrect', "that's not", 'thats not', "didn't", 'did not', "wasn't", 'was not',
  'actually it', 'actually i', 'no it was', 'no i had', 'no that', 'i said', 'i told you',
  'you said', 'you got that wrong', 'recount', 'recheck', 'check again', 'look again',
  'thats off', "that's off", 'seems off', 'doesnt add up', "doesn't add up", 'math',
];

/* Vocabulary that makes a question the AI's business rather than the coach's. Deliberately about
   FUEL, not training: "how are your legs feeling" is a trainer's question and must stay one. */
const NUTRITION_WORDS = [
  'protein', 'carb', 'carbs', 'carbohydrate', 'fat', 'fats', 'calorie', 'calories', 'kcal',
  'macro', 'macros', 'fiber', 'fibre', 'sugar', 'sodium', 'hydration', 'hydrate', 'water',
  'meal', 'meals', 'eat', 'eating', 'ate', 'food', 'snack', 'breakfast', 'lunch', 'dinner',
  'portion', 'serving', 'shake', 'supplement', 'creatine', 'nutrition', 'diet', 'weight',
  'bulk', 'cut', 'cutting', 'deficit', 'surplus', 'gram', 'grams', 'oz', 'ounces', 'plate',
  'score', 'target', 'goal', 'remaining', 'left over', 'leftover', 'pregame', 'postgame',
  'recovery meal', 'fuel', 'fueling', 'fuelling',
];

/* Nutrition talk that is dangerous enough to be worth breaking silence for, unprompted. Kept SMALL
   and specific on purpose: a false positive here is the AI barging into a private conversation,
   which is the exact failure this whole module exists to stop. Everything in this list is a
   practice that hurts a young athlete quickly. */
const RISK_PATTERNS = [
  /\b(stop|quit|skip(ping)?|not)\s+(eat|eating|drinking|food|meals?)\b/,
  /\b(starve|starving|starvation)\b/,
  /\b(dehydrat\w*|sweat\s*suit|sauna\s*suit|spit\s*out|water\s*cut)\b/,
  /\bcut\s+\d+\s*(lb|lbs|pound|pounds|kg)\b/,
  /\b(laxative|diuretic|purge|purging|throw(ing)?\s+up|vomit\w*)\b/,
  /\b(no|zero)\s+(carbs?|water|food)\b/,
  /\b(fast(ing)?)\s+(for|all)\s+\w*\s*(day|days|week)\b/,
  /\b\d{3,4}\s*(cal|cals|calories)\s+(a|per)\s+day\b/,
];

// Curly apostrophes and dashes are what an iPhone keyboard actually produces, and every cue
// list below is written with straight ones. Folding here is why "I didn’t eat the rice"
// reads as a correction instead of falling through to silence.
const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .replace(/[\u2018\u2019\u02bc]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();
/** Strip punctuation and emoji for whole-message matching, so "Got it!!" and "got it" are one. */
const bare = (s) => norm(s).replace(/[^a-z0-9' ]+/g, '').replace(/\s+/g, ' ').trim();
const hasWord = (text, word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);

/** @mentions, without the @. `@AI`, `@Coach Alex` (first token only — names are matched separately). */
export function mentionsIn(text) {
  const out = [];
  // Only at the start of a token: `a@b.com` is an email address, not a mention of "b".
  const re = /(?:^|[\s(\[])@([a-z0-9._'-]{1,32})/gi;
  let m;
  while ((m = re.exec(String(text || '')))) out.push(m[1].toLowerCase().replace(/[._'-]+$/, ''));
  return out;
}

const isAiRole = (role) => norm(role) === 'ai';
const isHumanRole = (role) => HUMAN_ROLES.indexOf(norm(role)) !== -1;

/** Every way a participant can be named: full name, each name part of 2+ characters. */
function namesOf(participant) {
  const full = norm(participant && participant.name);
  if (!full) return [];
  const parts = full.split(' ').filter((p) => p.length >= 2);
  return [full].concat(parts).filter((v, i, a) => a.indexOf(v) === i);
}

/** A human participant whose own TITLE is "nutritionist"/"dietitian" makes the bare word ambiguous:
 *  it could be them or the model. Ambiguous means silent (rule 4). */
function nutritionistIsAmbiguous(participants) {
  return (participants || []).some((p) => p && !isAiRole(p.role)
    && ['nutritionist', 'dietitian'].indexOf(norm(p.role)) !== -1);
}

const recipient = (kind, who, how) => ({
  kind,
  id: (who && who.id) || null,
  name: (who && who.name) || null,
  role: (who && who.role) || null,
  via: how,
});

const verdict = (shouldRespond, intendedRecipient, confidence, reason) =>
  ({ shouldRespond, intendedRecipient, confidence, reason });

/**
 * Decide whether the AI Nutritionist should answer this message.
 *
 * @param message {{ id?, senderId?, senderName?, senderRole?, text?, replyToMessageId?, replyToSender? }}
 * @param context {{
 *   participants?: Array<{id,name,role}>,   // everyone who can read the thread, the AI included
 *   history?: Array<message>,               // oldest -> newest, NOT including `message`
 *   aiName?: string,
 * }}
 * @returns {{ shouldRespond:boolean, intendedRecipient:object, confidence:number, reason:string }}
 *
 * The priority the founder specified, in order:
 *   explicit @mention > reply-to target > named person/role > conversational adjacency > semantics
 * and, underneath all of it, silence.
 */
export function shouldAiRespond(message, context) {
  const msg = message || {};
  const ctx = context || {};
  const participants = Array.isArray(ctx.participants) ? ctx.participants : [];
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  const text = String(msg.text == null ? '' : msg.text);
  const low = norm(text);
  const flat = bare(text);

  const NOBODY = recipient('unknown', null, 'none');

  // The AI never answers itself, and never answers a system/receipt row.
  if (isAiRole(msg.senderRole)) return verdict(false, recipient('ai', { role: 'ai' }, 'self'), 1, 'the AI does not reply to itself');
  if (!low) return verdict(false, NOBODY, 1, 'empty message');

  /* ---------------- 0. danger outranks every addressing rule ----------------
     An athlete saying "gonna stop eating till weigh-ins" to their COACH is still an athlete about
     to hurt themselves, and the nutritionist in the room would speak up. This sits above adjacency
     deliberately: it was below it first, and the coach-then-athlete ordering of exactly that
     conversation filed it as a private exchange and stayed quiet. The pattern list is small on
     purpose (see RISK_PATTERNS) because a false positive here is the AI interrupting. */
  if (RISK_PATTERNS.some((re) => re.test(low))) {
    return verdict(true, recipient('group', null, 'semantic'), 0.7, 'unsafe nutrition practice raised in the thread');
  }

  const humans = participants.filter((p) => p && !isAiRole(p.role));
  const aiParticipant = participants.find((p) => p && isAiRole(p.role)) || { id: null, name: ctx.aiName || 'AI Nutritionist', role: 'ai' };

  /* ---------------- 1. explicit @mention ---------------- */
  const mentions = mentionsIn(text);
  if (mentions.length) {
    const aiMentioned = mentions.some((m) => AI_WORDS.indexOf(m) !== -1);
    if (aiMentioned) return verdict(true, recipient('ai', aiParticipant, 'mention'), 0.99, 'the message @mentions the AI');
    for (const p of humans) {
      const names = namesOf(p);
      if (mentions.some((m) => names.indexOf(m) !== -1 || HUMAN_WORDS.indexOf(m) !== -1 && norm(p.role) === m)) {
        return verdict(false, recipient('human', p, 'mention'), 0.95, 'the message @mentions ' + (p.name || p.role));
      }
    }
    if (mentions.some((m) => HUMAN_WORDS.indexOf(m) !== -1)) {
      return verdict(false, recipient('human', null, 'mention'), 0.9, 'the message @mentions a person, not the AI');
    }
  }

  /* ---------------- 2. reply-to target ---------------- */
  // A real reply beats every guess below it: the app knows exactly which message this answers.
  const repliedTo = msg.replyToMessageId
    ? history.find((h) => h && h.id && String(h.id) === String(msg.replyToMessageId)) || null
    : null;
  const repliedRole = (repliedTo && repliedTo.senderRole) || msg.replyToSender && msg.replyToSender.role || null;
  if (repliedRole) {
    if (isAiRole(repliedRole)) return verdict(true, recipient('ai', aiParticipant, 'reply'), 0.97, 'a direct reply to the AI');
    const who = repliedTo
      ? { id: repliedTo.senderId, name: repliedTo.senderName, role: repliedTo.senderRole }
      : msg.replyToSender;
    return verdict(false, recipient('human', who, 'reply'), 0.95, 'a direct reply to ' + ((who && who.name) || 'someone else'));
  }

  /* ---------------- acknowledgements: silent whoever they are for ----------------
     Placed above "named person" on purpose. "Thanks AI" is still a nod, not a question, and the
     room does not need the model to say "you're welcome". The one exception is a nod that also
     carries a real question, which is not an acknowledgement by the test below. */
  const isAck = ACK_PATTERNS.some((re) => re.test(flat));

  /* ---------------- 3. a person or role named in the text ---------------- */
  // "Thank you Coach" / "Yeah coach I'll get it done" / "tell mom I ate" — the founder's case.
  let namedHuman = null;
  for (const p of humans) {
    if (namesOf(p).some((n) => hasWord(low, n))) { namedHuman = p; break; }
  }
  if (!namedHuman) {
    for (const w of HUMAN_WORDS) {
      if (hasWord(low, w)) {
        namedHuman = humans.find((p) => norm(p.role) === w) || { id: null, name: null, role: w };
        break;
      }
    }
  }
  const aiNamed = AI_WORDS.some((w) => {
    if (w === 'nutritionist' && nutritionistIsAmbiguous(participants)) return false;
    return hasWord(low, w);
  }) || hasWord(low, norm(ctx.aiName || 'ai nutritionist'));

  if (aiNamed && !namedHuman) {
    if (isAck) return verdict(false, recipient('ai', aiParticipant, 'named'), 0.8, 'an acknowledgement to the AI needs no answer');
    return verdict(true, recipient('ai', aiParticipant, 'named'), 0.9, 'the message names the AI');
  }
  if (namedHuman && !aiNamed) {
    return verdict(false, recipient('human', namedHuman, 'named'), 0.9,
      'the message names ' + (namedHuman.name || namedHuman.role) + ', not the AI');
  }
  if (namedHuman && aiNamed) {
    // Both named. Ambiguous, and rule 4 says ambiguous means quiet.
    return verdict(false, recipient('unknown', null, 'named'), 0.5, 'names both a person and the AI: ambiguous, staying out');
  }

  if (isAck) return verdict(false, recipient('human', null, 'adjacency'), 0.9, 'an acknowledgement, not a question');

  /* ---------------- 4. conversational adjacency ---------------- */
  const prev = lastHumanOrAi(history);
  const asksSomething = /\?/.test(text) || /^(what|how|when|why|where|which|who|can|could|should|would|do|does|did|is|are|am|will|any)\b/.test(low);

  if (prev && isAiRole(prev.senderRole)) {
    // The AI spoke last. A question, or a push-back, is aimed at it.
    if (CORRECTION_CUES.some((c) => low.indexOf(c) !== -1)) {
      return verdict(true, recipient('ai', aiParticipant, 'adjacency'), 0.9, 'corrects or challenges what the AI just said');
    }
    if (asksSomething) return verdict(true, recipient('ai', aiParticipant, 'adjacency'), 0.85, 'a question right after the AI spoke');
  }

  if (prev && isHumanRole(prev.senderRole) && String(prev.senderId || '') !== String(msg.senderId || '')) {
    // Someone else spoke last and this is not a question: it is the other half of their exchange.
    if (!asksSomething) {
      return verdict(false, recipient('human', { id: prev.senderId, name: prev.senderName, role: prev.senderRole }, 'adjacency'), 0.85,
        'answering ' + (prev.senderName || prev.senderRole) + ', who spoke last');
    }
  }

  /* ---------------- 5. semantics, and the narrow proactive cases ---------------- */
  const nutritionTopic = NUTRITION_WORDS.some((w) => hasWord(low, w));

  const senderIsOperator = ['coach', 'trainer', 'dietitian', 'nutritionist', 'staff'].indexOf(norm(msg.senderRole)) !== -1;
  if (senderIsOperator) {
    // A coach asking the ROOM a nutrition question ("how much protein does he have left?") wants
    // the nutritionist. A coach asking the ATHLETE something ("did you eat yet?") does not.
    const secondPerson = /\b(you|your|you're|youre|u|ur)\b/.test(low);
    if (asksSomething && nutritionTopic && !secondPerson) {
      return verdict(true, recipient('ai', aiParticipant, 'semantic'), 0.8, 'the coach asked a nutrition question of the room');
    }
    return verdict(false, recipient('human', null, 'semantic'), 0.75, 'a coach speaking to their athlete');
  }

  if (asksSomething && nutritionTopic) {
    return verdict(true, recipient('ai', aiParticipant, 'semantic'), 0.8, 'an unanswered nutrition question');
  }

  /* ---------------- 6. default ---------------- */
  return verdict(false, NOBODY, 0.6, 'nothing addressed to the AI, staying quiet');
}

/** The most recent message from a person or the AI, skipping rows that are not speech (receipts,
 *  analysis updates and other system writes carry a kind of their own). */
function lastHumanOrAi(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || !h.text) continue;
    if (h.system === true) continue;
    return h;
  }
  return null;
}
