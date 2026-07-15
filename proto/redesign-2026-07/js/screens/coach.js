import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { backHead, titleHead, esc, composer } from '../components.js';
import * as roles from '../roles.js';
import { openingMessage, reactionGroups, threadMessages } from '../meal-intel.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  } catch {
    // A fetch that actually threw (vs the lower layers' swallow-to-[]) must NOT leave the screen
    // stuck on "Loading…" forever — mark offline so the render shows a distinct, retryable state.
    ROSTER = { teams: [], rows: [], pending: [], offline: true };
  } finally {
    rosterLoading = false; // always clear so a retry can re-run
  }
  // coach-athlete also depends on the roster (name + membership guard for a stale/dead link).
  if (location.hash === '#coach' || location.hash === '#copilot' || location.hash === '#coach-inbox' || location.hash.startsWith('#coach-athlete') || location.hash.startsWith('#coach-assign') || location.hash.startsWith('#coach-plan')) window.__render();
}
const scoreColor = (s) => s == null ? 'var(--text-3)' : s >= 80 ? 'var(--green-bright)' : s >= 60 ? 'var(--amber-bright)' : 'var(--red)';

/* Roster-wide activity feed (WS4a): recent meals across the team, newest first, with
   per-device unseen dots. Photos are real signed URLs (cached), never stock plates. */
let ACT = null;            // null = loading; { rows, photos: {mealId: url} }
let actLoading = false;
let actFetchedAt = 0;      // freshness window: a tab visit refetches, a repaint doesn't loop
async function loadActivity(force) {
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
const actTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  let h = d.getHours() % 12; if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

function rosterRow(r) {
  return `
  <div class="roster-row" data-go="coach-athlete/${esc(r.athleteId)}">
    <div class="flagdot ${r.flag}"></div>
    <div class="rn">
      <div class="t">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
      <div class="s">${esc(r.note)}</div>
    </div>
    <span class="rl">${esc(r.logs)}</span>
    <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
  </div>`;
}

/* ---------- Coach Dashboard — real roster scoped by RLS to the coach's teams ---------- */
export const coach = {
  nav: 'coach', tab: 'team',
  render() {
    const teamName = ROSTER && ROSTER.teams[0] ? ROSTER.teams[0].name : (S.athlete.school || 'Your team');
    const rows = ROSTER ? ROSTER.rows : null;
    const scored = rows ? rows.filter(r => r.score != null) : [];
    const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
    const onStd = rows ? rows.filter(r => r.score != null && r.score >= 80).length : 0;
    const attention = rows ? rows.filter(r => r.flag === 'r') : [];
    // A real account greeting, not a "view" — the handle the room uses (0056), e.g. "Coach JB".
    return `
    ${titleHead(`${S.greeting}, ${S.coachIdentity.handle}`, `${esc(teamName)} · today`)}

    ${rows === null || (ROSTER && ROSTER.offline) ? `
    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:var(--text-3)">—</div><div class="k">Team avg</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--text-3)">—</div><div class="k">On standard</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--text-3)">—</div><div class="k">Need attention</div></div>
    </div>` : `
    <section class="card" style="display:flex;align-items:center;gap:16px;padding:15px 18px">
      <div style="flex:none">
        <div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-3);margin-bottom:3px">Team score</div>
        <div style="font-size:42px;font-weight:800;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums;background:linear-gradient(105deg,var(--ring-a),var(--ring-b) 45%,var(--ring-c));-webkit-background-clip:text;background-clip:text;color:transparent">${avg != null ? avg : '—'}</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:7px;border-left:1px solid var(--hairline-soft);padding-left:16px;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-2)"><span style="width:7px;height:7px;border-radius:50%;background:var(--green-bright);flex:none"></span><b style="color:var(--text);font-variant-numeric:tabular-nums">${onStd}</b>&nbsp;on standard</div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-2)"><span style="width:7px;height:7px;border-radius:50%;background:var(--red);flex:none;box-shadow:0 0 8px rgba(246,87,87,0.5)"></span><b style="color:var(--text);font-variant-numeric:tabular-nums">${attention.length}</b>&nbsp;need attention</div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-2)"><span style="width:7px;height:7px;border-radius:50%;background:var(--blue-bright);flex:none"></span><b style="color:var(--text);font-variant-numeric:tabular-nums">${rows.filter(r => r.loggedToday).length} of ${rows.length}</b>&nbsp;logged today</div>
      </div>
    </section>`}

    ${ROSTER && ROSTER.pending && ROSTER.pending.length ? `
    <div class="eyebrow">Join requests</div>
    <section class="card" style="padding:6px 16px">
      ${ROSTER.pending.map(q => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
          <div class="lm"><div class="lt">${esc(q.athlete_name || 'Athlete')}${q.position ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(q.position)}</small>` : ''}</div><div class="ls">Wants to join</div></div>
          <button class="btn ghost sm" data-jr="decline" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
          <button class="btn green sm" data-jr="approve" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
        </div>`).join('')}
    </section>` : ''}

    ${rows === null ? `
    <div class="eyebrow">Roster</div>
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
    <div><div class="tt">Loading your roster…</div><div class="ts">Pulling today's real scores for your team.</div></div></div>`
    : (ROSTER && ROSTER.offline) ? `
    <div class="eyebrow">Roster</div>
    <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your roster</div>
    <div class="sd-s">We couldn't load today's scores — check your connection. Pull down or reopen to retry; nothing is lost.</div></div>`
    : rows.length === 0 ? `
    <div class="eyebrow">Roster</div>
    <div class="state-demo"><div class="sd-ic">${icon('users', 24)}</div>
    <div class="sd-t">No athletes yet</div>
    <div class="sd-s">Share your team code so athletes can join. Their live scores show up here — nothing is invented until they log.</div></div>`
    : `
    ${attention.length ? `<div class="eyebrow">Needs attention</div>${attention.map(r => {
      const nudgedToday = (RT.coachNudged || {})[r.athleteId] === new Date().toISOString().slice(0, 10);
      return `
    <div class="notif critical" style="display:block">
      <div style="display:flex;align-items:center;gap:12px;cursor:pointer" data-go="coach-athlete/${esc(r.athleteId)}">
        <div class="nic">${icon('bell', 19)}</div>
        <div style="flex:1"><div class="nt">${esc(r.name)}${r.unit ? ` · ${esc(r.unit)}` : ''}</div><div class="nb">${esc(r.note)}</div></div>
        <span class="nw">${r.score != null ? r.score : '—'}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:10px">
        <button class="btn sm" data-msg="${esc(r.athleteId)}" style="height:34px;font-size:12px">${icon('message', 14)} Message</button>
        <button class="btn ghost sm" data-nudge="${esc(r.athleteId)}" style="height:34px;font-size:12px" ${nudgedToday ? 'disabled' : ''}>${nudgedToday ? 'Nudged ✓' : 'Nudge'}</button>
        <button class="btn ghost sm" data-go="coach-assign/${esc(r.athleteId)}" style="height:34px;font-size:12px">Assign</button>
      </div>
      <div class="msg-composer" id="msg-box-${esc(r.athleteId)}" style="display:none;margin-top:8px">
        <input class="ob-input" id="msg-in-${esc(r.athleteId)}" maxlength="300" placeholder="Straight to their phone — as ${esc(S.coachIdentity.handle)}" />
        <button class="btn green sm" data-msg-send="${esc(r.athleteId)}" style="height:34px;font-size:12px;margin-top:7px">Send it</button>
      </div>
      <div id="msg-status-${esc(r.athleteId)}" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;margin-top:5px"></div>
    </div>`;
    }).join('')}` : ''}

    ${(() => {
      const act = ACT && ACT.rows ? ACT.rows : null;
      const names = {}; rows.forEach(r => { names[r.athleteId] = r; });
      const seen = new Set(RT.coachSeenMealIds || []);
      const unseenCount = act ? act.filter(m => !seen.has(m.id)).length : 0;
      const card = (m) => {
        const who = names[m.athlete_id] || {};
        const first = (who.name || 'Athlete').split(' ')[0];
        const photo = ACT.photos[m.id];
        const bits = [cap(m.type || 'Meal'), actTime(m.logged_at)].filter(Boolean);
        if (m.protein != null) bits.push(`${Math.round(m.protein)}g`);
        return `
        <div class="act-card" data-go="coach-meal/${esc(m.id)}" style="position:relative;flex:0 0 47%">
          ${photo ? `<div class="act-media" style="height:64px;background-image:url('${esc(photo)}');background-size:cover;background-position:center"></div>`
                  : `<div class="act-media" style="height:64px;background:linear-gradient(150deg,var(--surface-2),var(--surface-3))"></div>`}
          ${seen.has(m.id) ? '' : `<span style="position:absolute;top:7px;right:7px;width:9px;height:9px;border-radius:50%;background:var(--blue-bright);box-shadow:0 0 9px rgba(96,165,250,0.7);border:2px solid rgba(5,8,15,0.8)"></span>`}
          <div style="padding:8px 10px 9px">
            <div style="font-size:11px;font-weight:800">${esc(first)}${who.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(who.unit)}</small>` : ''}</div>
            <div style="font-size:9.5px;color:var(--text-3);font-weight:700;margin-top:2px">${esc(bits.join(' · '))}</div>
          </div>
        </div>`;
      };
      return `
    <div class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline"><span>Activity · every log as it lands</span>${unseenCount ? `<span style="color:var(--blue-bright);letter-spacing:0.04em">${unseenCount} new</span>` : ''}</div>
    ${act === null ? `
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('utensils', 17)}</div>
    <div><div class="tt">Loading the feed…</div><div class="ts">Every meal your roster logs shows up here.</div></div></div>`
    : act.length === 0 ? `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">No logs yet today. Meals appear here the moment an athlete logs — with a dot on anything you haven't opened.</div>`
    : `<div style="display:flex;gap:9px;overflow-x:auto;padding-bottom:4px;margin:0 -2px">${act.slice(0, 12).map(card).join('')}</div>`}`;
    })()}

    <div class="eyebrow">Roster · live scores</div>
    <section class="card" style="padding:2px 0">${rows.map(rosterRow).join('')}</section>`}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster().then(() => loadActivity());
    // Message / Nudge on the needs-attention cards (real send-push: in-app notification + device push)
    root.querySelectorAll('[data-msg]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-msg');
      const box = root.querySelector(`#msg-box-${id}`);
      if (box) { box.style.display = box.style.display === 'none' ? '' : 'none'; const i = box.querySelector('input'); if (i && box.style.display === '') i.focus(); }
    }));
    root.querySelectorAll('[data-msg-send]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-msg-send');
      const input = root.querySelector(`#msg-in-${id}`);
      const status = root.querySelector(`#msg-status-${id}`);
      const text = ((input && input.value) || '').trim();
      if (text.length < 2) { if (status) { status.style.color = 'var(--red)'; status.textContent = 'Type the message first.'; } return; }
      b.disabled = true; if (status) { status.style.color = 'var(--text-3)'; status.textContent = 'Sending…'; }
      const ok = await roles.nudgePush(id, `${S.coachIdentity.handle}`, text);
      b.disabled = false;
      if (status) {
        status.style.color = ok ? 'var(--green-bright)' : 'var(--red)';
        status.textContent = ok ? 'Sent — lands on their phone.' : 'Could not send — check the connection.';
      }
      if (ok && input) { input.value = ''; const box = root.querySelector(`#msg-box-${id}`); if (box) box.style.display = 'none'; }
    }));
    root.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-nudge');
      b.disabled = true; b.textContent = '…';
      const ok = await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
      if (ok) { act.markNudged(id); window.__render(); }
      else { b.disabled = false; b.textContent = 'Nudge'; }
    }));
    // Approve/decline a join request → real team_members flip/delete, then refresh the roster.
    root.querySelectorAll('[data-jr]').forEach(b => b.addEventListener('click', async () => {
      const team = b.getAttribute('data-team'), ath = b.getAttribute('data-ath');
      b.disabled = true; b.textContent = '…';
      if (b.getAttribute('data-jr') === 'approve') await roles.approveMember(team, ath);
      else await roles.declineMember(team, ath);
      await loadCoachRoster(true);
    }));
  },
};

/* ---------- Coach assign flow — the + button (0055 requirements engine) ----------
   Who (team / position room / one athlete) → what (title) → proof → due → note → send.
   The assign_requirement RPC fans out one row per athlete and notifies each; failures
   (offline, migration not yet applied to live) surface the server's message honestly. */
const ASSIGN = { scopeKind: 'team', scopeValue: null, proof: 'check', due: 'tonight' };
const DUE_CHOICES = {
  tonight:  { label: 'Tonight · 9 PM',   at: () => { const d = new Date(); d.setHours(21, 0, 0, 0); return d; } },
  tomorrow: { label: 'Tomorrow · 9 PM',  at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(21, 0, 0, 0); return d; } },
  none:     { label: 'No deadline',      at: () => null },
};
const PROOF_CHOICES = [
  ['photo', 'camera', 'Photo'], ['check', 'check', 'Check'], ['scale', 'scale', 'Scale'], ['form', 'clipboard', 'Form'],
];

export const coachAssign = {
  nav: 'coach', tab: 'assign',
  render({ sub } = {}) {
    // deep-link: coach-assign/<athleteId> pre-targets one athlete (from the athlete screen)
    const rows = ROSTER ? ROSTER.rows : [];
    if (sub && ASSIGN.scopeKind !== 'athlete') { ASSIGN.scopeKind = 'athlete'; ASSIGN.scopeValue = sub; }
    const positions = [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))];
    const target = ASSIGN.scopeKind === 'athlete' ? rows.find(r => r.athleteId === ASSIGN.scopeValue) : null;
    const chip = (on, label, act, arg) =>
      `<span class="chp ${on ? 'on' : ''}" data-assign="${act}${arg != null ? ':' + esc(String(arg)) : ''}">${label}</span>`;
    return `
    ${backHead('Assign', 'Put something on someone’s plate', 'coach')}

    <div class="eyebrow">Who</div>
    <div class="chip-row" id="as-who">
      ${chip(ASSIGN.scopeKind === 'team', `Whole team${rows.length ? ` · ${rows.length}` : ''}`, 'team')}
      ${positions.map(p => {
        const n = rows.filter(r => (r.unit || '').trim().toUpperCase() === p).length;
        return chip(ASSIGN.scopeKind === 'position' && ASSIGN.scopeValue === p, `${esc(p)} room · ${n}`, 'position', p);
      }).join('')}
    </div>
    ${rows.length ? `
    <div class="chip-row" id="as-ath" style="margin-top:6px">
      ${rows.slice(0, 12).map(r => chip(ASSIGN.scopeKind === 'athlete' && ASSIGN.scopeValue === r.athleteId, esc(r.name.split(' ')[0] || r.name), 'athlete', r.athleteId)).join('')}
    </div>` : `
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:2px 2px 0">Roster loading… team-wide works right away.</div>`}

    <div class="eyebrow">What</div>
    <input id="as-title" class="ob-input" maxlength="80" placeholder="e.g. Extra shake after lift" value="${esc(ASSIGN.title || '')}" />

    <div class="eyebrow">Proof</div>
    <div class="chip-row" id="as-proof">
      ${PROOF_CHOICES.map(([id, ic, label]) => chip(ASSIGN.proof === id, `${icon(ic, 13)} ${label}`, 'proof', id)).join('')}
    </div>

    <div class="eyebrow">Due</div>
    <div class="chip-row" id="as-due">
      ${Object.entries(DUE_CHOICES).map(([id, d]) => chip(ASSIGN.due === id, d.label, 'due', id)).join('')}
    </div>

    <div class="eyebrow">Note · optional</div>
    <input id="as-note" class="ob-input" maxlength="280" placeholder="Why it matters (they see this)" value="${esc(ASSIGN.note || '')}" />

    <div style="height:16px"></div>
    <button class="btn" id="as-send">${icon('plus', 18)} ${target ? `Send to ${esc(target.name)}` : ASSIGN.scopeKind === 'position' ? `Send to the ${esc(ASSIGN.scopeValue || '')} room` : 'Send to the whole team'}</button>
    <div id="as-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:8px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster();
    const say = (msg, isErr) => {
      const el = root.querySelector('#as-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    const keep = () => {
      ASSIGN.title = (root.querySelector('#as-title') || {}).value || '';
      ASSIGN.note = (root.querySelector('#as-note') || {}).value || '';
    };
    root.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('click', () => {
      keep();
      const [act, arg] = el.getAttribute('data-assign').split(':');
      if (act === 'team') { ASSIGN.scopeKind = 'team'; ASSIGN.scopeValue = null; }
      if (act === 'position') { ASSIGN.scopeKind = 'position'; ASSIGN.scopeValue = arg; }
      if (act === 'athlete') { ASSIGN.scopeKind = 'athlete'; ASSIGN.scopeValue = arg; }
      if (act === 'proof') ASSIGN.proof = arg;
      if (act === 'due') ASSIGN.due = arg;
      window.__render();
    }));
    const send = root.querySelector('#as-send');
    if (send) send.addEventListener('click', async () => {
      keep();
      const title = ASSIGN.title.trim();
      if (title.length < 2) { say('Give it a name first — what are they doing?', true); return; }
      const teamId = ROSTER && ROSTER.teams[0] && ROSTER.teams[0].id;
      if (!teamId) { say('Your roster hasn’t loaded yet — give it a second and try again.', true); return; }
      const due = DUE_CHOICES[ASSIGN.due];
      const dueAt = due.at();
      send.disabled = true; say('Sending…');
      const r = await roles.assignRequirement({
        teamId, scopeKind: ASSIGN.scopeKind, scopeValue: ASSIGN.scopeValue,
        title, proof: ASSIGN.proof,
        dueAt: dueAt ? dueAt.toISOString() : null,
        dueLabel: dueAt ? due.label.replace(' · ', ' ') : null,
        note: ASSIGN.note.trim() || null,
      });
      send.disabled = false;
      if (!r.ok) { say(r.error || 'Could not send — try again.', true); return; }
      if (!r.count) { say('No athletes matched — check who you picked.', true); return; }
      ASSIGN.title = ''; ASSIGN.note = '';
      say(r.count === 1 ? 'Sent — it’s on their list now.' : `Sent — it’s on ${r.count} lists now.`);
    });
  },
};

/* ---------- Coach sets an athlete's REAL nutrition targets (coach_set_goals RPC) ---------- */
let TGT = null;           // { athleteId, targets } loaded from athlete_profiles
let tgtLoadingId = null;
async function loadTargets(athleteId) {
  if (!athleteId || tgtLoadingId === athleteId) return;
  if (TGT && TGT.athleteId === athleteId) return; // loaded — repaints must not refetch-loop
  tgtLoadingId = athleteId;
  const [targets, basics] = await Promise.all([
    roles.fetchAthleteTargets(athleteId),
    roles.fetchAthleteBasics(athleteId),
  ]);
  TGT = { athleteId, targets: targets || {}, basics: basics || null };
  tgtLoadingId = null;
  if (location.hash.startsWith('#coach-plan')) window.__render();
}
/* Deterministic target suggestion — sports-nutrition rules of thumb, computed in the open
   (never an AI black box; the coach's Save is the only thing that writes). Direction comes
   from target vs current weight: bulk / cut / hold. */
function suggestTargets(targetWeight, baseWeight) {
  const tw = +targetWeight || 0;
  if (tw < 80 || tw > 450) return null;
  const bw = +baseWeight || tw;
  const mode = tw > bw + 5 ? 'bulk' : tw < bw - 5 ? 'cut' : 'hold';
  const protein = Math.round((tw * (mode === 'cut' ? 1.2 : mode === 'bulk' ? 1.1 : 0.9)) / 5) * 5;
  const calories = Math.round((tw * (mode === 'bulk' ? 17 : mode === 'cut' ? 13 : 15)) / 50) * 50;
  const why = mode === 'bulk' ? `building to ${tw} lb — surplus + 1.1g/lb protein`
    : mode === 'cut' ? `cutting to ${tw} lb — deficit + 1.2g/lb to hold muscle`
    : `holding ${tw} lb — maintenance + 0.9g/lb`;
  return { protein, calories, mode, why };
}
/* ---------- Plan tab = Coach Control Center (WS5.1) ----------
   No athlete id → the program home: per-room standing standards (0055 requirement_sets)
   + targets entry points. With an athlete id → the existing per-athlete targets editor. */
let SETS = null;            // team's requirement_sets, or null (loading) / {offline:true}
let setsLoading = false;
async function loadSets(force) {
  const teamId = ROSTER && ROSTER.teams[0] && ROSTER.teams[0].id;
  if (!teamId || setsLoading) return;
  if (SETS && !force) return;
  setsLoading = true;
  try { SETS = { rows: await roles.fetchRequirementSets(teamId) }; }
  catch { SETS = { rows: [] }; }
  finally { setsLoading = false; }
  if (location.hash.startsWith('#coach-plan')) window.__render();
}
/* Trust passes across the roster (0033/0039 — earned camera-free reward, server-enforced). */
let TP = null;
let tpLoading = false;
async function loadTrust(force) {
  if (tpLoading) return;
  if (TP && !force) return;
  const rows = ROSTER ? ROSTER.rows.slice(0, 12) : [];
  tpLoading = true;
  try {
    const map = {};
    await Promise.all(rows.map(async (r) => { map[r.athleteId] = await roles.fetchActiveTrustPass(r.athleteId); }));
    TP = { map };
  } catch { TP = { map: {} }; }
  finally { tpLoading = false; }
  if (location.hash.startsWith('#coach-plan')) window.__render();
}

const setSummary = (items) => {
  const meals = items.filter(i => i.kind === 'meal').length;
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  const bits = [`${meals} meal${meals === 1 ? '' : 's'}`];
  if (lift) bits.push((lift.freq && lift.freq.label) ? `lifts ${lift.freq.label}` : 'lifts');
  if (weigh) bits.push(weigh.freq && weigh.freq.type === 'daily' ? 'weigh daily' : 'weigh MWF');
  return bits.join(' · ');
};

export const coachPlan = {
  nav: 'coach', tab: 'plan',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const head = backHead('Nutrition targets', `${esc(who.name)} · coach owns the plan`, athleteId ? `coach-athlete/${esc(athleteId)}` : 'coach-plan');
    if (!athleteId) {
      const rows = ROSTER ? ROSTER.rows : null;
      const positions = rows ? [...new Set(rows.map(r => (r.unit || '').trim().toUpperCase()).filter(Boolean))] : [];
      const sets = SETS && SETS.rows ? SETS.rows : null;
      const teamSet = sets && sets.find(s => s.scope_kind === 'team');
      const roomCard = (pos) => {
        const s = sets && sets.find(x => x.scope_kind === 'position' && String(x.scope_value || '').trim().toUpperCase() === pos);
        const n = rows ? rows.filter(r => (r.unit || '').trim().toUpperCase() === pos).length : 0;
        return `
        <div class="lrow" data-go="coach-plan-set/position/${esc(pos)}">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright);font-weight:800;font-size:12px">${esc(pos.slice(0, 2))}</div>
          <div class="lm"><div class="lt">${esc(pos)} room <small style="color:var(--text-3);font-weight:700">· ${n}</small></div>
          <div class="ls">${s ? esc(setSummary(s.items)) : 'Team default'}</div></div>
          ${s ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`;
      };
      return `
      ${titleHead('Plan', 'Your program, room by room')}

      <div class="eyebrow">Standards · what every day asks</div>
      ${sets === null && rows === null ? `
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading your program…</div><div class="ts">Pulling your rooms and standards.</div></div></div>` : `
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-plan-set/team">
          <div class="lic" style="background:var(--surface-3);color:var(--text-2);font-weight:800;font-size:12px">TM</div>
          <div class="lm"><div class="lt">Team default</div>
          <div class="ls">${teamSet ? esc(setSummary(teamSet.items)) : 'Built-in · 3 meals, recovery, weekly check-in'}</div></div>
          ${teamSet ? '<span class="status-pill b">Custom</span>' : ''}
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        ${positions.map(roomCard).join('')}
      </section>
      ${positions.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.4">Rooms appear as athletes with positions join. The team default covers everyone until then.</div>` : ''}`}

      <div class="eyebrow">Targets · per athlete</div>
      ${rows && rows.length ? `
      <section class="card" style="padding:6px 16px">
        ${rows.slice(0, 6).map(r => `
        <div class="lrow" data-go="coach-plan/${esc(r.athleteId)}">
          <div class="lic">${icon('target', 17)}</div>
          <div class="lm"><div class="lt">${esc(r.name)}${r.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(r.unit)}</small>` : ''}</div>
          <div class="ls">Protein · calories · target weight</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`).join('')}
      </section>` : `
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.4">Athlete targets open from the roster once your team joins.</div>`}

      <div class="eyebrow">Trust passes · earned camera-free days</div>
      ${rows && rows.length ? `
      <section class="card" style="padding:6px 16px">
        ${rows.slice(0, 6).map(r => {
          const pass = TP && TP.map ? TP.map[r.athleteId] : undefined;
          const active = pass && pass.granted_date;
          return `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="${active ? 'background:var(--green-surface);color:var(--green-bright)' : ''}">${icon('shield', 17)}</div>
          <div class="lm"><div class="lt">${esc(r.name)}</div>
          <div class="ls">${TP === null ? 'Checking…' : active ? `Active · started ${esc(pass.granted_date)} · ${pass.length_days || 10} days` : 'No pass · needs 7 photo-logged days on standard'}</div></div>
          <button class="btn ghost sm" data-tp="${active ? 'end' : 'grant'}:${esc(r.athleteId)}" style="width:auto;padding:0 12px;height:30px;font-size:11px;${active ? 'color:var(--red)' : ''}">${active ? 'End' : 'Grant'}</button>
        </div>`;
        }).join('')}
        <div id="tp-plan-status" style="font-size:11.5px;font-weight:600;color:var(--text-3);min-height:14px;padding:2px 2px 8px"></div>
      </section>` : `
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.4">Trust passes unlock once athletes are on the roster — earned with 7 straight photo-logged days on standard.</div>`}

      <div class="eyebrow">Program controls</div>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" data-go="coach-voice">
          <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('sparkle', 17)}</div>
          <div class="lm"><div class="lt">AI in your voice</div><div class="ls">It reinforces your rulings, never invents</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
        <div class="lrow" data-go="team-diet">
          <div class="lic" style="background:var(--red-surface);color:var(--red)">${icon('bell', 17)}</div>
          <div class="lm"><div class="lt">Team dietary sheet</div><div class="ls">Allergies &amp; restrictions across the roster</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>
      </section>
      <div style="height:10px"></div>
      `;
    }
    if (!TGT || TGT.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Loading their targets…</div></div></div>`;
    }
    const t = TGT.targets || {};
    // Distinguish "no targets set yet" (starter defaults shown as a starting point) from real
    // saved values — a coach shouldn't think targets already exist when they're just placeholders.
    const unset = t.protein == null && t.calories == null && t.weight == null;
    const rows = [['Protein', 'tg-protein', t.protein != null ? t.protein : 180, 'g', 5], ['Calories', 'tg-calories', t.calories != null ? t.calories : 2400, '', 50], ['Target weight', 'tg-weight', t.weight != null ? t.weight : 180, ' lb', 1]];
    return `
    ${head}

    <div class="eyebrow">Targets${unset ? ' · not set yet' : ''}</div>
    ${unset ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:-4px 2px 8px;line-height:1.4">Starting points, not saved. Adjust and Save to set ${esc(who.name.split(' ')[0])}'s real targets.</div>` : ''}
    <section class="card" style="padding:6px 16px">
      ${rows.map(([k, id, v, u, step]) => `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt">${k}</div></div>
          <span class="wb2" data-step="${id}" data-d="-1" data-s="${step}" style="padding:6px 13px">−</span>
          <span id="${id}" data-u="${u}" style="font-size:16px;font-weight:800;width:84px;text-align:center">${v}${u}</span>
          <span class="wb2" data-step="${id}" data-d="1" data-s="${step}" style="padding:6px 13px">+</span>
        </div>`).join('')}
    </section>

    <div style="height:12px"></div>
    <section class="card" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="req-icon b" style="width:34px;height:34px;flex:none">${icon('target', 16)}</div>
        <div style="flex:1"><div style="font-size:13.5px;font-weight:800">Suggested from the target weight</div>
        <div id="sg-why" style="font-size:11.5px;font-weight:600;color:var(--text-3);margin-top:1px">Set the target weight above, then tap Suggest.</div></div>
        <button class="btn ghost sm" id="sg-btn" style="width:auto;padding:0 14px;height:32px">Suggest</button>
      </div>
      <div id="sg-out" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--hairline-soft)">
        <div style="display:flex;align-items:baseline;gap:14px">
          <div><span id="sg-protein" style="font-size:19px;font-weight:800;font-variant-numeric:tabular-nums">—</span><span style="font-size:11px;font-weight:700;color:var(--text-3)"> g protein</span></div>
          <div><span id="sg-calories" style="font-size:19px;font-weight:800;font-variant-numeric:tabular-nums">—</span><span style="font-size:11px;font-weight:700;color:var(--text-3)"> kcal</span></div>
          <button class="btn green sm" id="sg-use" style="width:auto;padding:0 16px;height:32px;margin-left:auto">Use these</button>
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:6px">Open math, not a black box — you approve, then Save writes it.</div>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Coach owns the numbers</div>
      <div class="ts">Saving writes these to the athlete's plan (athlete_profiles.targets) via the coach_set_goals RPC. Their nutrition scoring is unaffected — the score is always the four honest components.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="save-targets">${icon('check', 19)} Save targets</button>
    <div id="tg-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster().then(() => { loadSets(); if (!sub) loadTrust(); });
    // Trust pass grant/end on the Plan home (server-enforced eligibility, honest errors)
    root.querySelectorAll('[data-tp]').forEach(b => b.addEventListener('click', async () => {
      const [what, id] = b.getAttribute('data-tp').split(':');
      const status = root.querySelector('#tp-plan-status');
      const say = (msg, isErr) => { if (status) { status.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; status.textContent = msg; } };
      b.disabled = true; say(what === 'grant' ? 'Granting…' : 'Ending…');
      if (what === 'grant') {
        const r = await roles.grantTrustPass(id, 10);
        if (!r.ok) { b.disabled = false; say(r.error && /standard|photo|eligib/i.test(r.error) ? 'Not eligible yet — needs 7 photo-logged days on standard.' : (r.error || 'Could not grant it.'), true); return; }
        say('Granted — camera-free days start now.');
      } else {
        const ok = await roles.endTrustPass(id);
        if (!ok) { b.disabled = false; say('Could not end it — try again.', true); return; }
        say('Ended.');
      }
      await loadTrust(true);
    }));
    if (!sub) return;
    loadTargets(sub);
    root.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
      const el = root.querySelector('#' + b.getAttribute('data-step'));
      const u = el.getAttribute('data-u');
      const step = +b.getAttribute('data-s') || 1;
      el.textContent = Math.max(0, parseInt(el.textContent) + step * +b.dataset.d) + u;
    }));
    // Suggested targets: reads the CURRENT target-weight stepper, fills protein/calories.
    const sgBtn = root.querySelector('#sg-btn');
    if (sgBtn) {
      let sg = null;
      sgBtn.addEventListener('click', () => {
        const tw = parseInt((root.querySelector('#tg-weight') || {}).textContent) || 0;
        const bw = TGT && TGT.basics && TGT.basics.base_weight;
        sg = suggestTargets(tw, bw);
        const why = root.querySelector('#sg-why'), out = root.querySelector('#sg-out');
        if (!sg) { if (why) why.textContent = 'Set a real target weight first (80–450 lb).'; return; }
        if (why) why.textContent = `${sg.why}${bw ? ` · current ${Math.round(bw)} lb` : ''}`;
        if (out) out.style.display = '';
        const p = root.querySelector('#sg-protein'), k = root.querySelector('#sg-calories');
        if (p) p.textContent = sg.protein; if (k) k.textContent = sg.calories;
      });
      const use = root.querySelector('#sg-use');
      if (use) use.addEventListener('click', () => {
        if (!sg) return;
        const pEl = root.querySelector('#tg-protein'), kEl = root.querySelector('#tg-calories');
        if (pEl) pEl.textContent = `${sg.protein}${pEl.getAttribute('data-u') || ''}`;
        if (kEl) kEl.textContent = `${sg.calories}${kEl.getAttribute('data-u') || ''}`;
      });
    }
    const save = root.querySelector('#save-targets');
    const status = root.querySelector('#tg-status');
    if (save) save.addEventListener('click', async () => {
      const num = (id) => parseInt(root.querySelector('#' + id).textContent) || 0;
      save.disabled = true; if (status) status.textContent = 'Saving…';
      const ok = await roles.coachSetGoals(sub, { protein: num('tg-protein'), calories: num('tg-calories'), weight: num('tg-weight') });
      if (ok) { if (status) status.textContent = 'Saved to their plan.'; TGT = null; setTimeout(() => { location.hash = `#coach-athlete/${sub}`; }, 600); }
      else { save.disabled = false; if (status) status.textContent = 'Could not save — check the connection.'; }
    });
  },
};

/* ---------- Standards editor (WS5.1): one scope's standing requirement set ----------
   Knobs → catalog-shaped items (0055-validated rails: meals 1–6, lifts 0–7) →
   set_team_requirements. A position room can reset to the team default (0058). */
const LIFT_DAYS = { 1: [2], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Meal 4', 'Meal 5', 'Meal 6'];
const MEAL_WINDOWS = [{ open: 420, due: 570 }, { open: 720, due: 840 }, { open: 1080, due: 1230 }, { due: 1290 }, { due: 1320 }, { due: 1350 }];
let KNOB = null; // { key, meals, lifts, weigh, hydration, recovery, checkin }

function knobsFromItems(items) {
  const lift = items.find(i => i.kind === 'lift');
  const weigh = items.find(i => i.kind === 'weigh');
  return {
    meals: Math.min(6, Math.max(1, items.filter(i => i.kind === 'meal').length)),
    lifts: lift ? Math.min(7, (lift.freq && lift.freq.days && lift.freq.days.length) || 3) : 0,
    weigh: weigh ? ((weigh.freq && weigh.freq.type === 'daily') ? 'daily' : 'mwf') : 'off',
    hydration: items.some(i => i.kind === 'hydration'),
    recovery: items.some(i => i.kind === 'recovery'),
    checkin: items.some(i => i.kind === 'checkin'),
  };
}
function itemsFromKnobs(k) {
  const items = [];
  let names, wins;
  if (k.meals === 1) { names = ['Daily meal']; wins = [{ open: 720, due: 1230 }]; }
  else if (k.meals === 2) { names = ['Breakfast', 'Dinner']; wins = [MEAL_WINDOWS[0], MEAL_WINDOWS[2]]; }
  else { names = MEAL_NAMES.slice(0, k.meals); wins = MEAL_WINDOWS.slice(0, k.meals); }
  names.forEach((t, i) => items.push({ id: `meal-${i + 1}`, title: t, kind: 'meal', proof: 'photo', freq: { type: 'daily' }, window: wins[i] }));
  if (k.lifts > 0) items.push({
    id: 'lift', title: `Lift session`, kind: 'lift', proof: 'check',
    freq: { type: 'days', days: LIFT_DAYS[k.lifts], label: `${k.lifts}× / week` }, window: { due: 1230, label: 'After training' },
  });
  if (k.weigh !== 'off') items.push({
    id: 'weight', title: 'Morning Weight', kind: 'weigh', proof: 'scale',
    freq: k.weigh === 'daily' ? { type: 'daily' } : { type: 'days', days: [1, 3, 5], label: 'Mon / Wed / Fri' }, window: { due: 540 },
  });
  if (k.hydration) items.push({ id: 'hydration', title: 'Hydration · 120 oz', kind: 'hydration', proof: 'counter', freq: { type: 'daily' }, window: { due: 1290 }, required: false });
  if (k.recovery) items.push({ id: 'recovery', title: 'Recovery Check-In', kind: 'recovery', proof: 'form', freq: { type: 'daily' }, window: { due: 1410, label: 'Before bed' } });
  if (k.checkin) items.push({ id: 'weekly', title: 'Weekly Check-In', kind: 'checkin', proof: 'form', freq: { type: 'weekly', day: 0, label: 'Sundays' }, window: { due: 1260 } });
  return items;
}

export const coachPlanSet = {
  nav: 'coach', tab: 'plan',
  render({ sub }) {
    const [kind, rawVal] = (sub || 'team').split('/');
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const key = `${kind}:${value || ''}`;
    const scopeName = kind === 'team' ? 'Team default' : `${value} room`;
    const sets = SETS && SETS.rows ? SETS.rows : [];
    const existing = sets.find(s => s.scope_kind === kind && String(s.scope_value || '').trim().toUpperCase() === (value || '').toUpperCase())
      || (kind === 'team' ? sets.find(s => s.scope_kind === 'team') : null);
    if (!KNOB || KNOB.key !== key) {
      KNOB = existing
        ? { key, ...knobsFromItems(existing.items) }
        : { key, meals: 3, lifts: 0, weigh: 'mwf', hydration: true, recovery: true, checkin: true };
    }
    const chip = (on, label, act, arg) => `<span class="chp ${on ? 'on' : ''}" data-knob="${act}:${arg}">${label}</span>`;
    const seg = (label, subLabel, act, on) => `
      <div class="lrow" style="cursor:default">
        <div class="lm"><div class="lt">${label}</div><div class="ls">${subLabel}</div></div>
        <div class="seg" style="width:104px">
          <button class="${on ? 'on' : ''}" data-knob="${act}:1">On</button><button class="${on ? '' : 'on'}" data-knob="${act}:0">Off</button>
        </div>
      </div>`;
    return `
    ${backHead(scopeName, kind === 'team' ? 'Every athlete starts here' : 'Overrides the team default for this room', 'coach-plan')}

    <div class="eyebrow">Meals per day · photo proof</div>
    <div class="chip-row">${[1, 2, 3, 4, 5, 6].map(n => chip(KNOB.meals === n, String(n), 'meals', n)).join('')}</div>

    <div class="eyebrow">Lift sessions per week</div>
    <div class="chip-row">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => chip(KNOB.lifts === n, n === 0 ? 'Off' : String(n), 'lifts', n)).join('')}</div>

    <div class="eyebrow">Weigh-ins · season trend, never scored</div>
    <div class="chip-row">
      ${chip(KNOB.weigh === 'off', 'Off', 'weigh', 'off')}${chip(KNOB.weigh === 'mwf', 'Mon / Wed / Fri', 'weigh', 'mwf')}${chip(KNOB.weigh === 'daily', 'Daily', 'weigh', 'daily')}
    </div>

    <div class="eyebrow">Always-on pieces</div>
    <section class="card" style="padding:6px 16px">
      ${seg('Recovery check-in', 'Nightly · 25% of the score', 'recovery', KNOB.recovery)}
      ${seg('Weekly check-in', 'Sundays · 10% of the score', 'checkin', KNOB.checkin)}
      ${seg('Hydration focus', 'Visible, never scored', 'hydration', KNOB.hydration)}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Stored live, rails enforced server-side</div>
      <div class="ts">Meals 1–6, lifts 0–7 — the database rejects anything outside the rails. Athlete day lists AND scoring follow this standard on their next sync: the meal count is the denominator.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="set-save">${icon('check', 19)} Save the ${kind === 'team' ? 'team standard' : `${esc(value)} room standard`}</button>
    ${kind !== 'team' && existing ? `<div style="height:8px"></div><button class="btn ghost" id="set-clear">Use team default instead</button>` : ''}
    <div id="set-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster().then(() => loadSets());
    const [kind, rawVal] = (sub || 'team').split('/');
    const value = rawVal ? decodeURIComponent(rawVal).toUpperCase() : null;
    const say = (msg, isErr) => {
      const el = root.querySelector('#set-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    root.querySelectorAll('[data-knob]').forEach(el => el.addEventListener('click', () => {
      const [k, arg] = el.getAttribute('data-knob').split(':');
      if (k === 'meals') KNOB.meals = +arg;
      if (k === 'lifts') KNOB.lifts = +arg;
      if (k === 'weigh') KNOB.weigh = arg;
      if (k === 'recovery') KNOB.recovery = arg === '1';
      if (k === 'checkin') KNOB.checkin = arg === '1';
      if (k === 'hydration') KNOB.hydration = arg === '1';
      window.__render();
    }));
    const save = root.querySelector('#set-save');
    if (save) save.addEventListener('click', async () => {
      const teamId = ROSTER && ROSTER.teams[0] && ROSTER.teams[0].id;
      if (!teamId) { say('Your team hasn’t loaded yet — give it a second.', true); return; }
      save.disabled = true; say('Saving…');
      const r = await roles.setTeamRequirements(teamId, kind, value, itemsFromKnobs(KNOB));
      save.disabled = false;
      if (!r.ok) { say(r.error || 'Could not save — try again.', true); return; }
      say('Saved. This is the standard now.');
      await loadSets(true);
    });
    const clear = root.querySelector('#set-clear');
    if (clear) clear.addEventListener('click', async () => {
      const teamId = ROSTER && ROSTER.teams[0] && ROSTER.teams[0].id;
      if (!teamId) return;
      clear.disabled = true; say('Resetting…');
      const r = await roles.clearTeamRequirements(teamId, kind, value);
      clear.disabled = false;
      if (!r.ok) { say(r.error || 'Could not reset — try again.', true); return; }
      KNOB = null;
      await loadSets(true);
      location.hash = '#coach-plan';
    });
  },
};

/* ---------- Inbox (WS5.2): what needs the coach right now ----------
   Replaces the Copilot TAB (the copilot screen stays routable for deep links).
   Briefing = deterministic reads over the real roster — never narrated fiction.
   Then: join requests (act here), unopened logs (the feed's unseen dots as a list). */
export const coachInbox = {
  nav: 'coach', tab: 'inbox',
  badge() {
    const pending = ROSTER ? (ROSTER.pending || []).length : 0;
    const seen = new Set(RT.coachSeenMealIds || []);
    const unseen = ACT && ACT.rows ? ACT.rows.filter(m => !seen.has(m.id)).length : 0;
    return pending + unseen;
  },
  render() {
    const rows = ROSTER ? ROSTER.rows : null;
    const pending = ROSTER ? (ROSTER.pending || []) : [];
    const act = ACT && ACT.rows ? ACT.rows : [];
    const seen = new Set(RT.coachSeenMealIds || []);
    const unseen = act.filter(m => !seen.has(m.id));
    const names = {}; (rows || []).forEach(r => { names[r.athleteId] = r; });
    const needsMe = pending.length + unseen.length;

    let briefing = '';
    if (rows === null) briefing = 'Reading your roster…';
    else if (ROSTER && ROSTER.offline) briefing = "Can't reach your roster — reopen to retry. Nothing is invented while it's down.";
    else if (!rows.length) briefing = 'No athletes yet. Share your team code and this becomes your morning read.';
    else {
      const notLogged = rows.filter(r => !r.loggedToday);
      const below = rows.filter(r => r.score != null && r.score < 80);
      const top = rows.filter(r => r.score != null && r.score >= 80).sort((a, b) => b.score - a.score)[0];
      const lines = [];
      if (notLogged.length) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--red);flex:none;margin-top:5px"></span><span><b>${notLogged.length} not logged yet</b> — ${esc(notLogged.slice(0, 3).map(r => r.name.split(' ')[0]).join(', '))}${notLogged.length > 3 ? '…' : ''}.</span></div>`);
      if (below.length) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--amber-bright);flex:none;margin-top:5px"></span><span><b>${below.length} below the bar</b> today (under 80).</span></div>`);
      if (top) lines.push(`<div style="display:flex;gap:8px;align-items:flex-start"><span style="width:7px;height:7px;border-radius:50%;background:var(--green-bright);flex:none;margin-top:5px"></span><span><b>${esc(top.name)}</b> leads the day at ${top.score}.</span></div>`);
      briefing = lines.join('<div style="height:7px"></div>') || 'Quiet so far — logs land here as they come in.';
    }

    return `
    ${titleHead('Inbox', needsMe ? `${needsMe} need${needsMe === 1 ? 's' : ''} you` : 'All caught up')}

    <div class="eyebrow">Daily briefing · from your real roster</div>
    <section class="card pad" style="background:linear-gradient(180deg, rgba(168,85,247,0.10), rgba(168,85,247,0.03));border-color:rgba(168,85,247,0.26)">
      <div style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:10px">${icon('sparkle', 13)} Today's read</div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.55">${briefing}</div>
    </section>

    ${pending.length ? `
    <div class="eyebrow">Join requests · ${pending.length}</div>
    <section class="card" style="padding:6px 16px">
      ${pending.map(q => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
          <div class="lm"><div class="lt">${esc(q.athlete_name || 'Athlete')}${q.position ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(q.position)}</small>` : ''}</div><div class="ls">Wants to join</div></div>
          <button class="btn ghost sm" data-jr="decline" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
          <button class="btn green sm" data-jr="approve" data-team="${esc(q.teamId)}" data-ath="${esc(q.athlete_id)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
        </div>`).join('')}
    </section>` : ''}

    <div class="eyebrow">Unopened logs${unseen.length ? ` · ${unseen.length}` : ''}</div>
    ${unseen.length ? `
    <section class="card" style="padding:6px 16px">
      ${unseen.slice(0, 10).map(m => {
        const who = names[m.athlete_id] || {};
        return `
        <div class="lrow" data-go="coach-meal/${esc(m.id)}">
          <div class="lic" style="position:relative">${icon('utensils', 17)}<span style="position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--blue-bright)"></span></div>
          <div class="lm"><div class="lt">${esc((who.name || 'Athlete'))}${who.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(who.unit)}</small>` : ''}</div>
          <div class="ls">${esc(cap(m.type || 'Meal'))} · ${esc(actTime(m.logged_at))}${m.protein != null ? ` · ${Math.round(m.protein)}g` : ''}</div></div>
          ${icon('chevron', 17, 'style="color:var(--text-3)"')}
        </div>`;
      }).join('')}
    </section>` : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px;line-height:1.5">You've opened everything the roster has logged. New meals land here with a dot.</div>`}

    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster().then(() => loadActivity());
    root.querySelectorAll('[data-jr]').forEach(b => b.addEventListener('click', async () => {
      const team = b.getAttribute('data-team'), ath = b.getAttribute('data-ath');
      b.disabled = true; b.textContent = '…';
      if (b.getAttribute('data-jr') === 'approve') await roles.approveMember(team, ath);
      else await roles.declineMember(team, ath);
      await loadCoachRoster(true);
    }));
  },
};

/* ---------- Copilot: deterministic reads over the REAL roster (honest, not narrated fiction) ---------- */
export const copilot = {
  nav: 'coach', tab: 'copilot',
  render() {
    const rows = ROSTER ? ROSTER.rows : null;
    // Offline must read as offline, not as a stuck "loading" (F-C1) or a false "no athletes":
    // when the roster fetch failed, ROSTER.rows is [] with offline=true, which would otherwise
    // fall through to the empty-roster summary. Mirror the Coach/Trainer tabs' honest offline card.
    if (ROSTER && ROSTER.offline) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach')}
      <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
      <div class="sd-t">Can't reach your roster</div>
      <div class="sd-s">Copilot reads your real team data, and we couldn't load today's scores. Reopen this tab to retry — no numbers are invented while it's down.</div></div>`;
    }
    if (rows === null) {
      return `${backHead('Copilot', 'Deterministic roster reads', 'coach')}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('sparkle', 17)}</div>
      <div><div class="tt">Loading the roster…</div><div class="ts">Copilot reads your real team data — no numbers until it loads.</div></div></div>`;
    }
    const attention = rows.filter(r => r.flag === 'r');
    const belowBar = rows.filter(r => r.score != null && r.score < 80);
    const notLogged = rows.filter(r => !r.loggedToday);
    const summary = rows.length === 0
      ? 'No athletes on your roster yet. Share your team code to get started.'
      : `${rows.length} athlete${rows.length > 1 ? 's' : ''} on your roster. `
        + (attention.length ? `${attention.length} need attention (no logs or off standard). ` : 'Everyone who logged is on standard. ')
        + (notLogged.length ? `${notLogged.length} haven't logged today.` : 'Everyone has logged today.');
    return `
    ${backHead('Copilot', 'Deterministic reads over your real roster', 'coach')}

    <div class="ai-note">
      <div class="av">${icon('sparkle', 18)}</div>
      <div><div class="who">Copilot</div><p>${esc(summary)}</p></div>
    </div>

    ${belowBar.length ? `
    <div class="eyebrow">The numbers behind it</div>
    <section class="card" style="padding:2px 0">
      ${belowBar.map(r => `
        <div class="roster-row" data-go="coach-athlete/${esc(r.athleteId)}">
          <div class="flagdot ${r.flag}"></div>
          <div class="rn"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.note)}</div></div>
          <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
        </div>`).join('')}
    </section>` : `
    <div class="sidebox"><div class="req-icon g" style="width:38px;height:38px">${icon('check', 17)}</div>
    <div><div class="tt">Nobody below the bar</div><div class="ts">Every logged athlete is at 80+. Check back after tonight's logs.</div></div></div>`}
    <div style="height:10px"></div>
    `;
  },
  mount() { loadCoachRoster(); },
};

/* ---------- Coach → athlete review: real day + meals, RLS-scoped; a "seen" receipt on open ---------- */
let ATH = null;           // { athleteId, day, meals } for the athlete being reviewed
let athLoadingId = null;
function rosterName(athleteId) {
  const r = ROSTER && ROSTER.rows.find(x => x.athleteId === athleteId);
  return r ? { name: r.name, unit: r.unit } : { name: 'Athlete', unit: '' };
}
let athGen = 0;            // navigation generation: a stale fetch must never clobber the screen
async function loadAthlete(athleteId, viewerId, viewerName) {
  if (!athleteId) return;
  // Already showing this athlete: do nothing. Without this guard every repaint re-fetched,
  // which re-rendered, which re-fetched — an infinite refetch/repaint loop (photos re-signing,
  // flicker, scroll jumps). This WAS the "super buggy" athlete page.
  if (ATH && ATH.athleteId === athleteId) return;
  if (athLoadingId === athleteId) return; // this athlete's fetch is already in flight
  const myGen = ++athGen;
  athLoadingId = athleteId;
  try {
    const today = roles.todayISO();
    const [day, meals, pass] = await Promise.all([
      roles.fetchDay(athleteId, today),
      roles.fetchRecentMeals(athleteId, roles.daysAgoISO(14)),
      roles.fetchActiveTrustPass(athleteId),
    ]);
    // Sign photo URLs in PARALLEL, and only the most recent handful the screen shows —
    // the old serial loop signed every meal in 14 days one round-trip at a time.
    await Promise.all(meals.filter(m => m.photo_path).slice(0, 10)
      .map(async (m) => { m._url = await roles.signedMealPhotoUrl(m.photo_path); }));
    if (myGen !== athGen) return; // coach tapped another athlete mid-flight — drop this result
    ATH = { athleteId, day, meals, pass };
    roles.markDayViewed(athleteId, today, viewerId, viewerName); // fire-and-forget "coach saw your day"
  } finally {
    if (myGen === athGen) athLoadingId = null;
  }
  // Repaint whichever detail screen is waiting on this fetch — trainer-client shares this
  // loader, and matching only #coach-athlete left the trainer's client page stuck on
  // "Loading their day…" forever (role walkthrough 2026-07-15).
  if (location.hash.startsWith('#coach-athlete') || location.hash.startsWith('#trainer-client')) window.__render();
}
const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
export const coachAthlete = {
  nav: 'coach', tab: 'team',
  render({ sub }) {
    const athleteId = sub;
    const who = rosterName(athleteId);
    const head = backHead(`${esc(who.name)}${who.unit ? ` · ${esc(who.unit)}` : ''}`, 'Their day · read-only', 'coach');
    if (!athleteId) return `${head}<div class="state-demo"><div class="sd-t">No athlete selected</div></div>`;
    if (!ATH || ATH.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('user', 17)}</div>
      <div><div class="tt">Loading their day…</div><div class="ts">Pulling today's real score and logged meals.</div></div></div>`;
    }
    // Dead/stale-link guard: once the roster is loaded, an id that isn't a member and has no data
    // is a bad link, not a real athlete with an empty day — say so instead of a blank review. Only
    // fires when the roster is definitively loaded, so a real athlete is never misflagged mid-load.
    const rosterLoaded = !!(ROSTER && ROSTER.rows);
    const onRoster = rosterLoaded && ROSTER.rows.some(r => r.athleteId === athleteId);
    if (rosterLoaded && !onRoster && !ATH.day && !ATH.meals.length) {
      return `${head}
      <div class="state-demo"><div class="sd-ic">${icon('user', 24)}</div>
      <div class="sd-t">Athlete not found</div>
      <div class="sd-s">This athlete isn't on your roster — the link may be old, or they left your team. Head back and pick someone from your roster.</div>
      <div class="sd-cta"><button class="btn ghost sm" data-go="coach">Back to roster</button></div></div>
      <div style="height:10px"></div>`;
    }
    const day = ATH.day;
    const today = roles.todayISO();
    const todayMeals = ATH.meals.filter(m => m.day_date === today);
    const score = day && day.score != null ? day.score : null;
    const mealsJson = (day && day.meals) || {};
    const ci = (day && day.checkin) || {};
    const openSlots = ['breakfast', 'lunch', 'dinner'].filter(k => !mealsJson[k]);
    return `
    ${head}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--green-bright)">${MEAL_SLOTS.filter(k => mealsJson[k]).length}</div><div class="k">Meals logged</div></div>
      <div class="coach-stat"><div class="v" style="color:${ci.submitted ? 'var(--green-bright)' : 'var(--amber-bright)'}">${ci.submitted ? 'In' : 'Open'}</div><div class="k">Recovery</div></div>
    </div>

    ${!day ? `<div class="sidebox" style="margin-top:14px"><div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
    <div><div class="tt">No logs today yet</div><div class="ts">Nothing to review — they haven't logged. Their day appears here as they log it.</div></div></div>`
    : `
    <div class="eyebrow">Today's proof${todayMeals.length ? '' : ' · none yet'}</div>
    ${todayMeals.length ? `<div class="hscroll">
      ${todayMeals.map(m => `
        <div class="act-card" data-go="coach-meal/${esc(m.id)}">
          <div class="act-time">${esc(cap(m.type || 'Meal'))}</div>
          ${m._url
            ? `<div class="act-media"><img src="${esc(m._url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`
            : `<div class="act-media icon" style="background:linear-gradient(150deg, rgba(52,211,153,0.2), rgba(37,99,235,0.1));color:var(--green-bright)">${icon('utensils', 26)}</div>`}
          <div class="act-body"><div class="act-type">${m.quality != null ? 'Meal score' : 'Logged'}</div><div class="act-value ${m.quality != null && m.quality >= 80 ? 'g' : 'b'}">${m.quality != null ? m.quality : '·'}</div></div>
        </div>`).join('')}
    </div>` : `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:-2px 2px 10px">No meal photos logged today.</div>`}

    <div class="eyebrow">What's open</div>
    <section class="card" style="padding:6px 16px">
      ${openSlots.length || !ci.submitted ? `
        ${openSlots.map(k => `
          <div class="lrow" style="cursor:default"><div class="lic" style="color:var(--amber-bright)">${icon('bowl', 17)}</div>
          <div class="lm"><div class="lt">${cap(k)}</div><div class="ls">Not logged yet</div></div><span class="status-pill a">Open</span></div>`).join('')}
        ${!ci.submitted ? `<div class="lrow" style="cursor:default"><div class="lic" style="color:var(--purple-bright)">${icon('moon', 17)}</div>
          <div class="lm"><div class="lt">Recovery check-in</div><div class="ls">Before bed</div></div><span class="status-pill p">Open</span></div>` : ''}`
        : `<div class="lrow" style="cursor:default"><div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
          <div class="lm"><div class="lt">Everything is in</div><div class="ls">Finished day${score != null ? ` · ${score}` : ''}</div></div></div>`}
    </section>`}

    <div class="eyebrow">Coach actions</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="coach-plan/${esc(athleteId)}">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Set nutrition targets</div><div class="ls">Protein · calories · target weight</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:rgba(168,85,247,0.16);color:var(--purple-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">Trust Pass</div><div class="ls">${ATH.pass ? `Active · granted ${esc(ATH.pass.granted_date)}` : 'Camera-free days, earned with photo-logged history'}</div></div>
        <button class="btn ghost sm" id="tp-btn" style="width:auto;padding:0 14px;height:34px">${ATH.pass ? 'End' : 'Grant'}</button>
      </div>
    </section>
    <div id="tp-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px"></div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:4px;padding:0 2px">Tap a meal photo to review and comment on it.</div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadCoachRoster(); // ensure the name is available
    loadAthlete(sub, RT.userId, S.athlete.name);
    const btn = root.querySelector('#tp-btn');
    const status = root.querySelector('#tp-status');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true; if (status) status.textContent = ATH.pass ? 'Ending…' : 'Granting…';
      if (ATH.pass) {
        const ok = await roles.endTrustPass(sub);
        if (status) status.textContent = ok ? 'Trust Pass ended.' : 'Could not end it.';
      } else {
        const r = await roles.grantTrustPass(sub, 10);
        if (status) status.textContent = r.ok ? 'Trust Pass granted.' : (r.error && /on.?standard|photo|eligib/i.test(r.error) ? 'Not eligible yet — needs 7 photo-logged days.' : 'Could not grant it.');
      }
      ATH = null; // force a refresh of the pass state
      setTimeout(() => { if (location.hash.startsWith('#coach-athlete')) { loadAthlete(sub, RT.userId, S.athlete.name); } }, 500);
    });
  },
};

/* ---------- Coach → meal review + comment: the REAL meal_comments thread (slice 5) ---------- */
let MC = null;            // { mealId, comments }
let mcLoadingId = null;
async function loadMealComments(mealId, force) {
  if (!mealId || (mcLoadingId === mealId && !force)) return;
  // Router mount() re-runs on every render (router.js:121); without this guard a re-render of an
  // already-loaded meal silently refetches every time — and would let the offline {error}
  // sentinel loop on repaint. Force (post-comment / retry) always bypasses it.
  if (!force && MC && MC.mealId === mealId) return;
  mcLoadingId = mealId;
  MC = { mealId, comments: await roles.fetchMealComments(mealId) };
  mcLoadingId = null;
  if (location.hash.startsWith('#coach-meal')) window.__render();
}
function mealById(mealId) { return ATH && ATH.meals.find(m => m.id === mealId); }
export const coachMeal = {
  nav: 'coach', tab: 'team',
  render({ sub }) {
    const mealId = sub;
    const meal = mealById(mealId);
    const title = meal ? cap(meal.type || 'Meal') : 'Meal';
    const head = backHead(title, 'Your comment lands on the athlete’s log', ATH ? `coach-athlete/${ATH.athleteId}` : 'coach');
    if (!MC || MC.mealId !== mealId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('message', 17)}</div>
      <div><div class="tt">Loading the thread…</div><div class="ts">Reading the athlete’s comments on this meal.</div></div></div>`;
    }
    const foods = meal && Array.isArray(meal.detected) ? meal.detected : [];
    return `
    ${head}

    ${meal ? `
    <div class="photo-hero" ${meal._url ? '' : 'style="background:linear-gradient(150deg, rgba(52,211,153,0.14), rgba(37,99,235,0.06))"'}>
      ${meal._url ? `<img src="${esc(meal._url)}" alt="" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0"/>` : ''}
      <div class="ph-grad"></div>
      <div class="ph-meta"><div><div class="ph-t">${esc(title)}</div><div class="ph-s">${meal.protein != null ? `${meal.protein}g protein` : 'Logged'}${meal.source === 'gallery' ? ' · from gallery' : ''}${meal.source === 'manual' || meal.source === 'label' ? ' · no photo' : ''}</div></div>
      ${meal.quality != null ? `<div class="scorechip"><span class="v">${meal.quality}</span><span class="k">Meal</span></div>` : ''}</div>
    </div>` : ''}

    ${foods.length ? `<div class="eyebrow">Detected</div><div class="foodchips">${foods.map(f => `<span class="foodchip"><span class="dot"></span>${esc(typeof f === 'string' ? f : f.name)}</span>`).join('')}</div>` : ''}

    <div class="eyebrow">Conversation</div>
    ${MC.comments && MC.comments.error ? `
    <div style="text-align:center;padding:14px 12px;border-radius:var(--r-tile);background:var(--surface-1);border:1px solid var(--hairline)">
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.4">Couldn't load the discussion — try again.</div>
      <button class="btn ghost sm" id="coach-thread-retry" style="margin-top:10px">${icon('wifiOff', 15)} Retry</button>
    </div>` : (() => {
      const rx = reactionGroups(MC.comments);
      const msgs = threadMessages(MC.comments);
      // Timing parity (0062): the CLIENT wrote minutes_late on the meals row at log time (the
      // athlete's own clock — the only honest source), so the coach now sees the exact same
      // on-time/late accountability sentence the athlete saw. Pre-0062 rows carry no
      // minutes_late → late: null keeps the honest omission (never guess from UTC logged_at).
      const mlate = meal && typeof meal.minutes_late === 'number' ? meal.minutes_late : null;
      const opening = meal ? openingMessage({
        name: title, quality: meal.quality, note: meal.note, analysis: meal.analysis || '',
        goal: null, coachTargets: null,
        late: mlate == null ? null : mlate > 0, minutesLate: mlate,
      }) : '';
      return `
      ${rx.length ? `<div class="rx-strip">${rx.map((r) => `<span class="rx">${esc(r.emoji)}<span class="n">${r.count}</span></span>`).join('')}</div>` : ''}
      <div class="thread">
        ${opening ? `
        <div class="msg">
          <div class="av">${icon('sparkle', 15)}</div>
          <div><div class="who">OnStandard AI · what the athlete was told</div>
          <div class="bubble">${esc(opening)}</div></div>
        </div>` : ''}
        ${msgs.map((c) => `
          <div class="msg ${c.role === 'athlete' ? 'athlete' : 'coach'}">
            ${c.role !== 'athlete' ? `<div class="av">${c.role === 'ai' ? icon('sparkle', 15) : 'M'}</div>` : ''}
            <div>${c.role !== 'athlete' ? `<div class="who">${c.role === 'ai' ? 'OnStandard AI' : 'Coach'}</div>` : ''}
            <div class="bubble">${esc(c.text)}</div></div>
          </div>`).join('')}
        ${!msgs.length ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:2px 2px 8px">No comments yet. React or say something — the athlete sees it on the log.</div>` : ''}
      </div>`;
    })()}
    <div class="rx-strip" id="rx-bar" style="margin-top:4px">
      ${['🔥', '💪', '👏', '👍'].map((e2) => `<span class="rx" data-rx="${e2}" style="cursor:pointer;font-size:16px;padding:6px 14px">${e2}</span>`).join('')}
    </div>
    <div id="rx-note" style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px"></div>
    ${composer({ inputId: 'cm-input', sendId: 'cm-send', placeholder: 'Comment on this meal…', sendLabel: 'Send comment' })}
    <div id="cm-note" style="font-size:12.5px;font-weight:600;color:#f87171;margin:6px 2px 0;min-height:16px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadMealComments(sub);
    act.markMealSeen(sub); // clears this meal's unseen dot in the team activity feed
    const threadRetry = root.querySelector('#coach-thread-retry');
    if (threadRetry) threadRetry.addEventListener('click', () => loadMealComments(sub, true));
    const input = root.querySelector('#cm-input');
    const send = root.querySelector('#cm-send');
    const cmNote = root.querySelector('#cm-note');
    // Thread caps (0059, founder-ratified): coach 2 / athlete 3 messages per meal. The DB
    // trigger is the real wall; this is the honest UI for it.
    const coachN = Array.isArray(MC && MC.comments)
      ? MC.comments.filter(c => c.role === 'coach' && (c.kind || 'message') === 'message').length : 0;
    if (coachN >= 2) {
      if (input) { input.disabled = true; input.placeholder = 'Coach cap reached'; }
      if (send) send.disabled = true;
      if (cmNote) { cmNote.style.color = 'var(--text-3)'; cmNote.textContent = 'You’ve made your point — 2 coach messages per meal. Reactions are always open.'; }
    } else if (coachN === 1 && cmNote) {
      cmNote.style.color = 'var(--text-3)'; cmNote.textContent = '1 of 2 coach messages used on this meal.';
    }
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) return;
      if (cmNote) cmNote.textContent = '';
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', text);
      if (!ok) {
        // Post failed (returns false, never throws): keep the typed text so it isn't lost, tell
        // the coach, let them retry. The old code cleared the input BEFORE the await — a failed
        // send silently ate the comment. Mirrors the reaction handler's honest failure path.
        if (cmNote) cmNote.textContent = "Couldn't send — try again.";
        return;
      }
      input.value = '';
      roles.nudgePush(athleteId, `${S.athlete.name} commented on your ${meal ? cap(meal.type) : 'meal'}`, text);
      // AI's one supporting message (2/3/1): best-effort, selective server-side — it only
      // fires on a substantive coach point, at most once per meal, and never blocks the post.
      try {
        await window.sb.functions.invoke('meal-chat', { body: {
          mealId: sub, coachSupport: true, coachText: text,
          context: meal ? { meal: { type: meal.type, protein: meal.protein, kcal: meal.kcal, quality: meal.quality } } : { meal: {} },
        } });
      } catch { /* skipped or unavailable — the coach's message already landed */ }
      await loadMealComments(sub, true);
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    // One shared lock across all four emoji: a burst of taps lands exactly one reaction.
    const rxNote = root.querySelector('#rx-note');
    let rxBusy = false;
    root.querySelectorAll('#rx-bar [data-rx]').forEach((btn) => btn.addEventListener('click', async () => {
      if (rxBusy) return;
      rxBusy = true;
      if (rxNote) rxNote.textContent = '';
      const meal = mealById(sub);
      const athleteId = meal ? meal.athlete_id : (MC && MC.comments[0] && MC.comments[0].athlete_id);
      if (!athleteId) { rxBusy = false; return; }
      const ok = await roles.postMealComment(sub, athleteId, RT.userId, 'coach', btn.getAttribute('data-rx'), 'reaction');
      if (!ok) {
        // Post failed (returns false, never throws): quiet note, no push, no reload — tapping again IS the retry.
        if (rxNote) rxNote.textContent = "Couldn't send — try again.";
        rxBusy = false;
        return;
      }
      roles.nudgePush(athleteId, `Coach reacted to your ${meal ? cap(meal.type) : 'meal'}`, btn.getAttribute('data-rx'));
      await loadMealComments(sub, true);
      rxBusy = false;
    }));
  },
};

/* ---------- Trainer view: real client book (practice_roster), scoped by RLS to owned practices ---------- */
let BOOK = null;
let bookLoading = false;
export async function loadTrainerBook(force) {
  if (bookLoading) return;
  if (BOOK && !force) return;
  bookLoading = true;
  try {
    const r = await roles.loadTrainerBook();
    const pending = [];
    for (const p of r.practices) {
      const reqs = await roles.pendingPracticeRequests(p.id);
      for (const q of reqs) pending.push({ practiceId: p.id, clientId: q.client_id, clientName: q.client_name });
    }
    r.pending = pending;
    r.offline = false;
    BOOK = r;
  } catch {
    // Same honest-offline pattern as loadCoachRoster: a thrown fetch must never read as
    // "No clients yet" — a trainer with a full book, merely offline, was told they had zero.
    BOOK = { practices: [], rows: [], pending: [], offline: true };
  } finally {
    bookLoading = false; // always clear so a retry can re-run
  }
  // trainer-client deep links resolve their header name from this book — repaint it too,
  // or a cold open shows "Client" forever (role walkthrough 2026-07-15).
  if (location.hash === '#trainer' || location.hash.startsWith('#trainer-client')) window.__render();
}
function bookName(athleteId) {
  const r = BOOK && BOOK.rows.find(x => x.athleteId === athleteId);
  return r ? r.name : 'Client';
}
export const trainer = {
  nav: 'trainer', tab: 'clients',
  render() {
    const rows = BOOK ? BOOK.rows : null;
    return `
    ${titleHead('Trainer view', 'Your clients · recovery & nutrition consistency')}

    ${BOOK && BOOK.pending && BOOK.pending.length ? `
    <div class="eyebrow">Client requests</div>
    <section class="card" style="padding:6px 16px">
      ${BOOK.pending.map(q => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 17)}</div>
          <div class="lm"><div class="lt">${esc(q.clientName || 'Client')}</div><div class="ls">Wants to join your practice</div></div>
          <button class="btn ghost sm" data-cr="decline" data-p="${esc(q.practiceId)}" data-c="${esc(q.clientId)}" style="width:auto;padding:0 12px;height:32px">Decline</button>
          <button class="btn green sm" data-cr="approve" data-p="${esc(q.practiceId)}" data-c="${esc(q.clientId)}" style="width:auto;padding:0 12px;height:32px;margin-left:6px">Approve</button>
        </div>`).join('')}
    </section>` : ''}

    ${rows === null ? `
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
    <div><div class="tt">Loading your clients…</div></div></div>`
    : (BOOK && BOOK.offline) ? `
    <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
    <div class="sd-t">Can't reach your clients</div>
    <div class="sd-s">We couldn't load today's scores — check your connection. Reopen this tab to retry; nothing is lost.</div></div>`
    : rows.length === 0 ? `
    <div class="state-demo"><div class="sd-ic">${icon('heart', 24)}</div>
    <div class="sd-t">No clients yet</div><div class="sd-s">Share your practice code so athletes can connect. Their real scores show up here.</div></div>`
    : `<section class="card" style="padding:2px 0">${rows.map(r => `
      <div class="roster-row" data-go="trainer-client/${esc(r.athleteId)}">
        <div class="flagdot ${r.flag}"></div>
        <div class="rn"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.note)}</div></div>
        <span class="rs" style="color:${scoreColor(r.score)}">${r.score != null ? r.score : '—'}</span>
      </div>`).join('')}</section>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Trainer scope</div>
      <div class="ts">You see your clients' day score, recovery, and nutrition — the same can_view data a coach sees. Team leaderboards and coach-only notes stay in the coach lane.</div></div>
    </div>

    <div style="height:12px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="trainer-profile">
        <div class="lic" style="background:linear-gradient(150deg,var(--purple-bright),#7e22ce);color:#fff;font-weight:800;font-size:13px">T</div>
        <div class="lm"><div class="lt">Trainer profile & client code</div><div class="ls">Practice, share code, scope</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadTrainerBook();
    root.querySelectorAll('[data-cr]').forEach(b => b.addEventListener('click', async () => {
      const p = b.getAttribute('data-p'), c = b.getAttribute('data-c');
      b.disabled = true; b.textContent = '…';
      if (b.getAttribute('data-cr') === 'approve') await roles.approveClient(p, c);
      else await roles.declineClient(p, c);
      await loadTrainerBook(true);
    }));
  },
};

/* ---------- Trainer → client detail: real day (RLS can_view); a note is a real push ---------- */
export const trainerClient = {
  nav: 'trainer', tab: 'note',
  render({ sub }) {
    const athleteId = sub;
    const name = bookName(athleteId);
    const head = backHead(esc(name), 'Client · recovery & nutrition', 'trainer');
    if (!athleteId) return `${head}<div class="state-demo"><div class="sd-t">Open a client</div></div>`;
    if (!ATH || ATH.athleteId !== athleteId) {
      return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('heart', 17)}</div>
      <div><div class="tt">Loading their day…</div></div></div>`;
    }
    const day = ATH.day;
    const ci = (day && day.checkin) || {};
    const score = day && day.score != null ? day.score : null;
    const readiness = ci.submitted && ci.recovery != null ? Math.round(ci.recovery) : null;
    return `
    ${head}

    <div class="coach-stats">
      <div class="coach-stat"><div class="v" style="color:${scoreColor(score)}">${score != null ? score : '—'}</div><div class="k">Score today</div></div>
      <div class="coach-stat"><div class="v" style="color:var(--blue-bright)">${readiness != null ? readiness : '—'}</div><div class="k">Readiness</div></div>
      <div class="coach-stat"><div class="v" style="color:${ci.submitted ? 'var(--green-bright)' : 'var(--amber-bright)'}">${ci.submitted ? 'In' : 'Open'}</div><div class="k">Recovery</div></div>
    </div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Recovery trend</div>
      <div class="ts">Per-client recovery patterns show up here once there's enough real check-in history — no invented bars until then.</div></div>
    </div>

    <div class="eyebrow">Note to client</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px 8px">Sends a real push to their notifications.</div>
    ${composer({ inputId: 'tn-input', sendId: 'tn-send', placeholder: `Note for ${name}…`, sendLabel: 'Send note' })}
    <div id="tn-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root, { sub }) {
    loadTrainerBook();
    loadAthlete(sub, RT.userId, S.athlete.name);
    const input = root.querySelector('#tn-input');
    const send = root.querySelector('#tn-send');
    const status = root.querySelector('#tn-status');
    const submit = async () => {
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      const ok = await roles.nudgePush(sub, `Note from ${S.athlete.name}`, text);
      if (status) status.textContent = ok ? 'Sent to their notifications.' : 'Could not send — check the connection.';
    };
    if (send) send.addEventListener('click', submit);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  },
};

/* ---------- Parent view — honest pending state (no parent→child data path yet) ---------- */
export const parent = {
  hideTabs: true,
  render() {
    // A real guardian has NO server data path in v1 (guardianship + minor-consent verification
    // aren't wired). So we show an honest pending state — never a fabricated child's score/digest.
    return `
    ${titleHead('Parent view', 'Setting up access')}

    <div class="state-demo">
      <div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">Parent access is being set up</div>
      <div class="sd-s">Once your athlete confirms the link (and, for a minor, consent is verified), their score, streak, and weekly digest show up here. Until then there's nothing to show — we won't invent it.</div>
    </div>

    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What parents will see</div>
      <div class="ts">Scores, streaks, and completion only. Meal photos, weight, and check-in answers stay between your athlete and their coach by default.</div></div>
    </div>

    <div style="height:14px"></div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="welcome"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Sign out</div></div></div>
    </section>
    <div style="height:10px"></div>
    `;
  },
};
