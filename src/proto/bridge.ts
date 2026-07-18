// Phase 2 — the native bridge between the proto (running in the WebView) and iOS.
//
// The proto posts typed messages over window.ReactNativeWebView.postMessage; native handles
// the device-only capabilities and, for request/response calls (secure storage), injects the
// result back by callback id. These native capabilities (haptics, share, secure Keychain,
// push) are also the concrete "real native app" signals that clear Apple guideline 4.2.
//
// Injection is JSON-escaped (incl. U+2028/U+2029, which are valid JSON but break a JS string
// literal) so a value can never break out of the injected call.
import { Platform, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import type WebView from 'react-native-webview';
import { isAppleAuthAvailable, requestAppleIdentityToken } from '../lib/auth/apple';
import { isGoogleAuthAvailable, requestGoogleIdToken } from '../lib/auth/google';
import { biometricsUsable } from '../lib/auth/biometrics';
import { syncExecNotifications } from '../lib/notify/execSync';
import { getPushToken } from '../lib/notify';

type Ref = React.RefObject<WebView | null>;

export type BridgeMessage =
  | { type: 'HAPTIC'; style?: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' }
  | { type: 'SHARE'; payload?: { title?: string; message?: string; url?: string } }
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
    case 'NOTIFY_SYNC':
      void syncExecNotifications(msg.plan ?? []);
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
    push: { token: function(){ return call('PUSH_TOKEN', {}); } },
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
