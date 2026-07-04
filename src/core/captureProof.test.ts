import { captureProof, CLOSING_SOON_MIN } from './captureProof';

const at = (h: number, m = 0) => h * 60 + m;

describe('captureProof', () => {
  it('names the requirement + real window and the time left', () => {
    const p = captureProof({ mealType: 'Dinner', nowMin: at(18), overseer: 'coach' });
    expect(p.windowLine).toBe('DINNER · closes 8:30 PM');
    expect(p.timeLine).toBe('2h 30m left');
    expect(p.urgency).toBe('open');
    expect(p.seenLine).toContain('coach sees this');
  });

  it('turns urgent inside the closing window', () => {
    const p = captureProof({ mealType: 'Dinner', nowMin: at(20, 10), overseer: null });
    expect(p.urgency).toBe('closing');
    expect(p.timeLine).toBe('Closes in 20m');
    expect(CLOSING_SOON_MIN).toBe(45);
  });

  it('past the window is honest about consequences per the engines flag', () => {
    const strict = captureProof({ mealType: 'Breakfast', nowMin: at(11), overseer: 'trainer', lateMatters: true });
    expect(strict.urgency).toBe('late');
    expect(strict.timeLine).toContain('logs as late');
    const lenient = captureProof({ mealType: 'Breakfast', nowMin: at(11), overseer: null });
    expect(lenient.timeLine).toBe('Past the usual window. Still counts.');
    expect(lenient.timeLine).not.toContain('late.');
  });

  it('no linked overseer means no fabricated audience', () => {
    expect(captureProof({ mealType: 'Lunch', nowMin: at(12), overseer: null }).seenLine).toBeNull();
  });

  it('never uses an em dash', () => {
    for (const now of [at(7), at(9, 20), at(23)]) {
      const p = captureProof({ mealType: 'Breakfast', nowMin: now, overseer: 'coach', lateMatters: true });
      expect(`${p.windowLine} ${p.timeLine} ${p.seenLine}`).not.toContain('—');
    }
  });
});
