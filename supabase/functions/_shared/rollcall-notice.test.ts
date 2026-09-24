import {
  groupNotices, daysLabel, clockAt, dayName, noticeCopy, armPayload, alarmLabelOf, alarmTitleOf,
  settleRowsOf, NOTICE_ROUTE, ARM_MAX_ITEMS, ARM_PAYLOAD_MAX_BYTES, type NoticeRow, type NoticeContext,
} from './rollcall-notice';

const TZ = 'America/New_York';
const row = (o: Partial<NoticeRow> = {}): NoticeRow => ({
  response_id: 'r1', athlete_id: 'a1', commitment_id: 'c1', instance_id: 'i1', kind: 'assigned',
  starts_at: '2026-09-28T08:45:00Z', occurs_on: '2026-09-28', was_starts_at: null, off: false,
  claimed_at: '2026-09-24T12:00:00.123Z', ...o,
});
const ctx: NoticeContext = {
  commitment_id: 'c1', title: 'Morning Roll Call', action_label: null, coach_id: 'co1', coach_name: 'Coach Brooks',
  repeat_days: [1, 2, 3, 4, 5], starts_min: 285, timezone: TZ, alarm: true,
};

describe('daysLabel', () => {
  it('names the common shapes the way a coach says them', () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysLabel([0, 6])).toBe('Weekends');
    expect(daysLabel([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(daysLabel([])).toBe('');
    expect(daysLabel(null)).toBe('');
  });
});

describe('clock and day, in the roll call\'s own zone', () => {
  it('reads 8:45Z as 4:45 AM Monday in New York', () => {
    expect(clockAt('2026-09-28T08:45:00Z', TZ)).toBe('4:45 AM');
    expect(dayName('2026-09-28T08:45:00Z', TZ)).toBe('Monday');
  });
});

describe('groupNotices', () => {
  it('makes ONE group per athlete and roll call, ranked assigned over moved over cancelled over extend', () => {
    const g = groupNotices([
      row({ response_id: 'r1', instance_id: 'i1', kind: 'extend', starts_at: '2026-09-30T08:45:00Z' }),
      row({ response_id: 'r2', instance_id: 'i2', kind: 'moved', starts_at: '2026-09-29T09:15:00Z', was_starts_at: '2026-09-29T08:45:00Z' }),
      row({ response_id: 'r3', instance_id: 'i3', kind: 'cancelled', off: true }),
      row({ response_id: 'r4', athlete_id: 'a2', kind: 'assigned' }),
      row({ response_id: 'r5', instance_id: 'i5', kind: 'silent', off: true }),
    ]);
    expect(g).toHaveLength(2);
    const a1 = g.find((x) => x.athleteId === 'a1')!;
    expect(a1.kind).toBe('moved');
    expect(a1.arm.map((r) => r.instance_id)).toEqual(['i2', 'i1']);   // nearest first
    expect(a1.cancel.map((r) => r.instance_id)).toEqual(['i3']);
    expect(a1.moved.map((r) => r.instance_id)).toEqual(['i2']);
    expect(a1.silent.map((r) => r.instance_id)).toEqual(['i5']);
  });
});

describe('noticeCopy', () => {
  it('assigned: the coach by name, the days and time, and an honest fallback', () => {
    const [g] = groupNotices([row()]);
    const c = noticeCopy(g, ctx);
    expect(c.title).toBe('Coach Brooks put you on roll call');
    expect(c.body).toBe('Mon–Fri at 4:45 AM. Open OnStandard to set your alarm.');
    expect(c.setBody).toBe('Mon–Fri at 4:45 AM. Alarm set ✓');
    expect(c.sound).toBe('default');
    expect(c.interruption).toBe('active');
  });
  it('moved: one morning names its day and new time', () => {
    const [g] = groupNotices([row({ kind: 'moved', starts_at: '2026-10-01T08:45:00Z', was_starts_at: '2026-09-29T08:45:00Z' })]);
    const c = noticeCopy(g, ctx);
    expect(c.title).toBe('Coach Brooks');
    expect(c.body).toBe('Thursday’s roll call moved to 4:45 AM. Open OnStandard to update your alarm.');
    expect(c.setBody).toBe('Thursday’s roll call moved to 4:45 AM. Alarm set ✓');
  });
  it('moved and cancelled together: the move leads, the day off rides along', () => {
    const [g] = groupNotices([
      row({ response_id: 'r1', instance_id: 'i1', kind: 'moved', starts_at: '2026-10-01T08:45:00Z' }),
      row({ response_id: 'r2', instance_id: 'i2', kind: 'cancelled', off: true, starts_at: '2026-09-29T08:45:00Z' }),
    ]);
    expect(noticeCopy(g, ctx).body).toBe('Thursday’s roll call moved to 4:45 AM. Tuesday is off. Open OnStandard to update your alarm.');
  });
  it('cancelled: says the day is off; the extension adds that the alarm is gone', () => {
    const [g] = groupNotices([row({ kind: 'cancelled', off: true, starts_at: '2026-10-01T08:45:00Z' })]);
    const c = noticeCopy(g, ctx);
    expect(c.body).toBe('Thursday’s roll call is off.');
    expect(c.setBody).toBe('Thursday’s roll call is off. Alarm removed.');
  });
  it('extend: quiet, OnStandard speaking', () => {
    const [g] = groupNotices([row({ kind: 'extend' })]);
    const c = noticeCopy(g, ctx);
    expect(c.title).toBe('Morning Roll Call');
    expect(c.body).toBe('Open OnStandard to set your next alarms.');
    expect(c.setBody).toBe('Your next alarms are set ✓');
    expect(c.interruption).toBe('passive');
    expect(c.sound).toBeNull();
  });
  it('remind: the coach asks for the next morning', () => {
    const [g] = groupNotices([row({ kind: 'remind' })]);
    const c = noticeCopy(g, ctx);
    expect(c.title).toBe('Coach Brooks');
    expect(c.body).toBe('Your coach wants your alarm set for Mon 4:45 AM. Open OnStandard to set it.');
    expect(c.setBody).toBe('Alarm set for Mon 4:45 AM ✓');
  });
  it('a coach who chose a notification, not an alarm, is never promised one', () => {
    const [g] = groupNotices([row()]);
    const c = noticeCopy(g, { ...ctx, alarm: false });
    expect(c.body).toBe('Mon–Fri at 4:45 AM.');
    expect(c.setBody).toBe('Mon–Fri at 4:45 AM.');
  });
  it('no em dash anywhere', () => {
    const kinds: NoticeRow['kind'][] = ['assigned', 'moved', 'cancelled', 'extend', 'remind'];
    for (const k of kinds) {
      const [g] = groupNotices([row({ kind: k, off: k === 'cancelled' })]);
      const c = noticeCopy(g, ctx);
      expect(`${c.title}${c.body}${c.setBody}`).not.toContain('—');
    }
  });
});

describe('armPayload', () => {
  const item = (n: number) => ({ i: `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`, at: 1790000000000 + n * 86400000, c: 'x'.repeat(200) });
  it('keeps the contract keys and nothing else', () => {
    const p = armPayload({ kind: 'assigned', title: 'T', label: 'I’m Up', url: 'https://x/functions/v1/roll-call-ack', items: [item(1)], cancel: [], set: 'ok' });
    expect(Object.keys(p).sort()).toEqual(['arm', 'cancel', 'kind', 'label', 'set', 'title', 'url', 'v']);
    expect(Object.keys(p.arm[0]).sort()).toEqual(['at', 'c', 'i']);
    expect(p.v).toBe(1);
  });
  it('arms the nearest mornings first and fits the push', () => {
    const items = Array.from({ length: 14 }, (_, k) => item(14 - k));
    const p = armPayload({ kind: 'assigned', title: 'T', label: 'L', url: 'https://x', items, cancel: [], set: 's' });
    expect(p.arm.length).toBeLessThanOrEqual(ARM_MAX_ITEMS);
    expect(p.arm[0].i.endsWith('01')).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(ARM_PAYLOAD_MAX_BYTES);
  });
});

describe('small pieces', () => {
  it('alarm title and label mirror the proto (wake-alarms.js alarmTitle / alarmButtonLabel)', () => {
    expect(alarmTitleOf(ctx)).toBe('Morning Roll Call');
    expect(alarmTitleOf({ ...ctx, title: '' })).toBe('Wake up');
    expect(alarmLabelOf(ctx)).toBe('I’m Up');
    expect(alarmLabelOf({ ...ctx, action_label: 'Attack the day, every single morning' })).toHaveLength(24);
  });
  it('the route fits the 64-char bound', () => {
    expect(NOTICE_ROUTE('3f2b1c4e-1111-2222-3333-444455556666')).toBe('rollcall-assigned/3f2b1c4e-1111-2222-3333-444455556666');
    expect(NOTICE_ROUTE('3f2b1c4e-1111-2222-3333-444455556666').length).toBeLessThanOrEqual(64);
  });
});

// The settle contract changed under this task (migration 0247, commit aeaac105): claim_rollcall_notices
// and rollcall_remind_rows_svc now return an extra last column, claimed_at, and settle_rollcall_notices
// only touches a row while claimed_at still matches notice_claimed_at to the millisecond. A row with
// no delivered push must settle sent: false so notified_at is never stamped for it (settled is not told).
describe('settleRowsOf', () => {
  it('carries claimed_at back unchanged and defaults sent to false', () => {
    expect(settleRowsOf([row()])).toEqual([
      { response_id: 'r1', starts_at: '2026-09-28T08:45:00Z', off: false, claimed_at: '2026-09-24T12:00:00.123Z', sent: false },
    ]);
  });
  it('marks sent: true only for a row whose push actually went out', () => {
    const rows = [
      row({ response_id: 'r1', claimed_at: '2026-09-24T12:00:00.100Z' }),
      row({ response_id: 'r2', claimed_at: '2026-09-24T12:00:00.200Z', off: true }),
    ];
    const out = settleRowsOf(rows, ['r1']);
    expect(out).toEqual([
      { response_id: 'r1', starts_at: '2026-09-28T08:45:00Z', off: false, claimed_at: '2026-09-24T12:00:00.100Z', sent: true },
      { response_id: 'r2', starts_at: '2026-09-28T08:45:00Z', off: true, claimed_at: '2026-09-24T12:00:00.200Z', sent: false },
    ]);
  });
  it('a remind row carries a null claimed_at through untouched', () => {
    expect(settleRowsOf([row({ kind: 'remind', claimed_at: null })])[0].claimed_at).toBeNull();
  });
});
