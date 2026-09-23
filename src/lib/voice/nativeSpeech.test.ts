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
  __resetSpeechModuleForTest, type DictationEvent,
} from './nativeSpeech';

beforeEach(() => {
  for (const k of Object.keys(mockListeners)) delete mockListeners[k];
  jest.clearAllMocks();
  mockNativePresent = true;
  mockFake.isRecognitionAvailable.mockReturnValue(true);
  mockFake.supportsOnDeviceRecognition.mockReturnValue(true);
  mockFake.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  __resetSpeechModuleForTest();
  abortDictation();
});

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
    await expect(startDictation(() => undefined)).resolves.toEqual({ ok: false, code: 'denied' });
    expect(mockFake.start).not.toHaveBeenCalled();
  });

  test('starts on-device with interim results and punctuation, streams a running transcript, ends', async () => {
    const got: DictationEvent[] = [];
    await expect(startDictation((e) => got.push(e))).resolves.toEqual({ ok: true, onDevice: true });
    expect(mockFake.start).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'en-US', interimResults: true, continuous: true, requiresOnDeviceRecognition: true, addsPunctuation: true,
    }));
    fire('result', { isFinal: false, results: [{ transcript: 'grilled' }] });
    fire('result', { isFinal: true, results: [{ transcript: 'grilled chicken' }] });
    stopDictation();
    expect(mockFake.stop).toHaveBeenCalled();
    fire('end');
    expect(got).toEqual([
      { type: 'text', text: 'grilled', final: false },
      { type: 'text', text: 'grilled chicken', final: true },
      { type: 'end' },
    ]);
    // The session is over: a late event reaches nobody.
    fire('result', { isFinal: true, results: [{ transcript: 'late' }] });
    expect(got).toHaveLength(3);
  });

  test('no on-device model: one quiet retry on the network recognizer once the first attempt ends', async () => {
    const got: DictationEvent[] = [];
    await startDictation((e) => got.push(e));
    fire('error', { error: 'language-not-supported' });
    fire('end');
    expect(mockFake.start).toHaveBeenCalledTimes(2);
    expect(mockFake.start.mock.calls[1][0]).toMatchObject({ requiresOnDeviceRecognition: false });
    expect(got).toEqual([]);
    fire('result', { isFinal: true, results: [{ transcript: 'oatmeal' }] });
    fire('end');
    expect(got).toEqual([{ type: 'text', text: 'oatmeal', final: true }, { type: 'end' }]);
  });

  test('a real error reaches the page, then the end', async () => {
    const got: DictationEvent[] = [];
    mockFake.supportsOnDeviceRecognition.mockReturnValue(false);
    await startDictation((e) => got.push(e));
    fire('error', { error: 'no-speech' });
    fire('end');
    expect(got).toEqual([{ type: 'error', code: 'no-speech' }, { type: 'end' }]);
  });

  test('abort ends at once and tells the page', async () => {
    const got: DictationEvent[] = [];
    await startDictation((e) => got.push(e));
    abortDictation();
    expect(mockFake.abort).toHaveBeenCalled();
    expect(got).toEqual([{ type: 'end' }]);
  });
});
