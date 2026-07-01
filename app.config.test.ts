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
