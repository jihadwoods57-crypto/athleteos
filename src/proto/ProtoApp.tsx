// Phase 1 shell: renders the real :8124 proto full-screen in a WebView from local files.
// Pixel-perfect by construction (it IS the proto's HTML/CSS). Native bridges (camera, push,
// haptics, secure store, auth) layer on in later phases via the postMessage router.
import React from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { ensureProtoExtracted, PROTO_ROOT_DIR } from './protoBundle';
import { BRIDGE_SHIM, handleBridgeMessage, type BridgeMessage } from './bridge';
import { authenticateBiometric } from '../lib/auth/biometrics';
import { parseInviteCode } from '../lib/inviteLink';
import { registerGeofenceTask } from '../lib/location';
import { postRollCallAck, queueAck, drainAckQueue, ensureRollCallCategories, rememberRollCallLabel } from '../lib/notify/rollcall';

const BG = '#080B0A';

// Runs BEFORE any proto code: forwards errors to native so device issues are diagnosable (not a
// silent blank screen). The native bridge shim (haptics/share/secure store) is appended right after
// so both are live at document-start, before the proto's modules run.
// Crash capture (error/unhandledrejection) runs in ALL builds. The broad console.log/warn/error
// forwarder runs ONLY in __DEV__ — in release it would echo arbitrary app strings into device logs
// (Console.app / logcat), a latent PII channel. (stress-test R3)
const CONSOLE_BRIDGE = `
(function(){
  function send(o){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
  ${__DEV__ ? `['log','warn','error'].forEach(function(l){ var orig=console[l]; console[l]=function(){ send({__log:{level:l,msg:Array.prototype.map.call(arguments,String).join(' ')}}); try{orig.apply(console,arguments);}catch(e){} }; });` : ''}
  window.addEventListener('error', function(e){ send({__log:{level:'error',msg:(e.error&&e.error.stack)||e.message||'error'}}); });
  window.addEventListener('unhandledrejection', function(e){ send({__log:{level:'error',msg:'unhandled: '+((e.reason&&e.reason.stack)||e.reason)}}); });
})();
true;
`;
// Inject the Supabase config from the app's environment (Metro inlines EXPO_PUBLIC_* at build)
// so production is the source of truth. If absent, the proto's index.html fallback provides it.
// Only overrides when BOTH are present, so we never blank out the fallback with empty strings.
const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_CONFIG =
  SB_URL && SB_KEY
    ? `window.__SUPABASE = { url: ${JSON.stringify(SB_URL)}, anonKey: ${JSON.stringify(SB_KEY)} }; true;`
    : `true;`;

// Analytics sink — INERT until the founder deploys analytics-ingest and sets this env var. Absent
// → the proto buffers events locally and never sends (guardrail: no external send until wired).
const ANALYTICS_URL = process.env.EXPO_PUBLIC_ANALYTICS_URL;
const ANALYTICS_CONFIG = ANALYTICS_URL
  ? `window.__ANALYTICS_SINK = { url: ${JSON.stringify(ANALYTICS_URL)} }; true;`
  : `true;`;

const PRELUDE = SUPABASE_CONFIG + ANALYTICS_CONFIG + CONSOLE_BRIDGE + BRIDGE_SHIM;

function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function ProtoApp() {
  const [uri, setUri] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [locked, setLocked] = React.useState<boolean | null>(null);
  const webviewRef = React.useRef<WebView>(null);

  const tryUnlock = React.useCallback(async () => {
    try {
      const flag = await SecureStore.getItemAsync('onstd-biolock');
      if (flag !== '1') { setLocked(false); return; }
      setLocked(!(await authenticateBiometric()));
    } catch {
      setLocked(false); // fail-open: never brick the app on a storage error
    }
  }, []);

  React.useEffect(() => { void tryUnlock(); }, [tryUnlock]);

  React.useEffect(() => {
    let alive = true;
    ensureProtoExtracted()
      .then((u) => alive && setUri(u))
      .catch((e) => alive && setErr(String((e && e.message) || e)));
    return () => {
      alive = false;
    };
  }, []);

  const onMessage = React.useCallback((e: WebViewMessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as BridgeMessage;
    } catch {
      return;
    }
    // Android hardware back at a role root: the proto asked us to let the OS take it (exit).
    if ((msg as { type?: string }).type === 'BACK_EXIT') {
      BackHandler.exitApp();
      return;
    }
    // Native bridge: haptics, share, secure-store (Phase 2); camera/meal loop lands here later.
    void handleBridgeMessage(webviewRef, msg);
  }, []);

  // Invite deep links (onstandard://join?code=X / https://onstandard.app/join?code=X): route
  // the WebView to #connect/<code> so the Connect screen opens with the code prefilled —
  // the coach's shared link becomes a one-tap join. Links that arrive before the WebView
  // finishes loading are held and flushed on load; a signed-out user lands on Welcome (the
  // router's auth gate) and can enter the code after signing in.
  const pendingCode = React.useRef<string | null>(null);
  const webLoaded = React.useRef(false);
  const deliverCode = React.useCallback((code: string | null) => {
    if (!code) return;
    if (!webLoaded.current || !webviewRef.current) {
      pendingCode.current = code;
      return;
    }
    // parseInviteCode guarantees [A-Z0-9]+ — safe to embed in the injected string.
    webviewRef.current.injectJavaScript(`location.hash = '#connect/${code}'; true;`);
  }, []);
  React.useEffect(() => {
    Linking.getInitialURL()
      .then((url) => deliverCode(url ? parseInviteCode(url) : null))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => deliverCode(parseInviteCode(url)));
    return () => sub.remove();
  }, [deliverCode]);

  // Verified Commitments (0139): define the geofence task at startup so a region crossing can wake
  // the app and record the arrival even when the WebView isn't alive — which is the whole point,
  // since the athlete this feature serves is the one who hasn't opened the app at 5:43 AM.
  // No-ops on a binary without expo-location, and registers nothing with the OS by itself:
  // regions are only armed once the athlete grants background permission (LOCATION_ARM).
  React.useEffect(() => { registerGeofenceTask(); }, []);

  // Reminder deep links: an exec reminder ("Dinner closes in 45") carries its in-app route in
  // notification data — tapping it must land the WebView on that exact screen, not Home. The
  // route strings are authored by our own exec engine, but validate the shape anyway before
  // injecting. Held-and-flushed on load exactly like invite codes (cold-start taps included).
  const pendingRoute = React.useRef<string | null>(null);
  const deliverRoute = React.useCallback((route: unknown) => {
    if (typeof route !== 'string' || !/^[a-z0-9/_-]{1,64}$/i.test(route)) return;
    if (!webLoaded.current || !webviewRef.current) {
      pendingRoute.current = route;
      return;
    }
    webviewRef.current.injectJavaScript(`location.hash = '#${route}'; true;`);
  }, []);
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    // Lazy require so web/test environments never load the native notifications module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    // A notification response is either a lock-screen "I'm Up" quick action (actionIdentifier
    // 'ACK') or a plain tap that should route into the WebView. Handle both from one place so the
    // cold-start path and the live listener behave identically. ACK records the roll call without
    // opening the app and MUST return before deliverRoute, so an ack never doubles as a deep link.
    const handleResponse = (resp: unknown): void => {
      const r = resp as
        | { actionIdentifier?: string; notification?: { request?: { content?: { data?: { route?: unknown; code?: unknown; action_label?: unknown } } } } }
        | null
        | undefined;
      const data = r?.notification?.request?.content?.data;
      // A roll-call push (tapped or ACK'd) carries a code — remember its label so the custom "I'm Up"
      // button is registered for the next launch, even if the app is later killed. Best-effort.
      if (typeof data?.code === 'string' && data.code) {
        void rememberRollCallLabel(typeof data?.action_label === 'string' ? data.action_label : null);
      }
      if (r?.actionIdentifier === 'ACK' && typeof data?.code === 'string' && data.code) {
        const code = data.code;
        // Best-effort: record now, queue for a foreground/reconnect retry if the network isn't there.
        postRollCallAck(code).then((ok) => { if (!ok) return queueAck(code); }).catch(() => {});
        return; // do not also route into the WebView
      }
      deliverRoute(data?.route);
    };
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => handleResponse(resp))
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => handleResponse(resp));
    return () => sub.remove();
  }, [deliverRoute]);

  // Drain any offline "I'm Up" acks that were queued while the phone was offline — a lock-screen
  // tap in a dead zone still lands the moment the athlete opens the app on connectivity. Native only.
  // Also (re-)register the roll-call notification categories at startup so a pushed roll call shows
  // its "I'm Up" action button — iOS only surfaces action buttons for categories registered on a
  // prior launch, so this must run every startup, not just on first push.
  React.useEffect(() => {
    if (Platform.OS !== 'web') {
      void drainAckQueue();
      void ensureRollCallCategories();
    }
  }, []);

  const onWebLoadEnd = React.useCallback(() => {
    webLoaded.current = true;
    const code = pendingCode.current;
    pendingCode.current = null;
    deliverCode(code);
    const route = pendingRoute.current;
    pendingRoute.current = null;
    deliverRoute(route);
  }, [deliverCode, deliverRoute]);

  // Android hardware back: pop the proto's in-app hash stack instead of exiting the app from
  // any depth. Role roots (and auth screens) are the only places back may exit — the injected
  // check posts BACK_EXIT for those, which the onMessage handler above turns into exitApp().
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const ref = webviewRef.current;
      if (!ref) return false; // no WebView yet — let the OS handle it
      ref.injectJavaScript(`(function(){
        var r = (location.hash || '#').slice(1).split('/')[0];
        var roots = ['', 'welcome', 'signin', 'home', 'coach', 'trainer', 'parent'];
        if (roots.indexOf(r) === -1 && window.history.length > 1) { history.back(); }
        else if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'BACK_EXIT' })); }
      })(); true;`);
      return true; // consumed — exit only happens via the explicit BACK_EXIT round-trip
    });
    return () => sub.remove();
  }, []);

  if (locked === null) {
    return (
      <Center>
        <ActivityIndicator color="#37D586" />
      </Center>
    );
  }
  if (locked) {
    return (
      <Center>
        <Text style={styles.errTitle}>OnStandard is locked</Text>
        <Text style={styles.errBody} onPress={() => void tryUnlock()}>
          Tap to unlock with Face ID
        </Text>
      </Center>
    );
  }
  if (err) {
    return (
      <Center>
        <Text style={styles.errTitle}>Couldn&apos;t load the app</Text>
        <Text style={styles.errBody}>{err}</Text>
      </Center>
    );
  }
  if (!uri) {
    return (
      <Center>
        <ActivityIndicator color="#37D586" />
      </Center>
    );
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ uri }}
      style={styles.web}
      containerStyle={styles.web}
      originWhitelist={['*']}
      // iOS: sibling-file read (js/css/assets next to index.html) comes SOLELY from
      // allowingReadAccessToURL pointing at the proto ROOT dir; allowFileAccess is Android-only.
      // allowUniversalAccessFromFileURLs is load-bearing — it bypasses the null-origin CORS block
      // on the proto's ES-module imports. Do NOT remove these two.
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      allowingReadAccessToURL={PROTO_ROOT_DIR}
      allowsBackForwardNavigationGestures={false}
      injectedJavaScriptBeforeContentLoaded={PRELUDE}
      onMessage={onMessage}
      onLoadEnd={onWebLoadEnd}
      onError={(e) => setErr(`WebView error: ${e.nativeEvent.description}`)}
      onRenderProcessGone={() => setErr('WebView crashed (render process gone)')}
      javaScriptEnabled
      domStorageEnabled
      // Live camera viewfinder (getUserMedia inside the WebView). mediaCapturePermissionGrantType
      // 'grant' forwards the OS-level camera permission (NSCameraUsageDescription / CAMERA) to the
      // page without a second in-page prompt, on both WKWebView (iOS 15+) and Android's
      // onPermissionRequest. allowsInlineMediaPlayback keeps the <video> element inline on iOS
      // (without it the stream tries to go fullscreen). If getUserMedia is still unavailable on a
      // device (e.g. older iOS refusing file:// origins), camera.js silently falls back to the
      // native <input type=file capture> path — never a dead shutter.
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      bounces={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
      // Keep the native side transparent-dark so there is no white flash before first paint.
      // (The proto paints its own dark ground immediately.)
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 24 },
  errTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  errBody: { color: '#93A69C', fontSize: 13, textAlign: 'center' },
});
