/**
 * WINBACK selection (supabase/functions/_shared/winback.ts).
 *
 * The riskiest message the product sends: it reaches people who have already stopped. Every test
 * here is about NOT sending — the failure mode is not "we missed someone", it is "we nagged
 * someone who had already left, and confirmed their decision".
 */
import { selectWinbacks, winbackKind, daysBetween, type LapsedCandidate } from '../../supabase/functions/_shared/winback';

const TODAY = '2026-07-29';
const ago = (n: number) => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const who = (over: Partial<LapsedCandidate> = {}): LapsedCandidate => ({
  athleteId: 'a1', lastActiveISO: ago(5), createdISO: ago(60), optedOut: false, alreadySent: [], ...over,
});

const pick = (c: Partial<LapsedCandidate> = {}) => selectWinbacks([who(c)], TODAY);

describe('daysBetween is date-only, so DST never moves a boundary', () => {
  test('counts whole days', () => expect(daysBetween('2026-07-20', '2026-07-29')).toBe(9));
  test('same day is zero', () => expect(daysBetween(TODAY, TODAY)).toBe(0));
  test('across a DST change still counts calendar days', () => expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30));
  test('junk is 0, never NaN', () => expect(daysBetween('nope', TODAY)).toBe(0));
});

describe('who gets spoken to', () => {
  test('gone 5 days → the day-3 message', () => {
    const s = pick({ lastActiveISO: ago(5) });
    expect(s).toHaveLength(1);
    expect(s[0].stage).toBe('d3');
    expect(s[0].kind).toBe('winback:d3');
  });

  test('gone 12 days → the day-10 message', () => {
    expect(pick({ lastActiveISO: ago(12) })[0].stage).toBe('d10');
  });

  test('active today or yesterday hears nothing', () => {
    expect(pick({ lastActiveISO: TODAY })).toHaveLength(0);
    expect(pick({ lastActiveISO: ago(1) })).toHaveLength(0);
  });

  test('gone 2 days is not yet lapsed — a rest day is not a loss', () => {
    expect(pick({ lastActiveISO: ago(2) })).toHaveLength(0);
  });

  test('gone 45 days is not a lapse to recover, and we stay quiet', () => {
    expect(pick({ lastActiveISO: ago(45) })).toHaveLength(0);
  });
});

describe('who is deliberately left alone', () => {
  test('never logged anything: activation owns them, not winback', () => {
    expect(pick({ lastActiveISO: null })).toHaveLength(0);
  });

  test('a brand-new account has not lapsed, it has not begun', () => {
    expect(pick({ createdISO: ago(1), lastActiveISO: null })).toHaveLength(0);
    expect(pick({ createdISO: TODAY })).toHaveLength(0);
  });

  test('opted out of notifications means opted out of this too', () => {
    expect(pick({ optedOut: true })).toHaveLength(0);
  });

  test('already told at this stage is never told again', () => {
    expect(pick({ lastActiveISO: ago(5), alreadySent: ['winback:d3'] })).toHaveLength(0);
  });

  test('someone who already got the day-10 message never drops back to day-3', () => {
    // Lapsed, came back, lapsed again past day 3. The last word has already been said.
    expect(pick({ lastActiveISO: ago(4), alreadySent: ['winback:d10'] })).toHaveLength(0);
  });

  test('day-3 already sent does not block the later day-10 message', () => {
    const s = pick({ lastActiveISO: ago(11), alreadySent: ['winback:d3'] });
    expect(s).toHaveLength(1);
    expect(s[0].stage).toBe('d10');
  });

  test('two in a lifetime is the ceiling', () => {
    expect(pick({ lastActiveISO: ago(11), alreadySent: ['winback:d3', 'winback:d10'] })).toHaveLength(0);
  });
});

describe('the copy never guilts', () => {
  test('no streak, no score, no count of missed days', () => {
    for (const days of [4, 12]) {
      const s = pick({ lastActiveISO: ago(days) })[0];
      const all = `${s.title} ${s.body}`.toLowerCase();
      expect(all).not.toMatch(/streak|score|missed|behind|lost|\d+ days?/);
    }
  });

  test('it asks for one plate, not a recovered day', () => {
    expect(pick({ lastActiveISO: ago(4) })[0].body.toLowerCase()).toMatch(/one (plate|meal)/);
  });

  test('it routes home, where logging starts', () => {
    expect(pick({ lastActiveISO: ago(4) })[0].route).toBe('home');
  });
});

describe('batching', () => {
  test('the longest-gone are served first when the batch is capped', () => {
    const many: LapsedCandidate[] = [4, 20, 12, 6].map((d, i) => who({ athleteId: `a${i}`, lastActiveISO: ago(d) }));
    const s = selectWinbacks(many, TODAY, 2);
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.daysGone)).toEqual([20, 12]);
  });

  test('one send per athlete, never two', () => {
    const s = selectWinbacks([who({ athleteId: 'solo', lastActiveISO: ago(11) })], TODAY);
    expect(s.filter((x) => x.athleteId === 'solo')).toHaveLength(1);
  });

  test('an empty or junk batch is safe', () => {
    expect(selectWinbacks([], TODAY)).toEqual([]);
    expect(selectWinbacks([null as never], TODAY)).toEqual([]);
    expect(selectWinbacks([who()], TODAY, 0)).toEqual([]);
  });

  test('winbackKind is stable — it is the durable dedupe key', () => {
    expect(winbackKind('d3')).toBe('winback:d3');
    expect(winbackKind('d10')).toBe('winback:d10');
  });
});
