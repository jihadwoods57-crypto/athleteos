/* OnStandard — WHO IS THIS MESSAGE FOR, and should Nia (the AI nutritionist) say anything?
 *
 * THE BUG THIS REPLACES (founder 2026-09-18). Every athlete message in every shared thread called
 * the AI. All three athlete composers ended in an unconditional `askAI(text)`, so the model was
 * handed a turn whether or not anyone had spoken to it. The result is the interaction the founder
 * watched happen in the app:
 *
 *     Coach Alex:      Good job
 *     Athlete:         Thank you Coach
 *     Nia:             <answers, about protein>
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

/** What the AI answers to. Its name is Nia (2026-09-24); the older words stay because people keep
 *  typing them. `nutritionist` can also be a human's title (nutritionistIsAmbiguous), and "Nia" can
 *  be a human's first name (niaAddressed). */
const AI_WORDS = ['ai', 'a.i', 'ai nutritionist', 'nutritionist', 'onstandard', 'nia'];
const AI_NAME_WORD = 'nia';

/* "Nia" is a first name, so the bare word only counts when it is used to ADDRESS her: at the start
   ("Nia, ...", "Nia what should I eat", "hey nia ..."), set off at the end (", nia?"), or @nia.
   "Nia said the hall closes early" is about a person, not to the AI. When a HUMAN in the room is
   also called Nia, only a leading "@nia", "Nia," or "Nia:" is clear enough; anything else is
   ambiguous, and ambiguous means quiet. */
const NIA_LEAD = /^(@nia\b|nia\s*[,:])/;
/* Only words that open a request TO someone. "Nia is coming", "Nia will drive", "Nia did it"
   are sentences ABOUT a person, and "did you see Nia?" asks about one: none of them wake her. */
const NIA_VOCATIVE = [
  NIA_LEAD,
  /^(hey|hi|hello|yo|ok|okay|so|thanks|thank you)[,!]?\s+nia\b/,
  /^nia\s*[!?]/,
  /^nia\s+(what|how|can|could|should|would|why|when|where|which|who|any|give|tell|help|check)\b/,
  /,\s*nia\s*[?.!]*$/,
];
/* The word after a leading "@nia" / "nia,": when it is the rest of a HUMAN Nia's name
   ("@Nia Johnson ..."), the message is to that person. */
const NIA_LEAD_NEXT = /^@?nia[\s,:]+([a-z][a-z'-]*)/;

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
  'recovery meal', 'fuel', 'fueling', 'fuelling', 'drink', 'drinks', 'drinking', 'label',
];

/* THE 12:44 INCIDENT (2026-09-22). An athlete posted a photo of a protein shake with "I'm also
   drinking this" under the AI's meal read, with their coach in the room, and the AI said nothing.
   It is a statement, not a question, and it names nobody, so every rule below fell through to
   silence. But it is the most AI-shaped message a meal thread gets: the athlete is telling the
   nutritionist what else went into THIS meal, so it can be counted.

   "About this meal" is the load-bearing part. "I had eggs and toast" answering a coach's "what did
   you have for breakfast?" is the other half of THEIR exchange. What makes a message an addition
   to this plate is an additive word (also, too, forgot) or a pointer at the thing in the photo
   (this, that), together with eating or drinking. Food nouns widen "had" just enough to catch "I
   also had a roll" without catching "I had practice too". */
const FOOD_WORDS = NUTRITION_WORDS.concat([
  'roll', 'rolls', 'bread', 'toast', 'bagel', 'rice', 'pasta', 'milk', 'chocolate milk', 'juice',
  'soda', 'coffee', 'tea', 'gatorade', 'powerade', 'smoothie', 'bar', 'protein bar', 'yogurt',
  'fruit', 'apple', 'banana', 'orange', 'chips', 'fries', 'cookie', 'cookies', 'dessert', 'side',
  'salad', 'egg', 'eggs', 'cheese', 'chicken', 'beef', 'steak', 'fish', 'sandwich', 'wrap',
  'burger', 'pizza', 'oatmeal', 'cereal', 'peanut butter', 'nuts', 'granola', 'bottle', 'can',
  // A burrito bowl's parts (2026-09-24, "double chicken" at Chipotle): what an amount is said about.
  'meat', 'bean', 'beans', 'corn', 'salsa', 'guac', 'guacamole', 'sour cream', 'cream', 'queso',
  'avocado', 'tortilla', 'lettuce', 'veggies', 'vegetables', 'potato', 'potatoes', 'bacon',
  'sausage', 'turkey', 'pork', 'shrimp', 'salmon', 'tuna', 'sauce', 'dressing', 'ranch', 'mayo',
]);
const EAT_VERB = /\b(eat|eats|eating|ate|drink|drinks|drinking|drank|sip|sips|sipping|sipped|chug|chugged|chugging)\b/;
const HAD_VERB = /\b(had|having|grabbed)\b/;
const ADDITIVE = /\b(also|too|as well|plus|with it|with this|with that|on the side)\b/;
const LEFT_OUT = /\b(forgot|forgot to (log|add)|left out|left off|didn't (log|add|include)|did not (log|add|include)|missed)\b/;
const DEICTIC = /\b(this|that|these|those)\b/;
const FUTURE = /\b(i'll|ill|i will|gonna|going to|next time|tomorrow|later)\b/;

/* AN AMOUNT ON THIS PLATE (2026-09-24). "I had double chicken", then "Double chicken", went
   unanswered on the founder's own Chipotle bowl: a statement, no name, no question, no additive
   word. It is the plainest correction a meal thread gets, and only Nia can put it in the numbers.
   An edit word followed by a food ("double chicken", "no sour cream", "half the rice", "extra
   guac") is about this plate unless it is about later. */
const AMOUNT_EDIT = /\b(?:double|doubled|triple|tripled|twice|extra|half|2x|x2|3x|x3|no|without)\s+(?:(?:the|a|of|my|portion|portions|serving|servings)\s+)*([a-z]+(?:\s[a-z]+)?)/g;
/** Is the athlete changing how much of a food was on this meal? Takes normalised text. */
export function changesAmountOnThisMeal(low) {
  const t = String(low || '');
  if (!t || FUTURE.test(t)) return false;
  for (const m of t.matchAll(AMOUNT_EDIT)) {
    const two = m[1];
    const one = two.split(' ')[0];
    if (FOOD_WORDS.indexOf(two) !== -1 || FOOD_WORDS.indexOf(one) !== -1 || FOOD_WORDS.indexOf(one.replace(/s$/, '')) !== -1) return true;
  }
  return false;
}

/* THE SHAPE OF AN ANSWER (review 2026-09-24). After Nia asks "Which one should I double: the grilled
   chicken or the chicken salad?", the reply that is FOR her is a yes or a no, a pick, a number, an
   amount or a food. "see you at practice", "lol" and "ok" are not, even straight after her question. */
const YES_NO = /^(yes|yeah|yep|yup|ya|yea|yessir|yes sir|sure|correct|right|exactly|no|nope|nah|neither|both|none|all of it|first|second|the first|the second|that one|this one|the other)\b/;
const AMOUNT_WORD = /\b(double|triple|half|extra|twice|oz|ounces?|cups?|grams?|tbsp|tsp|slices?|pieces?|servings?|portions?|scoops?|bowls?)\b/;
const PLAIN = ['which', 'what', 'should', 'would', 'could', 'want', 'that', 'this', 'with', 'have', 'your', 'about', 'there', 'then', 'than', 'from', 'were', 'like', 'need', 'just'];
/** Is this reply shaped like an answer to `question`? Both take bare() text. */
function answerShaped(flat, question) {
  if (!flat) return false;
  if (YES_NO.test(flat) || /\d/.test(flat) || AMOUNT_WORD.test(flat)) return true;
  if (FOOD_WORDS.some((w) => hasWord(flat, w))) return true;
  // A word from her own question: "the grilled one" after "the grilled chicken or the chicken salad?".
  const asked = String(question || '').split(' ').filter((w) => w.length >= 4 && PLAIN.indexOf(w) === -1);
  return flat.split(' ').some((w) => asked.indexOf(w) !== -1);
}
/** How long a question or a remark stays the thing the athlete's next line answers. */
const ADJACENT_MS = 30 * 60 * 1000;

/** Is the athlete telling the room something ELSE went into this meal? Takes normalised text. */
export function addsFoodToThisMeal(low) {
  const t = String(low || '');
  if (!t || FUTURE.test(t)) return false;
  const food = FOOD_WORDS.some((w) => hasWord(t, w));
  if (LEFT_OUT.test(t)) return food || DEICTIC.test(t);
  if (!ADDITIVE.test(t) && !DEICTIC.test(t)) return false;
  if (EAT_VERB.test(t)) return true;
  return HAD_VERB.test(t) && (food || DEICTIC.test(t));
}

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

/** A human in the room who also answers to "Nia". */
function niaIsAmbiguous(participants) {
  return (participants || []).some((p) => p && !isAiRole(p.role) && namesOf(p).indexOf(AI_NAME_WORD) !== -1);
}

/** Is this message calling Nia by name? `clash` = a human is also called Nia. */
function niaAddressed(low, clash) {
  if (clash) return NIA_LEAD.test(low);
  return NIA_VOCATIVE.some((re) => re.test(low));
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
 * Decide whether Nia, the AI nutritionist, should answer this message.
 *
 * @param message {{ id?, senderId?, senderName?, senderRole?, text?, replyToMessageId?, replyToSender? }}
 * @param context {{
 *   participants?: Array<{id,name,role}>,   // everyone who can read the thread, the AI included
 *   history?: Array<message>,               // oldest -> newest, NOT including `message`
 *   aiName?: string,
 *   now?: number,                           // ms; history rows carry `at`. The module reads no clock.
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
  let history = Array.isArray(ctx.history) ? ctx.history : [];
  const text = String(msg.text == null ? '' : msg.text);
  const low = norm(text);
  const flat = bare(text);
  const photo = msg.photo === true;
  const fromAthlete = norm(msg.senderRole) === 'athlete';

  /* THE MESSAGE IS NOT ITS OWN HISTORY (2026-09-22). The meal thread refreshes before it decides,
     so the row it is deciding about was already the last line of `history`. Every adjacency rule
     then saw "the athlete spoke last" instead of "the AI spoke last", and a question aimed straight
     at the AI's read fell through to silence. The echo is dropped here, on both halves of the
     mirror, whatever the caller sent. */
  const tail = history.length ? history[history.length - 1] : null;
  if (tail && (msg.id
    ? tail.id != null && String(tail.id) === String(msg.id)
    : tail.senderId && msg.senderId && String(tail.senderId) === String(msg.senderId) && norm(tail.text) === low)) {
    history = history.slice(0, -1);
  }

  const NOBODY = recipient('unknown', null, 'none');

  // The AI never answers itself, and never answers a system/receipt row.
  if (isAiRole(msg.senderRole)) return verdict(false, recipient('ai', { role: 'ai' }, 'self'), 1, 'the AI does not reply to itself');
  if (!low && !photo) return verdict(false, NOBODY, 1, 'empty message');

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
  const aiParticipant = participants.find((p) => p && isAiRole(p.role)) || { id: null, name: ctx.aiName || 'Nia', role: 'ai' };
  const niaClash = niaIsAmbiguous(participants);
  const niaLeads = NIA_LEAD.test(low);
  if (niaClash) {
    // "@Nia Johnson, see you at lunch": the rest of a human Nia's name follows, so it is to them.
    const next = (NIA_LEAD_NEXT.exec(low) || [])[1];
    const human = next && next !== AI_NAME_WORD
      ? participants.find((p) => p && !isAiRole(p.role) && namesOf(p).indexOf(AI_NAME_WORD) !== -1 && namesOf(p).indexOf(next) !== -1)
      : null;
    if (human) return verdict(false, recipient('human', human, 'mention'), 0.95, 'the message is to ' + (human.name || 'a person') + ', a person named Nia');
  }

  /* ---------------- 1. explicit @mention ---------------- */
  const mentions = mentionsIn(text);
  if (mentions.length) {
    if (niaClash && !niaLeads && mentions.indexOf(AI_NAME_WORD) !== -1) {
      return verdict(false, recipient('unknown', null, 'mention'), 0.5, '@nia could be the AI or a person named Nia: staying out');
    }
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
  // "thanks nia" / "ok ai" is the same nod with a name on it.
  const unnamed = flat.replace(/^(nia|ai)\s+/, '').replace(/\s+(nia|ai)$/, '');
  const isAck = ACK_PATTERNS.some((re) => re.test(flat) || re.test(unnamed));

  /* ---------------- 3. a person or role named in the text ---------------- */
  // "Thank you Coach" / "Yeah coach I'll get it done" / "tell mom I ate" — the founder's case.
  let namedHuman = null;
  for (const p of humans) {
    // A message led by "Nia," is to the AI even when a human is also called Nia (niaAddressed).
    if (namesOf(p).some((n) => !(niaLeads && n === AI_NAME_WORD) && hasWord(low, n))) { namedHuman = p; break; }
  }
  if (!namedHuman) {
    for (const w of HUMAN_WORDS) {
      if (hasWord(low, w)) {
        namedHuman = humans.find((p) => norm(p.role) === w) || { id: null, name: null, role: w };
        break;
      }
    }
  }
  const aiNameWord = norm(ctx.aiName || AI_NAME_WORD);
  const aiNamed = AI_WORDS.some((w) => {
    if (w === 'nutritionist' && nutritionistIsAmbiguous(participants)) return false;
    if (w === AI_NAME_WORD) return niaAddressed(low, niaClash);
    return hasWord(low, w);
  }) || (aiNameWord === AI_NAME_WORD ? niaAddressed(low, niaClash) : hasWord(low, aiNameWord));

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

  /* ---------------- 3b. the athlete showing or telling the nutritionist what they ate ----------------
     Above adjacency on purpose (2026-09-22). A photo the athlete posts on their own meal thread
     is food for the read unless they pointed it at a person, and the rules above have already
     sent every message that names or @mentions a person to that person. A caption does not
     change that: "I'm also drinking this" under a shake is the clearest ask this thread gets. */
  if (fromAthlete && photo) {
    return verdict(true, recipient('ai', aiParticipant, 'semantic'), 0.85, 'the athlete posted a photo on their own meal thread');
  }
  /* ANSWERING NIA'S QUESTION (2026-09-24, narrowed after review the same night). When the latest
     word from anyone but the athlete is Nia's question, asked in the last 30 minutes, an answer-
     shaped reply is hers: "yes", "the grilled one", "6 oz", which name nobody and ask nothing.
     Above the nod rule on purpose: "yes" to a question is an answer, not a nod. "see you at
     practice" is not an answer, and neither is anything once a person has spoken since. */
  const now = Number(ctx.now) || 0;
  const recent = (h) => { const t = Date.parse(h && h.at); return !(now > 0) || !isFinite(t) || now - t <= ADJACENT_MS; };
  const other = lastOther(history, msg);
  if (fromAthlete && other && isAiRole(other.senderRole) && /\?["')\s]*$/.test(String(other.text || '').trim())
    && recent(other) && answerShaped(flat, bare(other.text))) {
    return verdict(true, recipient('ai', aiParticipant, 'adjacency'), 0.85, 'answers the question the AI just asked');
  }
  if (isAck) return verdict(false, recipient('human', null, 'adjacency'), 0.9, 'an acknowledgement, not a question');
  /* THE COACH ASKED FIRST (review 2026-09-24). Coach: "How much chicken did you get?" Athlete:
     "double chicken". That is the other half of the COACH's exchange, and Nia answering it is the
     barging-in this module exists to stop. So adjacency to a person runs BEFORE the amount and
     food rules below: when the latest word from anyone else is a person's, and recent, a statement
     about the plate is for them. The founder's own sequence (Nia spoke last) still reaches her. */
  const aboutPlate = fromAthlete && (changesAmountOnThisMeal(low) || addsFoodToThisMeal(low));
  if (aboutPlate && other && isHumanRole(other.senderRole) && recent(other)) {
    return verdict(false, recipient('human', { id: other.senderId, name: other.senderName, role: other.senderRole }, 'adjacency'), 0.85,
      'answering ' + (other.senderName || other.senderRole) + ', who spoke last');
  }
  if (fromAthlete && changesAmountOnThisMeal(low)) {
    return verdict(true, recipient('ai', aiParticipant, 'semantic'), 0.8, 'the athlete changed an amount on this meal');
  }
  if (fromAthlete && addsFoodToThisMeal(low)) {
    return verdict(true, recipient('ai', aiParticipant, 'semantic'), 0.8, 'the athlete added food or drink to this meal');
  }

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

/** The most recent speech from anyone OTHER than the sender of `msg` (their own earlier lines do
 *  not change who they are answering). */
function lastOther(history, msg) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || (!h.text && h.photo !== true) || h.system === true) continue;
    const same = h.senderId && msg.senderId ? String(h.senderId) === String(msg.senderId)
      : norm(h.senderRole) === norm(msg.senderRole) && norm(h.senderName) === norm(msg.senderName);
    if (!same) return h;
  }
  return null;
}

/** The most recent message from a person or the AI, skipping rows that are not speech (receipts,
 *  analysis updates and other system writes carry a kind of their own). */
function lastHumanOrAi(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || (!h.text && h.photo !== true)) continue;
    if (h.system === true) continue;
    return h;
  }
  return null;
}
