// Phase 1 shell: renders the real :8124 proto full-screen in a WebView from local files.
// Pixel-perfect by construction (it IS the proto's HTML/CSS). Native bridges (camera, push,
// haptics, secure store, auth) layer on in later phases via the postMessage router.
import React from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { ensureProtoExtracted, PROTO_ROOT_DIR } from './protoBundle';
import { BRIDGE_SHIM, handleBridgeMessage, type BridgeMessage } from './bridge';
import { authenticateBiometric } from '../lib/auth/biometrics';

const BG = '#080B0A';

// Runs BEFORE any proto code: forwards console + errors to native so device issues are
// diagnosable (not a silent blank screen). The native bridge shim (haptics/share/secure store)
// is appended right after so both are live at document-start, before the proto's modules run.
const CONSOLE_BRIDGE = `
(function(){
  function send(o){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
  ['log','warn','error'].forEach(function(l){ var orig=console[l]; console[l]=function(){ send({__log:{level:l,msg:Array.prototype.map.call(arguments,String).join(' ')}}); try{orig.apply(console,arguments);}catch(e){} }; });
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

const PRELUDE = SUPABASE_CONFIG + CONSOLE_BRIDGE + BRIDGE_SHIM;

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
      onError={(e) => setErr(`WebView error: ${e.nativeEvent.description}`)}
      onRenderProcessGone={() => setErr('WebView crashed (render process gone)')}
      javaScriptEnabled
      domStorageEnabled
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
