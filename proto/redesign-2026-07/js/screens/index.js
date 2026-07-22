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
import commitment from './commitment.js';
import { coachAthlete, coachMeal, coachAssign, coachPlan, coachPlanSet, coachInbox, copilot, trainer, trainerClient, parent, inviteParent, parentLink } from './coach.js';
import { coachHome } from './coach-home.js';
import { coachRoster } from './coach-roster.js';
import { coachRooms } from './coach-rooms.js';
import { coachCreate } from './coach-create.js';
import { coachAnnounce } from './coach-announce.js';
import { coachInsights } from './coach-insights.js';
import states from './states.js';
import requirement from './requirement.js';
import { messages, settings as prefs, privacy, billing, notifSettings, coachNotifSettings, deleteAccount, terms } from './settings.js';
import { foodSearch, labelScan } from './foodsearch.js';
import { trust, streak, history, mealView } from './trust.js';
import { role, coachOb, trainerOb, clientOb, coachProfile, trainerProfile } from './roles.js';
import { ob2Role } from './ob2-role.js';
import { obAthlete } from './ob2-athlete.js';
import { obClient } from './ob2-client.js';
import { trainerGrow } from './trainer-grow.js';
import myTrainerOffers from './my-trainer-offers.js';
import monthlyReport from './monthly-report.js';
import fundPlan from './fund-plan.js';
import fundedPlans from './funded-plans.js';
import { obCoach } from './ob2-coach.js';
import { obTrainer } from './ob2-trainer.js';
import { obParent } from './ob2-parent.js';
import { obNutrition } from './ob2-nutrition.js';
import signin from './signin.js';
import reset from './reset.js';
import { devices, recruiting, restrictions, teamDiet, injury, partner, coachVoice, trustPassPolicy, weekPattern, safety } from './features.js';
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
  'monthly-report': monthlyReport,
  profile,
  connect,
  guardian,
  notifications,
  log,
  welcome: auth,
  onboarding,
  checkin,
  commitment,
  'coach-home': coachHome, coach: coachHome,     // alias — old route renders the new Home
  'coach-roster': coachRoster,
  'coach-rooms': coachRooms,
  'coach-create': coachCreate,
  'coach-announce': coachAnnounce,
  'coach-insights': coachInsights,
  'coach-athlete': coachAthlete,
  'coach-meal': coachMeal,
  'coach-assign': coachAssign,
  'coach-plan': coachPlan,
  'coach-plan-set': coachPlanSet,
  'coach-inbox': coachInbox,
  copilot,
  trainer,
  'trainer-grow': trainerGrow,
  'my-trainer-offers': myTrainerOffers,
  'fund-plan': fundPlan,
  'funded-plans': fundedPlans,
  'trainer-client': trainerClient,
  parent,
  'invite-parent': inviteParent,
  'parent-link': parentLink,
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
  'meal-view': mealView,
  // OB2 adaptive onboarding (2026-07 redesign) — the 6-role narrative flow now owns the
  // `role` route; the legacy picker stays importable as `legacy-role` for rollback.
  role: ob2Role,
  'legacy-role': role,
  oba: obAthlete,
  obf: obClient,
  obk: obCoach,
  obt: obTrainer,
  obp: obParent,
  obn: obNutrition,
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
  'coach-notif-settings': coachNotifSettings,
  'delete-account': deleteAccount,
  terms,
  devices,
  recruiting,
  restrictions,
  'team-diet': teamDiet,
  injury,
  partner,
  'coach-voice': coachVoice,
  'trust-pass-policy': trustPassPolicy,
  'week-pattern': weekPattern,
  safety,
  'bio-optin': bioOptin,
};
