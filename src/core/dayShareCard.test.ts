/**
 * DAY SHARE CARD payload (proto/redesign-2026-07/js/share-card.js).
 *
 * The renderer was written for a month and a day, but only the monthly report ever called it, so the
 * daily score could not leave the app — the cheapest growth surface in the product, sitting unused
 * behind a working bridge.
 *
 * These lock what the card CLAIMS, which is the part that matters: a shared card is a public
 * artifact, so an unknown value must never render as a confident zero, and a card nobody would post
 * is a card that does not grow anything.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const { dayShareCard } = require('../../proto/redesign-2026-07/js/share-card.js');

type Card = { payload: { score: number | null; eyebrow: string; caption: string; stats: [string, string][] }; caption: string };
const card = (day: unknown): Card => dayShareCard(day);
const statMap = (c: Card) => Object.fromEntries(c.payload.stats);

describe('the number', () => {
  test('a real score comes through rounded and clamped', () => {
    expect(card({ score: 87.4 }).payload.score).toBe(87);
    expect(card({ score: 140 }).payload.score).toBe(100);
    expect(card({ score: -5 }).payload.score).toBe(0);
  });

  test('an unknown score is null, never 0 — the renderer draws an em dash for null', () => {
    // A shared card is a public claim. "0" says the athlete scored zero; "—" says we do not know.
    for (const bad of [undefined, null, NaN, 'abc', {}]) {
      expect(card({ score: bad }).payload.score).toBeNull();
    }
    expect(card(undefined).payload.score).toBeNull();
  });
});

describe('the supporting stats only claim what exists', () => {
  test('a denominator appears when there is one', () => {
    expect(statMap(card({ score: 90, met: 4, total: 5 })).Completed).toBe('4 of 5');
  });

  test('no denominator means no Completed row — "0 of 0" is noise on something you post', () => {
    expect(statMap(card({ score: 90 })).Completed).toBeUndefined();
    expect(statMap(card({ score: 90, total: 0 })).Completed).toBeUndefined();
  });

  test('met is never allowed to exceed total', () => {
    expect(statMap(card({ score: 90, met: 9, total: 5 })).Completed).toBe('5 of 5');
  });

  test('a streak appears from 2 days, not from 1', () => {
    expect(statMap(card({ score: 90, streak: 1 })).Streak).toBeUndefined();
    expect(statMap(card({ score: 90, streak: 2 })).Streak).toBe('2 days');
  });

  test('the tier matches the app bands', () => {
    expect(statMap(card({ score: 95 })).Standard).toBe('OnStandard');
    expect(statMap(card({ score: 80 })).Standard).toBe('Locked In');
    expect(statMap(card({ score: 65 })).Standard).toBe('Building');
    expect(statMap(card({ score: 20 })).Standard).toBe('Off Standard');
  });

  test('at most three stats, which is all the renderer draws', () => {
    expect(card({ score: 95, met: 5, total: 5, streak: 9 }).payload.stats.length).toBeLessThanOrEqual(3);
  });
});

describe('the caption is something a person would actually post', () => {
  test('a streak leads with the streak', () => {
    expect(card({ score: 91, streak: 6 }).caption).toBe('Day 6 of my streak · 91 on OnStandard.');
  });

  test('without a streak it is just the number', () => {
    expect(card({ score: 91 }).caption).toBe('91 on OnStandard today.');
  });

  test('it never scolds — no missed, behind, or lost', () => {
    for (const s of [12, 55, 91]) {
      expect(card({ score: s }).caption.toLowerCase()).not.toMatch(/missed|behind|lost|failed|only/);
    }
  });

  test('an unknown score degrades to a dash rather than claiming zero', () => {
    expect(card({}).caption).toBe('— on OnStandard today.');
  });
});

describe('framing', () => {
  test('the eyebrow defaults to Today and can be overridden', () => {
    expect(card({ score: 90 }).payload.eyebrow).toBe('Today');
    expect(card({ score: 90, eyebrow: 'Thursday' }).payload.eyebrow).toBe('Thursday');
  });

  test('the caption line says what the number IS', () => {
    expect(card({ score: 90 }).payload.caption).toBe('Daily score');
  });

  test('junk input is safe — a tap must never throw', () => {
    expect(() => card(null)).not.toThrow();
    expect(() => card('nope')).not.toThrow();
    expect(() => card(42)).not.toThrow();
  });
});
