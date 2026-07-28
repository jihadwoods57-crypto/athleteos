// Every rule here is about NOT sending. A proactive message that fires at the wrong hour, twice,
// or for no reason costs more than it earns — the athlete mutes the app, and then the message that
// mattered is muted too.
import {
  inLocalWindow, localDateISO, pickFollowUpMeal, fallbackFollowUp, routeForMeal, notificationKind,
  LOW_QUALITY, type MealRow,
} from './followup';

const meal = (over: Partial<MealRow>): MealRow =>
  ({ id: 'm1', athlete_id: 'a1', type: 'dinner', quality: 40, day_date: '2026-07-27', ...over });

describe('the local window', () => {
  // 22:00 UTC — afternoon in New York, late night in London, next morning in Tokyo.
  const at22Utc = new Date('2026-07-27T22:00:00Z');

  it('sends in the athlete\'s own afternoon', () => {
    expect(inLocalWindow(at22Utc, 'America/New_York')).toBe(true);   // 18:00 local
  });

  it('does NOT send at 11pm or 7am local, whatever the UTC hour', () => {
    expect(inLocalWindow(at22Utc, 'Europe/London')).toBe(false);     // 23:00 local
    expect(inLocalWindow(at22Utc, 'Asia/Tokyo')).toBe(false);        // 07:00 local next day
  });

  it('SKIPS an athlete with no timezone rather than guessing', () => {
    // Guessing means pushing at 3am for someone, which loses notification permission for good.
    expect(inLocalWindow(at22Utc, null)).toBe(false);
    expect(inLocalWindow(at22Utc, undefined)).toBe(false);
    expect(inLocalWindow(at22Utc, '')).toBe(false);
  });

  it('skips an invalid timezone instead of throwing', () => {
    expect(inLocalWindow(at22Utc, 'Not/AZone')).toBe(false);
  });

  it('is inclusive at the open and exclusive at the close', () => {
    const at19 = new Date('2026-07-27T19:00:00Z');
    expect(inLocalWindow(at19, 'UTC', 19, 20)).toBe(true);
    expect(inLocalWindow(at19, 'UTC', 15, 19)).toBe(false);
  });
});

describe('the once-per-day key is the ATHLETE\'s date', () => {
  it('uses local calendar date, so the day rolls over where they live', () => {
    const lateUtc = new Date('2026-07-27T23:30:00Z');
    expect(localDateISO(lateUtc, 'America/New_York')).toBe('2026-07-27'); // still the 27th there
    expect(localDateISO(lateUtc, 'Asia/Tokyo')).toBe('2026-07-28');       // already the 28th
  });
  it('returns null with no timezone — the caller must skip', () => {
    expect(localDateISO(new Date(), null)).toBeNull();
  });
});

describe('picking a meal worth speaking about', () => {
  it('picks a low-quality dinner', () => {
    expect(pickFollowUpMeal([meal({ quality: 40 })])?.id).toBe('m1');
  });

  it('says nothing when the evening was fine', () => {
    expect(pickFollowUpMeal([meal({ quality: 85 })])).toBeNull();
  });

  it('ignores breakfast and lunch — the athlete cannot act on them today', () => {
    expect(pickFollowUpMeal([meal({ type: 'breakfast', quality: 10 })])).toBeNull();
    expect(pickFollowUpMeal([meal({ type: 'lunch', quality: 10 })])).toBeNull();
  });

  it('speaks about the WORSE of two weak evening meals', () => {
    const picked = pickFollowUpMeal([
      meal({ id: 'dinner', quality: 50 }),
      meal({ id: 'snack', type: 'snack', quality: 20 }),
    ]);
    expect(picked?.id).toBe('snack');
  });

  it('says nothing when quality is unknown — absence is not evidence', () => {
    expect(pickFollowUpMeal([meal({ quality: null })])).toBeNull();
  });

  it('says nothing at all when there are no meals', () => {
    expect(pickFollowUpMeal([])).toBeNull();
  });

  it('treats the threshold as inclusive', () => {
    expect(pickFollowUpMeal([meal({ quality: LOW_QUALITY })])?.id).toBe('m1');
    expect(pickFollowUpMeal([meal({ quality: LOW_QUALITY + 1 })])).toBeNull();
  });
});

describe('the fallback message', () => {
  it('ships a real message when the model is unavailable', () => {
    const t = fallbackFollowUp(meal({ quality: 48 }));
    expect(t).toContain('48');
    expect(t.length).toBeLessThan(160);
  });

  it('quotes no figure for an athlete who is not tracking numbers', () => {
    const t = fallbackFollowUp(meal({ quality: 48 }), false);
    expect(t).not.toMatch(/\d/);
  });
});

describe('delivery addressing', () => {
  it('routes to the meal it is about, where the context lives', () => {
    // NOT today's slot — that meal isn't logged yet, so the message would land on an empty screen.
    expect(routeForMeal('abc-123')).toBe('meal-view/abc-123');
  });

  it('carries the meal id in the notification kind (no schema change needed)', () => {
    expect(notificationKind('abc-123')).toBe('ai_followup:abc-123');
    expect(notificationKind('abc-123').split(':')[1]).toBe('abc-123');
  });

  it('the route shape passes the native deep-link validator', () => {
    // ProtoApp.tsx deliverRoute: /^[a-z0-9/_-]{1,64}$/i
    expect(/^[a-z0-9/_-]{1,64}$/i.test(routeForMeal('7f3a1b2c-9d8e-4f5a-b6c7-d8e9f0a1b2c3'))).toBe(true);
  });
});
