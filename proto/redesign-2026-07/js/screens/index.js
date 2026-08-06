import home from './home.js';
import breakdown from './breakdown.js';
import plan from './plan.js';
import camera, { cameraConfirm } from './camera.js';
import { analyzing, mealQuestions, analysis, confirm, detail, thread } from './meal.js';
import nutritionChat from './nutrition-chat.js';
import weight from './weight.js';
import recovery, { recoveryConfirm } from './recovery.js';
import progress from './progress.js';
import profile, { editProfile } from './profile.js';
import connect from './connect.js';
import guardian from './guardian.js';
import notifications from './notifications.js';
import log from './log.js';
import auth from './auth.js';
import onboarding from './onboarding.js';
import checkin from './checkin.js';
import commitment from './commitment.js';
import { coachAthlete, coachMeal, coachAssign, coachPlan, coachPlanSet, coachInbox, copilot, parent, inviteParent, parentLink } from './coach.js';
import { coachHome } from './coach-home.js';
import { coachRoster } from './coach-roster.js';
import { coachRooms } from './coach-rooms.js';
import { coachCreate } from './coach-create.js';
import { coachAnnounce } from './coach-announce.js';
import { coachInsights } from './coach-insights.js';
import states from './states.js';
import requirement from './requirement.js';
import { messages, settings as prefs, privacy, billing, notifSettings, coachNotifSettings, deleteAccount, terms, planStylePicker } from './settings.js';
import { feedback } from './feedback.js';
import { planUpgrade } from './plan-upgrade.js';
import { foodSearch, labelScan, barcodeScan } from './foodsearch.js';
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
import { devices, recruiting, restrictions, teamDiet, injury, coachVoice, trustPassPolicy, weekPattern, safety } from './features.js';
import bioOptin from './bio-optin.js';
import sponsor from './sponsor.js';
import redeemCode from './redeem-code.js';
import paywall from './paywall.js';
import progressPhotos from './progress-photos.js';
import progressCompare from './progress-compare.js';
import logTraining from './log-training.js';
import trainingHistory from './training-history.js';
import rollCall from './roll-call.js';
import connectedStandard, { connectedStandardsList, connectedStandardEdit } from './connected-standards.js';
import { coachStandards, coachStandardEdit, coachStandardsManage } from './coach-connected.js';
import healthConsent from './health-consent.js';
import locationConsent from './location-consent.js';
import accountability from './accountability.js';
import verifiedDiscipline from './verified-discipline.js';
import { coachCommitments, coachCommitEdit, coachCommitManage } from './coach-commitments.js';
import squad from './squad.js';
// Coach Marketplace (0183–0186) — client side + coach side
import getACoach from './get-a-coach.js';
import coachDirectory from './coach-directory.js';
import coachListing from './coach-listing.js';
import reportCoach from './report-coach.js';
import coachApply from './coach-apply.js';
import coachListingEditor from './coach-listing-editor.js';

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
  'nutrition-chat': nutritionChat,
  'meal-confirm': confirm,
  'meal-detail': detail,
  weight,
  recovery,
  'recovery-confirm': recoveryConfirm,
  progress,
  squad,
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
  // Trainer dashboard = the SAME operator modules the coach renders, under role-coherent routes
  // so a trainer's URL never reads #coach-*. The modules declare nav:'operator'; the router picks
  // the tab bar from RT.authRole and coach-data.js reduces them by capability.
  trainer: coachHome,
  'trainer-roster': coachRoster,
  'trainer-create': coachCreate,
  'trainer-inbox': coachInbox,
  'trainer-grow': trainerGrow,
  'my-trainer-offers': myTrainerOffers,
  // Coach Marketplace
  'get-a-coach': getACoach,
  'coach-directory': coachDirectory,
  'coach-listing': coachListing,
  'report-coach': reportCoach,
  'coach-apply': coachApply,
  'coach-listing-editor': coachListingEditor,
  'fund-plan': fundPlan,
  'funded-plans': fundedPlans,
  parent,
  'invite-parent': inviteParent,
  'parent-link': parentLink,
  states,
  requirement,
  messages,
  settings: prefs,
  feedback,
  'plan-upgrade': planUpgrade,
  'plan-style': planStylePicker,
  privacy,
  billing,
  'food-search': foodSearch,
  'label-scan': labelScan,
  'barcode-scan': barcodeScan,
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
  'notif-settings': notifSettings,
  'coach-notif-settings': coachNotifSettings,
  'delete-account': deleteAccount,
  terms,
  devices,
  recruiting,
  restrictions,
  'team-diet': teamDiet,
  injury,
  'coach-voice': coachVoice,
  'trust-pass-policy': trustPassPolicy,
  'week-pattern': weekPattern,
  safety,
  'bio-optin': bioOptin,
  sponsor,
  'redeem-code': redeemCode,
  paywall,
  'progress-photos': progressPhotos,
  'progress-compare': progressCompare,
  'log-training': logTraining,
  'training-history': trainingHistory,
  // Verified Commitments (0138). Athlete: the roll-call detail + the Accountability rollup +
  // the athlete-controlled recruit profile. Operator: the live board + the composer.
  'roll-call': rollCall,
  'location-consent': locationConsent,
  accountability,
  'verified-discipline': verifiedDiscipline,
  'coach-commitments': coachCommitments,
  'coach-commit-edit': coachCommitEdit,
  'coach-commit-manage': coachCommitManage,
  // Connected Standards (0155). Athlete: the standard detail, the list, and the personal editor.
  // The Home card itself is injected into #cs-slot by home.js, not routed.
  'connected-standard': connectedStandard,
  'connected-standards': connectedStandardsList,
  'connected-standard-edit': connectedStandardEdit,
  // Operator: the live board, the builder, and the manage list. nav:'operator' renders each of
  // these for a coach's team AND a trainer's practice.
  'coach-standards': coachStandards,
  'coach-standard-edit': coachStandardEdit,
  'coach-standards-manage': coachStandardsManage,
  'health-consent': healthConsent,
};
