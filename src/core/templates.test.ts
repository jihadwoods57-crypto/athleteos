// @ts-ignore
import { seedTemplates, TEMPLATE_KINDS, templateLabel } from '../../proto/redesign-2026-07/js/templates.js';

test('seven seeds, one per standard kind, deterministic', () => {
  const seeds = seedTemplates();
  expect(seeds.map(s => s.kind).sort()).toEqual([...TEMPLATE_KINDS].sort());
  expect(seedTemplates()).toEqual(seeds); // pure — same output every call
});

test('every seed passes the 0055/0074 item rails', () => {
  for (const s of seedTemplates()) {
    expect(s.items.length).toBeGreaterThanOrEqual(1);
    expect(s.items.length).toBeLessThanOrEqual(24);
    const meals = s.items.filter((i: any) => i.kind === 'meal');
    expect(meals.length).toBeGreaterThanOrEqual(1);
    expect(meals.length).toBeLessThanOrEqual(6);
    for (const it of s.items) {
      expect(typeof it.id).toBe('string');
      expect(typeof it.title).toBe('string');
      expect(['meal','lift','hydration','recovery','weigh','checkin','custom']).toContain(it.kind);
      expect(['photo','form','scale','counter','check']).toContain(it.proof);
      if (it.window) {
        if (it.window.open != null) expect(it.window.open).toBeGreaterThanOrEqual(0);
        expect(it.window.due).toBeLessThanOrEqual(1439);
        if (it.window.open != null) expect(it.window.due).toBeGreaterThanOrEqual(it.window.open);
      }
    }
  }
});

test('the templates differ where it matters', () => {
  const by = Object.fromEntries(seedTemplates().map(s => [s.kind, s]));
  const meals = (k: string) => by[k].items.filter((i: any) => i.kind === 'meal').length;
  expect(meals('weight_gain')).toBeGreaterThan(meals('weight_loss'));
  expect(by['travel'].items.some((i: any) => i.kind === 'lift')).toBe(false);
  expect(by['travel'].items.some((i: any) => i.kind === 'checkin')).toBe(false);
  expect(by['injured'].items.some((i: any) => i.kind === 'recovery')).toBe(true);
  expect(templateLabel('game_week')).toBe('Game week');
});

test('seedTemplates() returns fresh deep copies — mutating one call cannot affect the next', () => {
  const first = seedTemplates();
  first[0].name = 'MUTATED';
  first[0].items[0].title = 'MUTATED';
  first[0].items[0].window.due = 1;
  if (first[0].items[0].freq.days) first[0].items[0].freq.days.push(9);

  const second = seedTemplates();
  expect(second[0].name).not.toBe('MUTATED');
  expect(second[0].items[0].title).not.toBe('MUTATED');
  expect(second[0].items[0].window.due).not.toBe(1);
  if (second[0].items[0].freq.days) expect(second[0].items[0].freq.days).not.toContain(9);
});
