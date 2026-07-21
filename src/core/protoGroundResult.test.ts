/**
 * Payload-compat gate for groundResult (Tier 1, 2026-07-21): the client must produce a
 * correct, deterministic result from EVERY analyze-meal payload shape that can reach it —
 * (a) the pre-0062 legacy shape (detected = plain strings), (b) the CURRENT prod deploy's
 * shape (detected = {name, confidence, quantity}, no per-food macros), and (c) the new
 * shape (per-food macros). This is what makes the analyze-meal deploy order safe in both
 * directions: old server + new client falls back to meal-level DB grounding; new server +
 * new client gets per-food attribution. In every shape the SCORE is computed by the app —
 * the AI's quality number is never stored as the score. JSDOM + lazy require, same pattern
 * as protoMealPropagation.test.ts.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { groundResult, MEAL } = require('../../proto/redesign-2026-07/js/state.js');

beforeEach(() => {
  MEAL.key = 'dinner';
  MEAL.capturedAtMin = 17 * 60; // 5:00 PM — inside the dinner window, minutesLate 0
});

/** The CURRENT prod edge deploy's wire shape — rich detected rows, NO per-food macros. */
const oldShapePayload = () => ({
  kind: 'result', name: 'Chicken & Rice', quality: 88,
  protein: 300, kcal: 2400, carbs: 45, fat: 10, fiber: 5, // hallucinated protein on purpose
  detected: [
    { name: 'Grilled chicken', confidence: 'high', quantity: '6 oz' },
    { name: 'White rice', confidence: 'medium', quantity: '1 cup' },
  ],
  highlights: [], note: 'Solid fueling.',
  analysis: 'Chicken and rice covers the basics for your goal.',
});

/** The pre-0062 legacy shape — detected as plain strings. */
const legacyShapePayload = () => ({
  ...oldShapePayload(), detected: ['Grilled chicken', 'White rice'],
});

/** The NEW shape — per-food macro attribution. */
const newShapePayload = () => ({
  kind: 'result', name: 'Chicken, Rice & Broccoli', quality: 84,
  protein: 42, kcal: 426, carbs: 51, fat: 4, fiber: 6,
  detected: [
    { name: 'Grilled chicken', confidence: 'high', protein: 35, kcal: 190, carbs: 0, fat: 4 },
    { name: 'White rice', confidence: 'high', protein: 4, kcal: 205, carbs: 45, fat: 0 },
    { name: 'Broccoli', confidence: 'medium', protein: 3, kcal: 31, carbs: 6, fat: 0 },
  ],
  highlights: [], note: 'In on time.', analysis: 'A balanced plate that supports the goal.',
});

describe('groundResult — old-shape payloads (current prod deploy, no per-food macros)', () => {
  test('rich rows without macros take the meal-level DB grounding fallback', () => {
    const r = groundResult(oldShapePayload());
    // 300g "protein" bounded against the summed DB reference (chicken 35 + rice 4 → hi = 39*3+18 = 135)
    expect(r.protein).toBeLessThanOrEqual(135);
    expect(r.detectedRich.every((d: any) => d.per === undefined)).toBe(true);
    expect(r.detected).toEqual(['Grilled chicken', 'White rice']);
  });
  test('legacy string-array detected still normalizes and grounds', () => {
    const r = groundResult(legacyShapePayload());
    expect(r.protein).toBeLessThanOrEqual(135);
    expect(r.detectedRich.map((d: any) => d.name)).toEqual(['Grilled chicken', 'White rice']);
  });
  test('the SCORE is the app\'s, the AI\'s 88 survives only as aiQuality', () => {
    const r = groundResult(oldShapePayload());
    expect(r.aiQuality).toBe(88);
    expect(r.quality).not.toBeNull();
    expect(r.quality).not.toBe(88); // deterministic, from the grounded macros — not the AI's number
  });
});

describe('groundResult — new-shape payloads (per-food macros)', () => {
  test('totals are the sum of the per-food grounded macros', () => {
    const r = groundResult(newShapePayload());
    expect(r.protein).toBe(42); // 35 + 4 + 3, every food inside its DB band
    expect(r.detectedRich.every((d: any) => d.per && d.per.protein >= 0)).toBe(true);
  });
  test('deterministic quality + aiQuality cross-check both present', () => {
    const r = groundResult(newShapePayload());
    expect(typeof r.quality).toBe('number');
    expect(r.aiQuality).toBe(84);
  });
});

describe('groundResult — score↔language agreement (the swap to the honest line)', () => {
  test('praising prose on a weak plate is replaced by the deterministic reason', () => {
    const weak = {
      ...newShapePayload(), quality: 90,
      protein: 5, kcal: 640, carbs: 60, fat: 40, fiber: 0,
      detected: [{ name: 'Loaded fries', confidence: 'high', protein: 5, kcal: 640, carbs: 60, fat: 40 }],
      note: 'Great meal, keep this in rotation.',
      analysis: 'Excellent work, this is exactly what you need. Keep this in rotation.',
    };
    const r = groundResult(weak);
    expect(r.quality).toBeLessThan(50); // weak band, computed by the app
    expect(r.analysis).toBe('');        // praising paragraph dropped
    expect(r.note).not.toMatch(/rotation|excellent|great/i);
    expect(r.note.length).toBeGreaterThan(0); // deterministic qualityReason line speaks instead
  });
  test('agreeing prose rides along untouched', () => {
    const r = groundResult(newShapePayload());
    expect(r.analysis).toBe('A balanced plate that supports the goal.');
  });
});
