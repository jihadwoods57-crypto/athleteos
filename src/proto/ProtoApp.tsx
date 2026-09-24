// Phase 1 shell: renders the real :8124 proto full-screen in a WebView from local files.
// Pixel-perfect by construction (it IS the proto's HTML/CSS). Native bridges (camera, push,
// haptics, secure store, auth) layer on in later phases via the postMessage router.
import React from 'react';
import { ActivityIndicator, BackHandler, Dimensions, Keyboard, Linking, Platform, StyleSheet, Text, View, AppState } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { ensureProtoExtracted, PROTO_ROOT_DIR } from './protoBundle';
import { PROTO_VERSION } from './protoVersion';
import { BRIDGE_SHIM, handleBridgeMessage, type BridgeMessage } from './bridge';
import { nativeCapsScript } from './nativeCaps';
import { keyboardOverlap } from './keyboardOverlap';
import { abortDictation } from '../lib/voice/nativeSpeech';
import { authenticateBiometric } from '../lib/auth/biometrics';
import { parseInviteCode } from '../lib/inviteLink';
import { rollCallRouteFromUrl } from '../lib/rollCallLink';
import { runRollCallAck, drainAckQueue, ensureRollCallCategories, rememberRollCallLabel, registerCoachDigestCategory, runCoachAction, drainCoachQueue, registerRollCallBackgroundTask, ensureLiveActivityTokens, drainLiveActivityTaps, takeBoardRoute } from '../lib/notify/rollcall';
import { routeNotificationResponse } from '../core/rollcall';
import { installForegroundNotificationHandler } from '../lib/notify/foreground';
import { registerGeofenceTask } from '../lib/location';
import { PlacePicker } from '../lib/maps/placePicker';
import { setMapPresenter, type PickInitial, type Place } from '../lib/maps/pickRequest';
import { releaseSplash } from './launchSplash';

// A notification that arrives while the app is OPEN is shown only if a handler says so, and this
// app had none — so every push and reminder that landed while someone was looking at the screen
// was swallowed in silence. Registered here, at module scope, because it has to be in place
// before the first notification can arrive, which is earlier than any effect runs.
installForegroundNotificationHandler();

// Verified Commitments (0139, restored 2026-09-23): define the geofence task at MODULE scope, as
// TaskManager requires, so a region crossing can launch the app in the background and record the
// arrival even when the WebView isn't alive — which is the whole point, since the athlete this
// feature serves is the one who hasn't opened the app at 5:43 AM. No-ops on a binary without
// expo-location, and registers nothing with the OS by itself: regions are only armed once the
// athlete grants background permission (LOCATION_ARM).
registerGeofenceTask();

// The app canvas, exactly: --bg in the proto's tokens.css, and the splash backgroundColor in
// app.json. All three have to be the SAME value or launch shows a hue step — this was #080B0A, a
// green-tinted near-black, behind a navy-tinted app. Same for the spinner: --green is #34D399, and
// #37D586 was a fourth green nobody chose.
const BG = '#070B14';
const BRAND_GREEN = '#34D399';

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

/* Build identity for the WebView. A bug report cannot ask a person which build they are on, so the
   feedback screen attaches it — but only if it is here to attach. Both are compile-time constants
   (no device identifiers), which is what keeps them safe to put in a body a human will read. */
const BUILD_CONFIG =
  `window.__APP_VERSION = ${JSON.stringify(Constants.expoConfig?.version ?? 'dev')};` +
  `window.__PROTO_VERSION = ${JSON.stringify(PROTO_VERSION)};` +
  `window.__PLATFORM = ${JSON.stringify(Platform.OS)}; true;`;

// What this binary can do (location, walk-in, the coach's map), read from the NATIVE side so an
// OTA landing on an older build reports false instead of offering controls that cannot work
// (nativeCaps.ts, final review I-1/I-2). Computed once: a binary's modules never change at runtime.
const CAPS_CONFIG = (() => { try { return nativeCapsScript(); } catch { return 'true;'; } })();

const PRELUDE = SUPABASE_CONFIG + ANALYTICS_CONFIG + BUILD_CONFIG + CAPS_CONFIG + CONSOLE_BRIDGE + BRIDGE_SHIM;

function Center({ children }: { children: React.ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function ProtoApp() {
  const [uri, setUri] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [locked, setLocked] = React.useState<boolean | null>(null);
  const webviewRef = React.useRef<WebView>(null);

  // The coach's map (MAP_PICK). The bridge has no React state, so this component registers the
  // presenter it calls: a pending pick is rendered as the full-screen PlacePicker, and whatever the
  // coach does (Save or Cancel) settles the page's promise. pickRequest allows one at a time.
  const [mapPick, setMapPick] = React.useState<{ initial: PickInitial | null } | null>(null);
  const mapPickOpen = React.useRef(false);
  mapPickOpen.current = !!mapPick;
  const mapPickResolve = React.useRef<((p: Place | null) => void) | null>(null);
  React.useEffect(() => {
    setMapPresenter((initial) => new Promise<Place | null>((res) => {
      mapPickResolve.current = res;
      setMapPick({ initial });
    }));
    return () => {
      setMapPresenter(null);
      mapPickResolve.current?.(null);
      mapPickResolve.current = null;
    };
  }, []);
  const finishMapPick = React.useCallback((place: Place | null) => {
    const res = mapPickResolve.current;
    mapPickResolve.current = null;
    setMapPick(null);
    res?.(place);
  }, []);
  // The WebView died (load error, render process gone): nobody is left to receive a place, and the
  // picker is not rendered on the error screen, so settle the page's promise as a Cancel.
  React.useEffect(() => { if (err) finishMapPick(null); }, [err, finishMapPick]);

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

  // The splash (held in app/_layout.tsx, whose hold also starts the ceiling) goes when the proto
  // posts PAINTED, and on every path that will never paint the proto: the lock screen, an error.
  React.useEffect(() => { if (locked || err) releaseSplash(); }, [locked, err]);

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
    // The proto's first finished frame (router.js painted()): the splash fades straight into it.
    if ((msg as { type?: string }).type === 'PAINTED') {
      releaseSplash();
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
      const r = resp as { notification?: { request?: { content?: { data?: { code?: unknown; action_label?: unknown } } } } } | null | undefined;
      const data = r?.notification?.request?.content?.data;
      // A roll-call push (tapped or ACK'd) carries a code: remember its label so the custom button
      // is registered for the next launch, even if the app is later killed. Best-effort.
      if (typeof data?.code === 'string' && data.code) {
        void rememberRollCallLabel(typeof data?.action_label === 'string' ? data.action_label : null);
      }
      // One pure router for the live listener, the cold-start replay and (on Android) the
      // background task: an ACTION records and returns, a TAP routes. An action never opens the
      // WebView; that is the whole point of the lock-screen button.
      const intent = routeNotificationResponse(resp);
      if (!intent) return;
      if (intent.kind === 'ack') { runRollCallAck(intent.code).catch(() => {}); return; }
      if (intent.kind === 'coach') { void runCoachAction(intent.code, intent.action); return; }
      deliverRoute(intent.route);
    };
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => handleResponse(resp))
      .catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => handleResponse(resp));
    return () => sub.remove();
  }, [deliverRoute]);

  // The lock-screen widget's body tap (onstandard://roll-call/<id>, OnStandardWidget.swift) opens
  // that morning's team board. Cold start via getInitialURL, warm via the url event; deliverRoute
  // holds it until the WebView has loaded. Any other URL maps to null and is left to the invite
  // handler above.
  React.useEffect(() => {
    Linking.getInitialURL()
      .then((url) => { const r = rollCallRouteFromUrl(url); if (r) deliverRoute(r); })
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => {
      const r = rollCallRouteFromUrl(url);
      if (r) deliverRoute(r);
    });
    return () => sub.remove();
  }, [deliverRoute]);

  // Drain the taps the lock screen and the alarm recorded, then follow the one that asked to open
  // the app: the alarm's own button (the coach's words) checks in AND lands on the team board for
  // that morning. Stop and the lock-screen card check in without opening anything, so their taps
  // route nowhere. The board screen is the proto's (#rollcall-board/<instanceId>); deliverRoute
  // holds the route until the WebView has loaded, so a cold start from the alarm still lands.
  const drainTaps = React.useCallback(() => {
    void drainLiveActivityTaps().then(() => {
      const route = takeBoardRoute();
      if (route) deliverRoute(route);
    }, () => undefined);
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
      // The coach's digest category is static, so unlike the athlete's it needs no remembered
      // labels — but it has the same prior-launch requirement, so it registers on every startup.
      void registerCoachDigestCategory();
      void drainCoachQueue();
      // Android: the action pressed on a killed app runs the background task, not this listener.
      void registerRollCallBackgroundTask();
      // iOS: start watching ActivityKit's token streams so the server can put the roll-call card
      // on this phone's lock screen, and collect any tap made on that card while the app was not
      // running. Both no-op on Android and in binaries built before the native module existed.
      ensureLiveActivityTokens();
      drainTaps();
    }
  }, [drainTaps]);

  // The alarm's own button records into the native pending store, and until now that store was
  // read ONCE, at launch. An athlete who answered on the alarm banner while OnStandard was already
  // open, or who came back to a warm app after answering on the lock screen, had a tap that sat
  // unposted until the next cold start, and the roll call read as unanswered the whole time. Two
  // beats close that: every return to the foreground, and (on binaries that emit it) the moment
  // the intent itself runs. Both drain into the same queue, so a double drain is a no-op.
  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    const onState = (st: string) => {
      if (st !== 'active') return;
      drainTaps();
      void drainAckQueue();
    };
    const sub = AppState.addEventListener('change', onState);
    let off: () => void = () => {};
    try {
      const live = require('../../modules/rollcall-live') as typeof import('../../modules/rollcall-live');
      off = live.onPendingTap(() => { drainTaps(); });
    } catch { /* older binary: the foreground beat covers it */ }
    return () => { sub.remove(); off(); };
  }, [drainTaps]);

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

  // The keyboard, told to the page BEFORE it moves (composer upgrade, 2026-09-23). iOS announces
  // the keys with their final frame and the animation's duration; the proto (js/keyboard.js)
  // otherwise only learns the height from a visualViewport resize once the keys have arrived, so the
  // keys slid up over the composer first and the app shrank after them: the "glitchy" transition.
  // Forwarded here, the shell starts shrinking on the same beat as the keys, over the same time.
  // iOS only: Android resizes the WebView itself (softwareKeyboardLayoutMode resize) and needs none.
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const tell = (e: Parameters<typeof keyboardOverlap>[0] & { duration?: number }) => {
      const ref = webviewRef.current;
      if (!ref) return;
      // A native text field over the page (the coach's map search) raises the keys, not the
      // page's composer: the hidden page must not shrink for it.
      if (mapPickOpen.current) return;
      const px = keyboardOverlap(e, Dimensions.get('window').height);
      const ms = Math.round(Number(e.duration) || 0);
      ref.injectJavaScript(`window.__nativeKeyboard && window.__nativeKeyboard(${px}, ${ms}); true;`);
    };
    const subs = [
      Keyboard.addListener('keyboardWillShow', tell),
      Keyboard.addListener('keyboardWillHide', tell),
      Keyboard.addListener('keyboardWillChangeFrame', tell),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  // A microphone never outlives the page it was dictating into: the shell unmounting (sign-out,
  // biometric relock) or the WebView dying ends any dictation in progress.
  React.useEffect(() => () => abortDictation(), []);
  React.useEffect(() => { if (err) abortDictation(); }, [err]);

  if (locked === null) {
    return (
      <Center>
        <ActivityIndicator color={BRAND_GREEN} />
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
        <ActivityIndicator color={BRAND_GREEN} />
      </Center>
    );
  }

  return (
    <>
      <WebView
        ref={webviewRef}
        source={{ uri }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={['*']}
        // External links leave the app. The proto's Terms / Privacy / support rows are real anchors;
        // without this, a target=_blank tap loads the website INSIDE this WebView (there is no
        // second window to open) and the shell is gone with no back gesture. The router intercepts
        // those taps first (router.js); this catches whatever it does not — a window.open fallback,
        // a redirect, a link inside injected content. The proto itself is served from file://, and
        // its data goes over fetch, never navigation, so any http(s) main-frame load is external.
        onShouldStartLoadWithRequest={(req) => {
          if (/^https?:\/\//i.test(req.url)) { void Linking.openURL(req.url).catch(() => undefined); return false; }
          return true;
        }}
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
        // iOS draws an up/down/Done accessory bar above the keyboard for every WKWebView text field.
        // It sat between the message box and the keys in the founder's side-by-side with Messages
        // (2026-09-03); Messages has no such bar, and neither does any composer here — Send is the
        // return key (enterkeyhint) and the pill has its own button. iOS-only prop; Android has no bar.
        hideKeyboardAccessoryView
        // iOS: the WebView's OWN scroll view never moves (composer upgrade, 2026-09-23). The page is
        // one screen tall and scrolls inside .viewport; the only thing this outer scroll view ever
        // did was let WebKit shove the whole app up to "reveal" a focused composer, which the
        // proto then had to snap back a frame later (the jump in the founder's report). With it
        // off, react-native-webview pins its bounds natively on every scroll callback. Inner
        // overflow scrollers are separate scroll views and are unaffected. Android keeps the
        // default: it resizes the WebView for the keyboard and has no such shove.
        scrollEnabled={Platform.OS !== 'ios'}
        bounces={false}
        overScrollMode="never"
        // No pinch-zoom, no double-tap-zoom — the UI is an app, not a page you can scale. iOS is
        // handled by user-scalable=no in index.html's viewport meta (WKWebView honours it, unlike
        // mobile Safari); these three are the Android half. There is no iOS-side zoom prop on this
        // version of react-native-webview, which is why the meta tag carries that platform.
        scalesPageToFit={false}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        setSupportMultipleWindows={false}
        // Keep the native side transparent-dark so there is no white flash before first paint.
        // (The proto paints its own dark ground immediately.)
      />
      {mapPick ? <PlacePicker initial={mapPick.initial} onDone={finishMapPick} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG, padding: 24 },
  errTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  errBody: { color: '#93A69C', fontSize: 13, textAlign: 'center' },
});
