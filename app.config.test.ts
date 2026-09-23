// OnStandard — iOS App Store compliance guard for app.json.
//
// These keys are not cosmetic: Apple REJECTS a submission that accesses the
// camera or photo library without a usage string, that ships no privacy
// manifest with required-reason API declarations, or that has no bundle
// identifier. This test locks the launch-readiness config so a future change
// can never silently drop it and break the submission. See
// docs/APP-STORE-READINESS.md.
import appJson from './app.json';

const ios = appJson.expo.ios as any;

describe('app.json — iOS App Store compliance', () => {
  it('declares a reverse-DNS bundle identifier and a build number', () => {
    expect(ios.bundleIdentifier).toMatch(/^[a-z0-9.-]+\.[a-z0-9.-]+$/i);
    expect(String(ios.buildNumber)).toMatch(/^\d+$/);
  });

  it('carries an app version', () => {
    expect(appJson.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('auto-answers the export-compliance prompt (no non-exempt encryption)', () => {
    expect(ios.config.usesNonExemptEncryption).toBe(false);
    expect(ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('provides every Info.plist usage string for a resource the app accesses', () => {
    // The meal camera + photo picker. A missing/empty string is a guaranteed
    // App Review rejection.
    for (const key of [
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      const v = ios.infoPlist[key];
      expect(typeof v).toBe('string');
      expect(v.trim().length).toBeGreaterThan(15);
      // DESIGN.md bans em dashes in shipped copy (usage strings are user-visible).
      expect(v).not.toMatch(/—/);
    }
  });

  // Location is back (founder 2026-09-23): the walk-in check-in and "I'm here". The purpose
  // strings are what the athlete reads in the iOS prompt and what App Review reads first, so they
  // must say plainly what the app does with location, and the plugin must not be left to fill in
  // Expo's placeholder ("Allow $(PRODUCT_NAME) to access your location").
  it('location purpose strings are present and plain', () => {
    expect(ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription).toMatch(/check you in when you arrive|checks you in when you walk into/i);
    // When-in-use serves two roles (2026-09-23): the athlete's check-in AND centring the coach's
    // place picker on "Near me". The one string both roles see has to say both, truthfully.
    expect(ios.infoPlist.NSLocationWhenInUseUsageDescription).toMatch(/check you in when you arrive/i);
    expect(ios.infoPlist.NSLocationWhenInUseUsageDescription).toMatch(/center the map when a coach sets that place/i);
    // NO background-location mode. App Review 2.5.4 (2026-09-18) was exactly
    // UIBackgroundModes "location" with no feature that needed persistent location, and region
    // monitoring does not need it: the OS watches the region and wakes the app. "Always" is still
    // requested (region monitoring needs it); the mode must never creep back.
    expect(ios.infoPlist.UIBackgroundModes ?? []).not.toContain('location');
    for (const key of ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']) {
      const v = ios.infoPlist[key];
      expect(typeof v).toBe('string');
      expect(v).not.toMatch(/PRODUCT_NAME|—/);
      // Final fix round, item 7 (2026-09-23): "never shared" was false while a coach saw "N m from
      // <place>". Coaches now see Arrived / Not arrived only, and the string says exactly that.
      expect(v).toMatch(/Your coach sees only whether you arrived, never where you are\./);
      expect(v).not.toMatch(/never shared|never shares|only watches that place/i);
    }
    const plugin = (appJson.expo.plugins as unknown[]).find(
      (p) => Array.isArray(p) && p[0] === 'expo-location',
    ) as [string, Record<string, unknown>] | undefined;
    expect(plugin).toBeDefined();
    const opts = plugin![1];
    expect(opts.locationWhenInUsePermission).toBe(ios.infoPlist.NSLocationWhenInUseUsageDescription);
    expect(opts.locationAlwaysAndWhenInUsePermission).toBe(ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription);
    expect(opts.locationAlwaysPermission).toBe(ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription);
    expect(opts.isIosBackgroundLocationEnabled).not.toBe(true);
    // The plugin writes a placeholder motion string unless told not to; the app reads no motion.
    expect(opts.motionUsagePermission).toBe(false);
  });

  // Dictation in the chat composer (2026-09-23). App Review rejected a boilerplate microphone
  // string before, and three plugins (expo-speech-recognition, expo-camera, expo-image-picker) each
  // write NSMicrophoneUsageDescription, falling back to Expo's placeholder when the key is empty or
  // deleting it outright on microphonePermission:false. Exactly one real string, kept here, and no
  // plugin allowed to replace or delete it.
  it('dictation: one plain microphone string and one speech string, no plugin overriding them', () => {
    for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
      const v = ios.infoPlist[key];
      expect(typeof v).toBe('string');
      expect(v).not.toMatch(/PRODUCT_NAME|—/);
      expect(v).toMatch(/tap the mic in a chat/i);
    }
    const plugins = appJson.expo.plugins as unknown[];
    const opts = (name: string) => {
      const p = plugins.find((x) => Array.isArray(x) && x[0] === name) as [string, Record<string, unknown>] | undefined;
      return p ? p[1] : undefined;
    };
    expect(opts('expo-speech-recognition')).toBeDefined();
    for (const name of ['expo-speech-recognition', 'expo-camera', 'expo-image-picker']) {
      // Absent means "keep ios.infoPlist's string"; false would delete it (and, on the picker,
      // block RECORD_AUDIO); any other string would be a second, competing one.
      expect(opts(name)?.microphonePermission).toBeUndefined();
    }
    expect(opts('expo-speech-recognition')?.speechRecognitionPermission).toBeUndefined();
  });

  it('declares precise location as collected, linked, untracked, for app functionality', () => {
    // One reading is sent to our server on arrival, compared to the coach's place and discarded.
    // It leaves the device inside the athlete's signed-in request and the verdict it produces is
    // stored on their row, so it is declared, and declared LINKED: "not linked" would claim the
    // identifiers were stripped before it left the phone, which they are not.
    const loc = ios.privacyManifests.NSPrivacyCollectedDataTypes.find(
      (t: any) => t.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypePreciseLocation',
    );
    expect(loc).toEqual({
      NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
      NSPrivacyCollectedDataTypeLinked: true,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
    });
  });

  it('ships a privacy manifest declaring no tracking and the required-reason APIs', () => {
    const pm = ios.privacyManifests;
    expect(pm.NSPrivacyTracking).toBe(false);
    expect(Array.isArray(pm.NSPrivacyTrackingDomains)).toBe(true);
    expect(pm.NSPrivacyTrackingDomains).toHaveLength(0);
    // The offline build collects nothing remotely; when the Supabase backend is
    // turned on, NSPrivacyCollectedDataTypes must be filled in (health/fitness +
    // identifiers). Flagged in docs/APP-STORE-READINESS.md.
    expect(Array.isArray(pm.NSPrivacyCollectedDataTypes)).toBe(true);

    const declared = pm.NSPrivacyAccessedAPITypes.map((t: any) => t.NSPrivacyAccessedAPIType);
    // AsyncStorage -> UserDefaults is the one the app itself reaches; the rest are
    // the React Native runtime's required-reason APIs.
    expect(declared).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    for (const entry of pm.NSPrivacyAccessedAPITypes) {
      expect(Array.isArray(entry.NSPrivacyAccessedAPITypeReasons)).toBe(true);
      expect(entry.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
    }
  });
});
