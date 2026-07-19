const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Deferred "Sign In with Apple".
 *
 * `expo-apple-authentication` auto-applies its config plugin (via autolinking)
 * and adds the `com.apple.developer.applesignin` entitlement whenever the
 * package is installed. Our App Store provisioning profile does not yet carry
 * the "Sign In with Apple" capability (that needs Apple Developer setup on the
 * com.onstandard.app App ID + a regenerated profile), so declaring the
 * entitlement fails code-signing.
 *
 * This mod runs during the entitlements phase and strips just that one key, so
 * the app signs cleanly with the current profile. Everything else — the native
 * module, Face ID, Google Sign-In — is untouched.
 *
 * TO RE-ENABLE Apple Sign In: enable the capability on the App ID + regenerate
 * the App Store provisioning profile to include it, set ios.usesAppleSignIn
 * back to true in app.json, and remove this plugin from the plugins array.
 */
module.exports = function withDeferredAppleSignIn(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['com.apple.developer.applesignin'];
    return cfg;
  });
};
