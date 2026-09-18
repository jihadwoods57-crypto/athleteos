// OnStandard — what a notification does when it arrives while the app is OPEN.
//
// THE BUG THIS FIXES (2026-09-18). expo-notifications shows an arriving notification only if a
// handler says to. With no handler registered, iOS hands the notification to the app and the app
// presents NOTHING: no banner, no sound, no badge. Backgrounded, the OS draws it; foregrounded, it
// vanished. This app never called setNotificationHandler, so for its whole life every push and
// every local reminder that landed while someone was looking at the app was silently swallowed —
// which is exactly the state a person is in when they are testing whether notifications work.
//
// Registering the handler is a module side effect ON PURPOSE. It must be in place before the first
// notification can arrive, which is earlier than any component's first effect, so ProtoApp imports
// this module for its side effect at the top of the file and never calls anything.
//
// The DECISION is a pure function (presentationFor) so the rules below are unit-testable without a
// device — the seam every other notify rule in this folder already follows.
import { Platform } from 'react-native';

/** What expo-notifications wants back. `shouldShowAlert` is the pre-SDK-53 spelling and is
 *  deprecated; banner + list is the current pair, and both are required. */
export type Presentation = {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
};

/** The minimum of a notification we need to decide how to present it. */
export type ArrivingNotification = {
  data?: Record<string, unknown> | null;
  /** Expo maps a remote push's `sound` into the content; absent means silent by request. */
  sound?: string | null;
};

/**
 * How to present a notification that arrived while the app is in the foreground.
 *
 * Default is SHOW IT. A coach's message, an athlete's question, a logged meal, a roll call — the
 * person is holding the phone, and the whole point of the notification is that they find out now.
 * Two deliberate exceptions:
 *
 *   · `data.silent === true` — a data-only push whose job is to wake the app (token refresh, a
 *     Live Activity update). Showing a banner for one would be noise about plumbing.
 *   · the sender asked for no sound — then we show it without making a noise, rather than
 *     overriding the sender's own judgement about how loud this is.
 *
 * The badge is never set from here: the bell's unread count is server truth (notif-feed), and a
 * foreground arrival is about to be read anyway.
 */
export function presentationFor(notification: ArrivingNotification | null | undefined): Presentation {
  const data = (notification && notification.data) || {};
  const silent = data.silent === true;
  if (silent) {
    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
  }
  // `sound` is null/undefined when the sender deliberately sent a quiet one (send-push only sets
  // 'default' for the kinds worth a noise). An empty string counts as quiet too.
  const wantsSound = !!(notification && notification.sound);
  return {
    shouldShowBanner: true,
    // The list is the Notification Center history. A banner the person misses should still be
    // findable there — that is where someone looks when they say "I never got it".
    shouldShowList: true,
    shouldPlaySound: wantsSound,
    shouldSetBadge: false,
  };
}

/** Register the handler. Idempotent and safe to call more than once; a no-op on web, which has no
 *  notification runtime. Never throws — a handler failure must not stop the app from booting. */
export function installForegroundNotificationHandler(): void {
  if (Platform.OS === 'web') return;
  try {
    // Lazy require so web and jest never load the native module just by importing this file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const content = notification?.request?.content as ArrivingNotification | undefined;
        return presentationFor(content) as unknown as Awaited<
          ReturnType<NonNullable<Parameters<typeof Notifications.setNotificationHandler>[0]>['handleNotification']>
        >;
      },
    });
  } catch {
    // An older binary without the module, or a runtime that cannot register: the app still runs,
    // and a backgrounded notification is still drawn by the OS.
  }
}
