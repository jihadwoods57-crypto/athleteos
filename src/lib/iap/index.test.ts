// The consumer IAP seam. Two jobs here, and they pull in opposite directions:
//
//  1. INERT BY DEFAULT. With no RevenueCat key compiled in, every call must report an honest
//     'unavailable' so the paywall renders "Opens at launch" instead of a Start-trial CTA that
//     throws on tap. This is what protects the OTA case — this JS reaches binaries built before
//     react-native-purchases existed.
//  2. CORRECT WHEN WIRED. App Review rejected build 33 under Guideline 2.1(b) because nothing on
//     the membership screen could be bought. An inert-only lock would pass forever while the app
//     stayed unshippable, so the wired path is exercised here against a stubbed store.
//
// react-native-purchases is a REAL dependency now, so these mocks are plain jest.doMock with no
// `virtual: true` — a virtual mock over a real module poisons one resolver cache per worker and
// flakes (see the repo's jest-virtual-mock-resolver-cache note).

import { isIapAvailable, purchaseConsumer, restoreConsumer, configureIap, getConsumerOfferings } from './index';

type Stub = {
  configure: jest.Mock;
  logIn: jest.Mock;
  getOfferings: jest.Mock;
  getProducts: jest.Mock;
  purchasePackage: jest.Mock;
  purchaseStoreProduct: jest.Mock;
  restorePurchases: jest.Mock;
  checkTrialOrIntroductoryPriceEligibility: jest.Mock;
};

const ANNUAL = 'onstandard_individual_annual';
const UID = '11111111-2222-3333-4444-555555555555';

function makeStub(over: Partial<Stub> = {}): Stub {
  return {
    configure: jest.fn(),
    logIn: jest.fn().mockResolvedValue({}),
    getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
    getProducts: jest.fn().mockResolvedValue([]),
    purchasePackage: jest.fn().mockResolvedValue({}),
    purchaseStoreProduct: jest.fn().mockResolvedValue({}),
    restorePurchases: jest.fn().mockResolvedValue({ activeSubscriptions: [], entitlements: { active: {} } }),
    checkTrialOrIntroductoryPriceEligibility: jest.fn().mockResolvedValue({}),
    ...over,
  };
}

/** Load a FRESH copy of the seam with a key compiled in and the store stubbed. The module caches
 *  both the key and its `configuredFor` cursor at load, so every case needs its own instance. */
function loadWired(stub: Stub) {
  let mod!: typeof import('./index');
  jest.isolateModules(() => {
    jest.doMock('react-native-purchases', () => ({ __esModule: true, default: stub }));
    process.env.EXPO_PUBLIC_REVENUECAT_IOS = 'appl_TESTKEY';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    mod = require('./index');
  });
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS;
  return mod;
}

const offeringWith = (productId: string) => ({
  current: { identifier: 'default', availablePackages: [{ identifier: '$rc_annual', product: { identifier: productId } }] },
  all: {},
});

describe('iap seam — inert with no key', () => {
  it('reports unavailable rather than claiming a store it has no key for', () => {
    expect(isIapAvailable).toBe(false);
  });

  it('every call resolves to an honest unavailable, and none of them throw', async () => {
    await expect(purchaseConsumer(ANNUAL, UID)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(restoreConsumer(UID)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(configureIap(UID)).resolves.toBeUndefined();
    await expect(getConsumerOfferings(UID)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('iap seam — wired against a stubbed store', () => {
  afterEach(() => { jest.resetModules(); });

  it('is available once a key and the module are both present', () => {
    expect(loadWired(makeStub()).isIapAvailable).toBe(true);
  });

  it('buys the OFFERING PACKAGE when one carries the product, not the bare product', async () => {
    const stub = makeStub({ getOfferings: jest.fn().mockResolvedValue(offeringWith(ANNUAL)) });
    const mod = loadWired(stub);
    await expect(mod.purchaseConsumer(ANNUAL, UID)).resolves.toEqual({ ok: true });
    expect(stub.purchasePackage).toHaveBeenCalledTimes(1);
    // Losing the offering context is losing RevenueCat's attribution for the sale.
    expect(stub.purchaseStoreProduct).not.toHaveBeenCalled();
  });

  it('falls back to the bare store product when no offering carries it', async () => {
    const stub = makeStub({ getProducts: jest.fn().mockResolvedValue([{ identifier: ANNUAL }]) });
    const mod = loadWired(stub);
    await expect(mod.purchaseConsumer(ANNUAL, UID)).resolves.toEqual({ ok: true });
    expect(stub.purchaseStoreProduct).toHaveBeenCalledTimes(1);
  });

  it('configures RevenueCat with the PROFILE UUID — a purchase attached to nobody is unrecoverable', async () => {
    const stub = makeStub({ getOfferings: jest.fn().mockResolvedValue(offeringWith(ANNUAL)) });
    const mod = loadWired(stub);
    await mod.purchaseConsumer(ANNUAL, UID);
    expect(stub.configure).toHaveBeenCalledWith(expect.objectContaining({ appUserID: UID }));
  });

  it('never configures anonymously when the caller has no user id', async () => {
    const stub = makeStub();
    const mod = loadWired(stub);
    await mod.configureIap('');
    expect(stub.configure).not.toHaveBeenCalled();
  });

  it('configures once, then moves accounts with logIn rather than a second configure', async () => {
    const stub = makeStub();
    const mod = loadWired(stub);
    await mod.configureIap(UID);
    await mod.configureIap(UID);            // same subject: no second call at all
    expect(stub.configure).toHaveBeenCalledTimes(1);
    expect(stub.logIn).not.toHaveBeenCalled();
    await mod.configureIap('99999999-8888-7777-6666-555555555555');
    expect(stub.configure).toHaveBeenCalledTimes(1);
    expect(stub.logIn).toHaveBeenCalledTimes(1);
  });

  it('maps a tapped Cancel to "cancelled", which the paywall renders as silence — never an error', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offeringWith(ANNUAL)),
      purchasePackage: jest.fn().mockRejectedValue({ code: '1', message: 'cancelled' }),
    });
    const mod = loadWired(stub);
    await expect(mod.purchaseConsumer(ANNUAL, UID)).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('honours the deprecated userCancelled flag too, so an older SDK build never paints red', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offeringWith(ANNUAL)),
      purchasePackage: jest.fn().mockRejectedValue({ userCancelled: true, message: 'cancelled' }),
    });
    const mod = loadWired(stub);
    await expect(mod.purchaseConsumer(ANNUAL, UID)).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('reports a real store failure as an error, carrying the reason', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offeringWith(ANNUAL)),
      purchasePackage: jest.fn().mockRejectedValue({ code: '2', message: 'The App Store is unavailable.' }),
    });
    const mod = loadWired(stub);
    await expect(mod.purchaseConsumer(ANNUAL, UID))
      .resolves.toEqual({ ok: false, reason: 'error', message: 'The App Store is unavailable.' });
  });

  it('refuses an unknown product instead of opening an empty sheet', async () => {
    const mod = loadWired(makeStub());     // no offering, no product
    const res = await mod.purchaseConsumer(ANNUAL, UID);
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe('error');
  });

  it('restores an active subscription', async () => {
    const stub = makeStub({
      restorePurchases: jest.fn().mockResolvedValue({ activeSubscriptions: [ANNUAL], entitlements: { active: {} } }),
    });
    await expect(loadWired(stub).restoreConsumer(UID)).resolves.toEqual({ ok: true });
  });

  it('restores from an entitlement even when activeSubscriptions is empty', async () => {
    const stub = makeStub({
      restorePurchases: jest.fn().mockResolvedValue({ activeSubscriptions: [], entitlements: { active: { premium: {} } } }),
    });
    await expect(loadWired(stub).restoreConsumer(UID)).resolves.toEqual({ ok: true });
  });

  it('separates "nothing on this account" from "the check itself failed"', async () => {
    // Nothing to restore is a FACT, and the paywall prints it in neutral grey.
    const empty = makeStub();
    await expect(loadWired(empty).restoreConsumer(UID)).resolves.toEqual({ ok: false, reason: 'cancelled' });
    // A dropped check is NOT a verdict about the account, and must not claim one.
    const broken = makeStub({ restorePurchases: jest.fn().mockRejectedValue({ code: '10', message: 'offline' }) });
    await expect(loadWired(broken).restoreConsumer(UID)).resolves.toEqual({ ok: false, reason: 'error', message: 'offline' });
  });
});

/* G-R7 (App Review pass 2026-09-23): the paywall printed hard-coded USD in every storefront and a
   trial line to Apple IDs that had already used theirs. These pin the store read the paywall
   renders instead. */
describe('iap seam: offerings for the paywall', () => {
  afterEach(() => { jest.resetModules(); });

  const MONTHLY = 'onstandard_individual_monthly';
  const product = (id: string, over: Record<string, unknown> = {}) => ({
    identifier: id, priceString: '€219,99', price: 219.99, currencyCode: 'EUR', pricePerMonthString: '€18,33',
    introPrice: { price: 0, priceString: '€0', periodUnit: 'WEEK', periodNumberOfUnits: 2, cycles: 1 },
    ...over,
  });
  const offerings = (...products: Array<Record<string, unknown>>) => ({
    current: { identifier: 'default', availablePackages: products.map((p, i) => ({ identifier: `p${i}`, product: p })) },
    all: {},
  });

  it('returns the store’s own localized price, currency and free intro period', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offerings(product(ANNUAL))),
      checkTrialOrIntroductoryPriceEligibility: jest.fn().mockResolvedValue({ [ANNUAL]: { status: 2, description: '' } }),
    });
    const res = await loadWired(stub).getConsumerOfferings(UID);
    expect(res).toEqual({ ok: true, products: { [ANNUAL]: {
      priceString: '€219,99', price: 219.99, currencyCode: 'EUR', pricePerMonthString: '€18,33',
      trial: { count: 2, unit: 'WEEK' }, trialEligible: true,
    } } });
    expect(stub.checkTrialOrIntroductoryPriceEligibility).toHaveBeenCalledWith([ANNUAL]);
  });

  it('marks an Apple ID that already used its trial as ineligible', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offerings(product(ANNUAL))),
      checkTrialOrIntroductoryPriceEligibility: jest.fn().mockResolvedValue({ [ANNUAL]: { status: 1, description: '' } }),
    });
    const res = await loadWired(stub).getConsumerOfferings(UID);
    expect(res.ok && res.products[ANNUAL].trialEligible).toBe(false);
  });

  it('keeps the prices when the eligibility check fails, with eligibility unknown', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offerings(product(ANNUAL))),
      checkTrialOrIntroductoryPriceEligibility: jest.fn().mockRejectedValue(new Error('offline')),
    });
    const res = await loadWired(stub).getConsumerOfferings(UID);
    expect(res.ok).toBe(true);
    expect(res.ok && res.products[ANNUAL].trialEligible).toBeNull();
    expect(res.ok && res.products[ANNUAL].priceString).toBe('€219,99');
  });

  it('does not call a paid intro price a trial, and skips the eligibility call when nothing has a trial', async () => {
    const stub = makeStub({
      getOfferings: jest.fn().mockResolvedValue(offerings(product(MONTHLY, {
        priceString: '$19.99', price: 19.99, currencyCode: 'USD', pricePerMonthString: '$19.99',
        introPrice: { price: 9.99, priceString: '$9.99', periodUnit: 'MONTH', periodNumberOfUnits: 1, cycles: 1 },
      }))),
    });
    const res = await loadWired(stub).getConsumerOfferings(UID);
    expect(res.ok && res.products[MONTHLY].trial).toBeNull();
    expect(stub.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
  });

  it('reports a store failure as an error, never as an empty price list', async () => {
    const stub = makeStub({ getOfferings: jest.fn().mockRejectedValue({ code: '10', message: 'offline' }) });
    await expect(loadWired(stub).getConsumerOfferings(UID)).resolves.toEqual({ ok: false, reason: 'error', message: 'offline' });
  });
});
