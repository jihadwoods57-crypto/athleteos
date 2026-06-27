// AthleteOS — account data rights (Apple 5.1.1(v) + GDPR/CCPA). Proves in-app
// deletion wipes local data back to a fresh install and export returns the user's data.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useStore } from './useStore';
import { createInitialState } from '@/core';

const state = () => useStore.getState();

beforeEach(() => {
  state().resetDemo();
});

describe('deleteAccount', () => {
  it('wipes all local data back to a fresh install (flag off: no server call)', async () => {
    useStore.setState({ athleteName: 'Marcus', flow: 'app', role: 'athlete', hydrationL: 3.1 });
    await state().deleteAccount();
    const fresh = createInitialState();
    expect(state().athleteName).toBe(fresh.athleteName); // ''
    expect(state().flow).toBe(fresh.flow); // 'onboarding'
    expect(state().hydrationL).toBe(fresh.hydrationL);
  });
});

describe('exportMyData', () => {
  it('returns a JSON snapshot of the user own data', () => {
    useStore.setState({ athleteName: 'Jordan', sport: 'Soccer' });
    const json = JSON.parse(state().exportMyData());
    expect(json.identity.name).toBe('Jordan');
    expect(json.identity.sport).toBe('Soccer');
    expect(json.app).toBe('AthleteOS');
  });
});

describe('requestGuardianConsent (VPC)', () => {
  it('marks pending on a valid email (flag off: no send)', async () => {
    useStore.setState({ guardianEmail: 'parent@email.com' });
    const ok = await state().requestGuardianConsent();
    expect(ok).toBe(true);
    expect(state().guardianStatus).toBe('pending');
  });

  it('rejects an invalid email and surfaces an error', async () => {
    useStore.setState({ guardianEmail: 'nope' });
    const ok = await state().requestGuardianConsent();
    expect(ok).toBe(false);
    expect(state().guardianStatus).toBe('none');
    expect(state().authError).toMatch(/valid/i);
  });
});
