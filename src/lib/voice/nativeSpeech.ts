// OnStandard: native dictation for the chat composer (composer upgrade, 2026-09-23).
//
// The founder: "I need the microphone button in order to talk out a message." The proto's mic
// (proto/redesign-2026-07/js/dictation.js) reaches this file through the bridge (DICTATION_*).
// It wraps expo-speech-recognition (SFSpeechRecognizer + AVAudioEngine on iOS, SpeechRecognizer on
// Android), on-device wherever the OS supports it for the language.
//
// Loaded lazily and only when the native module is present, the same rule as src/lib/maps/
// mapsNative.ts: this file ships over the air, so it can land on a binary built before the speech
// module existed, and a module-scope require of a missing native module would take the whole shell
// down. On such a binary every entry point answers "unavailable" and the proto hides the mic.
//
// Privacy: nothing here records audio to a file or keeps it. The transcript goes to the page and
// nowhere else; it is never logged (the console bridge must never see it).
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

type SpeechModule = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

let cached: SpeechModule | null | undefined;

/** The native module, or null on a binary (or platform) without it. */
export function speechModule(): SpeechModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const core = require('expo-modules-core') as { requireOptionalNativeModule: (n: string) => unknown };
    if (!core.requireOptionalNativeModule('ExpoSpeechRecognition')) return cached;
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    cached = (require('expo-speech-recognition') as typeof import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam: forget the cached lookup. */
export function __resetSpeechModuleForTest(): void { cached = undefined; }

export type DictationPermission = 'granted' | 'denied' | 'undetermined';
export type DictationStatus = { available: boolean; onDevice: boolean; permission: DictationPermission };
/** The page's whole error vocabulary. Each maps to one plain line in dictation.js. */
export type DictationErrorCode = 'denied' | 'unavailable' | 'no-speech' | 'network' | 'interrupted' | 'busy' | 'failed';
export type DictationEvent =
  | { type: 'start'; onDevice: boolean }
  | { type: 'text'; text: string; final: boolean }
  | { type: 'level'; value: number }
  | { type: 'error'; code: DictationErrorCode }
  | { type: 'end' };

const UNAVAILABLE: DictationStatus = { available: false, onDevice: false, permission: 'undetermined' };

function permissionOf(p: { granted?: boolean; canAskAgain?: boolean; status?: string } | null | undefined): DictationPermission {
  if (!p) return 'undetermined';
  if (p.granted) return 'granted';
  if (p.status === 'denied' || p.canAskAgain === false) return 'denied';
  return 'undetermined';
}

/** Can the mic work here at all? Never throws; anything unexpected is "unavailable". Does NOT ask
 *  for permission: that happens on the first tap, where the athlete can see why. */
export async function dictationStatus(): Promise<DictationStatus> {
  const m = speechModule();
  if (!m) return UNAVAILABLE;
  try {
    if (!m.isRecognitionAvailable()) return UNAVAILABLE;
    let onDevice = false;
    try { onDevice = !!m.supportsOnDeviceRecognition(); } catch { onDevice = false; }
    let permission: DictationPermission = 'undetermined';
    try { permission = permissionOf(await m.getPermissionsAsync()); } catch { permission = 'undetermined'; }
    return { available: true, onDevice, permission };
  } catch {
    return UNAVAILABLE;
  }
}

/** The recognizer's own error codes, folded into the page's seven. `aborted` is not an error: it
 *  is our own abort() coming back, and the caller already knows. */
export function errorCodeOf(code: string | undefined): DictationErrorCode | null {
  switch (code) {
    case 'aborted': return null;
    case 'not-allowed': return 'denied';
    case 'service-not-allowed':
    case 'language-not-supported': return 'unavailable';
    case 'no-speech':
    case 'speech-timeout': return 'no-speech';
    case 'network': return 'network';
    case 'interrupted': return 'interrupted';
    case 'busy': return 'busy';
    default: return 'failed';
  }
}

/** A running transcript. Continuous recognition hands back each UTTERANCE separately: interim
 *  results cover the utterance in progress, and a final closes it and the next one starts blank.
 *  Some engines instead repeat everything so far in every result. Both shapes come out as one
 *  running string. Pure; exported for the test. */
export type TranscriptState = { committed: string; text: string };
export function accumulate(state: TranscriptState, transcript: string, final: boolean): TranscriptState {
  const t = String(transcript || '').trim();
  const base = state.committed;
  // Cumulative engine: the result already starts with everything committed so far.
  const piece = base && t.toLowerCase().startsWith(base.toLowerCase()) ? t.slice(base.length).trim() : t;
  const text = [base, piece].filter(Boolean).join(' ');
  return final ? { committed: text, text } : { committed: base, text };
}

/** The recognizer's volume (-2 to 10, below 0 inaudible) as 0 to 1 for the listening ring. */
export function levelOf(value: number): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v / 10));
}

type Session = { subs: { remove: () => void }[]; app: NativeEventSubscription | null; emit: (e: DictationEvent) => void };
let session: Session | null = null;

function endSession(): void {
  const s = session;
  session = null;
  if (!s) return;
  for (const sub of s.subs) { try { sub.remove(); } catch { /* already gone */ } }
  try { s.app?.remove(); } catch { /* already gone */ }
}

/**
 * Start listening. Asks for the microphone and speech permissions the first time (the OS prompt,
 * with the purpose strings in app.json). Resolves once recognition has been asked to start, or with
 * the reason it could not. Events stream to `emit` until an `end`. One session at a time: a second
 * start aborts the first.
 */
export async function startDictation(
  emit: (e: DictationEvent) => void,
  opts: { lang?: string } = {},
): Promise<{ ok: true; onDevice: boolean } | { ok: false; code: DictationErrorCode }> {
  const m = speechModule();
  if (!m) return { ok: false, code: 'unavailable' };
  if (session) abortDictation();
  try {
    if (!m.isRecognitionAvailable()) return { ok: false, code: 'unavailable' };
    const perm = await m.requestPermissionsAsync();
    if (!perm?.granted) return { ok: false, code: 'denied' };
  } catch {
    return { ok: false, code: 'unavailable' };
  }

  let onDevice = false;
  try { onDevice = !!m.supportsOnDeviceRecognition(); } catch { onDevice = false; }
  const lang = opts.lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(opts.lang) ? opts.lang : 'en-US';

  let transcript: TranscriptState = { committed: '', text: '' };
  let heard = false;
  let retryPending = false;
  let lastLevelAt = 0;
  const s: Session = { subs: [], app: null, emit };
  session = s;
  const live = () => session === s;

  const begin = (device: boolean) => {
    m.start({
      lang,
      interimResults: true,
      continuous: true,
      // On-device where the OS supports it for this language: the audio never leaves the phone,
      // and there is no one-minute server limit. Otherwise Apple's / Google's service.
      requiresOnDeviceRecognition: device,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  };

  s.subs.push(m.addListener('start', () => { if (live()) emit({ type: 'start', onDevice }); }));
  s.subs.push(m.addListener('result', (e) => {
    if (!live()) return;
    const best = e?.results?.[0]?.transcript ?? '';
    if (!best && !e?.isFinal) return;
    heard = true;
    transcript = accumulate(transcript, best, !!e?.isFinal);
    emit({ type: 'text', text: transcript.text, final: !!e?.isFinal });
  }));
  s.subs.push(m.addListener('volumechange', (e) => {
    if (!live()) return;
    const now = Date.now();
    if (now - lastLevelAt < 100) return;
    lastLevelAt = now;
    emit({ type: 'level', value: levelOf(e?.value) });
  }));
  s.subs.push(m.addListener('error', (e) => {
    if (!live()) return;
    // The on-device model for this language is not installed (Android, some iOS locales): once
    // this attempt has ended, try the network recognizer, before anything was heard, rather than
    // telling the athlete no. The restart waits for `end` so the two sessions never overlap.
    if (onDevice && !retryPending && !heard && (e?.error === 'language-not-supported' || e?.error === 'service-not-allowed')) {
      retryPending = true;
      onDevice = false;
      return;
    }
    const code = errorCodeOf(e?.error);
    if (code) emit({ type: 'error', code });
  }));
  s.subs.push(m.addListener('end', () => {
    if (!live()) return;
    if (retryPending) {
      retryPending = false;
      try { begin(false); return; } catch { emit({ type: 'error', code: 'unavailable' }); }
    }
    endSession();
    emit({ type: 'end' });
  }));
  // Leaving the app ends dictation: a microphone must never stay open behind the lock screen.
  s.app = AppState.addEventListener('change', (st) => { if (st !== 'active' && live()) abortDictation(); });

  try {
    begin(onDevice);
  } catch {
    endSession();
    return { ok: false, code: 'failed' };
  }
  return { ok: true, onDevice };
}

/** Stop listening and let the recognizer deliver its final words (a last `text`, then `end`). */
export function stopDictation(): void {
  const m = speechModule();
  if (!m || !session) return;
  try { m.stop(); } catch { abortDictation(); }
}

/** Stop at once, with no final result. The page has already moved on (a send, a navigation). */
export function abortDictation(): void {
  const m = speechModule();
  const s = session;
  endSession();
  if (m) { try { m.abort(); } catch { /* not running */ } }
  if (s) s.emit({ type: 'end' });
}
