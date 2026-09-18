// OnStandard: the ONE place that talks to Expo's push service, and the one that reads its answer.
//
// WHY THIS EXISTS (2026-09-18). Ten edge functions each had their own copy of:
//
//     const r = await fetch('https://exp.host/--/api/v2/push/send', { … });
//     if (r.ok) pushed += chunk.length;
//
// That line is wrong, and it was wrong everywhere. Expo answers a well-formed request with
// **HTTP 200 and a per-message ticket array**, and a ticket may say `status: "error"`. `r.ok` is
// therefore true when every single push in the batch was refused. From the day push shipped until
// this module landed, Expo had no APNs key for com.onstandard.app and answered EVERY push with
//
//     { "status": "error", "details": { "error": "InvalidCredentials" } }
//
// — inside a 200. So every function counted a full batch as delivered, send-push returned
// `{ ok: true, pushed: N }`, the coach UI said "pushed to their phone", admin_audit_log recorded
// deliveries, and not one notification ever reached a device. Nobody could see it, because the
// code never looked. The reporting bug is what hid the credentials bug for months.
//
// So: parse the tickets, count only `status: "ok"`, and hand the caller the failures by name.
// A push that did not land must never be reported as one that did.
//
// Plain ES module on purpose (the quiet-hours.mjs / send-push logic.mjs precedent): Deno imports
// it from the edge functions and node:test imports it from *.test.mjs, so the parsing that decides
// what we TELL a coach is pinned by tests that run in `npm run test:fn` without Docker.

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo's documented ceiling for one request. */
export const EXPO_CHUNK_SIZE = 100;

/** Ticket errors that mean "this token is dead, stop sending to it". DeviceNotRegistered is the
 *  one Expo actually returns for an uninstalled app or a rotated token; the caller prunes them so
 *  a dead phone does not sit in device_tokens forever, re-failing on every nudge. */
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);

/** An empty outcome — the shape every caller can rely on even when nothing was attempted. */
export function emptyOutcome() {
  return { sent: 0, failed: 0, dead: [], errors: [] };
}

/**
 * Read Expo's response body for ONE chunk and say what actually happened.
 *
 * `messages` is the chunk exactly as sent, so ticket i can be attributed to token i — Expo returns
 * the tickets in request order and that is the only way to know WHICH phone failed.
 *
 * Handles all four shapes Expo can answer with:
 *   - `{ data: [ {status:'ok',id}, {status:'error',message,details:{error}} ] }` — the normal case,
 *   - `{ errors: [ {code,message} ] }`                — request-level rejection (bad JSON, too big),
 *   - a non-200 with no usable body                   — `ok:false` is passed in and all fail,
 *   - anything else                                   — counted as failed, never as sent.
 */
export function readTickets(messages, body, httpOk = true) {
  const list = Array.isArray(messages) ? messages : [];
  const out = emptyOutcome();
  const failAll = (reason) => {
    out.failed = list.length;
    if (reason) out.errors.push(reason);
    return out;
  };

  if (!httpOk) return failAll(describeRequestErrors(body) || 'http error');
  if (!body || typeof body !== 'object') return failAll('unreadable response');

  // Request-level rejection: no tickets at all, so nothing in this chunk went anywhere.
  if (Array.isArray(body.errors) && body.errors.length) {
    return failAll(describeRequestErrors(body));
  }

  const tickets = Array.isArray(body.data) ? body.data : null;
  if (!tickets) return failAll('no tickets in response');

  for (let i = 0; i < list.length; i++) {
    const t = tickets[i];
    // Fewer tickets than messages is Expo misbehaving; the safe reading is "not delivered".
    if (!t || typeof t !== 'object') { out.failed++; out.errors.push('missing ticket'); continue; }
    if (t.status === 'ok') { out.sent++; continue; }
    out.failed++;
    const code = (t.details && typeof t.details === 'object' && t.details.error) || null;
    if (code) out.errors.push(String(code));
    else if (t.message) out.errors.push(String(t.message).slice(0, 200));
    else out.errors.push('error');
    const to = list[i] && list[i].to;
    if (to && code && DEAD_TOKEN_ERRORS.has(String(code))) out.dead.push(String(to));
  }
  return out;
}

function describeRequestErrors(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.errors)) return null;
  return body.errors
    .map((e) => (e && (e.code || e.message)) || 'error')
    .map((s) => String(s).slice(0, 200))
    .join('; ') || null;
}

/** Merge chunk outcomes into one. Errors are de-duplicated: a whole roster failing for the same
 *  reason should read as one cause, not two hundred lines of the same word. */
export function mergeOutcomes(parts) {
  const out = emptyOutcome();
  const seen = new Set();
  for (const p of (Array.isArray(parts) ? parts : [])) {
    if (!p) continue;
    out.sent += p.sent || 0;
    out.failed += p.failed || 0;
    for (const d of (p.dead || [])) out.dead.push(d);
    for (const e of (p.errors || [])) if (!seen.has(e)) { seen.add(e); out.errors.push(e); }
  }
  out.dead = [...new Set(out.dead)];
  return out;
}

/**
 * Send every message, in chunks of 100, and report what Expo said.
 *
 * Returns `{ sent, failed, dead, errors }`. `sent` is the number of messages Expo ACCEPTED for
 * delivery — never the number we handed it. Never throws: a network failure counts that chunk as
 * failed and the caller's durable in-app row (which is always written first) still stands.
 *
 * NOTE ON "ACCEPTED". An `ok` ticket means Expo took the message, not that Apple showed it. The
 * honest next step is the receipts endpoint, minutes later; that is a separate job and this
 * function deliberately does not pretend to do it. But an `ok` ticket is the difference between
 * "we handed it over" and "it was refused at the door", and that is the distinction that was
 * missing.
 */
export async function sendExpoPush(messages, fetchImpl = fetch) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && m.to);
  if (!list.length) return emptyOutcome();
  const parts = [];
  for (let i = 0; i < list.length; i += EXPO_CHUNK_SIZE) {
    const chunk = list.slice(i, i + EXPO_CHUNK_SIZE);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      let body = null;
      try { body = await res.json(); } catch { /* readTickets treats null as unreadable */ }
      parts.push(readTickets(chunk, body, res.ok));
    } catch (e) {
      parts.push(readTickets(chunk, null, false));
      parts[parts.length - 1].errors = [String((e && e.message) || e).slice(0, 200)];
    }
  }
  return mergeOutcomes(parts);
}

/**
 * Send, then forget the tokens Expo says are dead. `svc` is a service-role supabase client; the
 * delete is best-effort and never affects the reported outcome. Callers that have a client should
 * prefer this over sendExpoPush so device_tokens stays true over time.
 */
export async function sendExpoPushAndPrune(messages, svc, fetchImpl = fetch) {
  const out = await sendExpoPush(messages, fetchImpl);
  if (out.dead.length && svc) {
    try { await svc.from('device_tokens').delete().in('token', out.dead); }
    catch { /* pruning is housekeeping; it must never change what we report */ }
  }
  return out;
}
