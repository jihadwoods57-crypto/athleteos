// Every rule here is about NOT sending. A proactive message that fires at the wrong hour, twice,
// or for no reason costs more than it earns — the athlete mutes the app, and then the message that
// mattered is muted too.
import {
  inLocalWindow, localDateISO, pickFollowUpMeal, fallbackFollowUp, routeForMeal, notificationKind,
  routeForCoachMeal, LOW_QUALITY, type MealRow,
  openMealSlots, proteinLoggedFromDay, pickDayGapNudge, dayGapFallback, dayGapMessageOk,
  clampSentences, routeForSlot, dayGapKind, DAY_GAP_MIN_G, DAY_GAP_WINDOW, type DayRowForGap,
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

  it('routes a COACH to the staff-side meal thread, distinct from the athlete route', () => {
    expect(routeForCoachMeal('abc-123')).toBe('coach-meal/abc-123');
  });

  it('the coach route shape also passes the native deep-link validator', () => {
    expect(/^[a-z0-9/_-]{1,64}$/i.test(routeForCoachMeal('7f3a1b2c-9d8e-4f5a-b6c7-d8e9f0a1b2c3'))).toBe(true);
  });
});

/* ---------------- the day-gap nudge (2026-09-10) ---------------- */

const NOW = Date.parse('2026-09-10T23:30:00Z');   // 19:30 in New York
const inAnHour = new Date(NOW + 3600_000).toISOString();
const anHourAgo = new Date(NOW - 3600_000).toISOString();

const dayRow = (over: Partial<DayRowForGap> = {}): DayRowForGap => ({
  athlete_id: 'a1', date: '2026-09-10',
  meals: { breakfast: true, lunch: true, snack: false, dinner: false },
  checkin: { slotMacros: { breakfast: { protein: 35 }, lunch: { protein: 45 }, dinner: { protein: 60 } } },
  tasks: [
    { id: 'breakfast', done: true, dueAt: anHourAgo },
    { id: 'lunch', done: true, dueAt: anHourAgo },
    { id: 'dinner', done: false, dueAt: inAnHour },
    { id: 'recovery', done: false, dueAt: inAnHour },
  ],
  ...over,
});

describe('open meal slots come from the client\'s own deadlines', () => {
  it('names the undone meal slots still due, soonest first, and nothing else', () => {
    const later = new Date(NOW + 2 * 3600_000).toISOString();
    const open = openMealSlots([
      { id: 'snack', done: false, dueAt: later },
      { id: 'dinner', done: false, dueAt: inAnHour },
      { id: 'recovery', done: false, dueAt: inAnHour },   // not food
      { id: 'cs:abc', done: false },                        // not food, no deadline
      { id: 'lunch', done: false, dueAt: anHourAgo },       // already past: that is a miss, not a gap
      { id: 'breakfast', done: true, dueAt: inAnHour },     // done
    ], NOW);
    expect(open).toEqual(['dinner', 'snack']);
  });

  it('a slot with no dueAt is unknown, never open', () => {
    expect(openMealSlots([{ id: 'dinner', done: false }], NOW)).toEqual([]);
    expect(openMealSlots(null, NOW)).toEqual([]);
  });

  it('accepts a coach-defined slot id', () => {
    expect(openMealSlots([{ id: 'meal-5', done: false, dueAt: inAnHour }], NOW)).toEqual(['meal-5']);
  });
});

describe('protein already on the board', () => {
  it('sums only the slots the day marks logged', () => {
    // dinner has macros stamped (a stale re-read) but meals.dinner is false: it does not count.
    expect(proteinLoggedFromDay(dayRow())).toBe(80);
  });
  it('is zero for a missing or malformed row', () => {
    expect(proteinLoggedFromDay(null)).toBe(0);
    expect(proteinLoggedFromDay(dayRow({ meals: 'nope', checkin: null }))).toBe(0);
  });
});

describe('picking the day-gap nudge', () => {
  it('fires when the shortfall is real and a meal is still open', () => {
    const n = pickDayGapNudge(dayRow(), 180, NOW);
    expect(n).toEqual({ gap: 100, target: 180, soFar: 80, slot: 'dinner', openSlots: ['dinner'] });
  });

  it('says nothing under the threshold, and the threshold is exclusive', () => {
    expect(pickDayGapNudge(dayRow(), 80 + DAY_GAP_MIN_G, NOW)).toBeNull();
    expect(pickDayGapNudge(dayRow(), 80 + DAY_GAP_MIN_G + 1, NOW)?.gap).toBe(DAY_GAP_MIN_G + 1);
  });

  it('says nothing once every meal slot is closed: that is the day\'s score, not a nudge', () => {
    const closed = dayRow({ tasks: [{ id: 'dinner', done: true, dueAt: inAnHour }, { id: 'recovery', done: false, dueAt: inAnHour }] });
    expect(pickDayGapNudge(closed, 180, NOW)).toBeNull();
  });

  it('says nothing without a real target: a guessed target is an invented number', () => {
    expect(pickDayGapNudge(dayRow(), null, NOW)).toBeNull();
    expect(pickDayGapNudge(dayRow(), 0, NOW)).toBeNull();
    expect(pickDayGapNudge(dayRow(), 'lots', NOW)).toBeNull();
    expect(pickDayGapNudge(dayRow(), 900, NOW)).toBeNull();
  });

  it('lands on the slot due soonest', () => {
    const two = dayRow({ tasks: [
      { id: 'dinner', done: false, dueAt: new Date(NOW + 2 * 3600_000).toISOString() },
      { id: 'snack', done: false, dueAt: inAnHour },
    ] });
    expect(pickDayGapNudge(two, 180, NOW)?.slot).toBe('snack');
  });

  it('the window is the athlete\'s own 7pm hour', () => {
    const [s, e] = DAY_GAP_WINDOW;
    expect(inLocalWindow(new Date(NOW), 'America/New_York', s, e)).toBe(true);   // 19:30
    expect(inLocalWindow(new Date(NOW), 'America/Chicago', s, e)).toBe(false);   // 18:30
    expect(inLocalWindow(new Date(NOW), 'Europe/London', s, e)).toBe(false);     // 00:30
  });
});

describe('the day-gap message', () => {
  const n = { gap: 40, target: 180, soFar: 140, slot: 'dinner', openSlots: ['dinner'] };

  it('the fallback carries the exact gap and target in two sentences', () => {
    const t = dayGapFallback(n);
    expect(t).toContain('40g');
    expect(t).toContain('180g');
    expect(t).not.toContain('—');
    expect(clampSentences(t, 99).split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
    expect(dayGapMessageOk(t, n)).toBe(true);
  });

  it('a coach-defined slot reads as "your next meal", never as its id', () => {
    const t = dayGapFallback({ ...n, slot: 'meal-5', openSlots: ['meal-5'] });
    expect(t).toContain('your next meal');
    expect(t).not.toContain('meal-5');
  });

  it('a model message must quote the exact gap, invent nothing, and stop at two sentences', () => {
    expect(dayGapMessageOk('Dinner is still open and you are 40g short. What is the plan?', n)).toBe(true);
    expect(dayGapMessageOk('You are 45g short tonight. Go.', n)).toBe(false);          // wrong number
    expect(dayGapMessageOk('40g short. Aim for 50g at dinner.', n)).toBe(false);       // an invented figure
    expect(dayGapMessageOk('40g short. Dinner is open. Fix it tonight.', n)).toBe(false); // three sentences
    expect(dayGapMessageOk('40g short — dinner is open.', n)).toBe(false);             // em dash
    expect(dayGapMessageOk('', n)).toBe(false);
  });

  it('clampSentences keeps the first two and drops the rest', () => {
    expect(clampSentences('One. Two! Three?', 2)).toBe('One. Two!');
    expect(clampSentences('Only one', 2)).toBe('Only one');
  });
});

describe('day-gap delivery addressing', () => {
  it('routes to the camera for the slot that closes the gap, in the native deep-link shape', () => {
    expect(routeForSlot('dinner')).toBe('camera/dinner');
    expect(/^[a-z0-9/_-]{1,64}$/i.test(routeForSlot('meal-5'))).toBe(true);
  });
  it('carries the slot in the notification kind, distinct from the follow-up kind', () => {
    expect(dayGapKind('dinner')).toBe('ai_daygap:dinner');
    expect(dayGapKind('dinner').startsWith('ai_followup')).toBe(false);
  });
});
