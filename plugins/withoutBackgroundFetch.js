/**
 * Removes "fetch" from UIBackgroundModes.
 *
 * expo-task-manager's config plugin adds it unconditionally, but nothing on iOS registers a
 * background fetch task: the geofencing task rides region monitoring (no background mode needed)
 * and the roll-call notification task is Android-only (src/lib/notify/rollcall.ts). An unused
 * background mode is a 2.5.4 flag, and App Review already rejected this app once under 2.5.4
 * (2026-09-18). Listed FIRST in app.json: mods run in reverse plugin order, so it runs last. When the array ends up
 * empty the key is dropped. app.config.test.ts pins the result.
 */
const { withInfoPlist } = require('@expo/config-plugins');

module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      const kept = modes.filter((m) => m !== 'fetch');
      if (kept.length) cfg.modResults.UIBackgroundModes = kept;
      else delete cfg.modResults.UIBackgroundModes;
    }
    return cfg;
  });
};
