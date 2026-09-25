// run: node --test proto/redesign-2026-07/js/ai-addressing.test.mjs
//
// The bar these pin: the AI is a third member of the room, not a chatbot under every message.
// Most of this file asserts SILENCE, because silence is the behaviour that was missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAiRespond, mentionsIn } from './ai-addressing.js';

const ALEX = { id: 'u-coach', name: 'Alex Grinch', role: 'coach' };
const JIHAD = { id: 'u-ath', name: 'Jihad Woods', role: 'athlete' };
const TRAINER = { id: 'u-tr', name: 'Dana Reyes', role: 'trainer' };
const AI = { id: null, name: 'Nia', role: 'ai' };
const ROOM = [ALEX, JIHAD, TRAINER, AI];

const from = (who, text, extra) => ({
  id: 'm-' + Math.random().toString(36).slice(2, 8),
  senderId: who.id, senderName: who.name, senderRole: who.role, text, ...(extra || {}),
});
const decide = (msg, history, participants) =>
  shouldAiRespond(msg, { participants: participants || ROOM, history: history || [] });

/* ============================ THE FOUNDER'S REPORTED BUG ============================ */

test('Coach: "Good job" / Athlete: "Thank you Coach" — the AI says nothing', () => {
  const history = [from(ALEX, 'Good job')];
  const d = decide(from(JIHAD, 'Thank you Coach'), history);
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.kind, 'human');
  assert.equal(d.intendedRecipient.name, 'Alex Grinch', 'the recipient resolves to the actual coach');
});

test('the coach’s real first name addresses the coach, not the AI', () => {
  const d = decide(from(JIHAD, 'Appreciate it Alex, I’ll lock in'), [from(ALEX, 'Good job')]);
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.name, 'Alex Grinch');
});

/* ============================ 1. clearly addressed to the AI ============================ */

test('a direct question to the AI gets an answer', () => {
  const d = decide(from(JIHAD, 'AI, how much protein do I have left?'));
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
});

test('an @mention of the AI wins over everything else in the message', () => {
  const d = decide(from(JIHAD, '@ai coach said to ask you about my carbs'), [from(ALEX, 'ask the nutritionist')]);
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.via, 'mention');
});

test('"Why did you score this meal a 72?" right after the AI spoke is for the AI', () => {
  const d = decide(from(JIHAD, 'Why did you score this meal a 72?'), [from(AI, 'Lunch scored 72.')]);
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
});

test('the athlete correcting the AI is answered even though nobody is named', () => {
  const history = [from(AI, 'You have 35g of protein remaining.')];
  for (const text of ['Are you sure?', "That's wrong, I had the shake too", 'I didn’t eat the rice though']) {
    const d = decide(from(JIHAD, text), history);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.intendedRecipient.kind, 'ai', text);
  }
});

test('a reply-to pointing at the AI beats the words in the message', () => {
  const aiMsg = from(AI, 'You have 35g of protein remaining.');
  const d = decide(from(JIHAD, 'thanks coach', { replyToMessageId: aiMsg.id }), [aiMsg]);
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.via, 'reply');
});

/* ============================ 2 + 3. human-to-human ============================ */

test('acknowledgements are never worth a turn', () => {
  const history = [from(ALEX, 'Make sure you eat before meetings.')];
  for (const text of ['Got you.', 'yes coach', 'Bet', 'will do', 'ok', '\u{1F44D}', 'Thank you', 'appreciate it', 'say less']) {
    assert.equal(decide(from(JIHAD, text), history).shouldRespond, false, text);
  }
});

test('Trainer: "How are your legs feeling?" / Athlete: "A little sore today." — silent', () => {
  const d = decide(from(JIHAD, 'A little sore today.'), [from(TRAINER, 'How are your legs feeling?')]);
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.name, 'Dana Reyes');
});

test('a trainer asking about the body is not a nutrition question', () => {
  assert.equal(decide(from(TRAINER, 'How are your legs feeling?')).shouldRespond, false);
});

test('"Yeah coach I’ll get it done." is for the coach', () => {
  const d = decide(from(JIHAD, 'Yeah coach I’ll get it done.'));
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.role, 'coach');
});

test('a coach praising their athlete is left alone', () => {
  for (const text of ['Good job', 'Proud of you today', 'See you at 6']) {
    assert.equal(decide(from(ALEX, text)).shouldRespond, false, text);
  }
});

test('the coach speaking TO the athlete stays between them, even about food', () => {
  const d = decide(from(ALEX, 'Make sure you eat before meetings.'));
  assert.equal(d.shouldRespond, false);
});

test('a parent in the room is a person, not a prompt', () => {
  const d = decide(from(JIHAD, 'mom is picking up dinner'), [from(ALEX, 'eat well tonight')]);
  assert.equal(d.shouldRespond, false);
});

/* ============================ 4. ambiguity prefers silence ============================ */

test('naming both a person and the AI is ambiguous, so the AI stays out', () => {
  const d = decide(from(JIHAD, 'coach can you ask the AI about this'));
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.kind, 'unknown');
});

test('a bare statement addressed to nobody gets no reply', () => {
  for (const text of ['long day', 'we ran a lot today', 'back at it tomorrow']) {
    assert.equal(decide(from(JIHAD, text)).shouldRespond, false, text);
  }
});

test('"nutritionist" is ambiguous when a human on staff holds that title', () => {
  const human = { id: 'u-nut', name: 'Priya Shah', role: 'nutritionist' };
  const d = decide(from(JIHAD, 'nutritionist what do you think'), [], [human, JIHAD, AI]);
  assert.equal(d.shouldRespond, false, 'it could be Priya, so say nothing');
});

test('a non-nutrition question addressed to nobody is not the AI’s to answer', () => {
  assert.equal(decide(from(JIHAD, 'what time is practice?')).shouldRespond, false);
});

/* ============================ 5. rare, useful intervention ============================ */

test('a coach asking the room a nutrition question gets the nutritionist', () => {
  const d = decide(from(ALEX, 'How much protein does he have left?'));
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
});

test('an unanswered nutrition question from the athlete is answered', () => {
  for (const text of ['how much protein do I have left?', 'should I eat before lifting?', 'what should I have for dinner?']) {
    assert.equal(decide(from(JIHAD, text)).shouldRespond, true, text);
  }
});

test('dangerous practice breaks the silence even though nobody asked', () => {
  for (const text of ['gonna stop eating till weigh-ins', 'I need to cut 8 lbs by Friday', 'just gonna dehydrate in a sauna suit']) {
    const d = decide(from(JIHAD, text), [from(ALEX, 'weigh in Friday')]);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.reason, 'unsafe nutrition practice raised in the thread', text);
  }
});

/* ============================ invariants ============================ */

test('the AI never answers itself', () => {
  const d = decide(from(AI, 'You have 35g of protein remaining. Want a suggestion?'));
  assert.equal(d.shouldRespond, false);
});

test('every verdict carries a recipient, a confidence and a reason', () => {
  for (const text of ['thanks coach', 'AI how much protein', 'long day', 'are you sure?']) {
    const d = decide(from(JIHAD, text), [from(AI, 'x')]);
    assert.equal(typeof d.shouldRespond, 'boolean', text);
    assert.ok(d.intendedRecipient && typeof d.intendedRecipient.kind === 'string', text);
    assert.ok(d.confidence > 0 && d.confidence <= 1, text);
    assert.ok(d.reason && d.reason.length > 4, text);
  }
});

test('mentionsIn pulls @handles and ignores plain text', () => {
  assert.deepEqual(mentionsIn('@ai and @Alex, not email a@b.com'), ['ai', 'alex']);
  assert.deepEqual(mentionsIn('no mentions here'), []);
});

/* ============================ Nia, by name (2026-09-24) ============================ */

test('"Nia, what should I eat" is for Nia', () => {
  const d = decide(from(JIHAD, 'Nia, what should I eat before practice?'));
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
  assert.equal(d.intendedRecipient.name, 'Nia');
});

test('@nia is an explicit mention of Nia', () => {
  const d = decide(from(JIHAD, '@nia coach said to ask you about my carbs'));
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.via, 'mention');
});

test('"hey nia" with a question is for Nia', () => {
  const d = decide(from(JIHAD, 'hey nia how much protein do I have left'));
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
});

test('"thanks nia" is a nod, not a question', () => {
  assert.equal(decide(from(JIHAD, 'thanks nia'), [from(AI, 'Solid plate.')]).shouldRespond, false);
});

test('"Nia" mid-sentence about a person is not addressing the AI', () => {
  for (const text of ['Nia said the dining hall closes early tonight', 'I sat with Nia at lunch']) {
    const d = decide(from(JIHAD, text));
    assert.equal(d.shouldRespond, false, text);
    assert.notEqual(d.intendedRecipient.kind, 'ai', text);
  }
});

test('a coach named Nia in the thread makes a bare "nia" ambiguous', () => {
  const coachNia = { id: 'u-nia', name: 'Nia Brooks', role: 'coach' };
  const room = [coachNia, JIHAD, AI];
  for (const text of ['hey nia how much protein is left', 'what do you think nia?', 'thanks for the plan nia, @nia see you']) {
    assert.equal(decide(from(JIHAD, text), [], room).shouldRespond, false, text);
  }
  // A leading "Nia," / "Nia:" / "@nia" is clear enough to be the AI.
  for (const text of ['Nia, how much protein is left?', 'Nia: is this enough before practice?', '@nia how many carbs?']) {
    const d = decide(from(JIHAD, text), [], room);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.intendedRecipient.kind, 'ai', text);
  }
});

test('the default AI name is Nia', () => {
  const d = shouldAiRespond(from(JIHAD, 'Nia, is this enough protein?'), { participants: [JIHAD], history: [] });
  assert.equal(d.intendedRecipient.name, 'Nia');
});

test('@mentioning a human coach named Nia goes to the person, not the AI', () => {
  const coachNia = { id: 'u-nj', name: 'Nia Johnson', role: 'coach' };
  const room = [coachNia, JIHAD, AI];
  for (const text of ['@Nia Johnson can we talk after practice?', 'Nia Johnson, what time is lift', '@nia johnson how much protein should I get']) {
    const d = decide(from(JIHAD, text), [], room);
    assert.equal(d.shouldRespond, false, text);
    assert.equal(d.intendedRecipient.kind, 'human', text);
    assert.equal(d.intendedRecipient.name, 'Nia Johnson', text);
  }
  // A leading "@nia" followed by anything but the rest of her name is still the AI.
  const ai = decide(from(JIHAD, '@nia how many carbs are left?'), [], room);
  assert.equal(ai.shouldRespond, true);
  assert.equal(ai.intendedRecipient.kind, 'ai');
});

test('sentences ABOUT someone called Nia never wake her, even right after a coach speaks', () => {
  const texts = ['Nia is coming to lunch', 'Nia will drive us', 'did you see Nia?', 'Nia did the grocery run'];
  for (const text of texts) {
    assert.equal(decide(from(JIHAD, text)).shouldRespond, false, text);
    assert.equal(decide(from(JIHAD, text), [from(ALEX, 'Good lift today')]).shouldRespond, false, `${text} (after a coach)`);
  }
});

/* ============================ "I HAD DOUBLE CHICKEN" (2026-09-24) ============================ */
// The founder's own thread: Nia's last word was a meal suggestion; "I had double chicken" and,
// later, "Double chicken" got no reply at all. An amount on this plate is the plainest correction
// a meal thread gets, and only Nia can count it.

test('an amount on this meal wakes Nia, with or without her name', () => {
  const history = [from(AI, 'Breakfast resets the count, so aim for a plate around 45-50g protein.')];
  for (const text of ['I had double chicken', 'Double chicken', 'no sour cream on mine', 'half the rice', 'extra guac', '2x chicken']) {
    const d = decide(from(JIHAD, text), history);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.intendedRecipient.kind, 'ai', text);
  }
});

test('an amount said to the coach, about later, or by the coach is not a correction for Nia', () => {
  assert.equal(decide(from(JIHAD, 'Coach I had double chicken')).shouldRespond, false);
  assert.equal(decide(from(JIHAD, "I'll get double chicken next time")).shouldRespond, false);
  assert.equal(decide(from(ALEX, 'Double chicken next time')).shouldRespond, false);
  assert.equal(decide(from(JIHAD, 'no problem')).shouldRespond, false);
});

test('an answer to Nia\'s question reaches her, even "yes" or a bare food name', () => {
  // Timed: an answer is judged against how recently she asked (an undated row is not recent).
  const now = Date.parse('2026-09-24T21:30:00Z');
  const ago = (m) => ({ at: new Date(now - m * 60000).toISOString() });
  const d = (msg, history) => shouldAiRespond(msg, { participants: ROOM, history, now });
  const asked = [from(AI, 'Which one should I double: the chicken or the chicken salad?', ago(2))];
  for (const text of ['the chicken', 'yes', 'Grilled chicken', 'both']) {
    assert.equal(d(from(JIHAD, text), asked).shouldRespond, true, text);
  }
  // A nod is still a nod.
  for (const text of ['thanks', 'lol']) assert.equal(d(from(JIHAD, text), asked).shouldRespond, false, text);
  // Not after a statement, and not when someone else spoke in between.
  assert.equal(d(from(JIHAD, 'yes'), [from(AI, 'Solid plate.', ago(2))]).shouldRespond, false);
  assert.equal(d(from(JIHAD, 'yes'), [...asked, from(ALEX, 'Did you eat the rice?', ago(1))]).shouldRespond, false);
});

/* ============================ I3: THE COACH ASKED, THE ATHLETE ANSWERED (review 2026-09-24) ============================
 * Widening the gate for "double chicken" let Nia answer the athlete's reply to a HUMAN's question.
 * The reviewer's repros (the addr script), pinned: adjacency to a person runs before the
 * amount/food rules, and "answers Nia's question" needs her question to be the latest word from
 * anyone but the athlete, recent, and answered in an answer's shape. */

const NOW = Date.parse('2026-09-24T21:30:00Z');
const at = (min) => new Date(NOW - min * 60000).toISOString();
const decideAt = (msg, history) => shouldAiRespond(msg, { participants: ROOM, history, now: NOW });

test('I3: an amount answering the coach\'s question goes to the coach, not Nia', () => {
  const cases = [
    ['double chicken', 'How much chicken did you get?'],
    ['I had double chicken', 'That bowl looks light. What did you get?'],
    ['no dessert today', 'Did you have dessert?'],
    ['extra rice and no beans', 'Why is the carb number so high?'],
    ['I also had a roll', 'What else was on the plate?'],
  ];
  for (const [text, coach] of cases) {
    const d = decideAt(from(JIHAD, text), [from(AI, 'Solid plate, 29g protein.', { at: at(40) }), from(ALEX, coach, { at: at(2) })]);
    assert.equal(d.shouldRespond, false, `${coach} -> ${text}`);
    assert.equal(d.intendedRecipient.kind, 'human', text);
    assert.equal(d.intendedRecipient.name, 'Alex Grinch', text);
  }
  // The athlete's own earlier line in between does not hand the turn to Nia.
  const d = decideAt(from(JIHAD, 'double chicken'), [from(ALEX, 'How much chicken did you get?', { at: at(3) }), from(JIHAD, 'hmm', { at: at(2) })]);
  assert.equal(d.shouldRespond, false);
});

test('I3: a coach who spoke long ago does not own the next amount the athlete states', () => {
  const d = decideAt(from(JIHAD, 'I had double chicken'), [from(ALEX, 'Good lift today', { at: at(180) })]);
  assert.equal(d.shouldRespond, true);
  assert.equal(d.intendedRecipient.kind, 'ai');
});

test('I3: the founder\'s sequence still wakes Nia', () => {
  const history = [
    from(AI, "Protein, carbs, and fat are in balance on this plate. I'm least sure on the sour cream portion.", { at: at(20) }),
    from(JIHAD, 'What should i have for breakfast tomorrow', { at: at(19) }),
    from(AI, 'Breakfast resets the count, so aim for a plate around 45-50g protein.', { at: at(18) }),
  ];
  for (const text of ['I had double chicken', 'Nia in my meal i had double chicken. This from chipotle', 'Double chicken']) {
    const d = decideAt(from(JIHAD, text), history);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.intendedRecipient.kind, 'ai', text);
  }
});

test('I3: "yes" straight after Nia\'s question still wakes her', () => {
  const asked = [from(AI, 'Which one should I double: the grilled chicken or the chicken salad?', { at: at(1) })];
  for (const text of ['yes', 'the grilled one', 'Grilled chicken', 'both', '6 oz', 'no', 'the first one']) {
    assert.equal(decideAt(from(JIHAD, text), asked).shouldRespond, true, text);
  }
});

test('I3: an answer to Nia counts only when it is answer-shaped, recent, and hers was the last word', () => {
  const asked = (min) => [from(AI, 'Want me to count a shake with it?', { at: at(min) })];
  // Not an answer: small talk after her question.
  for (const text of ['see you at practice', 'lol', 'ok']) assert.equal(decideAt(from(JIHAD, text), asked(1)).shouldRespond, false, text);
  // Too long ago.
  assert.equal(decideAt(from(JIHAD, 'yes'), asked(45)).shouldRespond, false, 'her question was 45 minutes ago');
  assert.equal(decideAt(from(JIHAD, 'yes'), asked(10)).shouldRespond, true, 'ten minutes is still the same exchange');
  // Someone else spoke after her.
  const d = decideAt(from(JIHAD, 'yes'), [...asked(3), from(ALEX, 'You lifting today?', { at: at(1) })]);
  assert.equal(d.shouldRespond, false, "a person spoke after her question");
});

/* ============================ REVIEW ROUND 2: NAMING NIA ALWAYS WINS (2026-09-24) ============================
 * The re-reviewer's probes (rr/addr.mjs, rr/addr2.mjs). The human-recency rule silenced "Nia I had
 * double chicken" and the founder's exact "Nia in my meal i had double chicken..." whenever a coach
 * or guardian had spoken in the last half hour, and Nia's own correction replies (filed as system
 * records) were skipped, so the founder's follow-up "Double chicken" went to the coach. */

const GUARD = { id: 'u-g', name: 'Mary Woods', role: 'guardian' };
const ackRow = (text, min) => from(AI, text, { at: at(min), system: true });

test('R2 I3: the founder\'s two messages both wake Nia with a coach who spoke 5 minutes earlier', () => {
  const coach = from(ALEX, 'Make sure that gets added in', { at: at(5) });
  const first = 'Nia in my meal i had double chicken. This from chipotle';
  const d1 = decideAt(from(JIHAD, first), [coach]);
  assert.equal(d1.shouldRespond, true, d1.reason);
  // Nia's ack and receipt are filed as system records: they are still Nia speaking.
  const after = [coach, from(JIHAD, first, { at: at(3) }), ackRow('Doubled the grilled chicken to 6 oz.', 2), ackRow('Updated: Protein 29g to 50g.', 2)];
  const d2 = decideAt(from(JIHAD, 'Double chicken'), after);
  assert.equal(d2.shouldRespond, true, d2.reason);
  // And after her "Already counted" (a question-less correction_ask row, not system).
  const d3 = decideAt(from(JIHAD, 'yes double chicken'), [...after, from(JIHAD, 'Double chicken', { at: at(1) }), from(AI, 'Already counted as a double, 6 oz.', { at: at(1) })]);
  assert.equal(d3.shouldRespond, true, d3.reason);
});

test('R2 I3: "Nia I had double chicken" wakes Nia even right after a coach or a guardian', () => {
  for (const who of [ALEX, GUARD]) {
    const room = [ALEX, JIHAD, GUARD, AI];
    for (const text of ['Nia I had double chicken', 'hey Nia I had double chicken', '@Nia I had double chicken', 'ok nia I had double chicken']) {
      const d = shouldAiRespond(from(JIHAD, text), { participants: room, history: [from(who, 'How much chicken did you get?', { at: at(5) })], now: NOW });
      assert.equal(d.shouldRespond, true, `${who.role}: ${text} (${d.reason})`);
    }
  }
});

test('R2 I3: a sentence ABOUT a person called Nia stays quiet', () => {
  for (const text of ['Nia is coming to practice', 'Nia said the hall closes early', "Nia's bringing the food", 'Nia and I ate already', 'Nia will drive', 'Nia just left', 'Nia told me']) {
    assert.equal(decideAt(from(JIHAD, text), [from(ALEX, 'Good lift today', { at: at(5) })]).shouldRespond, false, text);
    assert.equal(decideAt(from(JIHAD, text), []).shouldRespond, false, `${text} (empty room)`);
  }
});

test('R2 I3: when a human in the room is called Nia, only "Nia," / "Nia:" / "@nia" at the start wake her', () => {
  const NIAH = { id: 'u-n', name: 'Nia Johnson', role: 'trainer' };
  const room = [ALEX, JIHAD, NIAH, AI];
  const d = (text) => shouldAiRespond(from(JIHAD, text), { participants: room, history: [], now: NOW }).shouldRespond;
  assert.equal(d('Nia I had double chicken'), false, 'could be the trainer');
  assert.equal(d('Nia, I had double chicken'), true);
});

test('R2 I3: a statement answering the coach, with no name on it, still goes to the coach', () => {
  const d = decideAt(from(JIHAD, 'double chicken'), [from(ALEX, 'How much chicken?', { at: at(4) })]);
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.name, 'Alex Grinch');
});

test('R2 I3: a row with no time, or no clock, is not recent', () => {
  const noAt = decideAt(from(JIHAD, 'double chicken'), [from(ALEX, 'How much chicken did you get?')]);
  assert.equal(noAt.intendedRecipient.via === 'adjacency' && noAt.reason.startsWith('answering'), false, 'the recency rule does not claim a row it cannot date');
  const noNow = shouldAiRespond(from(JIHAD, 'yes'), { participants: ROOM, history: [from(AI, 'Want me to count a shake with it?', { at: at(1) })] });
  assert.equal(noNow.shouldRespond, false, 'no clock: Nia\'s question is not known to be recent');
});

/* ============================ A NIA LEAD OUTRANKS A FOOD THAT SOUNDS LIKE A NAME (2026-09-25) ============================ */
// "Nia, the white rice was small" in a room with Coach White read as naming both the coach and Nia,
// and ambiguous means silent: the athlete answered Nia's question and nobody replied. A message that
// STARTS by addressing Nia is hers. A bare word elsewhere that happens to be part of a person's name
// (white rice, brown rice, green beans, an athlete surnamed Rice) is not that person being named.
// Only an @mention of the person, or their full name / "Coach <Surname>", still counts.
const FOOD_ROOMS = [
  { coach: { id: 'u-w', name: 'Marcus White', role: 'coach' }, food: 'white rice' },
  { coach: { id: 'u-b', name: 'Derek Brown', role: 'coach' }, food: 'brown rice' },
  { coach: { id: 'u-g', name: 'Sam Green', role: 'coach' }, food: 'green beans' },
];
const JAY_RICE = { id: 'u-jr', name: 'Jay Rice', role: 'athlete' };

test('a Nia lead wakes her even when the food shares a word with a coach’s name', () => {
  for (const { coach, food } of FOOD_ROOMS) {
    const room = [coach, JIHAD, AI];
    for (const text of [`@Nia the ${food} portion was small.`, `Nia, the ${food} was small`, `Nia the ${food} portion was large.`]) {
      const d = decide(from(JIHAD, text), [], room);
      assert.equal(d.shouldRespond, true, `${coach.name}: ${text}`);
      assert.equal(d.intendedRecipient.kind, 'ai', `${coach.name}: ${text}`);
    }
  }
});

test('an athlete surnamed Rice can still tell Nia about the rice', () => {
  const room = [ALEX, JAY_RICE, AI];
  for (const text of ['@Nia the rice portion was regular.', 'Nia, the rice was small', 'Nia: rice was more like 2 cups']) {
    const d = decide(from(JAY_RICE, text), [], room);
    assert.equal(d.shouldRespond, true, text);
    assert.equal(d.intendedRecipient.kind, 'ai', text);
  }
});

test('with a Nia lead, the person is still named by an @mention, their full name, or "Coach <Surname>"', () => {
  const white = FOOD_ROOMS[0].coach;
  const room = [white, JIHAD, AI];
  for (const text of ['Nia, tell Coach White I’m sick', 'Nia, @White wants the plan', 'Nia, Marcus White said to ask about rice']) {
    assert.equal(decide(from(JIHAD, text), [], room).shouldRespond, false, text);
  }
  // Whatever the gate did before for an explicit "Coach <Surname>" after a Nia lead, it still does.
  assert.equal(decide(from(JIHAD, 'Nia, tell Coach White I’m sick'), [], room).intendedRecipient.kind, 'unknown');
});

test('without a Nia lead, a coach’s surname still names the coach', () => {
  const white = FOOD_ROOMS[0].coach;
  const d = decide(from(JIHAD, 'thanks White, see you at lift'), [], [white, JIHAD, AI]);
  assert.equal(d.shouldRespond, false);
  assert.equal(d.intendedRecipient.name, 'Marcus White');
  // And a Nia mention at the END is not a lead: the surname still counts, so it stays ambiguous.
  assert.equal(decide(from(JIHAD, 'White said the white rice was fine, right nia?'), [], [white, JIHAD, AI]).shouldRespond, false);
});
