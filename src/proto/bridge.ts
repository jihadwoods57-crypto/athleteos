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
import { isAppleAuthAvailable, requestAppleIdentityToken } from '../lib/auth/apple';
import { isGoogleAuthAvailable, requestGoogleIdToken } from '../lib/auth/google';
import { biometricsUsable } from '../lib/auth/biometrics';
import { isIapAvailable, purchaseConsumer, restoreConsumer } from '../lib/iap';
import { isHealthAvailable, healthConnected, connectHealth, readRecoverySample } from '../lib/health';
import {
  isLocationAvailable, getPermissionState, requestPermission,
  refreshGeofences, disarmAll, checkArrival, reportArrival, capturePlace,
} from '../lib/location';
import { syncExecNotifications } from '../lib/notify/execSync';
import { getPushToken } from '../lib/notify';

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
  | { type: 'GOOGLE_AVAILABLE'; id: number }
  | { type: 'GOOGLE_SIGNIN'; id: number }
  | { type: 'BIO_AVAILABLE'; id: number }
  | { type: 'NOTIFY_SYNC'; plan: import('../lib/notify/execSync').ExecPlanItem[] }
  | { type: 'PUSH_TOKEN'; id: number }
  | { type: 'OPEN_URL'; url?: string }
  | { type: 'IAP_AVAILABLE'; id: number }
  | { type: 'IAP_PURCHASE'; id: number; productId?: string; appUserId?: string }
  | { type: 'IAP_RESTORE'; id: number; appUserId?: string }
  | { type: 'HEALTH_AVAILABLE'; id: number }
  | { type: 'HEALTH_CONNECTED'; id: number }
  | { type: 'HEALTH_CONNECT'; id: number }
  | { type: 'HEALTH_READ'; id: number }
  // Verified Commitments (0139). Note what is absent: no message carries a coordinate in either
  // direction. LOCATION_CHECK returns a boolean — the comparison to the coach's circle happens in
  // src/lib/location and the position is discarded there.
  | { type: 'LOCATION_AVAILABLE'; id: number }
  | { type: 'LOCATION_PERMISSION'; id: number; background?: boolean }
  | { type: 'LOCATION_ARM'; id: number }
  | { type: 'LOCATION_DISARM'; id: number }
  | { type: 'LOCATION_CHECK'; id: number; instanceId?: string; report?: boolean }
  // The ONE place a coordinate legitimately crosses this bridge: a COACH standing at their own
  // facility, deliberately capturing it as a scheduled place. That is the coach recording a
  // location they chose, not the app observing where a person goes — the opposite of what the
  // athlete-side messages above are careful never to do.
  | { type: 'LOCATION_PLACE'; id: number }
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
        await SecureStore.setItemAsync(msg.key, msg.value);
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
    case 'NOTIFY_SYNC':
      void syncExecNotifications(msg.plan ?? []);
      return true;
    case 'IAP_AVAILABLE':
      // Whether the consumer store paywall can transact. False until the founder installs
      // react-native-purchases + creates store products (src/lib/iap). The proto uses this
      // to keep the paywall honest — plan cards read "Available at launch", never a dead CTA.
      resolve(ref, msg.id, isIapAvailable);
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
      // Whether Apple Health / Health Connect can be read on this build. False until the founder
      // wires the native module (src/lib/health) — the #devices connect affordance stays hidden.
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
    case 'LOCATION_AVAILABLE':
      // False on any binary built before slice 2 shipped — an OTA update can land on such a build,
      // and the arrival affordance simply stays hidden rather than throwing.
      try {
        resolve(ref, msg.id, { available: isLocationAvailable(), state: await getPermissionState() });
      } catch (e) {
        resolve(ref, msg.id, { available: false, state: 'unavailable' }, String((e as Error)?.message ?? e));
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
        resolve(ref, msg.id, { armed: 0, capped: 0, state: 'unavailable' }, String((e as Error)?.message ?? e));
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
    case 'LOCATION_CHECK':
      // The "I'm here" tap: one fix, compared natively, boolean out. When `report` is set the
      // verdict is written straight to verify_arrival — including a NEGATIVE verdict, which the
      // RPC records as 'unverified' with a reason and never as 'missed'.
      try {
        const id = String(msg.instanceId || '');
        const out = await checkArrival(id);
        if (msg.report !== false && id) await reportArrival(id, 'manual', out.within, out.reason);
        resolve(ref, msg.id, out);
      } catch (e) {
        resolve(ref, msg.id, { within: false, reason: 'Something went wrong' }, String((e as Error)?.message ?? e));
      }
      return true;
    case 'LOCATION_PLACE':
      // "Use where I'm standing" in the coach's composer. Foreground permission only — capturing
      // a facility is a one-shot action the coach initiated, and needs nothing in the background.
      try {
        resolve(ref, msg.id, await capturePlace());
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
      }
      return true;
    case 'PUSH_TOKEN':
      // Expo push token for coach→athlete nudges (registered server-side by the proto via
      // register_device_token). Null when permission is denied / no EAS project / web.
      try {
        const token = await getPushToken();
        resolve(ref, msg.id, token ? { token, platform: Platform.OS } : null);
      } catch (e) {
        resolve(ref, msg.id, null, String((e as Error)?.message ?? e));
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
    secureStore: {
      getItem: function(key){ return call('SECURE_GET', { key: key }); },
      setItem: function(key, value){ return call('SECURE_SET', { key: key, value: String(value) }); },
      removeItem: function(key){ return call('SECURE_DELETE', { key: key }); }
    },
    apple: {
      available: function(){ return call('APPLE_AVAILABLE', {}); },
      signIn: function(){ return call('APPLE_SIGNIN', {}); }
    },
    google: {
      available: function(){ return call('GOOGLE_AVAILABLE', {}); },
      signIn: function(){ return call('GOOGLE_SIGNIN', {}); }
    },
    biometrics: {
      available: function(){ return call('BIO_AVAILABLE', {}); }
    },
    notify: { sync: function(plan){ post({ type: 'NOTIFY_SYNC', plan: plan || [] }); } },
    openUrl: function(url){ post({ type: 'OPEN_URL', url: String(url || '') }); },
    push: { token: function(){ return call('PUSH_TOKEN', {}); } },
    iap: {
      available: function(){ return call('IAP_AVAILABLE', {}); },
      purchase: function(productId, appUserId){ return call('IAP_PURCHASE', { productId: String(productId||''), appUserId: String(appUserId||'') }); },
      restore: function(appUserId){ return call('IAP_RESTORE', { appUserId: String(appUserId||'') }); }
    },
    health: {
      available: function(){ return call('HEALTH_AVAILABLE', {}); },
      connected: function(){ return call('HEALTH_CONNECTED', {}); },
      connect: function(){ return call('HEALTH_CONNECT', {}); },
      read: function(){ return call('HEALTH_READ', {}); }
    },
    // Verified Commitments. check() returns { within, reason } — a boolean and a sentence.
    // No coordinate crosses this boundary in either direction, by construction.
    location: {
      available: function(){ return call('LOCATION_AVAILABLE', {}); },
      request: function(background){ return call('LOCATION_PERMISSION', { background: !!background }); },
      arm: function(){ return call('LOCATION_ARM', {}); },
      disarm: function(){ return call('LOCATION_DISARM', {}); },
      check: function(instanceId, report){ return call('LOCATION_CHECK', { instanceId: String(instanceId||''), report: report !== false }); },
      // Coach-only: capture the facility they're standing in as a scheduled place.
      place: function(){ return call('LOCATION_PLACE', {}); }
    },
  };

  // navigator.vibrate does not exist in WKWebView; route it (and navigator.share) to native.
  navigator.vibrate = function(){ window.OnStandardNative.haptic('light'); return true; };
  try { navigator.share = function(data){ window.OnStandardNative.share({ title:data&&data.title, message:data&&data.text, url:data&&data.url }); return Promise.resolve(); }; } catch(e){}

  // Light haptic on every real interaction (the proto delegates via [data-go]/[data-act]).
  document.addEventListener('click', function(e){
    var t = e.target && e.target.closest && e.target.closest('[data-go],[data-act],button,a,[role=button],.tab,.chip');
    if(t) window.OnStandardNative.haptic('light');
  }, true);
})();
true;
`;
