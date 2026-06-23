// AthleteOS — thin, safe wrapper around expo-haptics.
//
// Native only: haptics are unsupported on web and a no-op there. Every call is
// fire-and-forget and swallows errors so a missing/denied haptics engine can
// never break an interaction. Three intents map to the design's tactile
// language: `tap` for ordinary presses, `select` for toggles/steppers, and
// `success` for completed goals (log a meal, finish a task, submit a check-in).
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

/** Light impact — ordinary button / CTA press. */
export function tap() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Selection tick — toggles, steppers, segmented choices. */
export function select() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

/** Success notification — a goal/action just completed. */
export function success() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export const haptics = { tap, select, success };
