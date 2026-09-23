// OnStandard: only the words of people who said yes reach the AI (review pass 2026-09-23, I3).
//
// The consent gate (0243) proves the meal OWNER and the CALLER agreed. A thread has more people
// in it: a second coach, a dietitian, a parent. Their messages and names must not go to Anthropic
// unless they agreed too. So, before anything is written into a prompt:
//   - a message from someone without consent becomes a neutral placeholder ("[a message from the
//     coach]"): no text, no photo, no name;
//   - that person is named by their role ("the coach"), never by name;
//   - a message from someone the meal owner BLOCKED (0244) is dropped entirely;
//   - the AI's own rows are always kept.
// Applied to both sources of thread text: the client-sent context.thread and the meal_comments
// rows the function reads itself. The addressing decision still sees the unscrubbed context (it
// runs here, never goes to the model).
//
// Plain ES module: Deno imports it, node:test pins it.

const ROLE_WORD = { coach: 'coach', trainer: 'trainer', parent: 'parent', guardian: 'parent', dietitian: 'dietitian',
  nutritionist: 'dietitian', staff: 'coach', athlete: 'athlete', client: 'athlete' };

/** "coach" for a role, never a name. */
export function roleWord(role) {
  return ROLE_WORD[String(role || '').toLowerCase()] || 'someone in the thread';
}

/** The placeholder that stands in for a message whose author has not agreed. */
export function placeholderFor(role) {
  const w = roleWord(role);
  return w === 'someone in the thread' ? '[a message from someone in the thread]' : `[a message from the ${w}]`;
}

/** Every author id a request carries: client context thread + rows read from the database. */
export function authorIds(context, rows) {
  const ids = new Set();
  const thread = context && Array.isArray(context.thread) ? context.thread : [];
  for (const m of thread) if (m && m.senderId) ids.add(String(m.senderId));
  for (const r of Array.isArray(rows) ? rows : []) if (r && r.author_id) ids.add(String(r.author_id));
  return [...ids];
}

/**
 * The client context with every non-consented message replaced. An entry with no senderId is
 * kept only when it is the AI or the owner's own ('athlete') line; anything else unattributable
 * is a placeholder, because it cannot be shown to be consented.
 */
export function scrubContext(context, { consented, ownerId, blocked } = {}) {
  if (!context || typeof context !== 'object' || !Array.isArray(context.thread)) return context;
  const yes = consented instanceof Set ? consented : new Set(consented || []);
  const no = blocked instanceof Set ? blocked : new Set(blocked || []);
  const thread = [];
  for (const m of context.thread) {
    if (!m || typeof m !== 'object') continue;
    const role = m.senderRole || m.role;
    const id = m.senderId ? String(m.senderId) : null;
    if (id && no.has(id)) continue;
    const isAi = role === 'ai' || m.system === true;
    const ok = isAi || (id ? yes.has(id) : (role === 'athlete' && !!ownerId && yes.has(String(ownerId))));
    if (ok) { thread.push(m); continue; }
    const word = roleWord(role);
    const out = { ...m, text: placeholderFor(role), photo: false };
    if ('senderName' in out) out.senderName = `the ${word}`;
    delete out.mentions;
    delete out.replyToSender;
    thread.push(out);
  }
  return { ...context, thread };
}

/**
 * meal_comments rows made safe for the prompt: blocked authors dropped, non-consented ones turned
 * into placeholders with no photo. Returns { rows, nameable } where `nameable` is the set of ids
 * whose names may be looked up and written into the prompt.
 */
export function scrubRows(rows, { consented, blocked } = {}) {
  const yes = consented instanceof Set ? consented : new Set(consented || []);
  const no = blocked instanceof Set ? blocked : new Set(blocked || []);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const id = r.author_id ? String(r.author_id) : null;
    if (r.role !== 'ai' && id && no.has(id)) continue;
    if (r.role === 'ai' || (id && yes.has(id))) { out.push(r); continue; }
    const meta = r.meta && typeof r.meta === 'object' ? { ...r.meta } : {};
    delete meta.photo;
    out.push({ ...r, text: placeholderFor(r.role), meta });
  }
  return { rows: out, nameable: yes };
}
