import home from './home.js';
import homeOpus from './home.opus.js';
import breakdown from './breakdown.js';
import plan from './plan.js';
import camera from './camera.js';
import { analysis, confirm, detail } from './meal.js';
import weight from './weight.js';
import recovery from './recovery.js';
import progress from './progress.js';
import profile from './profile.js';
import connect from './connect.js';
import notifications from './notifications.js';

export const screens = {
  home,
  'home-opus': homeOpus, // pre-Fable snapshot for side-by-side comparison
  'score-breakdown': breakdown,
  plan,
  camera,
  'meal-analysis': analysis,
  'meal-confirm': confirm,
  'meal-detail': detail,
  weight,
  recovery,
  progress,
  profile,
  connect,
  notifications,
};
