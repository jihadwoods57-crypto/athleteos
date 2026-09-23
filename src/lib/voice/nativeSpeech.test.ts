// The native dictation seam (composer upgrade, 2026-09-23). The recognizer is faked; what is tested
// is what this file decides: when the mic is available at all, the permission flow, how continuous
// results become one running transcript, how errors fold into the page's vocabulary, the one
// on-device -> network retry, and that a session always ends.
type Listener = (e?: unknown) => void;

const mockListeners: Record<string, Listener[]> = {};
const mockFake = {
  isRecognitionAvailable: jest.fn(() => true),
  supportsOnDeviceRecognition: jest.fn(() => true),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  addListener: jest.fn((name: string, fn: Listener) => {
    (mockListeners[name] ||= []).push(fn);
    return { remove: () => { mockListeners[name] = (mockListeners[name] || []).filter((f) => f !== fn); } };
  }),
};
const fire = (name: string, e?: unknown) => (mockListeners[name] || []).slice().forEach((f) => f(e));
let mockNativePresent = true;

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => (mockNativePresent ? {} : null) }));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: mockFake }));

import {
  accumulate, levelOf, errorCodeOf, dictationStatus, startDictation, stopDictation, abortDictation,
  __resetSpeechModuleForTest, __resetSessionsForTest, __currentSessionId, type DictationEvent,
} from './nativeSpeech';

beforeEach(() => {
  for (const k of Object.keys(mockListeners)) delete mockListeners[k];
  jest.clearAllMocks();
  mockNativePresent = true;
  mockFake.isRecognitionAvailable.mockReturnValue(true);
  mockFake.supportsOnDeviceRecognition.mockReturnValue(true);
  mockFake.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  __resetSpeechModuleForTest();
  __resetSessionsForTest();
  jest.useRealTimers();
});
const flush = () => new Promise((r) => setImmediate(r));

describe('the running transcript', () => {
  test('utterance-by-utterance results (interim, then final, then a fresh utterance) join up', () => {
    let s = { committed: '', text: '' };
    s = accumulate(s, 'I had', false);
    expect(s.text).toBe('I had');
    s = accumulate(s, 'I had chicken and rice', true);
    expect(s.text).toBe('I had chicken and rice');
    s = accumulate(s, 'and a protein', false);
    expect(s.text).toBe('I had chicken and rice and a protein');
    s = accumulate(s, 'and a protein shake.', true);
    expect(s).toEqual({ committed: 'I had chicken and rice and a protein shake.', text: 'I had chicken and rice and a protein shake.' });
  });

  test('an engine that repeats everything so far is not doubled', () => {
    let s = { committed: '', text: '' };
    s = accumulate(s, 'Two eggs', true);
    s = accumulate(s, 'Two eggs and toast', false);
    expect(s.text).toBe('Two eggs and toast');
  });

  test('a cumulative engine that revises punctuation takes its latest wording whole', () => {
    let s = { committed: '', text: '' };
    s = accumulate(s, 'hello', true);
    s = accumulate(s, 'Hello, how are you', true);
    expect(s.text).toBe('Hello, how are you');
  });

  test('levels and errors fold into the page\'s small vocabulary', () => {
    expect(levelOf(-2)).toBe(0);
    expect(levelOf(5)).toBe(0.5);
    expect(levelOf(40)).toBe(1);
    expect(levelOf(Number.NaN)).toBe(0);
    expect(errorCodeOf('not-allowed')).toBe('denied');
    expect(errorCodeOf('language-not-supported')).toBe('unavailable');
    expect(errorCodeOf('speech-timeout')).toBe('no-speech');
    expect(errorCodeOf('aborted')).toBeNull();
    expect(errorCodeOf('something-new')).toBe('failed');
  });
});

describe('availability', () => {
  test('a binary without the native module says unavailable and never throws', async () => {
    mockNativePresent = false;
    __resetSpeechModuleForTest();
    await expect(dictationStatus()).resolves.toEqual({ available: false, onDevice: false, permission: 'undetermined' });
    await expect(startDictation(() => undefined)).resolves.toEqual({ ok: false, code: 'unavailable' });
  });

  test('available reports on-device support and never prompts', async () => {
    await expect(dictationStatus()).resolves.toEqual({ available: true, onDevice: true, permission: 'undetermined' });
    expect(mockFake.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('a recognizer the OS says is unavailable hides the mic', async () => {
    mockFake.isRecognitionAvailable.mockReturnValue(false);
    await expect(dictationStatus()).resolves.toMatchObject({ available: false });
  });
});

describe('a session', () => {
  test('permission refused: no recognizer is started, the page is told "denied"', async () => {
    mockFake.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    await expect(startDictation(() => undefined, { sid: 'd1' })).resolves.toEqual({ ok: false, code: 'denied' });
    expect(mockFake.start).not.toHaveBeenCalled();
  });

  test('starts on-device in the device language, streams a running transcript tagged with its id, ends', async () => {
    const got: DictationEvent[] = [];
    await expect(startDictation((e) => got.push(e), { sid: 'd1', lang: 'es-US' })).resolves.toEqual({ ok: true, onDevice: true });
    expect(mockFake.start).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'es-US', interimResults: true, continuous: true, requiresOnDeviceRecognition: true, addsPunctuation: true,
    }));
    fire('result', { isFinal: false, results: [{ transcript: 'grilled' }] });
    fire('result', { isFinal: true, results: [{ transcript: 'grilled chicken' }] });
    stopDictation('d1');
    expect(mockFake.stop).toHaveBeenCalled();
    fire('end');
    expect(got).toEqual([
      { sid: 'd1', type: 'text', text: 'grilled', final: false },
      { sid: 'd1', type: 'text', text: 'grilled chicken', final: true },
      { sid: 'd1', type: 'end' },
    ]);
    expect(__currentSessionId()).toBeNull();
    fire('result', { isFinal: true, results: [{ transcript: 'late' }] });
    expect(got).toHaveLength(3);
  });

  test('a language that is not a language falls back to en-US', async () => {
    await startDictation(() => undefined, { sid: 'd1', lang: 'not a locale' });
    expect(mockFake.start.mock.calls[0][0]).toMatchObject({ lang: 'en-US' });
  });

  test('refused before a word: on-device, then the network, then en-US, one rung per end', async () => {
    const got: DictationEvent[] = [];
    await startDictation((e) => got.push(e), { sid: 'd1', lang: 'es-US' });
    fire('error', { error: 'language-not-supported' });
    fire('end');
    expect(mockFake.start.mock.calls[1][0]).toMatchObject({ lang: 'es-US', requiresOnDeviceRecognition: false });
    fire('error', { error: 'language-not-supported' });
    fire('end');
    expect(mockFake.start.mock.calls[2][0]).toMatchObject({ lang: 'en-US', requiresOnDeviceRecognition: false });
    expect(got).toEqual([]);
    fire('result', { isFinal: true, results: [{ transcript: 'oatmeal' }] });
    fire('end');
    expect(got).toEqual([{ sid: 'd1', type: 'text', text: 'oatmeal', final: true }, { sid: 'd1', type: 'end' }]);
  });

  test('a real error reaches the page, then the end', async () => {
    const got: DictationEvent[] = [];
    mockFake.supportsOnDeviceRecognition.mockReturnValue(false);
    await startDictation((e) => got.push(e), { sid: 'd1' });
    fire('error', { error: 'no-speech' });
    fire('end');
    expect(got).toEqual([{ sid: 'd1', type: 'error', code: 'no-speech' }, { sid: 'd1', type: 'end' }]);
  });
});

/* The I-1 race (review 2026-09-23): stop() and abort() end asynchronously, and the old code let the
   aborted recognizer's late `end` tear down the NEXT session while its recognizer ran on. */
describe('sessions never cross', () => {
  test('stop, then an immediate restart: the new recognizer waits for the old end, which is not the new session\'s', async () => {
    const a: DictationEvent[] = [];
    const b: DictationEvent[] = [];
    await startDictation((e) => a.push(e), { sid: 'd1' });
    fire('start');
    stopDictation('d1');
    const second = startDictation((e) => b.push(e), { sid: 'd2' });
    await flush();
    expect(mockFake.start).toHaveBeenCalledTimes(1); // not yet: d1 still owns the recognizer
    expect(a).toEqual([{ sid: 'd1', type: 'start', onDevice: true }, { sid: 'd1', type: 'end' }]);
    fire('end'); // d1's own, late
    await expect(second).resolves.toEqual({ ok: true, onDevice: true });
    expect(mockFake.start).toHaveBeenCalledTimes(2);
    expect(__currentSessionId()).toBe('d2');
    fire('start');
    fire('result', { isFinal: false, results: [{ transcript: 'rice' }] });
    expect(b).toEqual([{ sid: 'd2', type: 'start', onDevice: true }, { sid: 'd2', type: 'text', text: 'rice', final: false }]);
    stopDictation('d2');
    fire('end');
    expect(b[b.length - 1]).toEqual({ sid: 'd2', type: 'end' });
    expect(__currentSessionId()).toBeNull();
  });

  test('one box\'s mic, then another\'s: the first is aborted, and a late end it never delivered is written off', async () => {
    jest.useFakeTimers();
    const a: DictationEvent[] = [];
    const b: DictationEvent[] = [];
    await startDictation((e) => a.push(e), { sid: 'd1' });
    fire('start');
    const second = startDictation((e) => b.push(e), { sid: 'd2' });
    expect(mockFake.abort).toHaveBeenCalledTimes(1);
    expect(a[a.length - 1]).toEqual({ sid: 'd1', type: 'end' });
    await jest.advanceTimersByTimeAsync(1500); // d1's end never came: forced
    await expect(second).resolves.toEqual({ ok: true, onDevice: true });
    expect(__currentSessionId()).toBe('d2');
    fire('end'); // d1's end, very late
    expect(__currentSessionId()).toBe('d2'); // written off, d2 lives on
    expect(b).toEqual([]);
    fire('start');
    fire('result', { isFinal: true, results: [{ transcript: 'toast' }] });
    expect(b).toEqual([{ sid: 'd2', type: 'start', onDevice: true }, { sid: 'd2', type: 'text', text: 'toast', final: true }]);
  });

  test('navigating away while listening: the page hears end at once, the recognizer is released on its own end', async () => {
    const a: DictationEvent[] = [];
    await startDictation((e) => a.push(e), { sid: 'd1' });
    fire('start');
    abortDictation('d1');
    expect(mockFake.abort).toHaveBeenCalled();
    expect(a[a.length - 1]).toEqual({ sid: 'd1', type: 'end' });
    fire('result', { isFinal: true, results: [{ transcript: 'late words' }] });
    expect(a.filter((e) => e.type === 'text')).toEqual([]); // nothing after the page left
    expect(__currentSessionId()).toBe('d1');
    fire('end');
    expect(__currentSessionId()).toBeNull();
    expect(a.filter((e) => e.type === 'end')).toHaveLength(1);
  });

  test('stop with nothing running still stops the recognizer; a stale id never stops a newer session', async () => {
    stopDictation('gone');
    expect(mockFake.abort).toHaveBeenCalledTimes(1);
    await startDictation(() => undefined, { sid: 'd5' });
    stopDictation('d4');
    abortDictation('d4');
    expect(mockFake.stop).not.toHaveBeenCalled();
    expect(mockFake.abort).toHaveBeenCalledTimes(1);
    expect(__currentSessionId()).toBe('d5');
  });

  test('a stop whose end never comes is forced after a moment', async () => {
    jest.useFakeTimers();
    const a: DictationEvent[] = [];
    await startDictation((e) => a.push(e), { sid: 'd1' });
    stopDictation('d1');
    await jest.advanceTimersByTimeAsync(1500);
    expect(mockFake.abort).toHaveBeenCalled();
    expect(a).toEqual([{ sid: 'd1', type: 'end' }]);
    expect(__currentSessionId()).toBeNull();
  });
});
