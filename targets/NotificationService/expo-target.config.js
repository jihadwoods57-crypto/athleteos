/** @type {import('@bacons/apple-targets/app.plugin').Config} */
//
// OnStandard: the Notification Service Extension (roll call v3, 2026-09-24).
//
// iOS runs this extension for every push that carries `mutable-content`, before the banner shows,
// even when OnStandard was force-quit. It reads the roll-call schedule the server put in the push
// (`data.rc`), arms the AlarmKit alarms with the SAME scheduler the app uses, rewrites the banner
// only when that worked, and reports each armed morning to roll-call-ack. See
// NotificationService.swift.
//
// EVERY FILE IN THIS DIRECTORY IS COMPILED INTO THE EXTENSION. RollCallAlarm.swift and
// RollCallCheckInIntent.swift are byte-for-byte copies of modules/rollcall-live/ios/ (the alarm's
// metadata, its intents and the scheduler must be the SAME types whichever process armed the
// alarm); `npm run lint:mirror` fails if they drift.
//
// NO APP GROUP, deliberately. Nothing here reads or writes the group: taps on the alarm run the
// intents in the APP's process. Without the group the bundle id needs no portal step, so
// scripts/apple-provision.mjs creates it and its profile end to end.
//
// The name is the Xcode target name, the credentials.json key and the bundle id suffix.
module.exports = {
  type: 'notification-service',
  name: 'NotificationService',
  bundleIdentifier: '.NotificationService',
  // The extension's only job is AlarmKit, usable from 26.1 (RollCallAlarm.swift). An older iOS
  // never loads an extension whose minimum is above it, so the push shows unmodified there: the
  // server's own text, which never claims an alarm was set.
  deploymentTarget: '26.1',
  // AlarmKit is NOT listed: `import AlarmKit` auto-links it, exactly as the app pod does.
  frameworks: ['UserNotifications', 'SwiftUI', 'AppIntents', 'ActivityKit'],
};
