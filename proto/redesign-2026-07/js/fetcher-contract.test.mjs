/* The fetcher contract: a FAILED read must never be indistinguishable from a confirmed-empty one.

   This is the regression net for the whole "fabricated emptiness" class. Roughly fifty reads in
   roles.js used to answer `[]` for both "the server says there is nothing" and "I could not
   reach the server", and every screen that turns a list into a sentence then stated the first
   as fact: "No athletes yet" over a real roster, "You are all caught up" over waiting
   escalations, "You have the free plan" at a paying subscriber.

   The trap this locks shut is subtler than a missing try/catch. supabase-js does NOT throw on a
   network failure: it RESOLVES with an `error` field on the result object. A fetcher whose only
   failure handling lives in a `catch` block therefore never runs it, walks past the error, and
   returns `data || []`. Eight money and consent reads shipped in exactly that state, each with a
   fully built retry screen behind it that had never once rendered.

   So the fake client below models the real failure mode precisely: every builder method chains,
   and awaiting the chain RESOLVES (never rejects) with { data: null, error }. A fetcher only
   passes here if it inspects that error. */
import assert from 'node:assert';
import test from 'node:test';
import * as roles from './roles.js';

const ERR = { message: 'network unreachable', code: 'PGRST000' };

/* A supabase-js stand-in whose every query resolves { data: null, error }. The proxy answers any
   builder method (.select/.eq/.in/.gte/.order/.limit/.is/.maybeSingle/...) with itself, so it
   models an arbitrary chain without enumerating the API. */
function failingQuery() {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve({ data: null, error: ERR }).then(resolve, reject);
      if (prop === 'catch' || prop === 'finally') return () => p;
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}

function failingClient() {
  return {
    from: () => failingQuery(),
    rpc: () => failingQuery(),
    storage: { from: () => failingQuery() },
    // A signed-in user resolves fine; it is the DATA reads that fail. This matters for the
    // fetchers that resolve an id first (fetchMyRoomLabel, fetchMySubscription, fetchMyDietary):
    // stubbing auth as failing too would let them bail early and pass for the wrong reason.
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }),
    },
  };
}

/* "Confirmed empty" values — the exact shapes a screen renders a factual sentence from. A failed
   read returning any of these is the bug. */
function isFabricatedEmpty(v) {
  if (Array.isArray(v)) return v.length === 0;
  if (v === null || v === undefined) return false;      // null is a valid FAILED sentinel
  if (typeof v === 'object') return Object.keys(v).length === 0;  // {} = "nothing completed"
  return false;
}

/* Each entry: the read, and how to call it with arguments that clear its own guard clauses.
   Grouped by the sentence a failure used to print. */
const READS = [
  // roster + day truth
  ['fetchTeamRoster', () => roles.fetchTeamRoster('team-1')],
  ['fetchPracticeRoster', () => roles.fetchPracticeRoster('prac-1')],
  ['fetchLinkedDaysSince', () => roles.fetchLinkedDaysSince('2026-01-01', ['a1'])],
  ['pendingTeamRequests', () => roles.pendingTeamRequests('team-1')],
  ['pendingPracticeRequests', () => roles.pendingPracticeRequests('prac-1')],
  ['fetchTeamActivity', () => roles.fetchTeamActivity('2026-01-01', 20, ['a1'])],
  // the athlete's own record
  ['fetchRecentMeals', () => roles.fetchRecentMeals('a1', '2026-01-01')],
  ['fetchMyNotifications', () => roles.fetchMyNotifications(30)],
  ['fetchMyAssignments', () => roles.fetchMyAssignments()],
  ['fetchRequirementSets', () => roles.fetchRequirementSets('team-1', 'team')],
  ['fetchMyMemoryFacts', () => roles.fetchMyMemoryFacts('u-1')],
  ['fetchMyDayReceipts', () => roles.fetchMyDayReceipts('a1', '2026-01-01')],
  // safety + money
  ['fetchTeamDietary', () => roles.fetchTeamDietary(['a1'])],
  ['fetchMyDietary', () => roles.fetchMyDietary()],
  ['fetchMySubscription', () => roles.fetchMySubscription()],
  ['myPremiumSource', () => roles.myPremiumSource()],
  ['fetchMySponsorships', () => roles.fetchMySponsorships()],
  ['fetchPracticePayments', () => roles.fetchPracticePayments('prac-1')],
  ['fetchFundedClients', () => roles.fetchFundedClients('prac-1')],
  ['fetchPendingClaims', () => roles.fetchPendingClaims('prac-1')],
  ['fetchMyOffers', () => roles.fetchMyOffers('prac-1')],
  ['fetchMyApplications', () => roles.fetchMyApplications('prac-1')],
  ['fetchMyTrainerOffers', () => roles.fetchMyTrainerOffers()],
  ['fetchMyTrainerPage', () => roles.fetchMyTrainerPage('prac-1')],
  ['fetchMyConsent', () => roles.fetchMyConsent('a1')],
  // marketplace claims about real people's businesses
  ['fetchMarketplaceDirectory', () => roles.fetchMarketplaceDirectory({})],
  ['fetchMyCoachApplication', () => roles.fetchMyCoachApplication()],
  ['fetchMyListing', () => roles.fetchMyListing()],
  // coach surfaces
  ['fetchAnnouncements', () => roles.fetchAnnouncements('team-1', 10)],
  ['fetchRequirementTemplates', () => roles.fetchRequirementTemplates('team-1')],
  ['fetchTeamStaff', () => roles.fetchTeamStaff('team-1')],
  ['fetchOpenStaffInvites', () => roles.fetchOpenStaffInvites('team-1')],
  ['fetchTeamMealComments', () => roles.fetchTeamMealComments(['a1'], '2026-01-01')],
  ['fetchRecentInterventions', () => roles.fetchRecentInterventions('team-1', '2026-01-01', 'team')],
  ['fetchTodayInterventions', () => roles.fetchTodayInterventions('team-1', 'team')],
  ['fetchCoachGroups', () => roles.fetchCoachGroups('team-1', 'team')],
  ['fetchActiveExceptions', () => roles.fetchActiveExceptions('team-1', 'team')],
  ['fetchTeamRooms', () => roles.fetchTeamRooms('team-1')],
  ['fetchAthleteInterventions', () => roles.fetchAthleteInterventions('team-1', 'a1', '2026-01-01', 'team')],
  ['fetchAthleteAssignments', () => roles.fetchAthleteAssignments('a1', '2026-01-01')],
  ['fetchCoachNotes', () => roles.fetchCoachNotes('team-1', 'a1', 'team')],
  ['fetchTeamDayRollup', () => roles.fetchTeamDayRollup('team-1', '2026-01-01', '2026-02-01', 'team')],
  ['fetchInterventionOutcomes', () => roles.fetchInterventionOutcomes('team-1', '2026-01-01', 'team')],
  ['fetchRosterPasses', () => roles.fetchRosterPasses(['a1'])],
  ['fetchPlanMetaBatch', () => roles.fetchPlanMetaBatch(['a1'])],
  // config reads, where a fabricated value silently changes what the athlete is scored against
  ['fetchTeamWeekPattern', () => roles.fetchTeamWeekPattern('team-1')],
  ['fetchMyRoomLabel', () => roles.fetchMyRoomLabel('team-1')],
  ['fetchCoachSetupState', () => roles.fetchCoachSetupState('team-1')],
  ['fetchPracticeSetupState', () => roles.fetchPracticeSetupState('prac-1')],
  ['fetchPassPolicy', () => roles.fetchPassPolicy({ teamId: 'team-1' })],
];

test('a resolved supabase error never reads as confirmed-empty', async () => {
  globalThis.window = globalThis.window || {};
  const prev = globalThis.window.sb;
  globalThis.window.sb = failingClient();
  try {
    const liars = [];
    for (const [name, call] of READS) {
      const out = await call();
      if (isFabricatedEmpty(out)) liars.push(`${name} -> ${JSON.stringify(out)}`);
    }
    assert.deepStrictEqual(liars, [], `these reads answered a FAILURE with a confirmed-empty value:\n  ${liars.join('\n  ')}`);
  } finally {
    globalThis.window.sb = prev;
  }
});

test('the same reads still answer empty when the server really is empty', async () => {
  // The mirror image, and the reason the fix is not just "return null everywhere": a genuinely
  // empty server must still produce the empty value, or every first-run empty state becomes an
  // error state and the app cries wolf at brand-new users.
  const emptyQuery = () => {
    const p = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
        if (prop === 'catch' || prop === 'finally') return () => p;
        return () => p;
      },
      apply() { return p; },
    });
    return p;
  };
  globalThis.window = globalThis.window || {};
  const prev = globalThis.window.sb;
  globalThis.window.sb = {
    from: () => emptyQuery(),
    rpc: () => emptyQuery(),
    storage: { from: () => emptyQuery() },
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }),
    },
  };
  try {
    // A representative list read and a representative map read.
    assert.deepStrictEqual(await roles.fetchTeamRoster('team-1'), [], 'a real empty roster must stay []');
    assert.deepStrictEqual(await roles.fetchCoachGroups('team-1', 'team'), [], 'a real empty group list must stay []');
    assert.deepStrictEqual(await roles.fetchCoachSetupState('team-1'), {}, 'a real empty setup state must stay {}');
    const staff = await roles.fetchTeamStaff('team-1');
    assert.deepStrictEqual(staff, [], 'a team with no other staff must stay []');
  } finally {
    globalThis.window.sb = prev;
  }
});
