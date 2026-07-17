/* Coach OS Inbox v2 — PURE (no imports, no DOM, no fetch, no Date.now/new Date — callers pass
   nowMs): computes the six inbox categories + grouped alerts from real roster/meal/comment/
   intervention data, mirroring status.js/priority.js purity. Every row here is plain data
   {kind, id, athleteId?, title, sub, go?, ts} — no HTML, no esc() (escaping happens at render,
   Task 3). An unknown/missing input degrades to an empty category, never a thrown error. */

/** latest message-kind comment's role per meal id (reaction/note kinds are ignored — they
 *  don't count as "who spoke last" for needsResponse purposes). */
function lastByMeal(comments) {
  const out = {};
  const latestTs = {};
  for (const c of (comments || [])) {
    if (!c || c.kind !== 'message' || !c.meal_id) continue;
    const ts = c.created_at ? new Date(c.created_at).getTime() : 0;
    if (latestTs[c.meal_id] == null || ts >= latestTs[c.meal_id]) {
      latestTs[c.meal_id] = ts;
      out[c.meal_id] = c.role;
    }
  }
  return out;
}

/** meal ids marked resolved by a 'handled' intervention whose reason_key === 'meal:'+id. */
function resolvedMealIdSet(interventions) {
  const out = new Set();
  for (const iv of (interventions || [])) {
    if (!iv || iv.kind !== 'handled' || typeof iv.reason_key !== 'string') continue;
    if (iv.reason_key.startsWith('meal:')) out.add(iv.reason_key.slice(5));
  }
  return out;
}

function nameFor(roster, athleteId) {
  const r = (roster || []).find(r => r && r.athleteId === athleteId);
  return (r && r.name) || 'Athlete';
}

/** Grouped alert rows for overdue requirements across a scope's entries ([{row,status}] from
 *  entriesFor). Groups by openItems[].id where state==='overdue' — an athlete with 2 overdue
 *  items counts once per item id, never double-counted within one id. */
export function inboxAlerts(entries, nowMs) {
  const byItem = {}; // itemId -> { title, count }
  for (const e of (entries || [])) {
    const items = (e && e.status && e.status.openItems) || [];
    for (const it of items) {
      if (!it || it.state !== 'overdue') continue;
      const id = it.id;
      if (!byItem[id]) byItem[id] = { title: it.title || id, count: 0 };
      byItem[id].count++;
    }
  }
  const out = [];
  for (const id of Object.keys(byItem)) {
    const { title, count } = byItem[id];
    out.push({
      kind: 'alert',
      id: `alert:overdue:${id}`,
      title: `${count} athlete${count === 1 ? '' : 's'} missed ${title}`,
      sub: 'Overdue requirement',
      ts: nowMs,
    });
  }
  return out;
}

/** categorizeInbox({ meals, comments, interventions, roster, pending, staff, announcements,
 *  seenIds, nowMs }) -> { needsResponse, athletes, mealReviews, staff, announcements, resolved,
 *  counts } — see js/inbox.js header + task brief for the six category rules. */
export function categorizeInbox({ meals, comments, interventions, roster, pending, staff, announcements, seenIds, nowMs } = {}) {
  const mealRows = Array.isArray(meals) ? meals : [];
  const seen = seenIds instanceof Set ? seenIds : new Set(Array.isArray(seenIds) ? seenIds : []);
  const lastRole = lastByMeal(comments);
  const resolvedIds = resolvedMealIdSet(interventions);

  const tsOf = (m) => (m.logged_at ? new Date(m.logged_at).getTime() : 0);

  const athletes = [];
  const mealReviews = [];
  const resolved = [];
  const needsResponseMeals = [];

  for (const m of mealRows) {
    if (!m || !m.id) continue;
    const id = m.id;
    const athleteId = m.athlete_id;
    const title = `${nameFor(roster, athleteId)} — ${m.type || 'Meal'}`;
    const ts = tsOf(m);
    const row = { kind: 'meal', id, athleteId, title, sub: m.type || '', ts };

    // athletes: every recent athlete meal thread, regardless of seen/resolved.
    athletes.push(row);

    const isResolved = resolvedIds.has(id);
    if (isResolved) {
      resolved.push(row);
      continue; // resolved wins over needsResponse — never also shown there
    }

    if (lastRole[id] === 'athlete') {
      needsResponseMeals.push(row);
    }

    // mealReviews: unseen meals with no coach message yet ("unopened logs").
    if (!seen.has(id) && lastRole[id] !== 'coach' && lastRole[id] !== 'athlete') {
      mealReviews.push(row);
    }
  }

  const pendingRows = (pending || []).map(p => ({
    kind: 'join', id: p.id, title: `${p.name || 'New athlete'} wants to join`, sub: 'Join request', ts: nowMs,
  }));

  const staffRows = (staff || []).map(s => ({
    kind: 'staff', id: s.id, title: s.name || s.email || 'Staff', sub: s.role || '', ts: (s.created_at ? new Date(s.created_at).getTime() : nowMs),
  }));

  const announcementRows = (announcements || []).map(a => ({
    kind: 'announcement', id: a.id, title: a.title || 'Announcement', sub: a.body || '', ts: (a.created_at ? new Date(a.created_at).getTime() : nowMs),
  }));

  // Grouped alert rows (inboxAlerts) are computed from entriesFor()'s roster-status entries,
  // which categorizeInbox does not receive (its `roster` here is bare {athleteId,name} rows,
  // not status entries) — callers merge inboxAlerts(entries, nowMs) into needsResponse
  // themselves at render time (Task 3).
  const needsResponse = [...needsResponseMeals, ...pendingRows]
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const sortDesc = (rows) => rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const counts = {
    needsResponse: needsResponse.length,
    athletes: athletes.length,
    mealReviews: mealReviews.length,
    staff: staffRows.length,
    announcements: announcementRows.length,
    resolved: resolved.length,
  };

  return {
    needsResponse,
    athletes: sortDesc(athletes),
    mealReviews: sortDesc(mealReviews),
    staff: staffRows,
    announcements: announcementRows,
    resolved: sortDesc(resolved),
    counts,
  };
}
