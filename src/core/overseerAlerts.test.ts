import { defaultOverseerAlerts, enabledAlertCount, normalizeOverseerAlerts, OVERSEER_ALERT_DEFS } from './overseerAlerts';

describe('defaultOverseerAlerts', () => {
  it('turns the high-signal events on and the weekly digest off by default', () => {
    const a = defaultOverseerAlerts();
    expect(a.below_line).toBe(true);
    expect(a.missed_logging).toBe(true);
    expect(a.checkin_ready).toBe(true);
    expect(a.weekly_digest).toBe(false);
  });
});

describe('normalizeOverseerAlerts', () => {
  it('returns the defaults for null/undefined', () => {
    expect(normalizeOverseerAlerts(null)).toEqual(defaultOverseerAlerts());
  });
  it('overlays a saved partial map onto defaults (new keys default sanely)', () => {
    const a = normalizeOverseerAlerts({ weekly_digest: true });
    expect(a.weekly_digest).toBe(true); // saved value honored
    expect(a.below_line).toBe(true); // missing key falls back to default
  });
  it('ignores non-boolean saved values', () => {
    // @ts-expect-error — exercising defensive runtime handling
    expect(normalizeOverseerAlerts({ below_line: 'yes' }).below_line).toBe(true);
  });
});

describe('enabledAlertCount', () => {
  it('counts the enabled alerts', () => {
    expect(enabledAlertCount(defaultOverseerAlerts())).toBe(3);
    const allOff = OVERSEER_ALERT_DEFS.reduce((acc, d) => ({ ...acc, [d.key]: false }), {} as ReturnType<typeof defaultOverseerAlerts>);
    expect(enabledAlertCount(allOff)).toBe(0);
  });
});
