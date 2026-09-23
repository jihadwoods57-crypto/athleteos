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
/** Every event names the session it belongs to (`sid`, chosen by the page), so an event from a
 *  session the page has already left can never be mistaken for one from the session it is in. */
export type DictationEvent = { sid: string } & (
  | { type: 'start'; onDevice: boolean }
  | { type: 'text'; text: string; final: boolean }
  | { type: 'level'; value: number }
  | { type: 'error'; code: DictationErrorCode }
  | { type: 'end' });

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
const wordsOf = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function accumulate(state: TranscriptState, transcript: string, final: boolean): TranscriptState {
  const t = String(transcript || '').trim();
  const base = state.committed;
  // Cumulative engine: the result already carries everything committed so far, possibly with its
  // punctuation and capitals revised ("hello" -> "Hello, how are you"). Compared on the WORDS, and
  // the engine's latest wording wins whole, so no stray " ," is stitched in.
  const cumulative = !!base && wordsOf(t).startsWith(wordsOf(base));
  const text = cumulative ? t : [base, t].filter(Boolean).join(' ');
  return final ? { committed: text, text } : { committed: base, text };
}

/** The recognizer's volume (-2 to 10, below 0 inaudible) as 0 to 1 for the listening ring. */
export function levelOf(value: number): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v / 10));
}

/* ONE RECOGNIZER, ONE OWNER (fix round 1, 2026-09-23). expo-speech-recognition's stop() and
   abort() finish asynchronously and only then send `end`. Before this, a session aborted to make
   way for a new one removed its listeners at once, so its late `end` landed on the NEW session's
   listener: the new session was torn down while its recognizer kept running (the orange dot on,
   the page showing an idle mic, and nothing left that could stop it). Now:
     - a session keeps its listeners until its own native `end` arrives (or FORCE_MS passes, after
       which the recognizer is aborted again and a late `end` may still be on its way: see
       `strayUntil` below);
     - a new start waits for the previous session to be released before it asks for anything;
     - every event carries the page's session id, and the page drops ids it has left;
     - stop and abort with no session still stop the recognizer (the stop control always stops). */
const FORCE_MS = 1500;

type Session = {
  sid: string;
  subs: { remove: () => void }[];
  app: NativeEventSubscription | null;
  emit: (e: DictationEvent) => void;
  phase: 'running' | 'stopping' | 'aborting';
  started: boolean;
  pageEnded: boolean;
  force: ReturnType<typeof setTimeout> | null;
  watch: ReturnType<typeof setTimeout> | null;
  done: Promise<void>;
  release: () => void;
};
let session: Session | null = null;
/* A force-released session's `end` may still arrive, late, on the NEXT session's listener. It is
   not written off blindly (fix round 2: a bare counter swallowed a new session's own legitimate
   `end` when its recognizer failed before `start`, leaving the composer on "Listening…"). Instead:
   only within STRAY_MS of a force-release, and only before this session's own `start`, an `end`
   is checked against the recognizer's real state. Idle ('inactive') means nothing is listening, so
   the session ends whatever the `end` was; still starting or recognizing means the `end` was the
   old recognizer's, and it is dropped, with a watchdog that ends the session anyway if the
   recognizer goes idle without a word. A composer can therefore never stay "Listening…" over an
   idle recognizer. */
const STRAY_MS = 3000;
const WATCH_MS = 2000;
let strayUntil = 0;
/** Timers this file owns never hold a process open (jest, a headless run). No-op in React Native. */
function unrefTimer(t: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}
/** The recognizer's own state, or null when it cannot say (an older module, a throw). */
async function nativeState(m: SpeechModule): Promise<string | null> {
  try {
    const f = (m as unknown as { getStateAsync?: () => Promise<string> }).getStateAsync;
    return typeof f === 'function' ? String(await f.call(m)) : null;
  } catch {
    return null;
  }
}
let startTicket = 0;

/** Test seam: the session currently owning the recognizer. */
export function __currentSessionId(): string | null { return session ? session.sid : null; }
/** Test seam: forget every session (between tests). */
export function __resetSessionsForTest(): void {
  if (session) { if (session.force) clearTimeout(session.force); session.release(); }
  session = null; strayUntil = 0; startTicket = 0;
}

function endToPage(s: Session): void {
  if (s.pageEnded) return;
  s.pageEnded = true;
  s.emit({ sid: s.sid, type: 'end' });
}

/** Release the recognizer: listeners off, the next start may go ahead. */
function releaseSession(s: Session): void {
  if (s.force) { clearTimeout(s.force); s.force = null; }
  if (s.watch) { clearTimeout(s.watch); s.watch = null; }
  for (const sub of s.subs) { try { sub.remove(); } catch { /* already gone */ } }
  s.subs = [];
  try { s.app?.remove(); } catch { /* already gone */ }
  s.app = null;
  if (session === s) session = null;
  s.release();
}

/** If the native `end` never comes, abort again and let the session go anyway. */
function armForce(s: Session): void {
  if (s.force) return;
  s.force = unrefTimer(setTimeout(() => {
    s.force = null;
    if (session !== s) return;
    strayUntil = Date.now() + STRAY_MS;
    const m = speechModule();
    if (m) { try { m.abort(); } catch { /* not running */ } }
    endToPage(s);
    releaseSession(s);
  }, FORCE_MS));
}

/**
 * Start listening. Asks for the microphone and speech permissions the first time (the OS prompt,
 * with the purpose strings in app.json). Resolves once recognition has been asked to start, or with
 * the reason it could not. Events stream to `emit` until an `end`, each tagged with `sid`. One
 * recognizer at a time: a running session is aborted and its native `end` awaited first.
 * `lang` is the device's language (BCP-47); anything else, or a language the recognizer refuses,
 * falls back to en-US.
 */
export async function startDictation(
  emit: (e: DictationEvent) => void,
  opts: { lang?: string; sid?: string } = {},
): Promise<{ ok: true; onDevice: boolean } | { ok: false; code: DictationErrorCode }> {
  const m = speechModule();
  if (!m) return { ok: false, code: 'unavailable' };
  const ticket = ++startTicket;
  const sid = String(opts.sid || `s${ticket}`);
  const prev = session;
  if (prev) {
    abortDictation(prev.sid);
    await prev.done;
  }
  try {
    if (!m.isRecognitionAvailable()) return { ok: false, code: 'unavailable' };
    const perm = await m.requestPermissionsAsync();
    if (!perm?.granted) return { ok: false, code: 'denied' };
  } catch {
    return { ok: false, code: 'unavailable' };
  }
  // A later start arrived while this one waited: it owns the next session, this one never begins.
  if (ticket !== startTicket || session) return { ok: false, code: 'busy' };

  let supportsDevice = false;
  try { supportsDevice = !!m.supportsOnDeviceRecognition(); } catch { supportsDevice = false; }
  const asked = opts.lang && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(opts.lang) ? opts.lang : 'en-US';
  // The ladder, tried in order when the recognizer refuses before hearing anything: on-device in
  // the device's language, the network recognizer in that language, then the network in en-US.
  const attempts: { lang: string; device: boolean }[] = [];
  const push = (a: { lang: string; device: boolean }) => {
    if (!attempts.some((x) => x.lang === a.lang && x.device === a.device)) attempts.push(a);
  };
  if (supportsDevice) push({ lang: asked, device: true });
  push({ lang: asked, device: false });
  push({ lang: 'en-US', device: false });
  let step = 0;

  let transcript: TranscriptState = { committed: '', text: '' };
  let heard = false;
  let retryNext = false;
  let lastLevelAt = 0;
  let release: () => void = () => undefined;
  const done = new Promise<void>((r) => { release = r; });
  const s: Session = { sid, subs: [], app: null, emit, phase: 'running', started: false, pageEnded: false, force: null, watch: null, done, release };
  session = s;
  const mine = () => session === s;

  const begin = () => {
    const a = attempts[step];
    m.start({
      lang: a.lang,
      interimResults: true,
      continuous: true,
      // On-device where the OS supports it for this language: the audio never leaves the phone,
      // and there is no one-minute server limit. Otherwise Apple's / Google's service.
      requiresOnDeviceRecognition: a.device,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  };

  s.subs.push(m.addListener('start', () => {
    if (!mine()) return;
    s.started = true;
    if (s.phase === 'running') emit({ sid, type: 'start', onDevice: attempts[step].device });
  }));
  s.subs.push(m.addListener('result', (e) => {
    if (!mine() || s.phase === 'aborting') return;
    const best = e?.results?.[0]?.transcript ?? '';
    if (!best && !e?.isFinal) return;
    heard = true;
    transcript = accumulate(transcript, best, !!e?.isFinal);
    emit({ sid, type: 'text', text: transcript.text, final: !!e?.isFinal });
  }));
  s.subs.push(m.addListener('volumechange', (e) => {
    if (!mine() || s.phase !== 'running') return;
    const now = Date.now();
    if (now - lastLevelAt < 100) return;
    lastLevelAt = now;
    emit({ sid, type: 'level', value: levelOf(e?.value) });
  }));
  s.subs.push(m.addListener('error', (e) => {
    if (!mine() || s.phase === 'aborting') return;
    // Refused before a word was heard (no on-device model, a language this recognizer does not
    // do): once this attempt has ended, try the next rung rather than telling the athlete no.
    if (s.phase === 'running' && !heard && step + 1 < attempts.length
      && (e?.error === 'language-not-supported' || e?.error === 'service-not-allowed')) {
      retryNext = true;
      return;
    }
    const code = errorCodeOf(e?.error);
    if (code) emit({ sid, type: 'error', code });
  }));
  const finishSession = () => { endToPage(s); releaseSession(s); };
  s.subs.push(m.addListener('end', async () => {
    if (!mine()) return;
    // Possibly the late `end` of a recognizer we stopped waiting for. Ask the recognizer.
    if (!s.started && Date.now() < strayUntil) {
      const st = await nativeState(m);
      if (!mine()) return;
      // 'stopping' is the recognizer we just aborted, still tearing down: its `end` is the stray.
      if (st === 'starting' || st === 'recognizing' || st === 'stopping') {
        strayUntil = 0; // that was the one stray; the next `end` is ours
        if (!s.watch) {
          s.watch = unrefTimer(setTimeout(async () => {
            s.watch = null;
            if (!mine() || s.started) return;
            const later = await nativeState(m);
            // Anything but a recognizer still coming up (idle, stuck tearing down, cannot say) ends it.
            if (mine() && !s.started && later !== 'starting' && later !== 'recognizing') finishSession();
          }, WATCH_MS));
        }
        return;
      }
      // Idle, or it cannot say: this end is real (or nothing is listening anyway). End it.
    }
    if (retryNext && s.phase === 'running') {
      retryNext = false;
      step += 1;
      s.started = false;
      try { begin(); return; } catch { emit({ sid, type: 'error', code: 'unavailable' }); }
    }
    finishSession();
  }));
  // Leaving the app ends dictation: a microphone must never stay open behind the lock screen.
  s.app = AppState.addEventListener('change', (st) => { if (st !== 'active' && mine()) abortDictation(sid); });

  try {
    begin();
  } catch {
    releaseSession(s);
    return { ok: false, code: 'failed' };
  }
  return { ok: true, onDevice: attempts[0].device };
}

/** Stop listening and let the recognizer deliver its final words (a last `text`, then `end`).
 *  `sid` names the session the page means; a stale id is ignored. With no session at all the
 *  recognizer is aborted anyway, so the stop control can never leave a microphone open. */
export function stopDictation(sid?: string): void {
  const m = speechModule();
  if (!m) return;
  const s = session;
  if (!s) { try { m.abort(); } catch { /* not running */ } return; }
  if (sid && s.sid !== sid) return;
  if (s.phase !== 'running') return;
  s.phase = 'stopping';
  try { m.stop(); } catch { abortDictation(s.sid); return; }
  armForce(s);
}

/** Stop at once, with no final result. The page has already moved on (a send, a navigation), so
 *  it is told `end` now; the session keeps the recognizer until its own native `end` arrives. */
export function abortDictation(sid?: string): void {
  const m = speechModule();
  const s = session;
  if (sid && s && s.sid !== sid) return;
  if (m) { try { m.abort(); } catch { /* not running */ } }
  if (!s || s.phase === 'aborting') return;
  s.phase = 'aborting';
  endToPage(s);
  armForce(s);
}
