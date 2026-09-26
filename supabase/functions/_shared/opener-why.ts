// Nia's "why this matters" line (goals and eating plan, A2, 2026-09-25).
//
// The opener tells the athlete what to do next ("Land around 45g at each of your last 3 meals").
// This is the one sentence underneath it that says WHY, for their goal. It is DETERMINISTIC: a
// small library keyed by goal family and by the topic of the move the opener made, picked by the
// meal id so the same meal always says the same thing and consecutive meals rarely repeat. No
// model call, no cost. It rides the opener row's `meta.why` (never its text), so an older client
// shows nothing new.
//
// THE RAILS EVERY LINE HOLDS (pinned by opener-why.test.ts over the whole library):
//   1. No figures at all. The same sentence serves a Structured athlete and an Intuitive one, so
//      it passes the Intuitive plan-style rail by construction (violatesStyleLanguage).
//   2. No weight language anywhere (no weight, scale, pounds, deficit, surplus, cut, bulk, lose).
//      A MINOR only ever gets the `perform` family, whose lines are about training and recovery
//      ("for your body and training"), whatever their goal says.
//   3. Plain text: at most 200 characters, no em dashes, nothing scrubToolLeak would touch.

export type WhyGoal = 'gain' | 'lose' | 'maintain' | 'perform';
export type WhyTopic = 'short' | 'closed' | 'carbs' | 'late' | 'snack';
/** What the row carries. `goal` is the label key the client names ("Why this matters for
 *  gaining"); a minor's is 'train' ("for your training"). */
export interface OpenerWhy { text: string; goal: WhyGoal | 'train'; topic: WhyTopic }

export const WHY_MAX = 200;

export const WHY_LIBRARY: Record<WhyGoal, Record<WhyTopic, string[]>> = {
  gain: {
    short: [
      'Muscle gets built from protein spread across the whole day, so each meal feeding it matters more than one big dinner.',
      'Your body can only use so much protein at once. Steady amounts at every meal are what turn training into new muscle.',
      'Building takes more food than feels normal. Landing protein at every meal means the last one never has to be huge.',
    ],
    closed: [
      'Protein is covered, so the rest of today is about enough total food. That extra fuel is what lets new muscle build.',
      'With protein handled, carbs and a real snack do the building work tonight by giving your body energy to spare.',
      'Covering protein every day is what makes building add up. One day does little; a week of these days is where it shows.',
    ],
    carbs: [
      'Carbs refill the fuel your muscles burn in training. Without enough of them, protein gets spent as energy instead of building.',
      'Building needs energy left over after training. Carbs at each meal are the easiest way to keep that tank full.',
      'Eating carbs across the day keeps training hard, and hard training is the signal that tells your body to build.',
    ],
    late: [
      'Meals that slip late usually mean fewer meals, and building depends on eating often enough to stay ahead.',
      'A late meal still counts. Eating on a steady rhythm just makes it easier to fit in all the food building takes.',
      'When a meal runs late, the next one gets squeezed. Keeping meals on time protects the total you need to build.',
    ],
    snack: [
      'A protein-forward snack is the easiest place to add food without forcing bigger meals. It adds up across a week.',
      'Snacks close the gap between meals. For building, they often turn an ordinary day into one that moves you forward.',
      'Something before bed with protein in it gives your body material to recover and build while you sleep.',
    ],
  },
  lose: {
    short: [
      'Protein at every meal keeps you full longer and protects the muscle you train for, so steady meals make the goal easier.',
      'Spreading protein across the day keeps hunger quieter than saving it for one big plate at night.',
      'Holding protein high at every meal is what keeps the change coming from fat, not from the muscle you train for.',
    ],
    closed: [
      'Protein is covered, so the rest of today can lean on vegetables and water. You stay full without much extra food.',
      'With protein handled, your muscle is protected today. That is what makes the change you see come from the right place.',
      'Days like this, protein first and the rest steady, are what make this goal feel manageable instead of hungry.',
    ],
    carbs: [
      'Carbs still matter here. Putting most of them around training keeps sessions strong while the rest of the day stays lighter.',
      'A fist of carbs at most meals, and more near hard training, puts your energy where it counts.',
      'Carbs at the right times keep training quality high, and hard training is what protects your muscle.',
    ],
    late: [
      'Late meals often turn into bigger meals. Eating on a rhythm keeps hunger in check so portions stay easy to judge.',
      'A late meal still counts. Regular timing just keeps you from arriving at dinner starving.',
      'When a meal runs late, hunger builds and the next plate grows. Steady timing makes the goal easier to hold.',
    ],
    snack: [
      'A protein-forward snack beats grazing. It keeps you full until the next meal without much extra food.',
      'Picking a snack with protein in it makes the next meal easier to keep sensible.',
      'A small protein snack before bed looks after your muscle overnight without adding much to the day.',
    ],
  },
  maintain: {
    short: [
      'Steady protein at each meal keeps your muscle fed and your energy even, which is what holding your level takes.',
      'Protein spread across the day repairs what training breaks down. That is how you keep what you have built.',
      'Holding steady still takes enough protein. Even amounts at each meal make it easy without a big push at night.',
    ],
    closed: [
      'Protein is covered. Matching the rest of today to how hard you trained keeps things steady.',
      'With protein handled, the rest of the day is just normal fuel. Consistency like this is the whole plan.',
      'Days like this are the goal: enough protein and steady meals, repeated. Nothing extreme needed.',
    ],
    carbs: [
      'Carbs should rise and fall with training: more on hard days, less on easy ones. That keeps you steady over the week.',
      'Carbs fuel the work. Matching them to your training keeps energy up without swinging the balance.',
      'A fist of carbs at meals, a bit more after hard training, keeps performance steady day to day.',
    ],
    late: [
      'A late meal still counts. Regular timing keeps energy even so you do not end up eating extra later to catch up.',
      'Eating on a rhythm is what makes steady easy. Late meals tend to push the whole day off balance.',
      'When meals drift late, energy dips and the evening fills the gap. Keeping them on time keeps things level.',
    ],
    snack: [
      'A snack with protein in it bridges long gaps so you reach the next meal with steady energy.',
      'Snacks keep energy even between meals. A protein-forward one does the most with the least.',
      'A planned snack keeps you from arriving at the next meal starving, which keeps portions steady.',
    ],
  },
  perform: {
    short: [
      'Protein at every meal is what repairs training. Your body recovers best when it gets some every few hours.',
      'Spreading protein across the day keeps recovery going all day, so you show up fresher tomorrow.',
      'Training breaks muscle down and protein builds it back. Even amounts at each meal keep that repair steady.',
    ],
    closed: [
      'Protein is covered, so recovery has what it needs. Carbs and water now keep you ready for the next session.',
      'With protein handled, the rest of today is about fuel: carbs to refill what practice used.',
      'Days like this are what recovery is made of. Stack them and you feel the difference late in the week.',
    ],
    carbs: [
      'Carbs are the main fuel for practice. Eating them around training keeps your legs and focus there late in the session.',
      'Your muscles store carbs for hard work. Refilling them after training is what makes the next session feel normal.',
      'Carbs at each meal, more after hard training, keep energy up so you can train at the level you want.',
    ],
    late: [
      'A late meal still counts. Eating on a rhythm keeps fuel steady so energy does not crash mid-practice.',
      'Regular meals keep your tank from running low. When one slips late, the next session can feel it.',
      'Timing matters for fuel. Meals on a steady rhythm mean you rarely train on empty.',
    ],
    snack: [
      'A snack with protein and carbs bridges the gap between meals so you train and recover on a full tank.',
      'Snacks are fuel you can time. Something small before or after training helps you perform and recover.',
      'A protein snack before bed keeps recovery going overnight so you wake up ready.',
    ],
  },
};

/** The goal family, tolerant of every stored spelling (base_goal is 'performance' from the core
 *  and 'perform' from older onboarding; 'build', 'lose_fat', 'health' are the client slugs).
 *  Unknown or unset reads as perform: the shipped athlete default. */
export function whyGoal(goal: unknown): WhyGoal {
  const k = String(goal ?? '').toLowerCase();
  if (k === 'gain' || k === 'build' || k === 'gain_muscle' || k === 'gain_weight') return 'gain';
  if (k === 'lose' || k === 'lose_fat') return 'lose';
  if (k === 'maintain' || k === 'health') return 'maintain';
  return 'perform';
}

/**
 * The topic of the move the opener made, from the same facts its day sentence reads. With the day
 * known: protein closed, the required meals in (the snack line), a late plate, else protein still
 * short. Without it (no target reached the composer): a late plate, the snack slot, else carbs
 * around the day. The style never changes the topic, only whether the day line prints figures.
 */
export function whyTopic(o: { gap: number | null; remaining: number | null; late: boolean | null | undefined; slot: string }): WhyTopic {
  const snackSlot = /snack/i.test(o.slot || '');
  if (o.gap !== null) {
    if (o.gap <= 0) return 'closed';
    if (o.remaining === 0) return 'snack';
    if (o.late === true) return 'late';
    return 'short';
  }
  if (o.late === true) return 'late';
  if (snackSlot) return 'snack';
  return 'carbs';
}

/** FNV-1a over the meal id: the same meal always picks the same variant. */
function pick(seed: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return n > 0 ? h % n : 0;
}

/** The why for one opener. A minor always gets the perform family, labelled 'train'. */
export function openerWhy(o: { goal: unknown; minor?: boolean | null; topic: WhyTopic; mealId?: string | null }): OpenerWhy {
  const fam: WhyGoal = o.minor ? 'perform' : whyGoal(o.goal);
  const lines = WHY_LIBRARY[fam][o.topic];
  const text = lines[pick(String(o.mealId || ''), lines.length)];
  return { text, goal: o.minor ? 'train' : fam, topic: o.topic };
}
