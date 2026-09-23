// supabase/functions/roll-call-ack/logic.test.ts
import { httpStatusFor } from './logic';

describe('httpStatusFor', () => {
  it('malformed/bad_sig -> 401', () => {
    expect(httpStatusFor('malformed')).toBe(401);
    expect(httpStatusFor('bad_sig')).toBe(401);
  });
  it('expired -> 410', () => {
    expect(httpStatusFor('expired')).toBe(410);
  });
  it('flag_off -> 403', () => {
    expect(httpStatusFor('flag_off')).toBe(403);
  });
  it('no_row -> 404', () => {
    expect(httpStatusFor('no_row')).toBe(404);
  });
  it('db_error -> 500', () => {
    expect(httpStatusFor('db_error')).toBe(500);
  });
});

// ---------------------------------------------------------------- 2026-09-23: the team on every card
import { teamCountUpdates, mintableWindows, bearerOf, TEAM_UPDATE_MIN_GAP_MS, refreshInstanceOf, refreshVerdict, wonAthleteIds,
  answeredClaimOf, ownCardBeforePush, ownCardAfterPush, fansOutTeam } from './logic';

describe('teamCountUpdates: one check-in moves every teammate\'s count', () => {
  const NOW = Date.parse('2026-09-25T10:03:00Z');
  const card = { respond_by_at: '2026-09-25T10:05:00Z', closes_at: '2026-09-25T10:30:00Z', message: 'Up.' };
  const board = {
    instance_id: 'inst', total: 4, up: 2, asks_arrival: false,
    rows: [
      { athlete_id: 'first', verdict: 'on_standard', place: 1, acknowledged_at: '2026-09-25T09:58:00Z' },
      { athlete_id: 'me', verdict: 'on_standard', place: 2, acknowledged_at: '2026-09-25T10:02:59Z' },
      { athlete_id: 'sleepy', verdict: 'pending', place: null, acknowledged_at: null },
      { athlete_id: 'fresh', verdict: 'pending', place: null, acknowledged_at: null },
    ],
  };
  const targets = [
    { athlete_id: 'first', token: 't-first', last_update_at: null, phase_hint: 'answered' },
    { athlete_id: 'me', token: 't-me', last_update_at: null, phase_hint: 'answered' },
    { athlete_id: 'sleepy', token: 't-sleepy', last_update_at: '2026-09-25T10:01:00Z', phase_hint: 'reminder' },
    { athlete_id: 'fresh', token: 't-fresh', last_update_at: '2026-09-25T10:02:30Z', phase_hint: 'initial' },
  ];
  const run = () => teamCountUpdates('inst', board, { targets, card, checkedIn: 'me', nowMs: NOW });

  test('never sends the athlete who just checked in a second push', () => {
    expect(run().map((u) => u.athleteId)).not.toContain('me');
  });
  test('throttles to one update per athlete per minute', () => {
    expect(TEAM_UPDATE_MIN_GAP_MS).toBe(60_000);
    const ids = run().map((u) => u.athleteId).sort();
    expect(ids).toEqual(['first', 'sleepy']);   // fresh was updated 30 s ago
  });
  test('every update carries the new team count', () => {
    for (const u of run()) expect(u.state).toMatchObject({ teamUp: 2, teamTotal: 4 });
  });
  test('a teammate already up keeps their own place, points and answered state', () => {
    const u = run().find((x) => x.athleteId === 'first')!;
    expect(u.token).toBe('t-first');
    expect(u.state).toMatchObject({ phase: 'answered', place: 1, points: 8, checkedInEpoch: Date.parse('2026-09-25T09:58:00Z') / 1000 });
  });
  test('a teammate not up yet keeps the phase their card is in (no amber-to-blue flicker)', () => {
    const u = run().find((x) => x.athleteId === 'sleepy')!;
    expect(u.state).toMatchObject({ phase: 'reminder', place: null, points: null, checkedInEpoch: null });
  });
  test('a board for another instance sends nothing', () => {
    expect(teamCountUpdates('other', board, { targets, card, checkedIn: 'me', nowMs: NOW })).toEqual([]);
  });
});

describe('mintableWindows: the codes the phone holds for the week', () => {
  const NOW = Date.parse('2026-09-23T12:00:00Z');
  test('keeps windows that have not closed and open within 7 days, drops the rest', () => {
    const rows = [
      { instance_id: 'past', opens_at: '2026-09-22T09:50:00Z', closes_at: '2026-09-22T10:30:00Z' },
      { instance_id: 'now', opens_at: '2026-09-23T11:50:00Z', closes_at: '2026-09-23T12:30:00Z' },
      { instance_id: 'fri', opens_at: '2026-09-25T09:50:00Z', closes_at: '2026-09-25T10:30:00Z' },
      { instance_id: 'far', opens_at: '2026-10-05T09:50:00Z', closes_at: '2026-10-05T10:30:00Z' },
      { instance_id: 'bad', opens_at: null, closes_at: 'x' },
    ];
    expect(mintableWindows(rows, NOW)).toEqual([
      { instance_id: 'now', opensMs: Date.parse('2026-09-23T11:50:00Z'), closesMs: Date.parse('2026-09-23T12:30:00Z') },
      { instance_id: 'fri', opensMs: Date.parse('2026-09-25T09:50:00Z'), closesMs: Date.parse('2026-09-25T10:30:00Z') },
    ]);
  });
});

describe('bearerOf', () => {
  test('reads a bearer token and nothing else', () => {
    expect(bearerOf('Bearer abc.def')).toBe('abc.def');
    expect(bearerOf('bearer abc')).toBe('abc');
    expect(bearerOf('Basic abc')).toBe('');
    expect(bearerOf(null)).toBe('');
  });
});

describe('not_yet', () => {
  test('a code spent before its window is a decided answer (410), like expired', () => {
    expect(httpStatusFor('not_yet')).toBe(410);
  });
});

describe('refresh: an answer that did not come through a code still turns the card', () => {
  const ID = '0b6f2c1e-4d0a-4c55-9b1e-7d2a3f4e5a6b';
  test('names exactly one instance, as a uuid', () => {
    expect(refreshInstanceOf({ action: 'refresh', instance_id: ID })).toBe(ID);
    expect(refreshInstanceOf({ action: 'refresh', instance_id: ID.toUpperCase() })).toBe(ID.toUpperCase());
    expect(refreshInstanceOf({ action: 'refresh' })).toBe('');
    expect(refreshInstanceOf({ action: 'refresh', instance_id: "x' or 1=1" })).toBe('');
    expect(refreshInstanceOf({ action: 'refresh', instance_id: 42 })).toBe('');
    expect(refreshInstanceOf(null)).toBe('');
  });
  test('only the caller\'s own row, and only once they have actually answered', () => {
    expect(refreshVerdict(null)).toBe('no_row');
    expect(refreshVerdict({ acknowledged_at: null })).toBe('not_acked');
    expect(refreshVerdict({ acknowledged_at: '2026-09-25T10:01:00Z' })).toBe('ok');
  });
  test('reads the answered claim, and anything unreadable as unknown (an un-migrated stack)', () => {
    expect(answeredClaimOf('claimed', null)).toBe('claimed');
    expect(answeredClaimOf('already_answered', null)).toBe('already_answered');
    expect(answeredClaimOf('no_token', null)).toBe('no_token');
    expect(answeredClaimOf([{ claim_live_answered_update: 'claimed' }], null)).toBe('claimed');
    expect(answeredClaimOf(null, { message: 'function does not exist' })).toBe('unknown');
    expect(answeredClaimOf('weird', null)).toBe('unknown');
  });
  test('a count update seconds earlier never stops the answered update: the claim alone decides', () => {
    // The throttle that bit (fix round 2) was a count stamp; the answered decision reads no
    // last_update_at at all. 'claimed' and 'unknown' both send.
    expect(ownCardBeforePush({ apns: true, card: true, claim: 'claimed' })).toBeNull();
    expect(ownCardBeforePush({ apns: true, card: true, claim: 'unknown' })).toBeNull();
  });
  test('distinct reasons before the push', () => {
    expect(ownCardBeforePush({ apns: false, card: true, claim: 'claimed' })).toBe('unavailable');
    expect(ownCardBeforePush({ apns: true, card: false, claim: 'claimed' })).toBe('no_card');
    expect(ownCardBeforePush({ apns: true, card: true, claim: 'already_answered' })).toBe('already_answered');
    expect(ownCardBeforePush({ apns: true, card: true, claim: 'no_token' })).toBe('no_token');
  });
  test('after the push: sent, or the claim is released so the next refresh can try again', () => {
    expect(ownCardAfterPush('claimed', { updated: 1, revoked: 0 })).toEqual({ result: 'sent', release: false });
    expect(ownCardAfterPush('claimed', { updated: 0, revoked: 1 })).toEqual({ result: 'no_token', release: true });
    expect(ownCardAfterPush('claimed', { updated: 0, revoked: 0 })).toEqual({ result: 'unavailable', release: true });
    expect(ownCardAfterPush('unknown', { updated: 0, revoked: 0 })).toEqual({ result: 'unavailable', release: false });
  });
  test('the team hears about it unless this answer was already announced', () => {
    expect(fansOutTeam('sent')).toBe(true);
    expect(fansOutTeam('no_token')).toBe(true);
    expect(fansOutTeam('unavailable')).toBe(true);
    expect(fansOutTeam('no_card')).toBe(false);
    expect(fansOutTeam('already_answered')).toBe(false);
  });
  test('reads the athletes a claim returned, in either row shape', () => {
    expect([...wonAthleteIds(['a', { claim_live_team_updates: 'b' }, null])]).toEqual(['a', 'b', '']);
    expect([...wonAthleteIds(null)]).toEqual([]);
  });
});
