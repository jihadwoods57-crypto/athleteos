/* OnStandard Coach OS — Announcement compose (Slice C, 0074). One staff broadcast → the
   post_announcement RPC inserts the announcements row AND fans out one `notifications` feed
   row per matched active athlete, server-side (SECURITY DEFINER) — this screen never writes
   the fan-out itself. Mirrors coachAssign's module-state + chip pattern (coach.js:23-126):
   who (team / position room / custom group, or one athlete via the coach-announce/<id>
   deep-link) → what (title + body) → send. A short "Recent announcements" history reads the
   announcements table back (staff-read RLS) so the coach can see what already went out. */
import { backHead, esc, errorState, skeletonRows } from '../components.js';
import { icon } from '../icons.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster } from '../coach-data.js';
import { fmtWhen } from '../notif-feed.js';

const ANN = { scopeKind: 'team', scopeValue: null, title: '', body: '' };
let HIST = null;          // { teamId, rows } — fetchAnnouncements cache
let histLoadingId = null;

/** Plain-language "who this went to" — shared by this screen's history list and the coach
    Inbox's compact Announcements block (coach.js). Reads a server row's scope_kind/scope_value
    back honestly; a group that no longer exists (deleted since) falls back to 'Group' rather
    than inventing a name. */
export function audienceLabel(scopeKind, scopeValue, groups) {
  if (scopeKind === 'team') return 'Entire team';
  if (scopeKind === 'position') return `${scopeValue} room`;
  if (scopeKind === 'group') {
    const g = (groups || []).find((x) => x.id === scopeValue);
    return g ? g.name : 'Group';
  }
  if (scopeKind === 'athlete') return 'One athlete';
  return 'Team';
}

async function loadHistory(teamId, force) {
  if (!teamId) return;
  if (HIST && HIST.teamId === teamId && !force) return;
  if (histLoadingId === teamId) return;
  histLoadingId = teamId;
  try { HIST = { teamId, rows: await roles.fetchAnnouncements(teamId, 10) }; }
  catch { HIST = { teamId, rows: [], offline: true }; } // audit G-3: don't leave history stuck on "Loading…"
  finally { histLoadingId = null; }
  if (location.hash.startsWith('#coach-announce')) window.__render();
}

export const coachAnnounce = {
  nav: 'coach', tab: 'create', transient: true,
  render({ sub } = {}) {
    const rows = CD.roster ? CD.roster.rows : [];
    const groups = (CD.extras && CD.extras.groups) || [];
    // deep-link: coach-announce/<athleteId> pre-targets one athlete (from the athlete screen)
    if (sub && ANN.scopeKind !== 'athlete') { ANN.scopeKind = 'athlete'; ANN.scopeValue = sub; }
    // a plain (non-deep-link) open must not inherit a stale athlete-only scope from a prior deep-link visit
    if (!sub && ANN.scopeKind === 'athlete') { ANN.scopeKind = 'team'; ANN.scopeValue = null; }
    const positions = [...new Set(rows.map((r) => (r.unit || '').trim().toUpperCase()).filter(Boolean))];
    const target = ANN.scopeKind === 'athlete' ? rows.find((r) => r.athleteId === ANN.scopeValue) : null;
    const group = ANN.scopeKind === 'group' ? groups.find((g) => g.id === ANN.scopeValue) : null;
    const chip = (on, label, act, arg) =>
      `<span class="chp ${on ? 'on' : ''}" data-ann="${act}${arg != null ? ':' + esc(String(arg)) : ''}">${label}</span>`;
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    const histRows = HIST && HIST.teamId === teamId ? HIST.rows : null;
    const sendLabel = ANN.scopeKind === 'athlete' ? `Send to ${esc(target ? target.name : 'this athlete')}`
      : ANN.scopeKind === 'position' ? `Send to the ${esc(ANN.scopeValue || '')} room`
      : ANN.scopeKind === 'group' ? `Send to ${esc(group ? group.name : 'the group')}`
      : 'Send to the whole team';

    return `
    ${backHead('Announcement', 'Lands in every selected athlete’s feed', 'coach-create')}

    ${target ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px 8px">Sending to <b style="color:var(--text-1)">${esc(target.name)}</b> only.</div>` : ''}

    <div class="eyebrow">Who</div>
    <div class="chip-row" id="an-who">
      ${chip(ANN.scopeKind === 'team', `Whole team${rows.length ? ` · ${rows.length}` : ''}`, 'team')}
      ${positions.map((p) => {
        const n = rows.filter((r) => (r.unit || '').trim().toUpperCase() === p).length;
        return chip(ANN.scopeKind === 'position' && ANN.scopeValue === p, `${esc(p)} room · ${n}`, 'position', p);
      }).join('')}
      ${groups.map((g) => chip(ANN.scopeKind === 'group' && ANN.scopeValue === g.id, `${esc(g.name)} · ${(g.athlete_ids || []).length}`, 'group', g.id)).join('')}
    </div>

    <div class="eyebrow">Title</div>
    <input id="an-title" class="ob-input" maxlength="80" placeholder="e.g. Lift moved to 6am" value="${esc(ANN.title || '')}" />

    <div class="eyebrow">Message</div>
    <textarea id="an-body" class="ob-input" maxlength="500" rows="4" placeholder="What they need to know" style="height:auto;padding-top:10px;padding-bottom:10px">${esc(ANN.body || '')}</textarea>

    <div style="height:16px"></div>
    <button class="btn" id="an-send">${icon('share', 18)} ${sendLabel}</button>
    <div id="an-status" style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:8px"></div>

    <div class="eyebrow" style="margin-top:18px">Recent announcements</div>
    ${(HIST && HIST.teamId === teamId && HIST.offline) ? errorState({ title: "Couldn't load history", body: 'Your sent announcements are safe — reconnect to see them.', retryId: 'an-hist-retry' }) : histRows === null ? skeletonRows(2, 'Loading announcements') : histRows.length ? `
    <section class="card" style="padding:6px 16px">
      ${histRows.map((a) => `
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('share', 17)}</div>
        <div class="lm"><div class="lt">${esc(a.title)}</div><div class="ls">${esc(audienceLabel(a.scope_kind, a.scope_value, groups))} · ${esc(fmtWhen(a.created_at, Date.now()))}${a.sent_count != null ? ` · → ${a.sent_count}` : ''}</div></div>
      </div>`).join('')}
    </section>` : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:0 2px">Nothing sent yet — your first one shows up here.</div>`}
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    loadCoachRoster().then(() => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (teamId) loadHistory(teamId);
    });
    const histRetry = root.querySelector('#an-hist-retry');
    if (histRetry) histRetry.addEventListener('click', () => {
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (teamId) { histRetry.disabled = true; loadHistory(teamId, true); }
    });
    const say = (msg, isErr) => {
      const el = root.querySelector('#an-status');
      if (el) { el.style.color = isErr ? 'var(--red)' : 'var(--text-3)'; el.textContent = msg; }
    };
    const keep = () => {
      ANN.title = (root.querySelector('#an-title') || {}).value || '';
      ANN.body = (root.querySelector('#an-body') || {}).value || '';
    };
    root.querySelectorAll('[data-ann]').forEach((el) => el.addEventListener('click', () => {
      keep();
      const [act, arg] = el.getAttribute('data-ann').split(':');
      if (act === 'team') { ANN.scopeKind = 'team'; ANN.scopeValue = null; }
      if (act === 'position') { ANN.scopeKind = 'position'; ANN.scopeValue = arg; }
      if (act === 'group') { ANN.scopeKind = 'group'; ANN.scopeValue = arg; }
      window.__render();
    }));
    const send = root.querySelector('#an-send');
    if (send) send.addEventListener('click', async () => {
      keep();
      const title = ANN.title.trim();
      const body = ANN.body.trim();
      if (title.length < 2) { say('Give it a title first.', true); return; }
      if (!body.length) { say('Add what they need to know — the message can’t be blank.', true); return; }
      const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
      if (!teamId) { say('Your roster hasn’t loaded yet — give it a second and try again.', true); return; }
      send.disabled = true; say('Sending…');
      const r = await roles.postAnnouncement({
        teamId, scopeKind: ANN.scopeKind, scopeValue: ANN.scopeValue, title, body,
      });
      send.disabled = false;
      if (!r.ok) { say(r.error || 'Could not send — try again.', true); return; }
      // Push is best-effort on top of the guaranteed feed rows the RPC already wrote —
      // fire-and-forget, never allowed to affect the status copy below.
      roles.pushAnnouncement(r.id).catch(() => {});
      const count = r.count || 0;
      const msg = `Sent to ${count} athlete${count === 1 ? '' : 's'}.`;
      ANN.title = ''; ANN.body = '';
      await loadHistory(teamId, true);
      say(msg);
    });
  },
};
