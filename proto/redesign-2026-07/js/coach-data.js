/* OnStandard Coach OS — shared coach data cache (Task 5).
   Every coach screen (coach-home, coach-roster, coach-insights, and the existing coach/trainer
   screens in screens/coach.js) reads the roster + activity + requirements-engine "extras" from
   HERE instead of keeping its own private copy — one fetch, one repaint, one honest state.
   Lift-and-rewire only: the ROSTER/ACT loaders below are moved verbatim from screens/coach.js,
   no behavior change for anything that already used them. */
import * as roles from './roles.js';
import { CATALOG, resolveRequirementSet, catalogFromItems } from './requirements.js';
import { athleteStatus } from './status.js';

/* Coach roster cache: null = not loaded (show loading), else { teams, rows } from real data.
   Fetched once on mount, repainted via window.__render; the athletes' scores are their own real
   numbers (days.score), and a member with no day row today is honestly "No logs today". */
let ROSTER = null;
let rosterLoading = false;
export async function loadCoachRoster(force) {
  if (rosterLoading) return;
  if (ROSTER && !force) return;
  rosterLoading = true;
  try {
    const r = await roles.loadCoachRoster();
    // Pending join requests per team (athlete names before their link is active).
    const pending = [];
    for (const t of r.teams) {
      const reqs = await roles.pendingTeamRequests(t.id);
      for (const q of reqs) pending.push({ teamId: t.id, ...q });
    }
    r.pending = pending;
    r.offline = false;
    ROSTER = r;
    // Coach OS core (0071): requirement sets, groups, exceptions, today's interventions, and
    // this staff member's own scope — best-effort, scoped to the first team (mirrors the rest
    // of this cache's single-team assumption). A failure here must NOT read as a roster outage:
    // it's isolated in its own try/catch so a good roster fetch never gets marked offline
    // because the extras fetch (a separate set of tables) had trouble.
    if (r.teams.length) {
      try { await loadExtras(r.teams[0].id); }
      catch { CD.extras = { sets: [], groups: [], exceptions: [], interventions: [], scope: null }; }
    }
  } catch {
    // A fetch that actually threw (vs the lower layers' swallow-to-[]) must NOT leave the screen
    // stuck on "Loading…" forever — mark offline so the render shows a distinct, retryable state.
    ROSTER = { teams: [], rows: [], pending: [], offline: true };
  } finally {
    rosterLoading = false; // always clear so a retry can re-run
  }
  // coach-athlete also depends on the roster (name + membership guard for a stale/dead link).
  // coach-home/coach-roster/coach-create/coach-insights (later tasks) depend on it too —
  // harmless to repaint a route that isn't wired yet.
  if (location.hash === '#coach' || location.hash === '#copilot' || location.hash === '#coach-inbox'
    || location.hash.startsWith('#coach-athlete') || location.hash.startsWith('#coach-assign') || location.hash.startsWith('#coach-plan')
    || location.hash === '#coach-home' || location.hash === '#coach-roster' || location.hash === '#coach-create' || location.hash === '#coach-insights') window.__render();
}

/* Roster-wide activity feed (WS4a): recent meals across the team, newest first, with
   per-device unseen dots. Photos are real signed URLs (cached), never stock plates. */
let ACT = null;            // null = loading; { rows, photos: {mealId: url} }
let actLoading = false;
let actFetchedAt = 0;      // freshness window: a tab visit refetches, a repaint doesn't loop
export async function loadActivity(force) {
  if (actLoading) return;
  if (ACT && !force && Date.now() - actFetchedAt < 30000) return;
  actLoading = true;
  try {
    const rows = await roles.fetchTeamActivity(roles.daysAgoISO(1), 20);
    const photos = {};
    await Promise.all(rows.slice(0, 10).filter(m => m.photo_path).map(async (m) => {
      const u = await roles.signedMealPhotoUrl(m.photo_path);
      if (u) photos[m.id] = u;
    }));
    ACT = { rows, photos };
  } catch { ACT = { rows: [], photos: {} }; }
  finally { actLoading = false; actFetchedAt = Date.now(); }
  if (location.hash === '#coach' || location.hash === '#coach-inbox') window.__render();
}
export const actTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  let h = d.getHours() % 12; if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

export const CD = {
  get roster() { return ROSTER; },
  get act() { return ACT; },
  extras: null,
};

async function loadExtras(teamId) {
  const [sets, groups, exceptions, interventions, scope] = await Promise.all([
    roles.fetchRequirementSets(teamId), roles.fetchCoachGroups(teamId),
    roles.fetchActiveExceptions(teamId), roles.fetchTodayInterventions(teamId),
    roles.fetchMyStaffScope(teamId),
  ]);
  CD.extras = { sets, groups, exceptions, interventions, scope };
}

/* Which slice of the roster the coach is currently looking at (team / one position room /
   a saved group / one athlete) — persisted so it survives a tab switch or reopen. Defaults to
   the signed-in staff member's own position-room scope (0071 team_staff) when they have one,
   else the whole team. */
const SCOPE_KEY = 'onstd-coach-scope-v1';
export function getScope() {
  try { const j = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null'); if (j && j.kind) return j; } catch { /* fresh */ }
  const s = CD.extras && CD.extras.scope;
  return s && s.kind === 'position' ? { kind: 'position', value: s.value } : { kind: 'team', value: null };
}
export function setScope(scope) {
  try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch { /* in-memory only */ }
}

export function scopeFilter(rows, scope) {
  if (!scope || scope.kind === 'team') return rows;
  if (scope.kind === 'position') return rows.filter(r => (r.position || '').toUpperCase() === String(scope.value || '').toUpperCase());
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    const ids = new Set((g && g.athlete_ids) || []);
    return rows.filter(r => ids.has(r.athleteId));
  }
  if (scope.kind === 'athlete') return rows.filter(r => r.athleteId === scope.value);
  return rows;
}

/** Scope-filtered [{ row, status }] for the given scope — the one place coach screens compute
    an athlete's live status. Pure w.r.t. this module's caches: resolves each athlete's governing
    requirement set (athlete > position > team > built-in CATALOG when no set is configured),
    then runs the pure status engine at THIS caller's clock (nowMin/nowMs), not a fixed constant. */
export function entriesFor(scope) {
  if (!ROSTER || !CD.extras) return null;   // still loading — screens render skeletons
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes(); const nowMs = now.getTime();
  const nowDow = now.getDay();
  const excusedIds = new Set(CD.extras.exceptions.map(e => e.athlete_id));
  return scopeFilter(ROSTER.rows, scope).map((row) => {
    // resolveRequirementSet(sets, athleteId, position) → the governing SET row (or null), not a
    // reqs array — catalogFromItems maps its raw .items into the CATALOG-shaped requirements
    // athleteStatus expects. No configured set for this athlete → the built-in CATALOG governs.
    const set = resolveRequirementSet(CD.extras.sets, row.athleteId, row.position);
    const reqs = set ? catalogFromItems(set.items) : CATALOG;
    return {
      row,
      status: athleteStatus({
        nowMin, nowMs, nowDow, row, reqs,
        excused: excusedIds.has(row.athleteId),
        needsReview: false, // slice D wires flagged-meal review state
      }),
    };
  });
}
