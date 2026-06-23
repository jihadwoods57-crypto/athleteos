// AthleteOS — clock helpers. todayStamp is covered via dayRollover; here we pin
// the time-of-day greeting boundaries used by the Home header.
import { greeting, todayStamp } from './clock';

// Build a local-time Date at a given hour so getHours() is deterministic.
const at = (hour: number) => new Date(2026, 5, 23, hour, 0, 0);

describe('greeting', () => {
  it('says good morning before noon', () => {
    expect(greeting(at(0))).toBe('Good morning');
    expect(greeting(at(8))).toBe('Good morning');
    expect(greeting(at(11))).toBe('Good morning');
  });

  it('switches to afternoon at noon through 16:59', () => {
    expect(greeting(at(12))).toBe('Good afternoon');
    expect(greeting(at(16))).toBe('Good afternoon');
  });

  it('switches to evening from 17:00', () => {
    expect(greeting(at(17))).toBe('Good evening');
    expect(greeting(at(23))).toBe('Good evening');
  });
});

describe('todayStamp', () => {
  it('formats the local date as YYYY-MM-DD with zero padding', () => {
    expect(todayStamp(new Date(2026, 0, 5, 9, 0, 0))).toBe('2026-01-05');
  });
});
