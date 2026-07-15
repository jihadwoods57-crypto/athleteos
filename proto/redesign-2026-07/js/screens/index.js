import home from './home.js';
import breakdown from './breakdown.js';
import plan from './plan.js';
import camera, { cameraConfirm } from './camera.js';
import { analyzing, mealQuestions, analysis, confirm, detail, thread } from './meal.js';
import weight from './weight.js';
import recovery, { recoveryConfirm } from './recovery.js';
import progress from './progress.js';
import profile, { editProfile, squad } from './profile.js';
import connect from './connect.js';
import guardian from './guardian.js';
import notifications from './notifications.js';
import log from './log.js';
import auth from './auth.js';
import onboarding from './onboarding.js';
import checkin from './checkin.js';
import { coach, coachAthlete, coachMeal, coachAssign, coachPlan, coachPlanSet, coachInbox, copilot, trainer, trainerClient, parent } from './coach.js';
import states from './states.js';
import requirement from './requirement.js';
import { messages, settings as prefs, privacy, billing, notifSettings, deleteAccount, terms } from './settings.js';
import { foodSearch, labelScan } from './foodsearch.js';
import { trust, streak, history } from './trust.js';
import { role, coachOb, trainerOb, clientOb, coachProfile, trainerProfile } from './roles.js';
import signin from './signin.js';
import reset from './reset.js';
import { devices, recruiting, restrictions, teamDiet, injury, partner, coachVoice, safety } from './features.js';
import bioOptin from './bio-optin.js';

export const screens = {
  home,
  'score-breakdown': breakdown,
  plan,
  camera,
  'camera-confirm': cameraConfirm,
  analyzing,
  'meal-questions': mealQuestions,
  'meal-analysis': analysis,
  'meal-thread': thread,
  'meal-confirm': confirm,
  'meal-detail': detail,
  weight,
  recovery,
  'recovery-confirm': recoveryConfirm,
  progress,
  profile,
  connect,
  guardian,
  notifications,
  log,
  welcome: auth,
  onboarding,
  checkin,
  coach,
  'coach-athlete': coachAthlete,
  'coach-meal': coachMeal,
  'coach-assign': coachAssign,
  'coach-plan': coachPlan,
  'coach-plan-set': coachPlanSet,
  'coach-inbox': coachInbox,
  copilot,
  trainer,
  'trainer-client': trainerClient,
  parent,
  states,
  requirement,
  messages,
  settings: prefs,
  privacy,
  billing,
  'food-search': foodSearch,
  'label-scan': labelScan,
  trust,
  streak,
  history,
  role,
  signin,
  reset,
  'coach-ob': coachOb,
  'trainer-ob': trainerOb,
  'client-ob': clientOb,
  'coach-profile': coachProfile,
  'trainer-profile': trainerProfile,
  'edit-profile': editProfile,
  squad,
  'notif-settings': notifSettings,
  'delete-account': deleteAccount,
  terms,
  devices,
  recruiting,
  restrictions,
  'team-diet': teamDiet,
  injury,
  partner,
  'coach-voice': coachVoice,
  safety,
  'bio-optin': bioOptin,
};
