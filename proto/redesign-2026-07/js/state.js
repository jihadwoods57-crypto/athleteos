/* OnStandard — Redesign Prototype · Seeded state + honest score engine.
   ONE source of truth. Every screen reads from here so numbers never drift.

   Score model = the shipped weighted engine (core/scoring.ts), NOT additive +pts:
     score = round( 0.50*Nutrition + 0.25*Recovery + 0.15*Commitment + 0.10*WeeklyCheckin )
   Weight is deliberately OUT of the daily score (season-goal arc, weightProgress.ts).
*/

export const WEIGHTS = { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

export function computeScore(c) {
  return Math.round(
    WEIGHTS.nutrition * c.nutrition +
    WEIGHTS.recovery  * c.recovery +
    WEIGHTS.commitment* c.commitment +
    WEIGHTS.checkin   * c.checkin
  );
}

/* Evening of a slightly-behind day Jihad can still rescue.
   NOW:  N80 R68 C100 K100  -> 82
   DONE: N92 R92 C100 K100  -> 94   (log dinner +6, recovery check-in +6) */
const comp = {
  now:  { nutrition: 80, recovery: 68, commitment: 100, checkin: 100 },
  done: { nutrition: 92, recovery: 92, commitment: 100, checkin: 100 },
};

export const S = {
  athlete: { first: 'Jihad', last: 'Woods', initials: 'J2', sport: 'Football', position: 'Wide Receiver', school: 'Central Catholic' },
  coach:   { name: 'Coach Mark', initials: 'M', role: 'Head Coach', team: 'Central Catholic · Varsity' },

  now: '10:20',            // evening
  greeting: 'Good evening',

  components: comp,
  score: computeScore(comp.now),          // 82
  possible: computeScore(comp.done),       // 94
  scoreYesterday: 76,                       // +6 vs yesterday
  streakDays: 5,
  streakGraceUsed: false,

  // Human-readable breakdown that MAPS onto the real weights and sums to /100.
  breakdown: [
    { key: 'Nutrition',     earned: 40, possible: 50, note: 'Breakfast + lunch logged on time; dinner still open',   accent: 'g', weightPct: 50 },
    { key: 'Recovery',      earned: 17, possible: 25, note: 'Carried from Tuesday check-in; tonight refreshes it',    accent: 'p', weightPct: 25 },
    { key: 'Daily commitment', earned: 15, possible: 15, note: 'You confirmed you hit your plan today',               accent: 'b', weightPct: 15 },
    { key: 'Weekly check-in',  earned: 10, possible: 10, note: 'Submitted Sunday',                                    accent: 'g', weightPct: 10 },
  ],
  // shown separately — NOT a score lever
  weightLine: { label: 'Morning Weight', state: 'missed', note: "Missed today. It doesn't affect your score, but your logging streak reset." },

  reachPlan: [
    { label: 'Log dinner',           gain: 6, accent: 'g' },
    { label: 'Submit recovery check-in', gain: 6, accent: 'p' },
  ],

  // Today's requirements (evening truth). "met" counts score-bearing meals/checkins.
  requirements: [
    { id: 'breakfast', title: 'Breakfast', icon: 'utensils', accent: 'g', status: 'Logged', statusColor: 'g',
      sub: 'Logged 8:14 AM', subColor: 'g', meta: 'Scored 95', done: true, route: 'meal-detail' },
    { id: 'lunch', title: 'Lunch', icon: 'bowl', accent: 'g', status: 'Logged', statusColor: 'g',
      sub: 'Logged 12:18 PM', subColor: 'g', meta: 'Scored 91', done: true, route: 'meal-detail' },
    { id: 'weight', title: 'Morning Weight', icon: 'scale', accent: 'a', status: 'Missed', statusColor: 'a',
      sub: 'Was due 9:00 AM', subColor: 'a', meta: 'Not scored', done: false, missed: true, route: 'weight' },
    { id: 'dinner', title: 'Dinner', icon: 'bowl', accent: 'a', status: 'Due soon', statusColor: 'a',
      sub: 'Due by 8:00 PM', subColor: 'a', meta: '+6 pts', done: false, next: true, route: 'camera' },
    { id: 'recovery', title: 'Recovery Check-In', icon: 'moon', accent: 'p', status: 'Later', statusColor: 'p',
      sub: 'Before bed', subColor: 'p', meta: '+6 pts', done: false, route: 'recovery' },
  ],
  metCount: 2, reqTotal: 4,

  activity: [
    { time: 'Today · 8:14 AM', type: 'Breakfast',  value: '95',       vClass: 'g',     img: 'assets/meal-breakfast.jpg', route: 'meal-detail' },
    { time: 'Today · 12:18 PM', type: 'Lunch',      value: '91',       vClass: 'g',     img: 'assets/meal-lunch.jpg', route: 'meal-detail' },
    { time: 'Today · 3:30 PM', type: 'Hydration',   value: '88 oz',    vClass: 'b',     img: null, route: null },
    { time: 'Tonight',         type: 'Recovery Check-In', value: 'Upcoming', vClass: 'muted', img: 'assets/recovery.jpg', dim: true, route: 'recovery' },
  ],

  finish: {
    current: 82, possible: 94, met: '2/4',
    nextMove: 'Log Dinner', nextGain: 6,
    risk: 'Recovery Check-In', riskSub: 'keeps your streak alive',
  },

  trustPass: { active: true, day: 3, length: 14, note: 'On standard, camera-free today. Credited from your 10-day median.' },

  // ---------- PLAN ----------
  plan: {
    title: "Today's Game Plan", coachLine: 'Set by Coach Mark · Updated 2h ago',
    phase: 'Lean Mass Phase · Week 2 of 6',
    objectiveTitle: 'Fuel training. Recover hard.',
    objectiveBody: 'Hydration is the focus today. Hit 120 oz and complete your recovery check-in before bed.',
    goal: 'Lean mass', targetW: '188 lb', currentW: '183.8 lb', focus: 'Hydration + meal timing',
    macros: { protein: '190g', carbs: '260g', fat: '70g', cals: '2,400', water: '120 oz' },
    windows: [
      { k: 'Breakfast', v: '7–10 AM' }, { k: 'Lunch', v: '12–2 PM' }, { k: 'Dinner', v: '6–8 PM' }, { k: 'Snack', v: 'Optional' },
    ],
    coachNote: 'Prioritize protein at breakfast. Keep carbs around training. Don’t skip lunch. Hydration is the standard this week.',
    plate: ['1 protein', '1 carb', '1 color', '1 fluid'],
    swaps: [
      { k: 'Protein', v: 'chicken · steak · eggs · turkey · Greek yogurt · tuna' },
      { k: 'Carbs',   v: 'rice · potatoes · oats · pasta · fruit · tortillas' },
      { k: 'On the go', v: 'Chipotle bowl · grilled sandwich · smoothie · rice bowl' },
    ],
    schedule: [
      { title: 'Morning Weight', freq: 'Required Mon / Wed / Fri', due: 'Due by 9:00 AM', proof: 'Photo not required', impact: 'Logging streak · not scored', accent: 'a', icon: 'scale' },
      { title: 'Breakfast', freq: 'Required daily', due: 'Due by 10:00 AM', proof: 'Photo required', impact: 'Nutrition (50%)', accent: 'g', icon: 'utensils' },
      { title: 'Lunch', freq: 'Required daily', due: 'Due by 2:00 PM', proof: 'Photo required', impact: 'Nutrition (50%)', accent: 'g', icon: 'bowl' },
      { title: 'Dinner', freq: 'Required daily', due: 'Due by 8:00 PM', proof: 'Photo required', impact: 'Nutrition (50%)', accent: 'b', icon: 'bowl' },
      { title: 'Recovery Check-In', freq: 'Required daily', due: 'Before bed', proof: 'Quick form', impact: 'Recovery (25%)', accent: 'p', icon: 'moon' },
      { title: 'Weekly Check-In', freq: 'Required weekly', due: 'Sundays', proof: 'Form + weight', impact: 'Check-in (10%)', accent: 'g', icon: 'clipboard' },
    ],
    notes: [
      { who: 'coach', name: 'Coach Mark', when: '2h ago', text: 'Bumped water to 120 oz this week. You practice in heat Wed/Thu, get ahead of it.' },
      { who: 'ai', name: 'OnStandard AI', when: '2h ago', text: 'Applied Coach Mark’s update: hydration target 96 → 120 oz. Your other targets are unchanged.' },
      { who: 'coach', name: 'Coach Mark', when: 'Mon', text: 'Lean mass phase, week 2. Keep protein at 190 and don’t chase the scale, we’re building.' },
    ],
  },

  // ---------- MEAL (for analysis / detail / confirmation) ----------
  meal: {
    name: 'Lunch', loggedAt: '12:18 PM', onTime: true, score: 91, hue: '128',
    foods: ['Grilled chicken', 'White rice', 'Black beans', 'Avocado', 'Salsa'],
    macros: { protein: 42, carbs: 68, fat: 18, cals: 610 },
    ai: 'Strong lunch. Good protein and carb balance for recovery. Add more water with this meal.',
    planNote: 'Fits your plan: protein-forward, carbs around training. On target for lean mass.',
    thread: [
      { who: 'coach', name: 'Coach Mark', text: 'Great lunch. Keep this structure.' },
      { who: 'ai', name: 'OnStandard AI', text: 'Coach is right, this fits your plan well: protein plus carbs after training.' },
      { who: 'athlete', name: 'You', text: 'Could I swap rice for potatoes?' },
      { who: 'ai', name: 'OnStandard AI', text: 'Yes. Potatoes fit your carb target. Keep the portion similar.' },
    ],
  },
  // camera header context (logging dinner tonight)
  logging: { name: 'Dinner', due: 'Due by 8:00 PM', remaining: '48 min remaining',
    ai: 'Strong dinner. Protein is on target and the carbs land right after training. One more glass of water before bed.' },

  // ---------- WEIGHT ----------
  weight: { current: '183.8', unit: 'lb', target: 188, start: 179, lastLogged: 'Fri 7:02 AM', deltaMonth: '+1.2 lb', pace: 'On pace', history: [180.1, 180.9, 181.6, 182.4, 182.0, 183.1, 183.8] },

  // ---------- RECOVERY ----------
  recovery: {
    fields: [
      { k: 'Sleep quality', lo: 'Poor', hi: 'Great', val: 4 },
      { k: 'Soreness', lo: 'High', hi: 'None', val: 3 },
      { k: 'Energy', lo: 'Low', hi: 'High', val: 4 },
      { k: 'Mood', lo: 'Off', hi: 'Locked in', val: 4 },
      { k: 'Stress', lo: 'High', hi: 'Calm', val: 3 },
    ],
    gain: 6,
  },

  // ---------- PROGRESS ----------
  progress: {
    weekAvg: 84, weekDelta: '+6', onDays: '5 of 7',
    weekScores: [78, 88, 72, 90, 82, 86, 82],
    consistency: 87, consDone: '26 of 30', consDelta: '+12%',
    consBreak: [
      { k: 'Meals', v: 92, accent: 'g' }, { k: 'Recovery', v: 71, accent: 'p' },
      { k: 'Hydration', v: 80, accent: 'b' }, { k: 'Weight logs', v: 67, accent: 'a' },
      { k: 'Check-ins', v: 100, accent: 'g' },
    ],
    pattern: 'You average 11 more points on days you log breakfast before 9 AM.',
    nutritionInsight: 'Protein is strong. Hydration is holding your score back.',
    lost: [
      { k: 'Recovery missed (Wed)', v: '-6', accent: 'p' },
      { k: 'Late lunch (Thu)', v: '-4', accent: 'a' },
      { k: 'Weight log skipped', v: '—', accent: 'a', note: 'streak only' },
    ],
    coachFeedback: 'Best week yet. Keep breakfast consistent and clean up the hydration misses.',
    aiSummary: 'You’re trending up. Meal consistency improved, but recovery and hydration are your biggest gaps. Get water in before practice and do your check-in before bed.',
  },

  // ---------- SQUAD / LEADERBOARD ----------
  squad: [
    { rank: 1, name: 'D. Okafor', unit: 'WR', score: 93, you: false },
    { rank: 2, name: 'You', unit: 'WR', score: 82, you: true },
    { rank: 3, name: 'M. Reyes', unit: 'WR', score: 79, you: false },
    { rank: 4, name: 'T. Boone', unit: 'WR', score: 74, you: false },
  ],

  // ---------- NOTIFICATIONS ----------
  notifications: {
    new: [
      { level: 'high', title: 'Recovery check-in before bed', body: 'Do it tonight to lock +6 and keep your 5-day streak.', when: 'now', icon: 'moon' },
      { level: 'positive', title: 'Coach Mark liked your lunch', body: '“Great lunch. Keep this structure.”', when: '18m', icon: 'heart' },
      { level: 'medium', title: 'Dinner window open', body: 'Log dinner by 8:00 PM to finish today on plan.', when: '32m', icon: 'bowl' },
    ],
    earlier: [
      { level: 'critical', title: 'Morning Weight overdue', body: 'You missed the 9:00 AM window. Coach can see missed logs.', when: '1:12 PM', icon: 'scale' },
      { level: 'positive', title: 'Breakfast logged on time', body: 'Strong start, meal score 95.', when: '8:14 AM', icon: 'check' },
    ],
  },
};

// convenience
export function pct(v, of) { return Math.round((v / of) * 100); }
window.S = S; // debug
