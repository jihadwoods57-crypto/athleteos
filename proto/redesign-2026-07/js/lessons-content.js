/* The 60-second lessons, the words (goals and eating plan, phase D, 2026-09-26).
 *
 * Twelve short lessons an athlete reads on Plan > Learn and a coach can assign. OnStandard content,
 * written the way a careful sports dietitian would say it: mainstream, conservative, plain, second
 * person. Never signed as Nia, no medical claims, no product names, no em dashes.
 *
 * THE SHAPE (lessons-model.js reads it; lessons.test.mjs lints every word of it)
 *   id        stable slug. 0256 lesson_ids() holds the same list and lesson_title() the titles.
 *   title     the lesson's name, read by everyone (no figures, no weight words).
 *   summary   one line under the title in the Learn list (the same rules).
 *   focus     the weekly-focus candidates it teaches (weekly-focus-model.js keys), or [].
 *   cards     3 to 5 cards, one idea each, at most 60 words. A card is { text } plus, only where
 *             `text` would break a rule for someone, a variant:
 *               intuitive       for an Intuitive athlete (no macro or calorie figure, the plate)
 *               minor           for an athlete under 18 (no weight words)
 *               minorIntuitive  both at once, when neither of the two above fits both
 *             A variant set to null SKIPS the card for that reader. `text: null` is a card only
 *             the minor variant shows.
 *   check     the quick check: { q, options: [3], answer: index, why } with the same variants.
 *
 * Lazy: nothing imports this in the boot graph. */

export const LESSONS = [
  {
    id: 'protein-every-meal',
    title: 'Protein at every meal',
    summary: 'Spread protein across the day so your muscles can use it.',
    focus: ['protein:lunch', 'protein:dinner'],
    cards: [
      { text: 'Your muscles repair and rebuild a little at a time, all day long. They use protein best when it arrives in steady amounts at each meal. One big protein dinner cannot make up for a breakfast and lunch that had almost none.' },
      {
        text: 'A good aim for most athletes is about 20 to 40 grams of protein at each meal, spread over 3 or 4 meals. Plan splits your own daily number across your meals, so you always know your share.',
        intuitive: 'Aim for a palm-sized portion of protein at each meal, spread over 3 or 4 meals. Every meal gets its own palm. That steady rhythm is what your muscles use best.',
      },
      { text: 'Easy protein anchors: chicken, turkey, lean beef, fish, eggs, Greek yogurt, milk, cottage cheese, tofu, beans and lentils. Pick one first, then build the rest of the plate around it.' },
      { text: 'Build every plate the same way. Protein first. Then carbs for fuel. Then fill about half the plate with vegetables or fruit. The same rule works at home, in the dining hall and on the road.' },
    ],
    check: {
      q: 'Which day spreads protein the way your muscles use it best?',
      options: ['Almost none until a huge dinner', 'Some protein at breakfast, lunch and dinner', 'One shake at night and nothing else'],
      answer: 1,
      why: 'Steady amounts at each meal give your muscles protein to work with all day. One big serving cannot make up for the rest.',
    },
  },
  {
    id: 'breakfast-that-holds',
    title: 'A breakfast that holds up',
    summary: 'Start the day with protein and fuel so you are not running on empty.',
    focus: ['protein:breakfast'],
    cards: [
      { text: 'After a night without food, the fuel your body stores for energy is running low. Breakfast refills it before class, practice or a lift. Skipping it often means low energy by midmorning and a scramble to catch up later.' },
      { text: 'A breakfast that holds up has three parts: protein, carbs and fruit. The protein keeps you full for hours. The carbs give you energy for the morning. The fruit adds vitamins and water.' },
      {
        text: 'Aim for at least 20 to 30 grams of protein. Three eggs have about 18 grams. A cup of plain Greek yogurt has about 20. A glass of milk adds about 8.',
        intuitive: 'Aim for a palm of protein at breakfast, the same as any other meal. Eggs, Greek yogurt, milk, or a breakfast sandwich with egg and meat all count.',
      },
      { text: 'Short on time? Greek yogurt with granola and berries. A breakfast burrito with eggs and cheese. Overnight oats made with milk and peanut butter. A banana and a glass of milk on the way out the door.' },
      { text: 'Not hungry early? Start small with a glass of milk or a yogurt, then eat a real meal when you can. Many athletes find their morning appetite grows once breakfast becomes a habit.' },
    ],
    check: {
      q: 'Which breakfast holds up best until lunch?',
      options: ['A pastry and a coffee', 'Eggs, toast and a piece of fruit', 'Just a sports drink'],
      answer: 1,
      why: 'The eggs bring protein to keep you full, the toast brings energy, and the fruit rounds it out. The other two are mostly quick sugar.',
    },
  },
  {
    id: 'carbs-are-fuel',
    title: 'Carbs are fuel',
    summary: 'Carbs power hard training. Match them to how hard you work.',
    focus: [],
    cards: [
      { text: 'Carbs are your main fuel for hard, fast work: sprints, lifts, drills and games. Your muscles store them and burn them during training. When those stores run low, you slow down and your focus fades.' },
      { text: 'Good sources: rice, pasta, potatoes, bread, tortillas, oats, cereal, fruit and milk. Whole grains and fruit also bring fiber and vitamins. Sports drinks have a place during long, hard sessions.' },
      { text: 'Match carbs to the day. A fist of carbs at each meal is your base. After a hard session, make it two fists. On lighter days and rest days, the base is plenty.' },
      {
        text: 'Skipping carbs to drop weight can cost you speed, power and focus in practice. If you want to change your body, ask your coach or dietitian for a plan that still fuels your training.',
        minor: 'Skipping carbs can cost you speed, power and focus in practice. Your body needs plenty of fuel to train and to grow. If you have questions about how much to eat, ask your coach, your dietitian or your doctor.',
      },
    ],
    check: {
      q: 'Why do carbs matter on a hard training day?',
      options: ['They are your main fuel for hard work', 'They only matter for distance runners', 'They slow you down, so skip them'],
      answer: 0,
      why: 'Your muscles store carbs and burn them during hard, fast work. Low stores mean less speed and less focus.',
    },
  },
  {
    id: 'before-training',
    title: 'Eating before training',
    summary: 'What to eat, and when, so you train with energy and a settled stomach.',
    focus: [],
    cards: [
      { text: 'About 3 to 4 hours before training, eat a regular meal: protein, plenty of carbs, and not too much fat or fiber. Chicken and rice, a turkey sandwich with fruit, or pasta with a lean meat sauce all work.' },
      { text: 'Closer to training, about 30 to 60 minutes before, keep it small and simple: mostly carbs. A banana, pretzels, crackers, applesauce, a granola bar, or toast with honey or jam.' },
      { text: 'Heavy, greasy or very high-fiber food right before training can sit in your stomach. Save the big salad, fried food and large portions for after. Everyone is different, so notice what feels good for you.' },
      { text: 'Drink water through the day, not just at practice. Showing up thirsty means you are already behind. Try new foods on a regular practice day, never right before a big game.' },
    ],
    check: {
      q: 'Practice starts in 45 minutes. What is the best choice?',
      options: ['A banana or a handful of pretzels', 'A double cheeseburger and fries', 'Nothing at all'],
      answer: 0,
      why: 'Close to training, a small snack that is mostly carbs gives you quick energy without sitting heavy in your stomach.',
    },
  },
  {
    id: 'recovery-meal',
    title: 'The recovery meal',
    summary: 'What you eat after training decides how ready you are for the next one.',
    focus: [],
    cards: [
      { text: 'Training uses up fuel and puts stress on your muscles. Eating afterward starts the repair and refills your fuel, so you show up ready for the next session instead of flat.' },
      { text: 'Try to eat a meal or a solid snack within about 1 to 2 hours after training. Sooner matters more when you train again later the same day or early the next morning.' },
      {
        text: 'The recovery formula: protein to repair, about 20 to 40 grams, plus carbs to refuel, plus fluids. Chocolate milk, a turkey sandwich, or a rice bowl with chicken are all simple options.',
        intuitive: 'The recovery formula: a palm of protein to repair, carbs to refuel (two fists after a hard session), plus fluids. Chocolate milk, a turkey sandwich, or a rice bowl with chicken all work.',
      },
      { text: 'Not hungry after a hard session? Drink it instead. Chocolate milk or a smoothie with yogurt and fruit counts. Then eat a real meal when your appetite comes back.' },
    ],
    check: {
      q: 'Which is the best choice right after a hard practice?',
      options: ['Chocolate milk', 'Black coffee', 'A bag of chips'],
      answer: 0,
      why: 'Chocolate milk has protein to repair, carbs to refuel and fluid to rehydrate, all in one.',
    },
  },
  {
    id: 'hydration-basics',
    title: 'Hydration basics',
    summary: 'Show up hydrated, drink while you train, and refill after.',
    focus: [],
    cards: [
      { text: 'Even mild dehydration can make you slower, weaker and less sharp. You sweat out water faster in heat and humidity. The goal is to start every session already hydrated, not to catch up during it.' },
      { text: 'Check your urine. Pale yellow means you are in good shape. Dark yellow means drink more. Carry a water bottle and drink through the day, with every meal and snack.' },
      { text: 'During practice, take small drinks at every break. For long or very hot sessions, over about an hour, a sports drink helps replace the salt and carbs that sweat takes out of you.' },
      {
        text: 'After training, keep drinking until your urine is pale again. If you weigh yourself before and after practice, drink about 16 to 24 ounces of fluid for every pound you lost.',
        minor: 'After training, keep drinking with your recovery meal until your urine is pale again. Heavy sweaters and anyone training in the heat need more. Water, milk and sports drinks all count.',
        intuitive: 'After training, keep drinking with your recovery meal until your urine is pale again. Heavy sweaters and anyone training in the heat need more. Water, milk and sports drinks all count.',
      },
      { text: 'Energy drinks are not hydration. Many carry a lot of caffeine and other stimulants, which can leave you jittery and hurt your sleep. Stick to water, milk and sports drinks.' },
    ],
    check: {
      q: 'What does pale yellow urine usually mean?',
      options: ['You are well hydrated', 'You need a sports drink right now', 'You should stop drinking'],
      answer: 0,
      why: 'Pale yellow is the target. Darker urine is a sign to drink more.',
    },
  },
  {
    id: 'eating-on-the-road',
    title: 'Eating on the road',
    summary: 'Busy days, travel and fast food can still fuel you if you plan ahead.',
    focus: ['missed'],
    cards: [
      { text: 'Busy days and travel are when meals get missed. Plan before you leave: know where your next meal is coming from, and pack food so you are never stuck with nothing but a vending machine.' },
      { text: 'Good things to pack: fruit, trail mix, peanut butter sandwiches, jerky, cheese sticks, granola bars, and shelf-stable milk or protein shakes. Check your allergies and your team rules first.' },
      { text: 'At fast food, order like you are building a plate. A grilled chicken sandwich, a burrito bowl with meat, rice and beans, or a sub with lean meat and extra vegetables. Add fruit or milk if you can.' },
      { text: 'Go easy on fried sides, large sodas and desserts. They fill you up without much fuel or protein. Water, milk or a sports drink are better picks than soda.' },
    ],
    check: {
      q: 'The team bus stops for fast food. Which order fuels you best?',
      options: ['A burrito bowl with chicken, rice and beans', 'Large fries and a milkshake', 'Nothing until you get home'],
      answer: 0,
      why: 'It has protein, carbs and some vegetables, just like a plate you would build at home.',
    },
  },
  {
    id: 'dining-hall-plate',
    title: 'Building a plate at the dining hall',
    summary: 'A simple way to build a strong plate from any line.',
    focus: [],
    cards: [
      { text: 'Walk the whole dining hall before you grab a tray. Seeing every option first helps you build a complete plate instead of filling up at the first station you pass.' },
      { text: 'Start with protein: grilled chicken, turkey, fish, eggs, beans or tofu. Then add a carb: rice, pasta, potatoes, bread or tortillas. Then fill about half the plate with vegetables or fruit.' },
      { text: 'On hard training days, add a second fist of carbs or go back for another plate. On lighter days, one balanced plate is usually enough.' },
      { text: 'Grab a drink that helps: water or milk. Dessert is fine sometimes. Eat your real meal first, then decide if you still want it.' },
    ],
    check: {
      q: 'What goes on your plate first?',
      options: ['Protein', 'Dessert', 'Whatever is closest'],
      answer: 0,
      why: 'Start with protein, add a carb, then fill half the plate with vegetables or fruit.',
    },
  },
  {
    id: 'game-day',
    title: 'Game-day eating',
    summary: 'Familiar food, good timing and plenty of fluid for your best performance.',
    focus: [],
    cards: [
      { text: 'Game day is not the day to try something new. Eat foods you know sit well with you. The night before, have a normal dinner with plenty of carbs, like pasta, rice or potatoes, plus protein.' },
      { text: 'Eat your pre-game meal about 3 to 4 hours before the start: carbs, some lean protein, and not much fat or fiber. Think chicken with rice, a turkey sandwich, or pancakes with eggs.' },
      { text: 'About 30 to 60 minutes before, top off with a small carb snack if you are hungry: a banana, crackers or a sports drink. Keep sipping fluids all day.' },
      { text: 'After the game, eat a recovery meal with protein, carbs and fluid, even if it is late. It helps you bounce back for the next practice and the next game.' },
    ],
    check: {
      q: 'What is a smart pre-game meal about 3 hours before the start?',
      options: ['Chicken, rice and a piece of fruit', 'A large plate of fried wings', 'An energy bar you have never tried'],
      answer: 0,
      why: 'Familiar carbs with lean protein digest well and fuel you. Greasy food and anything new are risky on game day.',
    },
  },
  {
    id: 'snacks-that-count',
    title: 'Snacks that count',
    summary: 'The right snack bridges long gaps with protein and fuel.',
    focus: ['snack'],
    cards: [
      { text: 'A snack is a small meal that keeps you fueled when there is a long gap between meals, or training in the middle of it. It works best with protein and carbs together.' },
      { text: 'Snacks that count: Greek yogurt with fruit, a peanut butter and banana sandwich, cheese and crackers, trail mix, a turkey wrap, hummus with pita, or chocolate milk.' },
      {
        text: 'Aim for a snack with about 15 to 20 grams of protein. A cup of Greek yogurt has about 20. A glass of chocolate milk and a string cheese together come to about 15.',
        intuitive: 'Give your snack about a palm of protein, plus some carbs. A cup of Greek yogurt, or chocolate milk and a string cheese, are easy ways to get there.',
      },
      { text: 'Chips, candy and soda on their own are treats, not fuel. They are fine sometimes, but they will not carry you to your next meal. Keep a real snack in your bag so you are never stuck.' },
    ],
    check: {
      q: 'Which snack counts the most before an afternoon practice?',
      options: ['Greek yogurt with a banana', 'A bag of candy', 'A can of soda'],
      answer: 0,
      why: 'Protein plus carbs fuels you and holds you over. Candy and soda are mostly quick sugar.',
    },
  },
  {
    id: 'nutrition-label',
    title: 'Reading a nutrition label',
    summary: 'A few quick checks tell you what is really in the package.',
    focus: [],
    cards: [
      { text: 'Start with the serving size at the top. Every number on the label is for one serving, and many packages hold more than one. If you eat the whole package, multiply.' },
      {
        text: 'Check protein next. For a meal, look for about 20 grams or more. For a snack, about 10 grams or more is a good sign it will hold you over.',
        intuitive: 'Check protein next. Foods with more protein keep you full longer and help you recover. Compare two similar foods and pick the one with more.',
      },
      { text: 'Look at added sugars. Carbs are fuel, but a food that is mostly added sugar gives you quick energy that fades fast. Sports drinks during long, hard sessions are the exception.' },
      {
        text: 'The percent Daily Value shows how much one serving gives compared with a typical day. About 5 percent or less is low, and 20 percent or more is high. Use it to compare similar foods.',
        intuitive: 'The Daily Value column shows whether one serving gives a little or a lot of something. Use it to compare two similar foods, not as a number to hit.',
      },
      { text: 'The ingredients list starts with what the food contains the most of. If sugar or oil is one of the first few ingredients, there is a lot of it.' },
    ],
    check: {
      q: 'A bag of trail mix holds 3 servings and you eat the whole bag. How much did you eat?',
      options: ['Three times what the label lists', 'Exactly what the label lists', 'A third of what the label lists'],
      answer: 0,
      why: 'Every number on the label is for one serving. Three servings means three times as much.',
    },
  },
  {
    id: 'food-first-supplements',
    title: 'Food first: supplements',
    summary: 'Why real food comes first, and why supplements carry real risk.',
    focus: [],
    cards: [
      { text: 'Food gives you protein, carbs, vitamins and minerals together, in the forms your body uses best. A supplement cannot make up for skipped meals. Build the plate first, every day.' },
      { text: 'Talk to your team dietitian first. Some supplements contain substances banned by the NCAA and other governing bodies, and labels are not always accurate. A positive drug test counts even if you did not know.' },
      { text: 'Supplements do not have to be proven safe or effective before they are sold. A product can contain ingredients that are not on the label, or much more or less than the label says.' },
      { text: 'If your doctor or dietitian recommends something for a specific reason, follow their plan. Do not add products on your own because a teammate, an influencer or an ad says so.' },
      { text: null, minor: 'If you are under 18, most supplements are not made or tested for you. Talk with your parents, your doctor and your team dietitian before you take anything.' },
    ],
    check: {
      q: 'A teammate offers you a pre-workout powder. What should you do first?',
      options: ['Talk to your team dietitian', 'Try half a scoop to see how it feels', 'Check that it tastes good'],
      answer: 0,
      why: 'Some supplements contain banned substances, and labels are not always accurate. Your dietitian can tell you what is safe for you.',
    },
  },
];
