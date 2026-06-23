// AthleteOS — initial session state, ported verbatim from the prototype.
import type { AppState } from './types';
import { todayStamp } from './clock';
import { CAL_TARGET, PROTEIN_TARGET, WEIGHT_TARGET } from './constants';

export function createInitialState(): AppState {
  return {
    // onboarding
    flow: 'onboarding',
    obStep: 0,
    role: null,
    signinMode: false,
    athleteName: '',
    athleteEmail: '',
    level: null,
    sport: null,
    position: null,
    goals: [],
    baseHeight: 73,
    baseWeight: 178,
    baseAge: 17,
    baseGoal: 'gain',
    inviteWho: ['coach', 'parent'],
    parentFocus: ['Performance'],
    compMode: 'position',
    coachTrack: { nutrition: true, recovery: true, hydration: true, weight: true, tasks: true },

    // day
    dateStamp: todayStamp(),
    scoreHistory: [],
    weightHistory: [],
    nutritionHistory: [],
    meals: { breakfast: true, lunch: true, snack: true, dinner: false },
    hydrationL: 2.4,
    quickAdded: [false, false, false],
    tasks: [
      { id: 1, group: 'NUTRITION', title: 'Log breakfast', meta: '42g protein', done: true },
      { id: 2, group: null, title: 'Hit 180g protein', meta: 'protein goal', done: false },
      { id: 3, group: null, title: 'Log dinner', meta: 'Due by 8:00 PM', done: false },
      { id: 4, group: 'HYDRATION', title: 'Drink 1 gallon of water', meta: 'water goal', done: false },
      { id: 5, group: 'RECOVERY', title: '8+ hours of sleep', meta: 'Logged 8.0 hrs', done: true },
      { id: 6, group: null, title: '10 min mobility routine', meta: 'Post-practice', done: true },
    ],

    // check-in
    ciStage: 'open',
    ciWeight: 178,
    currentWeight: 178,
    ciEnergy: 8,
    ciRecovery: 7,
    ciSleep: 8,
    ciConfidence: 9,
    ciSoreness: 4,
    ciMotivation: 8,
    ciSubmitted: false,
    ciConfig: { energy: true, recovery: true, sleep: true, confidence: true, soreness: false, motivation: false },

    // nav / overlays
    tab: 'home',
    squadMode: 'team',
    mealOpen: false,
    mealStage: 'capture',
    mealType: 'Dinner',
    mealDetailOpen: false,
    selectedMeal: null,
    notifOpen: false,
    personDetail: null,
    accountOpen: false,
    msgOpen: false,

    // misc
    weeklyGoalLb: 1.0,
    proteinTarget: PROTEIN_TARGET,
    calTarget: CAL_TARGET,
    weightTarget: WEIGHT_TARGET,
    visibility: 'parent',
    notif: true,
    units: 'imperial',
    mealDesc: '',
    chatDraft: '',
    msgDraft: '',

    // chat / memory
    coachNote: 'Ease up on refined carbs at dinner — swap bread for rice or sweet potato.',
    mealChat: [
      { who: 'ai', text: 'Detected grilled chicken, brown rice & broccoli. Quality 94 — strong protein, clean carbs, good timing.' },
      { who: 'coach', text: 'Great plate. Ease up on the rice portion at night though — keep carbs earlier in the day.' },
      { who: 'ai', text: 'Noted. I’ll flag smaller dinner carbs on Jihad’s plan and remind him going forward.' },
    ],
    msgThread: [
      { who: 'them', text: 'Thanks for staying on top of this — it really helps to see the daily numbers.' },
      { who: 'me', text: 'Of course. I’ll flag anything that looks off this week.' },
    ],
  };
}
