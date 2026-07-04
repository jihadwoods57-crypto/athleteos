import { rosterCsv } from './rosterExport';

describe('rosterCsv', () => {
  it('serializes the roster with grades, header first', () => {
    const csv = rosterCsv([
      { name: 'Jihad Carter', pos: 'WR', score: 88, comp: 92, loggedToday: true },
      { name: 'Sam "Tank" Lee', pos: 'OL', score: 55, comp: 40, loggedToday: false },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Athlete,Position,Score,Grade,Compliance %,Logged today');
    expect(lines[1]).toContain('Jihad Carter,WR,88,');
    expect(lines[1]).toContain(',yes');
    expect(lines[2]).toContain(',no');
    // Quoted name with embedded quotes survives round-trip escaping.
    expect(lines[2].startsWith('"Sam ""Tank"" Lee"')).toBe(true);
  });
  it('handles the empty roster (header only)', () => {
    expect(rosterCsv([])).toBe('Athlete,Position,Score,Grade,Compliance %,Logged today');
  });
});
