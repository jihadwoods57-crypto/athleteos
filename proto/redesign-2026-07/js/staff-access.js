// proto/redesign-2026-07/js/staff-access.js
//
// Coach OS Slice F — the staff-role capability map, pure and testable (templates.js idiom:
// no DOM, no Supabase, no clock). The SERVER is the wall (0077/0078: scoped can_view,
// readonly write-guards); this module only decides what the CLIENT offers, so a role never
// stares at buttons the server would bounce.
//
// Role vocabulary (0077): head_coach · coordinator · position_coach · nutritionist · readonly.
// Legacy 'assistant' rows are coordinators in everything but the stored string — normalizeRole
// folds them so no screen ever branches on 'assistant' again.

export const STAFF_ROLE_LABEL = {
  head_coach: 'Head Coach',
  coordinator: 'Coordinator',
  assistant: 'Coordinator',
  position_coach: 'Position Coach',
  nutritionist: 'Nutritionist / RD',
  s_and_c: 'Strength & Conditioning',
  athletic_trainer: 'Athletic Trainer',
  team_admin: 'Team Admin',
  readonly: 'View only',
};

export function roleLabel(role) {
  return STAFF_ROLE_LABEL[role] || (role ? String(role) : 'Staff');
}

/** Fold the legacy 'assistant' value into 'coordinator'; unknown/absent stays null. */
export function normalizeRole(role) {
  if (!role) return null;
  return role === 'assistant' ? 'coordinator' : role;
}

/* Create-menu option keys, in display order. The Create screen owns titles/routes;
   this map owns WHO gets WHAT (founder matrix, spec Slice F):
     head coach    — everything incl. staff, standards, groups
     coordinator   — assign, message, standards for their scope
     position coach— assign, message, nudge in their room
     nutritionist  — targets & meal plans (standards/diet surfaces) + messaging
     readonly      — nothing (view only)                                          */
const CREATE_CAPS = {
  head_coach:       ['assign', 'announce', 'message_athlete', 'message_group', 'standards', 'schedule', 'add_athlete', 'invite_staff'],
  coordinator:      ['assign', 'announce', 'message_athlete', 'message_group', 'standards', 'schedule'],
  position_coach:   ['assign', 'announce', 'message_athlete', 'message_group'],
  nutritionist:     ['announce', 'message_athlete', 'message_group', 'standards', 'team_diet'],
  // v1 (pre per-category permissions): S&C and Team Admin get coordinator-level write; the
  // Athletic Trainer assigns/messages in their scope without owning the nutrition standard.
  // Finer differences (Team Admin staff management, exports) land with the capability model.
  s_and_c:          ['assign', 'announce', 'message_athlete', 'message_group', 'standards', 'schedule'],
  athletic_trainer: ['assign', 'announce', 'message_athlete', 'message_group'],
  team_admin:       ['assign', 'announce', 'message_athlete', 'message_group', 'standards', 'schedule'],
  readonly:         [],
};

/** The Create-menu keys this role may use. An unknown/unloaded role gets the full head-coach
    set — the menu must never blank out on a slow staff fetch (the server enforces regardless). */
export function allowedCreateKeys(role) {
  const r = normalizeRole(role);
  if (!r || !CREATE_CAPS[r]) return CREATE_CAPS.head_coach;
  return CREATE_CAPS[r];
}

export function canEditStandards(role) {
  return allowedCreateKeys(role).includes('standards');
}
export function canManageStaff(role) {
  return normalizeRole(role) === 'head_coach' || role == null; // fail-open while loading; server walls it
}
export function isReadonly(role) {
  return normalizeRole(role) === 'readonly';
}

/* ---------------- onboarding responsibility -> team_staff scope ---------------- */

export const RESPONSIBILITIES = [
  { key: 'org',         title: 'Entire organization', sub: 'Every team under your school or club' },
  { key: 'team',        title: 'Entire team',         sub: 'The whole roster answers to you' },
  { key: 'side',        title: 'A side of the ball',  sub: 'Offense, defense — a set of rooms' },
  { key: 'room',        title: 'A position room',     sub: 'One room is yours' },
  { key: 'individuals', title: 'Individual athletes', sub: 'A hand-picked group you build' },
];

export function responsibilityLabel(key) {
  const r = RESPONSIBILITIES.find((x) => x.key === key);
  return r ? r.title : 'Entire team';
}

/** Map the onboarding responsibility step to the team_staff scope columns (0071/0078).
    'side'/'room' narrow to a position list ('LB' or 'LB, WR'); everything else is whole-team
    (kind null). 'individuals' declares INTENT to narrow to a hand-picked group — the group
    row can only exist after the team does, so the caller mints it and passes its id later.
    An empty rooms string on side/room falls back to whole team — never a scope that matches
    no one because a field was left blank. */
export function scopeForResponsibility(choice, rooms) {
  const list = String(rooms || '').split(',').map((s) => s.trim()).filter(Boolean);
  if ((choice === 'side' || choice === 'room') && list.length) {
    return { kind: 'position', value: list.join(', ') };
  }
  if (choice === 'individuals') return { kind: 'group', value: null };
  return { kind: null, value: null };
}

/** 'LB, wr' -> ['LB','WR'] — the client mirror of 0078's comma-list matching. */
export function parseScopeRooms(value) {
  return String(value || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Human line for a team_staff scope, e.g. 'Whole team' / 'LB room' / 'LB + WR' / a group name. */
export function scopeText(scope, groups) {
  if (!scope || !scope.kind) return 'Whole team';
  if (scope.kind === 'position') {
    const rooms = parseScopeRooms(scope.value);
    if (!rooms.length) return 'Whole team';
    return rooms.length === 1 ? `${rooms[0]} room` : rooms.join(' + ');
  }
  if (scope.kind === 'group') {
    const g = (groups || []).find((x) => x.id === scope.value);
    return g ? g.name : 'One group';
  }
  return 'Whole team';
}
