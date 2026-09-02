/** @type {import('@bacons/apple-targets/app.plugin').Config} */
//
// OnStandard — the widget extension that draws the Wake-Up Roll Call card.
//
// EVERY FILE IN THIS DIRECTORY IS COMPILED INTO THE EXTENSION. That is why the two shared types
// (RollCallAttributes, RollCallCheckInIntent) have copies here as well as in
// modules/rollcall-live/ios/, which is where the APP gets them:
//
//   RollCallAttributes      ActivityKit matches a push to a running activity by this type's NAME.
//                           The app starts activities, the extension draws them, so both need it.
//   RollCallCheckInIntent   the extension constructs it for Button(intent:); the app is the
//                           process the system actually runs perform() in. Apple requires it in
//                           the app target, and the extension cannot compile without the type.
//
// The copies are byte-for-byte identical and `npm run verify` FAILS if they ever drift
// (scripts/check-widget-mirror.mjs). That is the same hand-kept-mirror pattern the notification
// category ids already use across the Deno and React Native module graphs.
//
// The name matters: it becomes the product name and the bundle id suffix, so it has to match the
// identifier registered with Apple, com.onstandard.app.RollCallWidget.
module.exports = {
  type: 'widget',
  name: 'RollCallWidget',
  displayName: 'Roll Call',

  // ActivityKit and WidgetKit draw the card; AppIntents is what the button is built on; SwiftUI is
  // the whole view layer. Listing them explicitly rather than relying on an implicit link, because
  // a missing framework here fails at link time with a message that names a symbol, not a cause.
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],

  // The App Group is NOT declared here on purpose. apple-targets mirrors
  // ios.entitlements['com.apple.security.application-groups'] from app.json into any target that
  // can use App Groups, so app.json stays the single place the group is named. Declaring it in
  // both would be two things to keep in step for no gain.
};
