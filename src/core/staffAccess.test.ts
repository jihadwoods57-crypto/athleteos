// Coach OS Slice F — staff-role capability map + responsibility→scope mapping (pure oracle
// for proto/redesign-2026-07/js/staff-access.js; spec 2026-07-16 Slice F).
// @ts-ignore
import {
  allowedCreateKeys, canEditStandards, canManageStaff, isReadonly, normalizeRole,
  roleLabel, scopeForResponsibility, parseScopeRooms, scopeText, RESPONSIBILITIES,
  // @ts-ignore
} from '../../proto/redesign-2026-07/js/staff-access.js';

describe('normalizeRole', () => {
  test('folds legacy assistant into coordinator', () => {
    expect(normalizeRole('assistant')).toBe('coordinator');
    expect(normalizeRole('coordinator')).toBe('coordinator');
    expect(normalizeRole('head_coach')).toBe('head_coach');
    expect(normalizeRole(null)).toBeNull();
    expect(normalizeRole('')).toBeNull();
  });
});

describe('allowedCreateKeys — the founder matrix', () => {
  test('head coach gets everything including staff management', () => {
    const keys = allowedCreateKeys('head_coach');
    expect(keys).toContain('invite_staff');
    expect(keys).toContain('add_athlete');
    expect(keys).toContain('standards');
    expect(keys).toContain('assign');
  });
  test('coordinator (and legacy assistant) get standards but never staff management', () => {
    for (const role of ['coordinator', 'assistant']) {
      const keys = allowedCreateKeys(role);
      expect(keys).toContain('standards');
      expect(keys).toContain('assign');
      expect(keys).not.toContain('invite_staff');
      expect(keys).not.toContain('add_athlete');
    }
  });
  test('position coach: assign + message only — no standards, no staff, no schedule', () => {
    const keys = allowedCreateKeys('position_coach');
    expect(keys).toContain('assign');
    expect(keys).toContain('message_athlete');
    expect(keys).not.toContain('standards');
    expect(keys).not.toContain('schedule');
    expect(keys).not.toContain('invite_staff');
  });
  test('nutritionist: nutrition surfaces (standards + team diet), no assign/staff', () => {
    const keys = allowedCreateKeys('nutritionist');
    expect(keys).toContain('standards');
    expect(keys).toContain('team_diet');
    expect(keys).not.toContain('assign');
    expect(keys).not.toContain('invite_staff');
  });
  test('readonly creates nothing', () => {
    expect(allowedCreateKeys('readonly')).toEqual([]);
    expect(isReadonly('readonly')).toBe(true);
  });
  test('unknown/unloaded role fails OPEN to the full menu (server is the wall)', () => {
    expect(allowedCreateKeys(null)).toEqual(allowedCreateKeys('head_coach'));
    expect(allowedCreateKeys('some_future_role')).toEqual(allowedCreateKeys('head_coach'));
  });
});

describe('capability helpers', () => {
  test('canEditStandards mirrors the standards key', () => {
    expect(canEditStandards('head_coach')).toBe(true);
    expect(canEditStandards('coordinator')).toBe(true);
    expect(canEditStandards('nutritionist')).toBe(true);
    expect(canEditStandards('position_coach')).toBe(false);
    expect(canEditStandards('readonly')).toBe(false);
  });
  test('only the head coach manages staff; loading fails open', () => {
    expect(canManageStaff('head_coach')).toBe(true);
    expect(canManageStaff(null)).toBe(true);
    expect(canManageStaff('coordinator')).toBe(false);
    expect(canManageStaff('readonly')).toBe(false);
  });
  test('roleLabel covers every v1 role and never fabricates', () => {
    expect(roleLabel('head_coach')).toBe('Head Coach');
    expect(roleLabel('assistant')).toBe('Coordinator');
    expect(roleLabel('position_coach')).toBe('Position Coach');
    expect(roleLabel('readonly')).toBe('View only');
    expect(roleLabel('weird_role')).toBe('weird_role');
    expect(roleLabel(null)).toBe('Staff');
  });
});

describe('staff-role vocabulary v2 — S&C / Athletic Trainer / Team Admin', () => {
  test('roleLabel names the three new roles', () => {
    expect(roleLabel('s_and_c')).toBe('Strength & Conditioning');
    expect(roleLabel('athletic_trainer')).toBe('Athletic Trainer');
    expect(roleLabel('team_admin')).toBe('Team Admin');
  });
  test('S&C and Team Admin edit standards + assign; Athletic Trainer assigns without standards', () => {
    expect(canEditStandards('s_and_c')).toBe(true);
    expect(allowedCreateKeys('s_and_c')).toContain('assign');
    expect(canEditStandards('team_admin')).toBe(true);
    expect(allowedCreateKeys('athletic_trainer')).toContain('assign');
    expect(canEditStandards('athletic_trainer')).toBe(false);
  });
  test('none of the new roles manage staff (head coach only) or are readonly, and none see bounced buttons', () => {
    for (const r of ['s_and_c', 'athletic_trainer', 'team_admin']) {
      expect(canManageStaff(r)).toBe(false);
      expect(isReadonly(r)).toBe(false);
      expect(allowedCreateKeys(r)).not.toContain('invite_staff');
    }
  });
});

describe('scopeForResponsibility — the onboarding step contract', () => {
  test('org and team responsibilities are whole-team (kind null)', () => {
    expect(scopeForResponsibility('org', '')).toEqual({ kind: null, value: null });
    expect(scopeForResponsibility('team', 'LB')).toEqual({ kind: null, value: null });
  });
  test('a room narrows to one position; a side narrows to a normalized comma list', () => {
    expect(scopeForResponsibility('room', ' lb ')).toEqual({ kind: 'position', value: 'lb' });
    expect(scopeForResponsibility('side', 'OL, TE ,QB')).toEqual({ kind: 'position', value: 'OL, TE, QB' });
  });
  test('a blank rooms field falls back to whole team — never a scope matching no one', () => {
    expect(scopeForResponsibility('room', '')).toEqual({ kind: null, value: null });
    expect(scopeForResponsibility('side', ' , ,')).toEqual({ kind: null, value: null });
  });
  test('individuals declares group intent with no id yet', () => {
    expect(scopeForResponsibility('individuals', '')).toEqual({ kind: 'group', value: null });
  });
  test('every responsibility card key maps without throwing', () => {
    for (const r of RESPONSIBILITIES) {
      expect(() => scopeForResponsibility(r.key, 'LB')).not.toThrow();
    }
  });
});

describe('parseScopeRooms — client mirror of 0078 comma matching', () => {
  test('trims, uppercases, drops empties', () => {
    expect(parseScopeRooms('lb, wr , ')).toEqual(['LB', 'WR']);
    expect(parseScopeRooms(null)).toEqual([]);
  });
});

describe('scopeText', () => {
  test('null scope reads whole team; single room reads as a room; lists join', () => {
    expect(scopeText(null, [])).toBe('Whole team');
    expect(scopeText({ kind: 'position', value: 'LB' }, [])).toBe('LB room');
    expect(scopeText({ kind: 'position', value: 'lb, wr' }, [])).toBe('LB + WR');
  });
  test('group scope resolves the real group name, never invents one', () => {
    expect(scopeText({ kind: 'group', value: 'g1' }, [{ id: 'g1', name: 'Slot Room' }])).toBe('Slot Room');
    expect(scopeText({ kind: 'group', value: 'gone' }, [])).toBe('One group');
  });
});
