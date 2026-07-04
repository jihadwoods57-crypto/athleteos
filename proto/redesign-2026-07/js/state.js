/* OnStandard — Redesign Prototype · LIVE state engine.
   ONE source of truth. Screens read getters; actions mutate runtime; everything
   recomputes through the same honest formula so numbers can never drift.

   Score model = the shipped weighted engine (core/scoring.ts), NOT additive +pts:
     score = round( 0.50*Nutrition + 0.25*Recovery + 0.15*Commitment + 0.10*WeeklyCheckin )
   Weight is deliberately OUT of the daily score (season-goal arc, weightProgress.ts).
*/

import { CATALOG, runsToday, derive, deriveAssigned } from './requirements.js';

export const WEIGHTS = { nutrition: 0.5, recovery: 0.25, commitment: 0.15, checkin: 0.1 };

export function computeScore(c) {
  return Math.round(
    WEIGHTS.nutrition * c.nutrition +
    WEIGHTS.recovery  * c.recovery +
    WEIGHTS.commitment* c.commitment +
    WEIGHTS.checkin   * c.checkin
  );
}

/* Score tiers (Bo's brief) — same bands everywhere. */
export function tier(s) {
  if (s >= 90) return { name: 'OnStandard', cls: 'g' };
  if (s >= 75) return { name: 'Locked In',  cls: 'b' };
  if (s >= 60) return { name: 'Building',   cls: 'a' };
  return { name: 'Off Standard', cls: 'r' };
}

/* ---------------- Runtime (persisted) ---------------- */
const KEY = 'onstd-proto-rt-v1';
const DEFAULT_RT = {
  dinnerLogged: false,
  recoveryDone: false,
  weightLogged: false,   // late log (window was 9 AM) — trend only, never scored
  hydrationOz: 88,
  notifsRead: false,
  day0: false,           // fresh-athlete empty-state mode (set by finishing onboarding)
  day0Breakfast: false,  // day-0 first meal logged
  lastMove: null,        // {from, to, gain, what} — powers confirmation screens
  assigned: [],          // coach-assigned requirements: {id,title,icon,note,from,dueLabel,done,seen}
  coachComments: [],     // coach->athlete comments; REALLY land in the athlete's meal thread
  planUpdate: null,      // coach-published plan update; REALLY lands in Plan·Notes + notifications
};
function load() {
  try { return { ...DEFAULT_RT, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { ...DEFAULT_RT }; }
}
export const RT = load();
function save() { localStorage.setItem(KEY, JSON.stringify(RT)); }

/* ---------------- Derived (live) ---------------- */
function componentsNow() {
  if (RT.day0) {
    // brand-new athlete: nothing carried, commitment unanswered, no check-in yet
    return { nutrition: RT.day0Breakfast ? 35 : 0, recovery: 0, commitment: RT.day0Breakfast ? 100 : 0, checkin: 0 };
  }
  return {
    nutrition: RT.dinnerLogged ? 92 : 80,
    recovery: RT.recoveryDone ? 92 : 68,
    commitment: 100,
    checkin: 100,
  };
}
function componentsDone() {
  if (RT.day0) return { nutrition: 35, recovery: 92, commitment: 100, checkin: 100 };
  return { nutrition: 92, recovery: 92, commitment: 100, checkin: 100 };
}

/* ---------------- Actions ---------------- */
export const act = {
  logDinner() {
    if (RT.dinnerLogged) return;
    const from = computeScore(componentsNow());
    RT.dinnerLogged = true;
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: 'Dinner' };
    save();
  },
  submitRecovery() {
    if (RT.recoveryDone) return;
    const from = computeScore(componentsNow());
    RT.recoveryDone = true;
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: 'Recovery Check-In' };
    save();
  },
  logWeight() { RT.weightLogged = true; save(); },
  addWater(oz) { RT.hydrationOz = Math.min(160, RT.hydrationOz + oz); save(); },
  readNotifs() { RT.notifsRead = true; save(); },
  day0Meal() {
    if (RT.day0Breakfast) return;
    const from = computeScore(componentsNow());
    RT.day0Breakfast = true;
    const to = computeScore(componentsNow());
    RT.lastMove = { from, to, gain: to - from, what: 'Breakfast' };
    save();
  },
  startDay0() { RT.day0 = true; RT.day0Breakfast = false; RT.lastMove = null; save(); },
  /* Coach assigns a requirement -> it lands on the athlete's Home + notifications. */
  assignReq(templateId) {
    const T = {
      pwm:  { id: 'pwm',  title: 'Post-Workout Meal', icon: 'utensils', note: 'Within 45 min of lifting. Protein + carb, photo it like any meal.', dueLabel: 'After tomorrow’s lift' },
      supp: { id: 'supp', title: 'Supplement Log', icon: 'check', note: 'Confirm creatine + multivitamin with dinner.', dueLabel: 'Tonight' },
      body: { id: 'body', title: 'Body Photo', icon: 'camera', note: 'Same pose, same light as last month. Coach-only, never shared.', dueLabel: 'Sunday' },
      sleep:{ id: 'sleep',title: 'Sleep Target · 8h', icon: 'moon', note: 'Lights out by 10:30 on school nights this week.', dueLabel: 'This week' },
    };
    const t = T[templateId] || T.supp;
    if (RT.assigned.some(a => a.id === t.id)) return;
    RT.assigned.push({ ...t, from: 'Coach Mark', done: false, seen: false });
    RT.notifsRead = false;
    save();
  },
  completeAssigned(id) {
    const a = RT.assigned.find(x => x.id === id);
    if (a && !a.done) { a.done = true; a.seen = true; save(); }
  },
  seeAssigned() { RT.assigned.forEach(a => { a.seen = true; }); save(); },
  coachComment(text) { if (text) { RT.coachComments.push(String(text).slice(0, 300)); save(); } },
  assignCustom(title) {
    const t = String(title || '').trim().slice(0, 60);
    if (!t) return;
    const id = 'custom-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
    if (RT.assigned.some(a => a.id === id)) return;
    RT.assigned.push({ id, title: t, icon: 'clipboard', note: `Set by Coach Mark for you specifically.`, from: 'Coach Mark', dueLabel: 'This week', done: false, seen: false });
    RT.notifsRead = false;
    save();
  },
  publishPlanUpdate(text) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    RT.planUpdate = { text: t, when: 'just now' };
    RT.notifsRead = false;
    save();
  },
  reset() { Object.assign(RT, JSON.parse(JSON.stringify(DEFAULT_RT)), { lastMove: null }); save(); },
};
window.__act = act;

/* ---------------- The app state (live getters) ---------------- */
export const S = {
  athlete: { first: 'Jihad', last: 'Woods', initials: 'J2', sport: 'Football', position: 'Wide Receiver', school: 'Central Catholic', level: 'High School' },
  coach:   { name: 'Coach Mark', initials: 'M', role: 'Head Coach', team: 'Central Catholic · Varsity' },

  now: '7:12',
  greeting: 'Good evening',

  get components() { return { now: componentsNow(), done: componentsDone() }; },
  get score() { return computeScore(componentsNow()); },
  get possible() { return computeScore(componentsDone()); },
  get tier() { return tier(this.score); },
  scoreYesterday: 76,
  get streakDays() { return RT.day0 ? 0 : 5; },
  streakGraceUsed: false,

  get remainingCount() {
    if (RT.day0) return RT.day0Breakfast ? 3 : 4;
    return (RT.dinnerLogged ? 0 : 1) + (RT.recoveryDone ? 0 : 1);
  },

  /* Human-readable breakdown that MAPS onto the real weights and sums to /100. */
  get breakdown() {
    const c = componentsNow();
    return [
      { key: 'Nutrition', earned: Math.round(WEIGHTS.nutrition * c.nutrition), possible: 50,
        note: RT.dinnerLogged ? 'All three meals logged on time' : 'Breakfast + lunch logged on time; dinner still open', accent: 'g', weightPct: 50 },
      { key: 'Recovery', earned: Math.round(WEIGHTS.recovery * c.recovery), possible: 25,
        note: RT.recoveryDone ? 'Tonight’s check-in submitted' : 'Carried from Tuesday check-in; tonight refreshes it', accent: 'p', weightPct: 25 },
      { key: 'Daily commitment', earned: Math.round(WEIGHTS.commitment * c.commitment), possible: 15,
        note: 'You confirmed you hit your plan today', accent: 'b', weightPct: 15 },
      { key: 'Weekly check-in', earned: Math.round(WEIGHTS.checkin * c.checkin), possible: 10,
        note: 'Submitted Sunday', accent: 'g', weightPct: 10 },
    ];
  },
  get weightLine() {
    return RT.weightLogged
      ? { label: 'Morning Weight', state: 'late', note: 'Logged late tonight. Counts for your season trend; never for the daily score.' }
      : { label: 'Morning Weight', state: 'missed', note: "Missed today. It doesn't affect your score, but your logging streak reset." };
  },
  get reachPlan() {
    const plan = [];
    if (!RT.dinnerLogged) plan.push({ label: 'Log dinner', gain: 6, accent: 'g' });
    if (!RT.recoveryDone) plan.push({ label: 'Submit recovery check-in', gain: 6, accent: 'p' });
    return plan;
  },

  get requirements() {
    if (RT.day0) {
      return [
        { id: 'breakfast', title: 'Breakfast', icon: 'utensils', accent: RT.day0Breakfast ? 'g' : 'a', status: RT.day0Breakfast ? 'Logged' : 'Open', statusColor: RT.day0Breakfast ? 'g' : 'a',
          sub: RT.day0Breakfast ? 'Logged just now' : 'Photo proof', subColor: RT.day0Breakfast ? 'g' : 'a', meta: RT.day0Breakfast ? 'First log' : 'Start here', done: RT.day0Breakfast, route: RT.day0Breakfast ? 'meal-detail' : 'camera' },
        { id: 'lunch', title: 'Lunch', icon: 'bowl', accent: 'b', status: 'Upcoming', statusColor: 'b', sub: 'Due by 2:00 PM', subColor: 'b', meta: 'Photo proof', done: false, route: 'camera' },
        { id: 'dinner', title: 'Dinner', icon: 'bowl', accent: 'b', status: 'Upcoming', statusColor: 'b', sub: 'Due by 8:00 PM', subColor: 'b', meta: 'Photo proof', done: false, route: 'camera' },
        { id: 'recovery', title: 'Recovery Check-In', icon: 'moon', accent: 'p', status: 'Later', statusColor: 'p', sub: 'Before bed', subColor: 'p', meta: '+23 pts', done: false, route: 'recovery' },
      ];
    }
    /* ---- ENGINE-DERIVED: today's list from the catalog + runtime ---- */
    const resolve = (id) => {
      switch (id) {
        case 'breakfast': return { done: true };
        case 'lunch':     return { done: true };
        case 'weight':    return { done: RT.weightLogged, late: RT.weightLogged };
        case 'dinner':    return { done: RT.dinnerLogged };
        case 'hydration': return { done: RT.hydrationOz >= 120, progress: `${RT.hydrationOz} of 120 oz` };
        case 'recovery':  return { done: RT.recoveryDone };
        default: return {};
      }
    };
    const decorate = (d) => {
      const meta =
        d.id === 'breakfast' ? 'Scored 95' :
        d.id === 'lunch' ? 'Scored 91' :
        d.id === 'dinner' ? (d.done ? 'Scored 90' : '+6 pts') :
        d.id === 'weight' ? (d.done ? 'Trend only' : 'Not scored') :
        d.id === 'hydration' ? (d.done ? 'Focus hit' : 'Optional') :
        d.id === 'recovery' ? (d.done ? '+6 earned' : '+6 pts') : '';
      const route =
        d.id === 'breakfast' ? 'meal-detail' :
        d.id === 'lunch' ? 'meal-detail' :
        d.id === 'dinner' ? (d.done ? 'meal-detail/dinner' : 'camera') :
        d.id === 'weight' ? 'weight' :
        d.id === 'hydration' ? 'log' :
        d.id === 'recovery' ? (d.done ? 'recovery-confirm' : 'recovery') : 'home';
      // seeded on-time subs for the two morning logs
      const sub = d.id === 'breakfast' ? 'Logged 8:14 AM' : d.id === 'lunch' ? 'Logged 12:18 PM' :
                  d.id === 'dinner' && d.done ? 'Logged 7:12 PM' : d.sub;
      const subColor = (d.id === 'breakfast' || d.id === 'lunch' || (d.id === 'dinner' && d.done)) ? 'g' : d.subColor;
      return { ...d, meta, route, sub, subColor };
    };
    const rows = CATALOG
      .filter(r => runsToday(r) && r.id !== 'weekly' && r.id !== 'hydration')
      .map(r => decorate(derive(r, resolve(r.id))));
    // hydration rides as the optional row after the required set
    const hydro = decorate(derive(CATALOG.find(r => r.id === 'hydration'), resolve('hydration')));
    const assigned = RT.assigned.map(a => ({ ...deriveAssigned(a), meta: a.done ? 'Coach sees it' : 'From coach', route: `requirement/${a.id}` }));
    const fresh = assigned.filter(a => a.fresh);
    const rest = assigned.filter(a => !a.fresh);
    return [...fresh, ...rows, hydro, ...rest];
  },
  get metCount() {
    if (RT.day0) return RT.day0Breakfast ? 1 : 0;
    return 2 + (RT.dinnerLogged ? 1 : 0) + (RT.recoveryDone ? 1 : 0) + RT.assigned.filter(a => a.done).length;
  },
  get reqTotal() { return 4 + RT.assigned.length; },

  get activity() {
    if (RT.day0) {
      return RT.day0Breakfast
        ? [{ time: 'Just now', type: 'Breakfast', value: '88', vClass: 'g', img: 'assets/meal-breakfast.jpg', route: 'meal-detail' }]
        : [];
    }
    const a = [
      { time: 'Today · 8:14 AM', type: 'Breakfast', value: '95', vClass: 'g', img: 'assets/meal-breakfast.jpg', route: 'meal-detail' },
      { time: 'Today · 12:18 PM', type: 'Lunch', value: '91', vClass: 'g', img: 'assets/meal-lunch.jpg', route: 'meal-detail' },
      { time: 'Today · 3:30 PM', type: 'Hydration', value: `${RT.hydrationOz} oz`, vClass: 'b', img: null, route: 'log' },
    ];
    if (RT.dinnerLogged) a.push({ time: 'Today · 7:12 PM', type: 'Dinner', value: '90', vClass: 'g', img: 'assets/meal-dinner.jpg', route: 'meal-detail/dinner' });
    if (RT.weightLogged) a.push({ time: 'Tonight', type: 'Morning Weight', value: '183.8 lb', vClass: 'muted', img: 'assets/scale.jpg', route: 'weight' });
    a.push(RT.recoveryDone
      ? { time: 'Tonight', type: 'Recovery Check-In', value: 'Done', vClass: 'g', img: 'assets/recovery.jpg', route: 'recovery-confirm' }
      : { time: 'Tonight', type: 'Recovery Check-In', value: 'Upcoming', vClass: 'muted', img: 'assets/recovery.jpg', dim: true, route: 'recovery' });
    return a;
  },

  get nextMove() {
    if (RT.day0) return RT.day0Breakfast
      ? { label: 'Log Lunch', gain: null, route: 'camera', accent: 'g' }
      : { label: 'Log First Meal', gain: null, route: 'camera', accent: 'g' };
    if (!RT.dinnerLogged) return { label: 'Log Dinner', gain: 6, route: 'camera', accent: 'g' };
    if (!RT.recoveryDone) return { label: 'Do Recovery Check-In', gain: 6, route: 'recovery', accent: 'p' };
    return null; // day complete
  },

  get finish() {
    const next = this.nextMove;
    return {
      current: this.score, possible: this.possible,
      met: `${this.metCount}/${this.reqTotal}`,
      nextMove: next ? next.label.replace('Do ', '') : 'Day complete',
      nextGain: next ? next.gain : null,
      risk: RT.recoveryDone ? 'None left' : 'Recovery Check-In',
      riskSub: RT.recoveryDone ? 'everything is in' : 'keeps your streak alive',
    };
  },

  get trustPass() {
    return RT.day0
      ? { active: false }
      : { active: true, day: 3, length: 14, note: 'On standard, camera-free today. Credited from your 10-day median.' };
  },

  get unreadNotifs() { return RT.notifsRead ? 0 : this.notifications.new.length; },

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
      { k: 'Carbs', v: 'rice · potatoes · oats · pasta · fruit · tortillas' },
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
    get notes() {
      const base = [
        { who: 'coach', name: 'Coach Mark', when: '2h ago', text: 'Bumped water to 120 oz this week. You practice in heat Wed/Thu, get ahead of it.' },
        { who: 'ai', name: 'OnStandard AI', when: '2h ago', text: 'Applied Coach Mark’s update: hydration target 96 to 120 oz. Your other targets are unchanged.' },
        { who: 'coach', name: 'Coach Mark', when: 'Mon', text: 'Lean mass phase, week 2. Keep protein at 190 and don’t chase the scale, we’re building.' },
      ];
      // a plan update the coach ACTUALLY published from the coach plan editor
      return RT.planUpdate ? [{ who: 'coach', name: 'Coach Mark', when: RT.planUpdate.when, text: RT.planUpdate.text }, ...base] : base;
    },
  },

  // ---------- MEAL (lunch detail; dinner uses logging.*) ----------
  get meal() {
    return {
      name: 'Lunch', loggedAt: '12:18 PM', onTime: true, score: 91,
      foods: ['Grilled chicken', 'White rice', 'Black beans', 'Avocado', 'Salsa'],
      macros: { protein: 42, carbs: 68, fat: 18, cals: 610 },
      ai: 'Strong lunch. Good protein and carb balance for recovery. Add more water with this meal.',
      planNote: 'Fits your plan: protein-forward, carbs around training. On target for lean mass.',
      thread: [
        { who: 'coach', name: 'Coach Mark', text: 'Great lunch. Keep this structure.' },
        { who: 'ai', name: 'OnStandard AI', text: 'Coach is right, this fits your plan well: protein plus carbs after training.' },
        { who: 'athlete', name: 'You', text: 'Could I swap rice for potatoes?' },
        { who: 'ai', name: 'OnStandard AI', text: 'Yes. Potatoes fit your carb target. Keep the portion similar.' },
        // comments the coach ACTUALLY sent from the coach view this session
        ...RT.coachComments.map(t => ({ who: 'coach', name: 'Coach Mark', text: t })),
      ],
    };
  },

  // what's being logged right now — day-0 logs breakfast; Jihad's day logs dinner
  get logging() {
    if (RT.day0) {
      return {
        name: 'Breakfast', due: 'Due by 10:00 AM', remaining: 'Morning window open',
        img: 'assets/meal-breakfast.jpg', score: 88,
        foods: ['Eggs', 'Toast', 'Bacon', 'Greens'],
        macros: { protein: 34, carbs: 38, fat: 22, cals: 480 },
        componentsRead: [
          { k: 'Protein', v: 'Eggs + bacon · solid start', ok: true },
          { k: 'Carb source', v: 'Toast · add oats or fruit', ok: 'warn' },
          { k: 'Color / micros', v: 'Greens · good', ok: true },
          { k: 'Portion', v: 'Fine for a first log', ok: true },
        ],
        planMatch: { verdict: 'Fits your Standard', detail: 'First log of day one. Protein first thing, exactly what the plan asks for.', level: 'g' },
        ai: 'Good first log. Protein up front sets the day. Add a fruit or oats next time for a slower carb.',
      };
    }
    return {
      name: 'Dinner', due: 'Due by 8:00 PM', remaining: '48 min remaining',
      img: 'assets/meal-dinner.jpg', score: 90,
      foods: ['Steak', 'Roasted potatoes', 'Green beans', 'Butter'],
      macros: { protein: 46, carbs: 52, fat: 24, cals: 640 },
      componentsRead: [
        { k: 'Protein', v: 'Steak · high quality', ok: true },
        { k: 'Carb source', v: 'Roasted potatoes · slow carb', ok: true },
        { k: 'Color / micros', v: 'Green beans · add one more color', ok: 'warn' },
        { k: 'Portion', v: 'Right for a training day', ok: true },
      ],
      planMatch: { verdict: 'Matches your plan', detail: 'Plan called for protein + slow carb + vegetable at dinner. This hits all three.', level: 'g' },
      ai: 'Strong dinner. Protein is on target and the carbs land right after training. One more glass of water before bed.',
    };
  },

  // ---------- MEAL HISTORY (past days; today derives live) ----------
  history: [
    { day: 'Thursday', date: 'Jul 3', score: 86, tier: 'Locked In',
      meals: [ { type: 'Breakfast', score: 92, img: 'assets/meal-breakfast.jpg' }, { type: 'Lunch', score: 84, img: 'assets/meal-lunch.jpg' }, { type: 'Dinner', score: 89, img: 'assets/meal-dinner.jpg' } ] },
    { day: 'Wednesday', date: 'Jul 2', score: 72, tier: 'Building', note: 'Recovery missed · late lunch',
      meals: [ { type: 'Breakfast', score: 90, img: 'assets/meal-breakfast.jpg' }, { type: 'Lunch · late', score: 71, img: 'assets/meal-lunch.jpg' }, { type: 'Dinner', score: 85, img: 'assets/meal-dinner.jpg' } ] },
    { day: 'Tuesday', date: 'Jul 1', score: 90, tier: 'OnStandard',
      meals: [ { type: 'Breakfast', score: 95, img: 'assets/meal-breakfast.jpg' }, { type: 'Lunch', score: 91, img: 'assets/meal-lunch.jpg' }, { type: 'Dinner', score: 88, img: 'assets/meal-dinner.jpg' } ] },
  ],

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

  // ---------- WEEKLY CHECK-IN ----------
  weekly: {
    status: 'Submitted Sunday · next opens Sunday',
    readiness: 84,
    fields: [
      { k: 'Energy this week', val: 4 }, { k: 'Recovery', val: 3 }, { k: 'Sleep', val: 4 },
      { k: 'Confidence', val: 4 }, { k: 'Soreness', val: 3 }, { k: 'Motivation', val: 5 },
    ],
  },

  // ---------- PROGRESS ----------
  progress: {
    weekAvg: 84, weekDelta: '+6', onDays: '5 of 7',
    weekScores: [78, 88, 72, 90, 82, 86, 82],
    monthConsistency: 81, bestStreak: 9,
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
    weeklySummary: 'Best week of the phase. Meal logging is near-automatic now; the gap is night habits: recovery check-ins and water after practice.',
    coachFeedback: 'Best week yet. Keep breakfast consistent and clean up the hydration misses.',
    aiSummary: 'You’re trending up. Meal consistency improved, but recovery and hydration are your biggest gaps. Get water in before practice and do your check-in before bed.',
  },

  // ---------- SQUAD / COACH ----------
  squad: [
    { rank: 1, name: 'D. Okafor', unit: 'WR', score: 93, you: false },
    { rank: 2, name: 'You', unit: 'WR', score: 82, you: true },
    { rank: 3, name: 'M. Reyes', unit: 'WR', score: 79, you: false },
    { rank: 4, name: 'T. Boone', unit: 'WR', score: 74, you: false },
  ],
  roster: [
    { name: 'D. Okafor', unit: 'WR', score: 93, logs: '4/4', flag: 'g', note: 'On standard 12 days straight' },
    { name: 'J. Woods', unit: 'WR', score: 82, logs: '2/4', flag: 'y', note: 'Dinner + recovery still open', you: true },
    { name: 'M. Reyes', unit: 'WR', score: 79, logs: '3/4', flag: 'y', note: 'Hydration short 3 days running' },
    { name: 'T. Boone', unit: 'WR', score: 74, logs: '2/4', flag: 'y', note: 'Late lunches all week' },
    { name: 'K. Bell', unit: 'RB', score: 58, logs: '1/4', flag: 'r', note: 'No logs since Tuesday · needs attention' },
    { name: 'A. Grant', unit: 'RB', score: 91, logs: '4/4', flag: 'g', note: 'Weekly check-in due today' },
  ],

  // ---------- NOTIFICATIONS (live) ----------
  get notifications() {
    const fresh = [];
    RT.assigned.filter(a => !a.done).forEach(a => fresh.push({
      level: 'medium', title: `Coach Mark added: ${a.title}`, body: `${a.note} Due: ${a.dueLabel.toLowerCase()}.`, when: 'now', icon: 'clipboard', route: `requirement/${a.id}`,
    }));
    if (RT.planUpdate) fresh.push({ level: 'medium', title: 'Coach Mark updated your plan', body: `“${RT.planUpdate.text}”`, when: RT.planUpdate.when, icon: 'clipboard', route: 'plan/notes' });
    if (RT.hydrationOz >= 120) fresh.push({ level: 'positive', title: 'Hydration standard hit', body: `120 oz in. This week's focus, handled. Coach sees it.`, when: 'now', icon: 'droplet', route: 'log' });
    if (!RT.recoveryDone) fresh.push({ level: 'high', title: 'Recovery check-in before bed', body: 'Do it tonight to lock +6 and keep your 5-day streak.', when: 'now', icon: 'moon', route: 'recovery' });
    fresh.push({ level: 'positive', title: 'Coach Mark liked your lunch', body: '“Great lunch. Keep this structure.”', when: '18m', icon: 'heart', route: 'meal-detail' });
    if (RT.dinnerLogged) fresh.push({ level: 'positive', title: 'Dinner logged on time', body: `+6 pts. You’re at ${computeScore(componentsNow())}${RT.recoveryDone ? ', OnStandard.' : '. One move left tonight.'}`, when: 'now', icon: 'check', route: 'meal-detail/dinner' });
    else fresh.push({ level: 'medium', title: 'Dinner window open', body: 'Log dinner by 8:00 PM to finish today on plan.', when: '32m', icon: 'bowl', route: 'camera' });
    return {
      new: fresh,
      earlier: [
        { level: 'critical', title: 'Morning Weight overdue', body: 'You missed the 9:00 AM window. Coach can see missed logs.', when: '1:12 PM', icon: 'scale', route: 'weight' },
        { level: 'positive', title: 'Breakfast logged on time', body: 'Strong start, meal score 95.', when: '8:14 AM', icon: 'check', route: 'meal-detail' },
      ],
    };
  },
};

// convenience
export function pct(v, of) { return Math.round((v / of) * 100); }
window.S = S; // debug
