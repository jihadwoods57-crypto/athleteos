const { withInfoPlist, withEntitlementsPlist, withAndroidManifest } = require('@expo/config-plugins');

/**
 * OnStandard — native configuration for the Wake-Up Roll Call lock screen.
 *
 * Two platforms, two entirely different mechanisms, one plugin because they ship together:
 *
 *   iOS      declares that the app supports Live Activities, and joins the App Group the widget
 *            extension shares with the app.
 *   Android  nothing here: the module's own AndroidManifest already contributes the permission and
 *            the presentation receiver, and manifest merging picks them up. The Android branch
 *            below only asserts that, so a future refactor that drops the module's manifest fails
 *            loudly at prebuild instead of silently shipping an ordinary notification.
 *
 * WHAT THIS PLUGIN DELIBERATELY DOES NOT DO: create the widget extension target. That needs an
 * App ID, an App Group and a provisioning profile that only exist once someone has done the work
 * in the Apple Developer portal, and an app-extension target that cannot code-sign fails the whole
 * production build. `ios.appGroup` is therefore opt-in: pass it only once the portal work is done.
 * See docs/go-live/ROLLCALL-LIVE-ACTIVITY.md.
 */
const APP_GROUP_KEY = 'com.apple.security.application-groups';

/** Must match RollCallPendingStore.suiteName in the native module. */
const DEFAULT_APP_GROUP = 'group.com.onstandard.app';

module.exports = function withRollCallLiveActivity(config, props = {}) {
  const appGroup = props.appGroup === undefined ? null : props.appGroup || DEFAULT_APP_GROUP;

  // ---------------------------------------------------------------- iOS: Info.plist
  // NSSupportsLiveActivities goes on the MAIN APP target, not the widget extension. Apple is
  // explicit about which target, and putting it on the extension is a silent no-op: no card, no
  // error, nothing in the logs.
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSSupportsLiveActivities = true;
    // NSSupportsLiveActivitiesFrequentUpdates is deliberately NOT set. A roll call updates three
    // times in half an hour, which is nowhere near frequent enough to need it, and asking for it
    // adds a switch in Settings whose only effect here would be to let an athlete turn the feature
    // off by accident.
    return cfg;
  });

  // ---------------------------------------------------------------- iOS: App Group
  // Only when explicitly configured. The entitlement must match a group that exists on the App ID
  // and is carried by the provisioning profile; declaring one that does not fails code-signing,
  // which is a build failure rather than a degraded feature.
  if (appGroup) {
    config = withEntitlementsPlist(config, (cfg) => {
      const existing = cfg.modResults[APP_GROUP_KEY];
      const groups = Array.isArray(existing) ? existing : [];
      if (!groups.includes(appGroup)) groups.push(appGroup);
      cfg.modResults[APP_GROUP_KEY] = groups;
      return cfg;
    });
  }

  // ---------------------------------------------------------------- Android: assert, don't add
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const permissions = manifest['uses-permission'] || [];
    const has = permissions.some(
      (p) => p.$ && p.$['android:name'] === 'android.permission.POST_PROMOTED_NOTIFICATIONS',
    );
    if (!has) {
      // Contributed by modules/rollcall-live's own manifest via merging. Adding it a second time
      // here would mask its absence, so add it only when the merge did not happen — which means
      // the module is gone, and the presentation override is gone with it.
      permissions.push({
        $: { 'android:name': 'android.permission.POST_PROMOTED_NOTIFICATIONS' },
      });
      manifest['uses-permission'] = permissions;
      // eslint-disable-next-line no-console
      console.warn(
        '[rollcall-live] modules/rollcall-live did not contribute its Android manifest. ' +
          'The Live Update permission was added here, but the notification presentation override ' +
          'is MISSING: roll calls will arrive as ordinary notifications with no countdown.',
      );
    }
    return cfg;
  });

  return config;
};
