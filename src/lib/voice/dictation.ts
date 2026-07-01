// OnStandard — voice dictation for the meal description (talk instead of type).
//
// Athletes are 13-22, on their phone, often right after a workout — talking is far easier than
// typing a paragraph, and the more they say, the better the macro estimate. This is a thin,
// dependency-free seam:
//   * Web (the Expo web build): the browser's built-in Web Speech API. No install, works today.
//   * Native (iOS/Android): reports UNAVAILABLE until `expo-speech-recognition` is added and wired
//     in the marked seam below. We deliberately do NOT statically reference that module here, so an
//     uninstalled dependency can never break the Metro bundle. The mic button simply hides when
//     dictation is unavailable — the text field always works.
import { Platform } from 'react-native';

export interface DictationHandle {
  /** Stop listening and release the recognizer. Safe to call more than once. */
  stop: () => void;
}

export interface DictationCallbacks {
  /** The best transcript so far (interim or final). Called repeatedly as the athlete speaks. */
  onText: (text: string) => void;
  /** Recognition ended on its own (silence / done). */
  onEnd?: () => void;
  /** Something went wrong (unsupported, permission denied, etc.). */
  onError?: (message: string) => void;
}

// -- web (Web Speech API) -------------------------------------------------------------------------
function webRecognizer(): { new (): SpeechRecognitionLike } | null {
  const g = globalThis as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

// Minimal shape of the browser SpeechRecognition we use (avoids a DOM lib dependency).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

/** True when dictation can run on this platform right now (drives whether the mic button shows). */
export const isDictationAvailable: boolean = Platform.OS === 'web' ? webRecognizer() !== null : false;

/**
 * Start listening. Returns a handle whose `stop()` ends the session. Never throws — on any
 * problem it calls `onError` and returns a no-op handle, so the caller's UI stays simple.
 */
export function startDictation(cb: DictationCallbacks): DictationHandle {
  if (Platform.OS === 'web') {
    const Ctor = webRecognizer();
    if (!Ctor) {
      cb.onError?.('Voice input is not supported in this browser.');
      return { stop: () => {} };
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? '';
      const trimmed = text.trim();
      if (trimmed) cb.onText(trimmed);
    };
    rec.onerror = (e) => cb.onError?.(e?.error ? String(e.error) : 'Voice input error.');
    rec.onend = () => cb.onEnd?.();
    try {
      rec.start();
    } catch {
      // start() throws if called while already running — treat as a no-op.
    }
    return {
      stop: () => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      },
    };
  }

  // -- native seam ------------------------------------------------------------------------------
  // To enable on device: `npx expo install expo-speech-recognition`, then replace this block with
  // its ExpoSpeechRecognitionModule start/stop + 'result'/'error'/'end' listeners, and flip
  // `isDictationAvailable` to detect the module. Kept unreferenced until then so the bundle is safe.
  cb.onError?.('Voice input is not available yet on this device.');
  return { stop: () => {} };
}
