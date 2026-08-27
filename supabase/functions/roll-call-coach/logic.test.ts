import { parseAction, httpStatusForCoach, isTerminal, nudgeBody, type CoachFailure } from './logic';

describe('parseAction', () => {
  it('accepts exactly the two verbs', () => {
    expect(parseAction('seen')).toBe('seen');
    expect(parseAction('nudge')).toBe('nudge');
  });
  it('refuses anything else rather than defaulting', () => {
    // Defaulting to 'nudge' would push a whole roster on a typo; defaulting to 'seen' would
    // swallow a future client's new button and report success. Neither is acceptable.
    for (const junk of ['NUDGE', 'Seen', 'ack', '', null, undefined, 1, {}, ['nudge']]) {
      expect(parseAction(junk)).toBeNull();
    }
  });
});

describe('httpStatusForCoach', () => {
  it('maps every failure to a status', () => {
    const all: CoachFailure[] = [
      'malformed', 'bad_sig', 'bad_kind', 'expired', 'bad_action',
      'flag_off', 'not_authorized', 'rate_limited', 'no_instance', 'db_error',
    ];
    for (const r of all) expect(typeof httpStatusForCoach(r)).toBe('number');
  });
  it('does not distinguish a wrong-kind code from a bad signature', () => {
    // Both are 401. Telling a caller "your signature is fine, you just hold the athlete key"
    // is free reconnaissance on the credential scheme.
    expect(httpStatusForCoach('bad_kind')).toBe(401);
    expect(httpStatusForCoach('bad_sig')).toBe(401);
  });
  it('separates rate limiting from refusal', () => {
    // 429 vs 403 is what lets the device tell "somebody already nudged" (fine, stop) apart from
    // "you are not staff here" (also stop, but for a different reason worth reporting).
    expect(httpStatusForCoach('rate_limited')).toBe(429);
    expect(httpStatusForCoach('not_authorized')).toBe(403);
  });
  it('keeps expiry distinguishable from a bad credential', () => {
    expect(httpStatusForCoach('expired')).toBe(410);
  });
});

describe('isTerminal', () => {
  it('retries only a server-side failure', () => {
    // The offline queue replays on foreground. A 5xx is worth another try inside the code's own
    // lifetime; an expired or unauthorized code will never become valid, and retrying it forever
    // would let dead entries evict live ones at the queue cap.
    expect(isTerminal('db_error')).toBe(false);
    for (const r of ['expired', 'bad_sig', 'bad_kind', 'not_authorized', 'rate_limited', 'flag_off', 'no_instance', 'malformed', 'bad_action'] as CoachFailure[]) {
      expect(isTerminal(r)).toBe(true);
    }
  });
});

describe('nudgeBody', () => {
  const deadline = 1_000_000;
  it('offers the one-tap answer while the window is still open', () => {
    expect(nudgeBody(deadline, deadline - 60_000)).toMatch(/One tap/);
  });
  it('drops the "still time" framing once the deadline has passed', () => {
    const late = nudgeBody(deadline, deadline + 60_000);
    expect(late).toMatch(/still waiting/);
    expect(late).not.toMatch(/One tap/);
  });
  it('treats an unknown deadline as still open', () => {
    // A commitment with no respond_by_at has no window to have missed, so the urgent copy would
    // be asserting a fact the server does not have.
    expect(nudgeBody(null, deadline)).toMatch(/One tap/);
    expect(nudgeBody(Number.NaN, deadline)).toMatch(/One tap/);
  });
  it('never names the athlete or the count', () => {
    // The body goes to the ATHLETE, not the coach. "3 of 12 aren't up" is the coach's digest and
    // would leak their teammates' compliance to the whole roster.
    for (const now of [deadline - 1, deadline + 1]) {
      expect(nudgeBody(deadline, now)).not.toMatch(/\d/);
    }
  });
});
