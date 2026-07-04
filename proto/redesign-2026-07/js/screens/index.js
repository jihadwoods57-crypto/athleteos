import home from './home.js';
import homeOpus from './home.opus.js';
import breakdown from './breakdown.js';
import plan from './plan.js';
import camera from './camera.js';
import { analyzing, analysis, confirm, detail } from './meal.js';
import weight from './weight.js';
import recovery, { recoveryConfirm } from './recovery.js';
import progress from './progress.js';
import profile from './profile.js';
import connect from './connect.js';
import notifications from './notifications.js';
import log from './log.js';
import auth from './auth.js';
import onboarding from './onboarding.js';
import checkin from './checkin.js';
import { coach, coachAthlete, coachAssign, copilot, trainer, trainerClient, parent } from './coach.js';
import states from './states.js';
import requirement from './requirement.js';
import { messages, settings as prefs, privacy, billing } from './settings.js';

export const screens = {
  home,
  'home-opus': homeOpus, // pre-Fable snapshot for side-by-side comparison
  'score-breakdown': breakdown,
  plan,
  camera,
  analyzing,
  'meal-analysis': analysis,
  'meal-confirm': confirm,
  'meal-detail': detail,
  weight,
  recovery,
  'recovery-confirm': recoveryConfirm,
  progress,
  profile,
  connect,
  notifications,
  log,
  welcome: auth,
  onboarding,
  checkin,
  coach,
  'coach-athlete': coachAthlete,
  'coach-assign': coachAssign,
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
};
