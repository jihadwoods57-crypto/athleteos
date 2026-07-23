// A stand-in Supabase client, installed before the proto boots.
//
// WHY: the operator (coach/trainer), parent, commitment and report screens read through
// roles.js → the Supabase client. Without a server they render honest empty states — which is
// correct product behaviour and useless as a marketing screenshot. Rather than sign a screenshot
// harness into production, we answer the same queries locally with fixture rows.
//
// The fixtures are shaped to the REAL contracts (RPC names and column lists read out of roles.js)
// and every derived number on screen is still computed by the app's own engines from these rows —
// buildRosterRow decides the flags, status.js decides the notes, insights.js decides the sentences.
// We supply evidence; the product supplies conclusions. Nothing here paints a pixel directly.
//
// Returned as a source string to inject via Page.addScriptToEvaluateOnNewDocument.

export function sbStubSource({ todayISO, athletes, teamName = 'Lincoln Varsity Football', practiceName = 'Ruiz Performance' }) {
  return `(() => {
  const TODAY = ${JSON.stringify(todayISO)};
  const ATHLETES = ${JSON.stringify(athletes)};
  const TEAM = { id: 'team-1', name: ${JSON.stringify(teamName)}, join_code: 'LVF24', owner_id: 'seed-coach' };
  const PRACTICE = { id: 'prac-1', name: ${JSON.stringify(practiceName)}, join_code: 'RUIZ7', owner_id: 'seed-trainer', handle: 'ruiz-performance' };

  const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

  // ---- days: 7 days of history per athlete, today included only when they logged today ----
  const DAYS = [];
  for (const a of ATHLETES) {
    for (let back = 6; back >= 0; back--) {
      if (back === 0 && !a.loggedToday) continue;
      const score = back === 0 ? a.score : a.history[(a.history.length - back) % a.history.length];
      if (score == null) continue;
      DAYS.push({
        athlete_id: a.id, date: shift(TODAY, -back), score,
        grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
        tasks: a.tasks || [],
      });
    }
  }

  // ---- meals: the roster activity feed ----
  const SLOTS = [
    { type: 'breakfast', name: 'Eggs, oats & berries', at: '08:24', protein: 46, kcal: 620, quality: 88, photo: 'meal-breakfast' },
    { type: 'lunch', name: 'Chicken, rice & broccoli', at: '13:06', protein: 52, kcal: 780, quality: 84, photo: 'meal-lunch' },
    { type: 'dinner', name: 'Steak, potatoes & greens', at: '19:54', protein: 58, kcal: 910, quality: 86, photo: 'meal-dinner' },
  ];
  const MEALS = [];
  let mid = 0;
  for (const a of ATHLETES) {
    if (!a.loggedToday) continue;
    for (const s of SLOTS.slice(0, a.mealsToday == null ? 3 : a.mealsToday)) {
      MEALS.push({
        id: 'meal-' + (++mid), athlete_id: a.id, day_date: TODAY, type: s.type,
        photo_path: s.photo, name: s.name, protein: s.protein, kcal: s.kcal,
        quality: s.quality, logged_at: TODAY + 'T' + s.at + ':00Z',
      });
    }
  }
  MEALS.sort((x, y) => (x.logged_at < y.logged_at ? 1 : -1));

  const PROFILES = ATHLETES.map(a => ({ id: a.id, timezone: 'America/New_York', full_name: a.name }));

  const TABLES = {
    teams: [TEAM], practices: [PRACTICE], days: DAYS, meals: MEALS, profiles: PROFILES,
    team_members: [], practice_clients: [], announcements: [], notifications: [],
    meal_comments: [], interventions: [], requirement_sets: [], athlete_groups: [],
    coach_notes: [], training_logs: [], subscriptions: [], offers: [], sponsorships: [],
  };

  const ROSTER = ATHLETES.map(a => ({
    athlete_id: a.id, athlete_name: a.name, position: a.position || null, room_id: a.roomId || null,
    client_id: a.id, client_name: a.name,
  }));

  const RPCS = {
    team_roster: () => ROSTER,
    practice_roster: () => ROSTER,
    pending_team_requests: () => [],
    pending_practice_requests: () => [],
    team_day_rollup: () => ATHLETES.flatMap(a => DAYS.filter(d => d.athlete_id === a.id).map(d => ({ day: d.date, athlete_id: a.id, score: d.score }))),
    practice_day_rollup: () => [],
    guardian_children: () => ATHLETES.slice(0, 1).map(a => ({
      athlete_id: a.id, name: a.name, latest_score: a.score, latest_grade: a.score >= 90 ? 'A' : 'B', latest_day: TODAY,
    })),
    guardian_child_days: () => DAYS.filter(d => d.athlete_id === ATHLETES[0].id).map(d => ({ day: d.date, score: d.score, grade: d.grade })),
    my_funded_plans: () => [],
    has_premium_access: () => true,

    // ---- Verified Commitments (0138/0139) ----
    // Row shape mirrors what deriveCommitment() in commitments.js actually reads. The STAGE of
    // each card (open / acknowledged / awaiting_arrival / missed / unverified) is decided by that
    // function from these timestamps — we never set a stage directly.
    ensure_my_commitment_instances: () => null,
    ensure_commitment_instances: () => null,
    // window.__VC_MODE picks which moment we're capturing: 'open' = the card the athlete is about
    // to press; 'earned' = a trailing record so the Accountability rollup shows real percentages
    // instead of an honest-but-useless 0%.
    my_commitments: (p) => {
      const mode = window.__VC_MODE || 'open';
      const rollCall = (dayISO, ackAt) => ({
        instance_id: 'rc-' + dayISO, commitment_id: 'cmt-1', occurs_on: dayISO,
        type: 'morning_roll_call', title: '5 AM Club', action_label: 'I’m Up',
        status: ackAt ? 'acknowledged' : 'pending', instance_status: 'scheduled',
        respond_by_min: 315, opens_min: 255, starts_min: 300,
        respond_by_at: dayISO + 'T09:15:00Z', starts_at: dayISO + 'T09:00:00Z',
        acknowledged_at: ackAt, asks_arrival: false, timezone: 'America/New_York',
        reminder_offsets_min: [15, 5],
      });
      const lift = (dayISO, arrivedAt, completedAt) => ({
        instance_id: 'lf-' + dayISO, commitment_id: 'cmt-2', occurs_on: dayISO,
        type: 'strength', title: 'Team Lift', action_label: 'I’m here',
        status: completedAt ? 'completed' : arrivedAt ? 'arrived' : 'pending',
        instance_status: 'scheduled',
        arrive_by_min: 900, opens_min: 840, starts_min: 900,
        arrive_by_at: dayISO + 'T20:00:00Z', starts_at: dayISO + 'T20:00:00Z',
        arrived_at: arrivedAt, completed_at: completedAt,
        asks_arrival: true, location_name: 'Lincoln Weight Room',
        timezone: 'America/New_York', reminder_offsets_min: [30],
      });
      if (mode === 'earned') {
        const rows = [];
        for (let back = 13; back >= 1; back--) {
          const d = shift(TODAY, -back);
          // One genuinely unverifiable morning in the run — the state the product refuses to
          // call a miss. It leaves the denominator rather than counting against them.
          if (back === 6) { const r = rollCall(d, null); r.status = 'unverified'; r.unverified_reason = 'Phone off overnight'; rows.push(r); continue; }
          rows.push(rollCall(d, d + 'T09:0' + (back % 9) + ':00Z'));
          if (back % 2 === 1) rows.push(lift(d, d + 'T19:52:00Z', d + 'T21:10:00Z'));
        }
        return rows;
      }
      return [rollCall(TODAY, null), lift(TODAY, null, null)];
    },
    commitment_board: () => ATHLETES.map((a, i) => ({
      instance_id: 'b-' + i, athlete_id: a.id, athlete_name: a.name, occurs_on: TODAY,
      type: 'morning_roll_call', title: '5 AM Club', respond_by_min: 315,
      timezone: 'America/New_York',
      // A real spread: most up, one excused, one that genuinely could not be verified.
      status: i < 3 ? 'acknowledged' : i === 3 ? 'excused' : i === 4 ? 'unverified' : 'pending',
      acknowledged_at: i < 3 ? TODAY + 'T09:0' + (i + 1) + ':00Z' : null,
      excused_reason: i === 3 ? 'Cleared by trainer' : null,
      unverified_reason: i === 4 ? 'Phone off overnight' : null,
    })),
  };

  // ---- chainable PostgREST-ish query builder ----
  function builder(table) {
    let rows = (TABLES[table] || []).slice();
    const api = {
      select: () => api, order: () => api, limit: (n) => { rows = rows.slice(0, n); return api; },
      eq: (c, v) => { rows = rows.filter(r => r[c] === v); return api; },
      neq: (c, v) => { rows = rows.filter(r => r[c] !== v); return api; },
      in: (c, vs) => { rows = rows.filter(r => vs.includes(r[c])); return api; },
      gte: (c, v) => { rows = rows.filter(r => String(r[c]) >= String(v)); return api; },
      lte: (c, v) => { rows = rows.filter(r => String(r[c]) <= String(v)); return api; },
      gt: (c, v) => { rows = rows.filter(r => String(r[c]) > String(v)); return api; },
      lt: (c, v) => { rows = rows.filter(r => String(r[c]) < String(v)); return api; },
      is: () => api, not: () => api, or: () => api, contains: () => api, range: () => api,
      insert: () => api, update: () => api, upsert: () => api, delete: () => api,
      maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
      single: () => Promise.resolve({ data: rows[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }

  const SESSION = { access_token: 'seed', user: { id: 'seed-user', email: 'seed@onstandard.app' } };
  const client = {
    from: (t) => builder(t),
    rpc: (name, params) => Promise.resolve({ data: RPCS[name] ? RPCS[name](params) : [], error: null }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; }, unsubscribe: () => {} }),
    removeChannel: () => {},
    functions: { invoke: () => Promise.resolve({ data: null, error: { message: 'offline fixture' } }) },
    storage: { from: () => ({
      createSignedUrl: (p) => Promise.resolve({ data: { signedUrl: '/assets/' + String(p).replace(/^.*\\//, '') + '.jpg' }, error: null }),
      createSignedUrls: (ps) => Promise.resolve({ data: ps.map(p => ({ path: p, signedUrl: '/assets/' + String(p).replace(/^.*\\//, '') + '.jpg' })), error: null }),
      upload: () => Promise.resolve({ data: null, error: null }),
      getPublicUrl: (p) => ({ data: { publicUrl: '/assets/' + p + '.jpg' } }),
    }) },
    auth: {
      getSession: () => Promise.resolve({ data: { session: SESSION }, error: null }),
      getUser: () => Promise.resolve({ data: { user: SESSION.user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      startAutoRefresh: () => {}, stopAutoRefresh: () => {},
      signOut: () => Promise.resolve({ error: null }),
    },
  };

  // The vendor UMD script assigns window.supabase (the library) BEFORE js/supabase.js reads it.
  // Trap the assignment so createClient hands back our client instead of a live one.
  let held;
  Object.defineProperty(window, 'supabase', {
    configurable: true,
    get: () => held,
    set: (v) => {
      held = (v && v.createClient) ? { ...v, createClient: () => client } : v;
    },
  });
  window.__SUPABASE = { url: 'http://stub.local', anonKey: 'stub' };
})();`;
}

// Task ids MUST match requirements.js CATALOG ids — status.js resolves done-ness by id
// (`doneById[r.id]`), so an invented id reads as "never logged" and every athlete flips to
// Overdue regardless of score. Required daily items at an 8:10 PM capture: breakfast (due
// 9:30 AM), lunch (2:00 PM), dinner (8:30 PM), recovery (11:30 PM).
const DONE = (...ids) => ids.map((id) => ({ id, done: true }));

/** The roster fixture: a believable team spanning every real status the engine can produce —
 *  on standard, below standard, overdue, and no activity. */
export const ROSTER_ATHLETES = [
  { id: 'ath-1', name: 'Marcus Reed', position: 'WR', score: 94, loggedToday: true, mealsToday: 3, history: [88, 91, 90, 93, 89, 92], tasks: DONE('breakfast', 'lunch', 'dinner', 'recovery') },
  { id: 'ath-2', name: 'DeShawn Cole', position: 'RB', score: 88, loggedToday: true, mealsToday: 3, history: [85, 87, 84, 90, 86, 88], tasks: DONE('breakfast', 'lunch', 'dinner', 'recovery') },
  { id: 'ath-3', name: 'Andre Whitfield', position: 'S', score: 86, loggedToday: true, mealsToday: 3, history: [82, 88, 85, 87, 84, 86], tasks: DONE('breakfast', 'lunch', 'dinner', 'recovery') },
  // Logged, but under the bar and dinner still open → "Below standard".
  { id: 'ath-4', name: 'Jaylen Brooks', position: 'QB', score: 71, loggedToday: true, mealsToday: 2, history: [78, 74, 81, 76, 73, 75], tasks: DONE('breakfast', 'lunch') },
  // Lunch window closed with nothing logged → genuinely "Overdue".
  { id: 'ath-5', name: 'Tyrek Malone', position: 'LB', score: 64, loggedToday: true, mealsToday: 1, history: [72, 69, 74, 68, 66, 70], tasks: DONE('breakfast') },
  // No day row at all → "No activity", and the score reads "—", never an invented number.
  { id: 'ath-6', name: 'Tommy Vargas', position: 'OL', score: null, loggedToday: false, history: [81, 79, 83, 62, 58, null], tasks: [] },
];

/** A trainer's book: adults on fat-loss / gain goals, not a football roster. */
export const BOOK_CLIENTS = [
  { id: 'cli-1', name: 'Sarah Kim', position: null, score: 91, loggedToday: true, mealsToday: 3, history: [88, 90, 87, 92, 89, 91], tasks: DONE('breakfast', 'lunch', 'dinner', 'recovery') },
  { id: 'cli-2', name: 'Devon Marsh', position: null, score: 85, loggedToday: true, mealsToday: 3, history: [82, 86, 84, 87, 83, 85], tasks: DONE('breakfast', 'lunch', 'dinner', 'recovery') },
  { id: 'cli-3', name: 'Priya Raman', position: null, score: 68, loggedToday: true, mealsToday: 2, history: [74, 71, 69, 76, 72, 70], tasks: DONE('breakfast', 'lunch') },
  { id: 'cli-4', name: 'James Tran', position: null, score: null, loggedToday: false, history: [79, 77, 80, 61, 57, null], tasks: [] },
];
