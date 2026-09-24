// Phase 2 — the native bridge between the proto (running in the WebView) and iOS.
//
// The proto posts typed messages over window.ReactNativeWebView.postMessage; native handles
// the device-only capabilities and, for request/response calls (secure storage), injects the
// result back by callback id. These native capabilities (haptics, share, secure Keychain,
// push) are also the concrete "real native app" signals that clear Apple guideline 4.2.
//
// Injection is JSON-escaped (incl. U+2028/U+2029, which are valid JSON but break a JS string
// literal) so a value can never break out of the injected call.
import { Linking, Platform, Share } from 'react-native';
// expo-file-system v57+ moved cacheDirectory/writeAsStringAsync/EncodingType (the classic
// promise-based file API this bridge needs) to the `/legacy` subpath — the new default export
// is object-oriented (File/Directory) and doesn't have these symbols.
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import type WebView from 'react-native-webview';
import { isAppleAuthAvailable, requestAppleIdentityToken, requestAppleCredential } from '../lib/auth/apple';
import { isGoogleAuthAvailable, requestGoogleIdToken } from '../lib/auth/google';
import { biometricsUsable } from '../lib/auth/biometrics';
import { isIapAvailable, purchaseConsumer, restoreConsumer, getConsumerOfferings } from '../lib/iap';
import {
  isHealthAvailable, healthConnected, connectHealth, readRecoverySample,
  readActivity, observeActivity, type HealthScope,
} from '../lib/health';
import {
  isLocationAvailable, getPermissionState, requestPermission,
  refreshGeofences, disarmAll, checkArrival, REPORTS_PRESENCE, walkInAllowed,
} from '../lib/location';
import { syncExecNotifications } from '../lib/notify/execSync';
import { syncWakeAlarms, wakeAlarmState, cancelWakeAlarmFor } from '../lib/notify/wakeAlarms';
import { drainLiveActivityTaps, settleLiveCard } from '../lib/notify/rollcall';
import { getPushToken, ensureNotifyPermission, notifyPermissionState } from '../lib/notify';
import { getFlag } from '../store/flagsStore';
import { requestMapPick } from '../lib/maps/pickRequest';
import { dictationStatus, startDictation, stopDictation, abortDictation, type DictationEvent } from '../lib/voice/nativeSpeech';

type Ref = React.RefObject<WebView | null>;

export type BridgeMessage =
  | { type: 'HAPTIC'; style?: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' }
  | { type: 'SHARE'; payload?: { title?: string; message?: string; url?: string } }
  | { type: 'SHARE_IMAGE'; dataUrl?: string; caption?: string }
  | { type: 'SECURE_GET'; id: number; key: string }
  | { type: 'SECURE_SET'; id: number; key: string; value: string }
  | { type: 'SECURE_DELETE'; id: number; key: string }
  | { type: 'APPLE_AVAILABLE'; id: number }
  | { type: 'APPLE_SIGNIN'; id: number }
  // The identity token plus the one-time authorization code (G-R4: deletion revokes the Apple
  // sign-in with the refresh token the code buys).
  | { type: 'APPLE_CREDENTIAL'; id: number }
  | { type: 'GOOGLE_AVAILABLE'; id: number }
  | { type: 'GOOGLE_SIGNIN'; id: number }
  | { type: 'BIO_AVAILABLE'; id: number }
  | { type: 'NOTIFY_SYNC'; plan: import('../lib/notify/execSync').ExecPlanItem[] }
  | { type: 'ROLLCALL_ACKED'; instanceId: string }
  // The proto asks the shell for taps the alarm or the lock-screen card recorded outside the
  // WebView (the athlete answered on the alarm banner while the app was already open).
  | { type: 'ROLLCALL_DRAIN'; id: number }
  // The coach-assigned wake-up, as a REAL alarm (AlarmKit on iOS 26, setAlarmClock on Android).
  // The proto owns the roll-call rows, so it is what says which mornings are armed; the whole set
  // is sent every time and the native side reconciles, which makes a dropped message harmless.
  | { type: 'WAKE_ALARMS'; id: number; alarms?: import('../lib/notify/wakeAlarms').WakeAlarmRequest[]; complete?: boolean }
  | { type: 'WAKE_ALARM_STATE'; id: number; ask?: boolean }
  // The native star prompt. REQUEST returns whether a prompt was actually asked for — never
  // whether anyone rated, which no platform reports. See the handler for why the flag is checked
  // here rather than in the proto.
  | { type: 'REVIEW_REQUEST'; id: number }
  // `ask`: show the system notification question if it has not been answered. Only the Continue
  // primers pass true (G-R10); a launch-time token read never asks.
  | { type: 'PUSH_TOKEN'; id: number; ask?: boolean }
  | { type: 'NOTIFY_PERMISSION'; id: number; ask?: boolean }
  | { type: 'OPEN_URL'; url?: string }
  | { type: 'IAP_AVAILABLE'; id: number }
  | { type: 'IAP_OFFERINGS'; id: number; appUserId?: string }
  | { type: 'IAP_PURCHASE'; id: number; productId?: string; appUserId?: string }
  | { type: 'IAP_RESTORE'; id: number; appUserId?: string }
  | { type: 'HEALTH_AVAILABLE'; id: number }
  | { type: 'HEALTH_CONNECTED'; id: number }
  | { type: 'HEALTH_CONNECT'; id: number }
  | { type: 'HEALTH_READ'; id: number }
  // Connected Standards (0155). HEALTH_CONNECT gains an optional scopes list; activity is a
  // broader ask than recovery and carries its own consent record server-side.
  | { type: 'HEALTH_CONNECT_SCOPED'; id: number; scopes?: string[] }
  | { type: 'HEALTH_READ_ACTIVITY'; id: number; from?: string; to?: string }
  | { type: 'HEALTH_OBSERVE_ACTIVITY'; id: number }
  // Verified Commitments (0139), restored 2026-09-23 and verified by DISTANCE on the server (0242).
  // No LOCATION_* message carries the device's position across THIS bridge: LOCATION_CHECK takes
  // one reading natively, sends it to verify_arrival_at, and hands the proto back the verdict
  // ({ within, reason, distance_m }). The coach's old "use where I'm standing" (LOCATION_PLACE) is
  // not restored: coaches pick places on a map.
  | { type: 'LOCATION_AVAILABLE'; id: number }
  | { type: 'LOCATION_PERMISSION'; id: number; background?: boolean }
  | { type: 'LOCATION_ARM'; id: number }
  | { type: 'LOCATION_DISARM'; id: number }
  | { type: 'LOCATION_CHECK'; id: number; instanceId?: string }
  // The athlete said no to location earlier: iOS never shows the prompt again, so the only way
  // back is the app's own page in Settings (final fix round, item 2).
  | { type: 'LOCATION_SETTINGS' }
  // The coach's map (roll call rebuilt, 2026-09-23). Opens the native full-screen place picker
  // and replies { place: { name, address, lat, lng, radius_m } }, or { place: null } on Cancel.
  // The only coordinate that crosses the bridge is the one the coach chose on that map (never the
  // device's own position), and nothing on either side logs it. One at a time: a second request while the map is open is refused.
  | { type: 'MAP_PICK'; id: number; initial?: { lat?: number; lng?: number; radius_m?: number; name?: string } }
  // Dictation in the chat composer (2026-09-23). AVAILABLE answers { available, onDevice,
  // permission } and never prompts; START prompts the first time and resolves { ok, onDevice } or
  // { ok:false, code }; the words then stream to the page through window.__onDictation(event)
  // until an { type:'end' }. STOP lets the recognizer deliver its last words; ABORT drops them.
  // Only the athlete's own words cross, only to the page, and nothing on either side logs them.
  | { type: 'DICTATION_AVAILABLE'; id: number }
  // `sid` is the page's name for the session; every event carries it back (fix round 1).
  | { type: 'DICTATION_START'; id: number; lang?: string; sid?: string }
  | { type: 'DICTATION_STOP'; sid?: string }
  | { type: 'DICTATION_ABORT'; sid?: string }
  | { __log: { level: string; msg: string } };

/** Serialize a value for safe injection into `window.__onNativeResult(id, <here>)`. */
function safeJson(value: unknown): string {
  // Escape every non-ASCII char to a \\uXXXX sequence so the result is always a valid JS
  // string literal (this covers U+2028/U+2029, valid in JSON but line-terminators in JS).
  const s = JSON.stringify(value ?? null);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 0x7f ? s[i] : '\\u' + c.toString(16).padStart(4, '0');
  }
  return out;
}

/** Push one dictation event into the page (window.__onDictation, js/dictation.js). */
function dictationEvent(ref: Ref, e: DictationEvent) {
  ref.current?.injectJavaScript(`window.__onDictation && window.__onDictation(${safeJson(e)}); true;`);
}

function resolve(ref: Ref, id: number, value: unknown, error?: string) {
  const js = `window.__onNativeResult && window.__onNativeResult(${id}, ${safeJson(value)}, ${safeJson(error ?? null)}); true;`;
  ref.current?.injectJavaScript(js);
}

// Capability boundary (audit 2026-07-11 B1): the secure-store bridge is reachable by ANY
// script that ends up running in the WebView, so it must never be an arbitrary-Keychain
// read/write oracle — that would turn a single DOM-XSS into full session theft. Only the
// keys the proto legitimately owns are served: the supabase session (`sb-<ref>-auth-token`
// + its chunk suffixes) and the app's own `onstd-*` flags (biolock). Everything else is
// refused with an explicit error.
/** Every SECURE_SET write. Same option as src/lib/supabase/secureStorage.ts, the other writer of
 *  the session keys. keychainAccessible is iOS-only; Android ignores it. */
const SECURE_WRITE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

function secureKeyAllowed(key: unknown): key is string {
  return typeof key === 'string' && (key.startsWith('sb-') || key.startsWith('onstd-'));
}
function denySecureKey(ref: Ref, id: number): true {
  resolve(ref, id, null, 'secure-store key not allowed');
  return true;
}

const IMPACT: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};
const NOTIFY: Record<string, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

/** Handle one decoded bridge message. Returns true if it was a bridge message (vs app data). */
export async function handleBridgeMessage(ref: Ref, msg: BridgeMessage): Promise<boolean> {
  if ('__log' in msg) {
    // eslint-disable-next-line no-console
    console.log(`[proto:${msg.__log.level}]`, msg.__log.msg);
    return true;
  }
  switch (msg.type) {
    case 'HAPTIC': {
      const s = msg.style ?? 'light';
      try {
        if (s in NOTIFY) await Haptics.notificationAsync(NOTIFY[s]);
        else await Haptics.impactAsync(IMPACT[s] ?? Haptics.ImpactFeedbackStyle.Light);
      } catch {
        /* haptics unavailable (e.g. web) — ignore */
      }
      return true;
    }
    case 'SHARE': {
      try {
        const p = msg.payload ?? {};
        await Share.share({ title: p.title, message: p.message ?? '', url: p.url });
      } catch {
        /* user cancelled */
      }
      return true;
    }
    case 'SHARE_IMAGE': {
      // The proto renders a report card to a PNG data URL; write it to a temp cache file and open the
      // system share sheet. Accept ONLY base64 png/jpeg data URLs — never a remote/file path from the
      // page. Best-effort; a share failure (user cancel, no file) is swallowed.
      try {
        const url = msg.dataUrl ?? '';
        const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(url);
        if (!m) return true;
        const ext = m[1].startsWith('jp') ? 'jpg' : 'png';
        const path = `${FileSystem.cacheDirectory}onstandard-report-${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
        await Share.share({ url: path, message: msg.caption });
      } catch {
        /* user cancelled / share unavailable — ignore */
      }
      return true;
    }
    case 'WAKE_ALARMS':
      // Fire-and-reconcile: resolves with how many are actually armed, which is what the Profile
      // row needs to say "3 mornings set" rather than guessing.
      try {
        resolve(ref, msg.id, await syncWakeAlarms(msg.alarms ?? [], { complete: msg.complete === true }));
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'WAKE_ALARM_STATE':
      try {
        resolve(ref, msg.id, await wakeAlarmState({ ask: msg.ask === true }));
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'SECURE_GET':
      if (!secureKeyAllowed(msg.key)) return denySecureKey(ref, msg.id);
      try {
        resolve(ref, msg.id, await SecureStore.getItemAsync(msg.key));
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'SECURE_SET':
      if (!secureKeyAllowed(msg.key)) return denySecureKey(ref, msg.id);
      try {
        // AFTER_FIRST_UNLOCK, not the iOS default (WHEN_UNLOCKED): the proto writes the Supabase
        // session through here, and the walk-in check-in reads it from a background region wake
        // with the phone LOCKED. The default class is unreadable then, so the arrival RPC went out
        // anonymous and recorded nothing. The proto deletes each item before it writes it, and
        // expo-secure-store applies the class on ADD, so every refresh moves the session over.
        // Applies to every allowed key (sb-*, onstd-*): none needs WHEN_UNLOCKED; the one other
        // secret-ish item, onstd-biolock, is a flag read at launch in the foreground.
        await SecureStore.setItemAsync(msg.key, msg.value, SECURE_WRITE_OPTS);
        resolve(ref, msg.id, true);
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'SECURE_DELETE':
      if (!secureKeyAllowed(msg.key)) return denySecureKey(ref, msg.id);
      try {
        await SecureStore.deleteItemAsync(msg.key);
        resolve(ref, msg.id, true);
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'APPLE_AVAILABLE':
      resolve(ref, msg.id, isAppleAuthAvailable);
      return true;
    case 'APPLE_SIGNIN':
      try {
        resolve(ref, msg.id, await requestAppleIdentityToken());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'APPLE_CREDENTIAL':
      try {
        resolve(ref, msg.id, await requestAppleCredential());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'GOOGLE_AVAILABLE':
      resolve(ref, msg.id, isGoogleAuthAvailable);
      return true;
    case 'GOOGLE_SIGNIN':
      try {
        resolve(ref, msg.id, await requestGoogleIdToken());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'BIO_AVAILABLE':
      resolve(ref, msg.id, await biometricsUsable());
      return true;
    case 'OPEN_URL':
      // Stripe's hosted Checkout/Connect-onboarding pages, and any other external link, open in
      // the SYSTEM browser rather than navigating this WebView — the WebView has no navigation
      // interceptor, so a raw in-page redirect would strand the proto's own app shell. https-only:
      // never let injected/attacker-controlled content trigger an arbitrary custom-scheme launch.
      if (typeof msg.url === 'string' && /^https:\/\//i.test(msg.url)) {
        void Linking.openURL(msg.url).catch(() => undefined);
      }
      return true;
    case 'ROLLCALL_ACKED':
      /* The lock-screen card has to STOP when the answer came from inside the app.
         endLiveActivity has existed since the module was written and nothing ever called it, so an
         athlete who tapped "I'm up" in the app watched the Live Activity keep counting down at
         them until iOS timed it out. Fire-and-forget: the ack is already recorded server-side, and
         a device with no Live Activity (Android, older iOS, push-to-start never fired) no-ops. */
      //
      // Since 2026-09-23 the card is not simply ended: the server turns it to the answered card
      // ("You're up · 4th") through roll-call-ack's refresh route, and ends it at the close. It is
      // still ended HERE on an older binary, or when the refresh fails (an answer queued offline).
      try { await settleLiveCard(String(msg.instanceId || '')); } catch { /* best effort */ }
      // And the alarm for it must not ring. An answer queued offline at 5:58 followed by the 6:00
      // alarm for the same roll call is the one "why is it still going off" nobody forgives.
      try { cancelWakeAlarmFor(String(msg.instanceId || '')); } catch { /* best effort */ }
      return true;
    case 'ROLLCALL_DRAIN':
      try {
        resolve(ref, msg.id, await drainLiveActivityTaps());
      } catch (e) {
        resolve(ref, msg.id, 0, String((e as Error)?.message ?? e));
      }
      return true;
    case 'NOTIFY_SYNC':
      void syncExecNotifications(msg.plan ?? []);
      return true;
    case 'IAP_AVAILABLE':
      // Whether the consumer store paywall can transact. False until the founder installs
      // react-native-purchases + creates store products (src/lib/iap). The proto uses this
      // to keep the paywall honest — plan cards read "Available at launch", never a dead CTA.
      resolve(ref, msg.id, isIapAvailable);
      return true;
    case 'IAP_OFFERINGS':
      // The store's localized prices, free intro period and this account's trial eligibility, so
      // the paywall prints what Apple's sheet will charge (App Review pass 2026-09-23, G-R7). An
      // answer of { ok:false } is normal on a build without the store; the proto then falls back
      // to its catalog, which is exactly what it printed before this call existed.
      try {
        resolve(ref, msg.id, await getConsumerOfferings(String(msg.appUserId ?? '')));
      } catch (e) {
        resolve(ref, msg.id, { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) });
      }
      return true;
    case 'IAP_PURCHASE':
      // Present the store purchase sheet for a consumer product. On success RevenueCat's
      // webhook writes the `consumer` subscription row; the proto then re-pulls entitlement.
      try {
        resolve(ref, msg.id, await purchaseConsumer(String(msg.productId ?? ''), String(msg.appUserId ?? '')));
      } catch (e) {
        resolve(ref, msg.id, { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) });
      }
      return true;
    case 'IAP_RESTORE':
      try {
        resolve(ref, msg.id, await restoreConsumer(String(msg.appUserId ?? '')));
      } catch (e) {
        resolve(ref, msg.id, { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) });
      }
      return true;
    case 'HEALTH_AVAILABLE':
      // Whether Apple Health can be read on this build. TRUE since 2026-08-20 (ffd1526) on an iOS
      // binary that has the module compiled in; still false on Android, on iPad (no HealthKit
      // store), and on any binary built before #27 — an OTA reaches those, so every caller keeps
      // treating false as normal rather than as an error.
      resolve(ref, msg.id, isHealthAvailable);
      return true;
    case 'HEALTH_CONNECTED':
      try {
        resolve(ref, msg.id, await healthConnected());
      } catch (e) {
        resolve(ref, msg.id, false, String((e as Error)?.message ?? e));
      }
      return true;
    case 'HEALTH_CONNECT':
      // Request read permission for sleep / HRV / resting HR. Returns { connected, reason }.
      try {
        resolve(ref, msg.id, await connectHealth());
      } catch (e) {
        resolve(ref, msg.id, { connected: false, reason: 'error' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'HEALTH_READ':
      // Latest recovery sample ({ sleepHours?, hrvMs?, restingHr? }) or null. DISPLAY-only in v1 —
      // it never changes the recovery sub-score (self-report stays authoritative).
      try {
        resolve(ref, msg.id, await readRecoverySample());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'HEALTH_CONNECT_SCOPED':
      // Same permission request, told which scopes to ask for. Kept as a separate message rather
      // than a new field on HEALTH_CONNECT so an OTA update landing on an older binary — one that
      // has never heard of activity scopes — falls through to the default handler and reports
      // unavailable, instead of silently requesting recovery when activity was meant.
      try {
        const scopes = Array.isArray(msg.scopes) && msg.scopes.length
          ? (msg.scopes.filter((x) => x === 'recovery' || x === 'activity') as HealthScope[])
          : (['recovery'] as HealthScope[]);
        resolve(ref, msg.id, await connectHealth(scopes));
      } catch (e) {
        resolve(ref, msg.id, { connected: false, reason: 'error' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'HEALTH_READ_ACTIVITY':
      // Activity totals for a window, or NULL when they cannot be read. Never an empty sample —
      // see the note on readActivity: null means "we don't know" and 0 means "you did nothing",
      // and only the first is honest when a watch has not synced.
      try {
        resolve(ref, msg.id, await readActivity(String(msg.from ?? ''), String(msg.to ?? '')));
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'HEALTH_OBSERVE_ACTIVITY':
      try {
        resolve(ref, msg.id, await observeActivity());
      } catch (e) {
        resolve(ref, msg.id, false, String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_AVAILABLE':
      // False on any binary built without expo-location — an OTA update can land on such a build,
      // and the arrival affordance simply stays hidden rather than throwing.
      try {
        // `presence` (0208) is ABSENT on every binary built before region exits were reported,
        // which is exactly what makes it usable as a capability probe: the proto reads a missing
        // field as false and stops claiming a minimum-stay is enforced. Never widen this to a
        // truthy default.
        // `walkIn` false = the WALK_IN switch has walk-in off on this platform: the proto then
        // never offers "Always" and shows "I'm here" only.
        resolve(ref, msg.id, {
          available: isLocationAvailable(),
          state: await getPermissionState(),
          presence: REPORTS_PRESENCE,
          walkIn: walkInAllowed(),
        });
      } catch (e) {
        resolve(ref, msg.id, { available: false, state: 'unavailable', presence: false, walkIn: false }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_PERMISSION':
      // Foreground first, background only when the athlete has seen the explainer and asked for it.
      try {
        resolve(ref, msg.id, await requestPermission(!!msg.background));
      } catch (e) {
        resolve(ref, msg.id, 'unavailable', String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_ARM':
      // Register geofences for whatever is inside its window right now. `capped` is surfaced so
      // the UI can tell the athlete which commitments need a tap instead of leaving them
      // silently unverified (iOS caps an app at 20 monitored regions).
      try {
        resolve(ref, msg.id, await refreshGeofences());
      } catch (e) {
        resolve(ref, msg.id, { armed: 0, capped: 0, state: 'unavailable', walkIn: 'unavailable' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_DISARM':
      try {
        await disarmAll();
        resolve(ref, msg.id, true);
      } catch (e) {
        resolve(ref, msg.id, false, String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_SETTINGS':
      void Linking.openSettings().catch(() => undefined);
      return true;
    case 'LOCATION_CHECK':
      // The "I'm here" tap: one reading, sent natively to verify_arrival_at, which measures the
      // distance on the server. A NEGATIVE verdict is recorded as 'unverified' with "Not at
      // <place>", never as 'missed'. The proto gets { within, reason, distance_m } back.
      try {
        resolve(ref, msg.id, await checkArrival(String(msg.instanceId || '')));
      } catch (e) {
        resolve(ref, msg.id, { within: false, reason: 'Something went wrong', distance_m: null }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'MAP_PICK':
      // Errors ('map-unavailable', 'map-busy') still carry { place: null }, so a page that ignores
      // the error reads it exactly as a Cancel.
      try {
        resolve(ref, msg.id, { place: await requestMapPick(msg.initial) });
      } catch (e) {
        resolve(ref, msg.id, { place: null }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'DICTATION_AVAILABLE':
      // False on any binary built without expo-speech-recognition (an OTA can land on one), and
      // the proto keeps the mic hidden.
      try {
        resolve(ref, msg.id, await dictationStatus());
      } catch (e) {
        resolve(ref, msg.id, { available: false, onDevice: false, permission: 'undetermined' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'DICTATION_START':
      try {
        resolve(ref, msg.id, await startDictation((ev) => dictationEvent(ref, ev), { lang: msg.lang || undefined, sid: msg.sid || undefined }));
      } catch (e) {
        resolve(ref, msg.id, { ok: false, code: 'failed' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'DICTATION_STOP':
      stopDictation(msg.sid || undefined);
      return true;
    case 'DICTATION_ABORT':
      abortDictation(msg.sid || undefined);
      return true;
    case 'REVIEW_REQUEST': {
      /* Ask the OS to show its rating prompt. Resolves TRUE only when we actually asked.
       *
       * The kill switch is evaluated HERE, not in the proto, because that is where the flag cache
       * already lives (src/store/flagsStore) — the WebView has no flags channel, and adding one for
       * a single boolean would be more plumbing than the feature. The founder can stop all asking
       * with one column in feature_flags and no app update.
       *
       * Every unavailability is a quiet false, never an error: iOS reports the prompt unavailable in
       * TestFlight, Android below 5.0 has no in-app card, web has neither. Nothing in the app should
       * behave differently because the OS declined to show a modal.
       */
      try {
        if (!getFlag('store_review_enabled')) { resolve(ref, msg.id, false); return true; }
        const StoreReview = await import('expo-store-review');
        if (!(await StoreReview.isAvailableAsync())) { resolve(ref, msg.id, false); return true; }
        await StoreReview.requestReview();
        resolve(ref, msg.id, true);
      } catch (e) {
        resolve(ref, msg.id, false, String((e as Error)?.message ?? e));
      }
      return true;
    }
    case 'PUSH_TOKEN':
      // Expo push token for coach→athlete nudges (registered server-side by the proto via
      // register_device_token). Null when permission is denied / no EAS project / web.
      try {
        const token = await getPushToken(msg.ask === true);
        resolve(ref, msg.id, token ? { token, platform: Platform.OS } : null);
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'NOTIFY_PERMISSION':
      // Where notification permission stands; with `ask`, the system question first (a primer's
      // Continue). Resolves 'granted' | 'denied' | 'undetermined' | 'unsupported'.
      try {
        if (msg.ask === true) await ensureNotifyPermission(true);
        resolve(ref, msg.id, await notifyPermissionState());
      } catch (e) {
        resolve(ref, msg.id, 'unsupported', String((e as Error)?.message ?? e));
      }
      return true;
    default:
      return false;
  }
}

// Injected BEFORE any proto code (document-start). Sets up: a light haptic on every tap of an
// interactive element (the "native feel"), a promise-based secure-storage API for the
// supabase-js session adapter (Phase 3), and a native share route. Kept tiny and defensive.
export const BRIDGE_SHIM = `
(function(){
  var RN = window.ReactNativeWebView;
  if(!RN) return;
  function post(o){ try{ RN.postMessage(JSON.stringify(o)); }catch(e){} }

  // ---- request/response plumbing (native injects window.__onNativeResult) ----
  var seq = 0, pending = {};
  window.__onNativeResult = function(id, value, error){
    var p = pending[id]; if(!p) return; delete pending[id];
    if(error) p.reject(new Error(error)); else p.resolve(value);
  };
  function call(type, extra){
    return new Promise(function(resolve, reject){
      var id = ++seq; pending[id] = { resolve: resolve, reject: reject };
      post(Object.assign({ type: type, id: id }, extra));
    });
  }

  // ---- public native API for the proto/supabase to use ----
  window.OnStandardNative = {
    haptic: function(style){ post({ type:'HAPTIC', style: style || 'light' }); },
    share: function(payload){ post({ type:'SHARE', payload: payload || {} }); },
    shareImage: function(dataUrl, caption){ post({ type:'SHARE_IMAGE', dataUrl: String(dataUrl||''), caption: caption||'' }); },
    // The coach's wake-up alarm. The argument is the WHOLE set that should be armed; anything the
    // device has that is not in the list is cancelled, so one call is always enough.
    wakeAlarms: {
      sync: function(alarms, opts){ return call('WAKE_ALARMS', { alarms: alarms || [], complete: !!(opts && opts.complete) }); },
      state: function(opts){ return call('WAKE_ALARM_STATE', { ask: !!(opts && opts.ask) }); }
    },
    secureStore: {
      getItem: function(key){ return call('SECURE_GET', { key: key }); },
      setItem: function(key, value){ return call('SECURE_SET', { key: key, value: String(value) }); },
      removeItem: function(key){ return call('SECURE_DELETE', { key: key }); }
    },
    apple: {
      available: function(){ return call('APPLE_AVAILABLE', {}); },
      signIn: function(){ return call('APPLE_SIGNIN', {}); },
      credential: function(){ return call('APPLE_CREDENTIAL', {}); }
    },
    google: {
      available: function(){ return call('GOOGLE_AVAILABLE', {}); },
      signIn: function(){ return call('GOOGLE_SIGNIN', {}); }
    },
    biometrics: {
      available: function(){ return call('BIO_AVAILABLE', {}); }
    },
    notify: {
      sync: function(plan){ post({ type: 'NOTIFY_SYNC', plan: plan || [] }); },
      permission: function(ask){ return call('NOTIFY_PERMISSION', { ask: !!ask }); }
    },
    // Answered in the app: end the lock-screen card. Fire-and-forget, no answer expected.
    rollcall: {
      acked: function(instanceId){ post({ type: 'ROLLCALL_ACKED', instanceId: String(instanceId || '') }); },
      // Resolves to how many native taps landed on the server just now.
      drain: function(){ return call('ROLLCALL_DRAIN', {}); }
    },
    openUrl: function(url){ post({ type: 'OPEN_URL', url: String(url || '') }); },
    push: { token: function(opts){ return call('PUSH_TOKEN', { ask: !!(opts && opts.ask) }); } },
    // Resolves true only if a prompt was actually requested — never whether a review was left.
    review: { request: function(){ return call('REVIEW_REQUEST', {}); } },
    iap: {
      available: function(){ return call('IAP_AVAILABLE', {}); },
      offerings: function(appUserId){ return call('IAP_OFFERINGS', { appUserId: String(appUserId||'') }); },
      purchase: function(productId, appUserId){ return call('IAP_PURCHASE', { productId: String(productId||''), appUserId: String(appUserId||'') }); },
      restore: function(appUserId){ return call('IAP_RESTORE', { appUserId: String(appUserId||'') }); }
    },
    health: {
      available: function(){ return call('HEALTH_AVAILABLE', {}); },
      connected: function(){ return call('HEALTH_CONNECTED', {}); },
      connect: function(){ return call('HEALTH_CONNECT', {}); },
      read: function(){ return call('HEALTH_READ', {}); },
      connectScoped: function(scopes){ return call('HEALTH_CONNECT_SCOPED', { scopes: Array.isArray(scopes) ? scopes : [] }); },
      readActivity: function(from, to){ return call('HEALTH_READ_ACTIVITY', { from: String(from||''), to: String(to||'') }); },
      observeActivity: function(){ return call('HEALTH_OBSERVE_ACTIVITY', {}); }
    },
    // Verified Commitments. check() returns { within, reason, distance_m }: the verdict the server
    // computed from one reading. No coordinate crosses this boundary in either direction.
    location: {
      available: function(){ return call('LOCATION_AVAILABLE', {}); },
      request: function(background){ return call('LOCATION_PERMISSION', { background: !!background }); },
      arm: function(){ return call('LOCATION_ARM', {}); },
      disarm: function(){ return call('LOCATION_DISARM', {}); },
      check: function(instanceId){ return call('LOCATION_CHECK', { instanceId: String(instanceId||'') }); },
      settings: function(){ post({ type: 'LOCATION_SETTINGS' }); }
    },
    // The coach's map. pick({ lat, lng, radius_m, name }?) resolves the saved place
    // { name, address, lat, lng, radius_m }, or null when the coach cancels. Rejects only when no
    // map can open ('map-unavailable') or one is already open ('map-busy').
    // Dictation (composer upgrade, 2026-09-23). available() never prompts; start() does, the first
    // time. Words arrive at window.__onDictation({ sid, type:'text', text, final }) until
    // { sid, type:'end' }; the page drops any sid it has left.
    dictation: {
      available: function(){ return call('DICTATION_AVAILABLE', {}); },
      start: function(lang, sid){ return call('DICTATION_START', { lang: String(lang || ''), sid: String(sid || '') }); },
      stop: function(sid){ post({ type: 'DICTATION_STOP', sid: String(sid || '') }); },
      abort: function(sid){ post({ type: 'DICTATION_ABORT', sid: String(sid || '') }); }
    },
    maps: {
      pick: function(initial){
        return call('MAP_PICK', initial && typeof initial === 'object' ? { initial: initial } : {})
          .then(function(r){ return r && r.place ? r.place : null; });
      }
    },
  };

  // navigator.vibrate does not exist in WKWebView. It is a NO-OP here rather than a haptic: the
  // capture-phase listener below is the single source of tap feedback, and routing vibrate()
  // there too meant every [data-go]/[data-act] tap fired TWO light impacts. A doubled light
  // impact reads as one heavier, mushier buzz — which is why a genuine 'success' notification
  // could never feel different from an ordinary tap. The proto's own buzz() calls stay and
  // become inert under the shell; on web there is no ReactNativeWebView, this shim never
  // installs, and the real navigator.vibrate still fires exactly once.
  navigator.vibrate = function(){ return true; };
  try { navigator.share = function(data){ window.OnStandardNative.share({ title:data&&data.title, message:data&&data.text, url:data&&data.url }); return Promise.resolve(); }; } catch(e){}

  // Light haptic on every real interaction (the proto delegates via [data-go]/[data-act]).
  //
  // ON POINTERDOWN, NOT CLICK (2026-09-21). This listened for 'click', which on iOS fires when
  // the finger LIFTS. So the app buzzed on release: you pressed a button, nothing happened, and
  // the confirmation arrived after you had already let go. That is the wrong half of the
  // gesture, and it is most of why taps felt unresponsive no matter what the CSS did.
  //
  // A second thing falls out of this for free. WKWebView only applies :active reliably once a
  // touch listener exists on the document; with the old click-phase listener it did not, so even
  // the handful of controls that HAD a pressed style could fail to paint it. Listening here fixes
  // the visual press and the haptic in one move.
  //
  // KNOWN COST, accepted: a finger that lands on a row and then drags to scroll gets one light
  // tick it did not ask for. Judged the better trade than every button in the app answering late.
  // If that reads badly on device, the fix is a short move threshold here, not a return to click.
  document.addEventListener('pointerdown', function(e){
    var t = e.target && e.target.closest && e.target.closest('[data-go],[data-act],button,a,[role=button],.tab,.chip');
    if(t) window.OnStandardNative.haptic('light');
  }, true);
})();
true;
`;
