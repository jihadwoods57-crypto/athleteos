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

  // A meal-photo storage path -> the real shipped proto plate. No regex (escaping inside this
  // injected template string is a trap): plain string ops only.
  const mealAsset = (p) => {
    const parts = String(p).split('/');
    let base = parts[parts.length - 1];                       // 'lunch.jpg' or 'meal-breakfast'
    if (base.slice(-4).toLowerCase() === '.jpg') base = base.slice(0, -4);
    if (base.slice(0, 5) === 'meal-') base = base.slice(5);   // 'lunch' or 'breakfast'
    const known = (base === 'breakfast' || base === 'lunch' || base === 'dinner') ? base : 'lunch';
    return '/assets/meal-' + known + '.jpg';
  };

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

    // ---- Connected Standards (0155) ----
    // window.__CS_MODE picks the moment being captured, and DEFAULT is 'none' so activity cards
    // never leak onto generic Home shots — the same discipline __VC_MODE follows.
    //   'live' the afternoon card: steps in progress, a weekly target off pace
    //   'done' the evening card: both verified by the device, nothing tapped
    //   'gap'  the state the product exists to get right — the watch never reported
    ensure_my_connected_standards: () => null,
    ensure_connected_standard_instances: () => null,
    my_connected_standards: () => {
      const mode = window.__CS_MODE || 'none';
      if (mode === 'none') return [];
      const MI = 1609.344;
      const steps = (over) => ({
        result_id: 'csr-steps', instance_id: 'csi-steps', standard_id: 'cs-steps',
        title: 'Daily Movement', metric: 'steps', display_unit: 'steps',
        target: 10000, progress: over ? 10326 : 7842,
        period: 'day', period_start: TODAY, period_end: TODAY,
        deadline_at: TODAY + 'T03:59:00Z', instance_status: 'scheduled',
        deliberate_workout: false, workout_min_duration_min: null,
        status: over ? 'verified_complete' : 'in_progress',
        verified_source: over ? 'healthkit' : null,
        completed_at: over ? TODAY + 'T00:17:00Z' : null,
        last_synced_at: TODAY + 'T22:42:00Z', device_connected: true,
        allow_manual: true, manual_requires_approval: false,
        source_kind: 'assigned', owner_label: 'Lincoln Football',
      });
      const run = () => ({
        result_id: 'csr-run', instance_id: 'csi-run', standard_id: 'cs-run',
        title: 'Tuesday Conditioning', metric: 'distance', display_unit: 'mi',
        target: 2.5 * MI, progress: 2.73 * MI,
        period: 'day', period_start: TODAY, period_end: TODAY,
        deadline_at: TODAY + 'T23:00:00Z', instance_status: 'scheduled',
        deliberate_workout: true, workout_min_duration_min: 30,
        status: 'verified_complete', verified_source: 'healthkit',
        completed_at: TODAY + 'T22:18:00Z', last_synced_at: TODAY + 'T22:20:00Z',
        device_connected: true, allow_manual: true, manual_requires_approval: true,
        source_kind: 'assigned', owner_label: 'Lincoln Football',
      });
      const weekly = (progressMi) => ({
        result_id: 'csr-week', instance_id: 'csi-week', standard_id: 'cs-week',
        title: 'Weekly Miles', metric: 'distance', display_unit: 'mi',
        target: 12 * MI, progress: progressMi * MI,
        period: 'week', period_start: shift(TODAY, -3), period_end: shift(TODAY, 3),
        deadline_at: shift(TODAY, 3) + 'T03:59:00Z', instance_status: 'scheduled',
        deliberate_workout: false, workout_min_duration_min: null,
        status: 'in_progress', verified_source: null, completed_at: null,
        last_synced_at: TODAY + 'T22:42:00Z', device_connected: true,
        allow_manual: true, manual_requires_approval: false,
        source_kind: 'personal', owner_label: null,
      });
      if (mode === 'gap') {
        const s = steps(false);
        s.status = 'awaiting_sync'; s.progress = 6120;
        s.last_synced_at = shift(TODAY, -1) + 'T18:04:00Z';
        // Yesterday, resolved the honest way: the device never reported and nobody was blamed.
        const prior = steps(false);
        prior.result_id = 'csr-steps-y'; prior.instance_id = 'csi-steps-y';
        prior.period_start = shift(TODAY, -1); prior.period_end = shift(TODAY, -1);
        prior.status = 'insufficient_data'; prior.progress = 4400;
        return [s, prior, weekly(4)];
      }
      if (mode === 'done') return [steps(true), run(), weekly(9.6)];
      return [steps(false), weekly(6.4)];
    },

    // ---- Verified Commitments (0138/0139) ----
    // Row shape mirrors what deriveCommitment() in commitments.js actually reads. The STAGE of
    // each card (open / acknowledged / awaiting_arrival / missed / unverified) is decided by that
    // function from these timestamps — we never set a stage directly.
    ensure_my_commitment_instances: () => null,
    ensure_commitment_instances: () => null,
    // window.__VC_MODE picks which moment we're capturing: 'open' = the card the athlete is about
    // to press; 'earned' = a trailing record so the Accountability rollup shows real percentages.
    // DEFAULT is 'none' (no commitments) so the roll-call card only appears on the VC-specific
    // shots — otherwise it leaks onto every generic Home/how-it-works step, showing a stray missed
    // commitment on screens that aren't about that feature.
    my_commitments: (p) => {
      const mode = window.__VC_MODE || 'none';
      if (mode === 'none') return [];
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
      // Map any meal-photo path to a REAL proto asset. Two shapes reach here: the meal-detail
      // path '<uid>/<date>/<slot>.jpg' and the activity-feed path 'meal-<slot>'. Both resolve to
      // the shipped proto plate (assets/meal-{breakfast,lunch,dinner}.jpg). Snack has no asset, so
      // it borrows lunch. The old code appended a second '.jpg' and never mapped the slot, which
      // is why the meal-detail photo rendered as an empty box.
      createSignedUrl: (p) => Promise.resolve({ data: { signedUrl: mealAsset(p) }, error: null }),
      createSignedUrls: (ps) => Promise.resolve({ data: ps.map(p => ({ path: p, signedUrl: mealAsset(p) })), error: null }),
      upload: () => Promise.resolve({ data: null, error: null }),
      getPublicUrl: (p) => ({ data: { publicUrl: mealAsset(p) } }),
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
