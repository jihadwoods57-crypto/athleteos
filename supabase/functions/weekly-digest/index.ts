// OnStandard — weekly-digest: the coach's Monday-morning read (churn build 2026-07-04,
// rebuilt 2026-08-05).
//
// A coach cancels when he can't tell the product is working. Once a week every active staff
// member gets their roster's week — who held the standard, who's slipping, whose run ended,
// who's gone silent — as an in-app notification AND a device push, so even a coach who hasn't
// opened the app gets reminded it's earning its keep. Numbers are computed HERE from the same
// days rows the dashboard reads; nothing is invented, and a roster with zero athletes gets an
// activation nudge, not a fake stat.
//
// The 2026-08-05 rebuild, three fixes in one pass:
//   1. CAPACITY (audit F3, the "wrong number in a coach's hand" finding): the old version read
//      teams/team_members/practices/practice_clients whole-table with max_rows=1000 — past a
//      thousand members every roster silently truncated. Now it pages the BOOKS and reads each
//      book's members with the filter in the query, so no read can exceed one roster.
//   2. RECIPIENTS: created_by/owner_id only meant assistant coaches never got a digest. Teams
//      now deliver to every ACTIVE team_staff row (send-push's announcement pattern).
//   3. CONTENT + ROUTE: logged-days/average said nothing a coach could act on. The body now
//      names who held standard, who's slipping, and whose streak broke, and the push carries
//      data.route so the tap lands on the insights screen instead of wherever the app last was.
//
// INVOCATION: scheduled. Protected by a shared key so only the scheduler can fire it
// (deploy with --no-verify-jwt; a browser/anon caller without the key gets 401):
//   supabase secrets set DIGEST_CRON_KEY=<long random string>
//   supabase functions deploy weekly-digest --use-api --no-verify-jwt
// Schedule via migration 0044's helper (see docs/go-live/WEEKLY-DIGEST.md). Monday morning
// beats Sunday night: the read leads the week it can still change.
import { createClient } from 'npm:@supabase/supabase-js@2.110.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CRON_KEY = Deno.env.get('DIGEST_CRON_KEY') ?? '';

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Constant-time compare of the shared cron key so the check leaks no timing signal about how many
// leading bytes matched (audit 2026-07-12; belt-and-suspenders given the key is long + random).
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** ISO date N days ago (UTC-based; the digest is a weekly summary, not a clock). */
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const PAGE = 500;           // rows per paged read — safely under config.toml max_rows=1000
const BOOK_CAP = 2000;      // books per invocation; a run that hits it logs what it dropped
const ON_STANDARD = 80;     // the same bar every athlete surface uses

// THE COACH'S OWN MONDAY MORNING (2026-09-03). The job fires every hour on Monday (migration 0218)
// and each coach hears from it in the one hour that is LOCAL_HOUR where they live, read from
// profiles.timezone (0088). One fixed 12:00 UTC send was 8 AM in New York and 5 AM in Los
// Angeles, and drifted an hour at every DST change. A profile with no timezone yet falls back to
// FALLBACK_TZ, which is what the old fixed hour assumed anyway. `?all=1` skips the hour gate for a
// manual run; the 6-day dedupe still makes that safe.
const LOCAL_HOUR = Number(Deno.env.get('DIGEST_LOCAL_HOUR') ?? '7');
const FALLBACK_TZ = Deno.env.get('DEFAULT_TIMEZONE') ?? 'America/New_York';

/** Hour of day (0-23) at `nowMs` in `tz`, falling back to FALLBACK_TZ for an unknown zone. */
export function localHour(nowMs: number, tz: string | null | undefined): number {
  const read = (zone: string) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false }).format(new Date(nowMs))) % 24;
  try { return read(tz || FALLBACK_TZ); } catch { return read(FALLBACK_TZ); }
}

interface DayLite { athlete_id: string; date: string; score: number | null }
interface Roster { athletes: { id: string; name: string }[]; recipients: string[] }

const first = (name: string) => (name || '').split(' ')[0];

/** Per-athlete week analysis over 14 days of rows (this week judges, last week gives streak
 *  context). Pure; factual; no em dash; never a fabricated number. */
function digestBody(roster: Roster): { title: string; body: string } {
  // Never the app name in a title: the OS notification header already says it (the rule every
  // push shares since the 2026-09-03 notification pass; see docs/notifications/).
  const title = 'Your weekly read';
  if (roster.athletes.length === 0) {
    return { title, body: 'No athletes on your roster yet. Share your join code and your first weekly report starts building.' };
  }
  return { title, body: buildBody(roster) };
}

let DAYS_BY_ATHLETE = new Map<string, DayLite[]>(); // set per-book before digestBody runs

function buildBody(roster: Roster): string {
  const weekFrom = daysAgo(6);
  const silentFrom = daysAgo(2);
  const held: string[] = [];
  const slipping: string[] = [];
  const silent: string[] = [];
  const broke: { name: string; run: number }[] = [];

  for (const a of roster.athletes) {
    const rows = (DAYS_BY_ATHLETE.get(a.id) ?? []).slice().sort((x, y) => x.date.localeCompare(y.date));
    const week = rows.filter((r) => r.date >= weekFrom);
    const scored = week.map((r) => r.score).filter((s): s is number => typeof s === 'number');
    if (!week.some((r) => r.date >= silentFrom)) silent.push(first(a.name));
    if (scored.length === 0) continue; // silent covers them; an empty week is not "slipping"
    const avg = scored.reduce((x, y) => x + y, 0) / scored.length;
    if (avg >= ON_STANDARD) held.push(first(a.name));
    else slipping.push(first(a.name));

    // A run of 3+ on-standard days whose last day fell inside this week, followed by a day
    // that broke it (off-standard or unlogged while later days exist). Longest such run wins.
    const on = new Set(rows.filter((r) => (r.score ?? 0) >= ON_STANDARD).map((r) => r.date));
    let run = 0;
    let best = 0;
    let bestEnd = '';
    for (let n = 13; n >= 0; n--) {
      const d = daysAgo(n);
      if (on.has(d)) { run++; continue; }
      if (run >= 3 && daysAgo(n + 1) >= weekFrom && run > best) { best = run; bestEnd = daysAgo(n + 1); }
      run = 0;
    }
    // A run still alive through today is not broken; only a bestEnd strictly before today counts.
    if (best >= 3 && bestEnd && bestEnd < daysAgo(0)) broke.push({ name: first(a.name), run: best });
  }

  const total = roster.athletes.length;
  const listOf = (names: string[], cap = 3) =>
    `${names.slice(0, cap).join(', ')}${names.length > cap ? ` and ${names.length - cap} more` : ''}`;

  const parts: string[] = [];
  parts.push(held.length === 0
    ? `Nobody averaged ${ON_STANDARD} this week across ${total} ${total === 1 ? 'athlete' : 'athletes'}.`
    : `${held.length} of ${total} held the standard this week${held.length <= 3 ? `: ${listOf(held)}` : ''}.`);
  if (slipping.length > 0) parts.push(`Below the bar: ${listOf(slipping)}.`);
  if (broke.length > 0) {
    const b = broke.sort((x, y) => y.run - x.run)[0];
    parts.push(`${b.name}'s ${b.run} day run ended this week.`);
  }
  if (silent.length > 0) {
    parts.push(`${silent.length === 1 ? 'One athlete has' : `${silent.length} athletes have`} not logged in 3 days: ${listOf(silent)}. A quick check-in usually restarts them.`);
  } else if (slipping.length === 0 && broke.length === 0) {
    parts.push('Nobody went silent.');
  }
  return parts.join(' ');
}

/** Paged read: every row matching the builder's filters, PAGE at a time. */
async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  // The shared-key gate is the endpoint's ONLY caller auth (deployed with JWT off so the
  // scheduler can call it). No key configured = fail closed, never open.
  if (!CRON_KEY || !safeEqual(req.headers.get('x-digest-key') ?? '', CRON_KEY)) return json({ error: 'unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'server not configured' }, 500);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowMs = Date.now();
  const sendAll = new URL(req.url).searchParams.get('all') === '1';
  let waiting = 0; // recipients whose local 7 AM is a later run today
  try {
    // 1) The books, paged. Teams deliver to every active staff member; practices to the owner.
    const teams = await allRows<{ id: string; created_by: string | null }>((f, t) =>
      svc.from('teams').select('id, created_by').order('id').range(f, t));
    const practices = await allRows<{ id: string; owner_id: string }>((f, t) =>
      svc.from('practices').select('id, owner_id').order('id').range(f, t));
    const books: { kind: 'team' | 'practice'; id: string; fallbackOwner: string | null }[] = [
      ...teams.map((t) => ({ kind: 'team' as const, id: t.id, fallbackOwner: t.created_by })),
      ...practices.map((p) => ({ kind: 'practice' as const, id: p.id, fallbackOwner: p.owner_id })),
    ];
    if (books.length > BOOK_CAP) console.warn(`weekly-digest: ${books.length - BOOK_CAP} books over cap were skipped this run`);
    const work = books.slice(0, BOOK_CAP);

    // 2) Dedupe + opt-out state is read per-recipient as we go, but the 6-day window is fixed.
    const dedupeSince = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const seen = new Set<string>();      // recipients already handled this run (a coach on two teams gets ONE digest, first book wins)
    let sent = 0, deduped = 0, optedOut = 0;

    for (const book of work) {
      // Roster: filter IN the query, page the read — no whole-table scan at any size (fix 1).
      const athletes = book.kind === 'team'
        ? await allRows<{ athlete_id: string }>((f, t) =>
          svc.from('team_members').select('athlete_id').eq('team_id', book.id).eq('status', 'active').order('athlete_id').range(f, t))
          .then((rows) => rows.map((r) => r.athlete_id))
        : await allRows<{ client_id: string }>((f, t) =>
          svc.from('practice_clients').select('client_id').eq('practice_id', book.id).eq('status', 'active').order('client_id').range(f, t))
          .then((rows) => rows.map((r) => r.client_id));

      // Recipients: active staff for a team (fix 2), owner for a practice.
      let recipients: string[] = [];
      if (book.kind === 'team') {
        recipients = await allRows<{ staff_id: string }>((f, t) =>
          svc.from('team_staff').select('staff_id').eq('team_id', book.id).eq('status', 'active').order('staff_id').range(f, t))
          .then((rows) => rows.map((r) => r.staff_id));
        if (recipients.length === 0 && book.fallbackOwner) recipients = [book.fallbackOwner];
      } else if (book.fallbackOwner) {
        recipients = [book.fallbackOwner];
      }
      recipients = recipients.filter((r) => !seen.has(r));
      if (recipients.length === 0) continue;

      // 14 days of day rows (this week judges; last week gives streak context) + names.
      let names = new Map<string, string>();
      DAYS_BY_ATHLETE = new Map();
      if (athletes.length > 0) {
        const [dayRows, profRows] = await Promise.all([
          allRows<DayLite>((f, t) =>
            svc.from('days').select('athlete_id, date, score').gte('date', daysAgo(13)).in('athlete_id', athletes).order('athlete_id').range(f, t)),
          allRows<{ id: string; full_name: string | null }>((f, t) =>
            svc.from('profiles').select('id, full_name').in('id', athletes).order('id').range(f, t)),
        ]);
        names = new Map(profRows.map((p) => [p.id, p.full_name ?? '']));
        for (const d of dayRows) {
          if (!DAYS_BY_ATHLETE.has(d.athlete_id)) DAYS_BY_ATHLETE.set(d.athlete_id, []);
          DAYS_BY_ATHLETE.get(d.athlete_id)!.push(d);
        }
      }
      const roster: Roster = {
        athletes: athletes.map((id) => ({ id, name: names.get(id) ?? '' })),
        recipients,
      };
      const { title, body } = digestBody(roster);

      // Per-recipient: opt-out gate, 6-day dedupe, durable row FIRST, then the push (winback's
      // rule: the notifications row is both the record and the dedupe key).
      // One read for the whole recipient list: opt-out and timezone together.
      const { data: profRows } = await svc.from('profiles').select('id, notifications_opt_out, timezone').in('id', recipients);
      const profOf = new Map((profRows ?? []).map((p: { id: string; notifications_opt_out?: boolean | null; timezone?: string | null }) => [p.id, p]));
      for (const rid of recipients) {
        const prof = profOf.get(rid);
        if (prof?.notifications_opt_out === true) { seen.add(rid); optedOut++; continue; }
        // Not their morning yet: leave them for a later run today. NOT marked seen, so a coach on
        // two books is still handled by whichever run is their 7 AM; the 6-day dedupe below is
        // what keeps a later run from doubling.
        if (!sendAll && localHour(nowMs, prof?.timezone) !== LOCAL_HOUR) { waiting++; continue; }
        seen.add(rid);
        const { data: recent } = await svc.from('notifications')
          .select('id').eq('user_id', rid).eq('kind', 'digest').gte('created_at', dedupeSince).limit(1);
        if (recent && recent.length > 0) { deduped++; continue; }
        await svc.from('notifications').insert({ user_id: rid, kind: 'digest', title, body });
        const { data: toks } = await svc.from('device_tokens').select('token').eq('user_id', rid);
        const tokens = (toks ?? []).map((t: { token: string }) => t.token).filter(Boolean);
        for (let i = 0; i < tokens.length; i += 100) {
          try {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(tokens.slice(i, i + 100).map((to) => ({
                to, title, body, sound: 'default',
                // Fix 3: the tap lands on the weekly insights read, not wherever the app last was.
                data: { route: 'coach-insights' },
              }))),
            });
          } catch { /* push is best-effort; the feed entry already landed */ }
        }
        sent++;
      }
    }
    return json({ ok: true, digests: sent, deduped, optedOut, waiting, localHour: LOCAL_HOUR, books: work.length });
  } catch (e) {
    console.error('weekly-digest error:', e);
    return json({ error: 'digest failed' }, 500);
  }
});
