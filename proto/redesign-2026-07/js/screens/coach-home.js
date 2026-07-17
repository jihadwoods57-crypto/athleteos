import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster, loadActivity, actTime, entriesFor, getScope, setScope } from '../coach-data.js';
import { buildPriorities } from '../priority.js';
import { teamPulse } from '../status.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
let SHOW_SCOPES = false;        // scope sheet open?
let SHOW_PULSE = false;         // pulse breakdown open?

function scopeLabel(scope) {
  if (!scope || scope.kind === 'team') return 'Entire team';
  if (scope.kind === 'position') return `${scope.value} room`;
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    return g ? g.name : 'Group';
  }
  if (scope.kind === 'athlete') {
    const r = CD.roster && CD.roster.rows.find(x => x.athleteId === scope.value);
    return r ? r.name : 'One athlete';
  }
  return 'Entire team';
}

function scopeSheet() {
  const rows = CD.roster ? CD.roster.rows : [];
  const positions = [...new Set(rows.map(r => (r.position || '').toUpperCase()).filter(Boolean))].sort();
  const groups = (CD.extras && CD.extras.groups) || [];
  const chip = (kind, value, label, active) => `
    <button class="btn ${active ? 'green' : 'ghost'} sm" data-scope="${esc(kind)}:${esc(value == null ? '' : value)}"
      style="width:auto;padding:0 13px;height:32px;margin:0 6px 6px 0">${esc(label)}</button>`;
  const cur = getScope();
  const is = (k, v) => cur.kind === k && String(cur.value || '') === String(v || '');
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Who you're looking at</div>
    <div>${chip('team', '', 'Entire team', is('team', ''))}
    ${positions.map(p => chip('position', p, `${p} room`, is('position', p))).join('')}
    ${groups.map(g => chip('group', g.id, g.name, is('group', g.id))).join('')}</div>
    <div style="font-size:11.5px;color:var(--text-3);font-weight:600;margin-top:4px">Custom groups are built on the Roster tab.</div>
  </section>`;
}

function pulseCard(rows, statuses) {
  const p = teamPulse(rows, statuses, roles.todayISO());
  if (p.avg == null && !rows.length) return '';
  const delta = p.deltaVsYesterday;
  const deltaTxt = delta == null ? '' : `<span style="font-size:12px;font-weight:800;color:${delta >= 0 ? 'var(--green-bright)' : 'var(--red)'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs yesterday</span>`;
  const cell = (v, k, color) => `<div style="flex:1;text-align:center"><div style="font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;color:${color}">${v}</div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3)">${k}</div></div>`;
  return `
  <section class="card" data-pulse style="padding:15px 18px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="flex:none">
        <div style="font-size:9px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-3);margin-bottom:3px">Group score</div>
        <div style="font-size:42px;font-weight:800;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums;background:linear-gradient(105deg,var(--ring-a),var(--ring-b) 45%,var(--ring-c));-webkit-background-clip:text;background-clip:text;color:transparent">${p.avg != null ? p.avg : '—'}</div>
        ${deltaTxt}
      </div>
      <div style="flex:1;display:flex;border-left:1px solid var(--hairline-soft);padding-left:10px">
        ${cell(p.onStandard, 'On std', 'var(--green-bright)')}
        ${cell(p.dueSoon, 'Due soon', 'var(--amber-bright)')}
        ${cell(p.overdue, 'Overdue', 'var(--red)')}
        ${cell(p.completionPct != null ? p.completionPct + '%' : '—', 'Done', 'var(--blue-bright)')}
      </div>
    </div>
    ${SHOW_PULSE ? `
    <div style="border-top:1px solid var(--hairline-soft);margin-top:12px;padding-top:10px;font-size:12px;font-weight:600;color:var(--text-2);line-height:1.6">
      The group score is the average of today's real athlete scores (${rows.filter(r => r.score != null).length} of ${rows.length} scored so far).
      Completion counts every required item across the group — ${p.completionPct != null ? p.completionPct + '% done' : 'no requirements resolved yet'}.
      Nothing here is estimated: an athlete with no log contributes no score.
    </div>` : ''}
  </section>`;
}

function priorityCard(c, i, nudgedToday) {
  const tierMeta = { critical: ['CRITICAL', 'var(--red)'], below: ['BELOW STANDARD', 'var(--amber-bright)'], due_soon: ['DUE SOON', 'var(--blue-bright)'] }[c.tier];
  return `
  <div class="card" style="padding:13px 15px;border-left:3px solid ${tierMeta[1]}">
    <div style="display:flex;align-items:center;gap:10px;cursor:pointer" data-go="coach-athlete/${esc(c.athleteId)}">
      <span style="font-size:15px;font-weight:800;color:var(--text-3);flex:none">${i + 1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:800">${esc(c.name)}${c.unit ? ` <small style="color:var(--text-3);font-weight:700">· ${esc(c.unit)}</small>` : ''} <span style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:${tierMeta[1]}">${tierMeta[0]}</span></div>
        ${c.reasons.map(r => `<div style="font-size:11.5px;font-weight:600;color:var(--text-2);margin-top:2px">${esc(r)}</div>`).join('')}
        <div style="font-size:11px;font-weight:700;color:var(--blue-bright);margin-top:3px">→ ${esc(c.suggestedAction.label)}</div>
      </div>
      ${c.score != null ? `<span class="nw">${c.score}</span>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px">
      <button class="btn sm" data-go="coach-athlete/${esc(c.athleteId)}" style="height:32px;font-size:11.5px">Open</button>
      <button class="btn ghost sm" data-pnudge="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px" ${nudgedToday ? 'disabled' : ''}>${nudgedToday ? 'Nudged ✓' : 'Nudge'}</button>
      <button class="btn ghost sm" data-passign="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px">Assign</button>
      <button class="btn ghost sm" data-phandle="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" style="height:32px;font-size:11.5px">Handled</button>
    </div>
    <div id="pstatus-${esc(c.athleteId)}" style="font-size:11px;font-weight:600;color:var(--text-3);min-height:0"></div>
  </div>`;
}

export const coachHome = {
  nav: 'coach', tab: 'home',
  render() {
    const teamName = CD.roster && CD.roster.teams[0] ? CD.roster.teams[0].name : (S.athlete.school || 'Your team');
    const initials = S.coachIdentity.initials;
    const scope = getScope();
    const head = avatarHead(`${S.greeting}, ${S.coachIdentity.handle}`, `${teamName} · ${scopeLabel(scope)} · today`, initials);
    if (CD.roster === null) return `${head}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Loading your team…</div><div class="ts">Pulling today's real numbers.</div></div></div>`;
    if (CD.roster.offline) return `${head}
      <div class="state-demo"><div class="sd-ic">${icon('wifiOff', 24)}</div>
      <div class="sd-t">Can't reach your team</div>
      <div class="sd-s">Check your connection — reopen to retry. Nothing is lost.</div></div>`;
    if (!CD.roster.rows.length) return `${head}
      <div class="state-demo" data-go="coach-profile" style="cursor:pointer"><div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">No athletes yet</div>
      <div class="sd-s">Share your team code so athletes can join. Your command center lights up as they log.</div>
      ${RT.team && RT.team.code ? `<div class="sd-cta"><span class="btn ghost sm" style="width:auto;padding:0 14px;letter-spacing:0.18em;font-weight:800">${esc(RT.team.code)}</span></div>` : ''}</div>`;

    const entries = entriesFor(scope);
    const statuses = {}; if (entries) for (const e of entries) statuses[e.row.athleteId] = e.status;
    const rows = entries ? entries.map(e => e.row) : [];
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowMs = now.getTime();
    const cards = entries ? buildPriorities({ nowMin, nowMs, entries, interventions: (CD.extras && CD.extras.interventions) || [] }) : [];
    const pending = CD.roster.pending || [];
    const seen = new Set(RT.coachSeenMealIds || []);
    const feed = CD.act && CD.act.rows ? CD.act.rows.filter(m => rows.some(r => r.athleteId === m.athlete_id)) : null;
    const unseen = feed ? feed.filter(m => !seen.has(m.id)).length : 0;
    const followUps = [
      unseen ? { n: unseen, t: `log${unseen > 1 ? 's' : ''} you haven't opened`, go: 'coach-inbox' } : null,
      pending.length ? { n: pending.length, t: `join request${pending.length > 1 ? 's' : ''} waiting`, go: 'coach-inbox' } : null,
      cards.length ? { n: cards.length, t: `priorit${cards.length > 1 ? 'ies' : 'y'} not handled yet`, go: null } : null,
    ].filter(Boolean);

    return `${head}
    <button class="btn ghost sm" data-scopes style="width:auto;padding:0 13px;height:30px;margin-bottom:10px">${icon('users', 13)} ${esc(scopeLabel(scope))} ▾</button>
    ${SHOW_SCOPES ? scopeSheet() : ''}
    ${pending.length ? `<div class="card" data-go="coach-inbox" style="padding:10px 15px;cursor:pointer;display:flex;align-items:center;gap:10px"><div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 15)}</div><div style="flex:1;font-size:12.5px;font-weight:700">${pending.length} join request${pending.length > 1 ? 's' : ''} waiting</div><span style="color:var(--text-3)">›</span></div>` : ''}
    ${entries === null ? '' : pulseCard(rows, statuses)}

    <div class="eyebrow">Coach priorities</div>
    ${entries === null ? `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bell', 17)}</div><div><div class="tt">Ranking the day…</div><div class="ts">Standards and exceptions are loading.</div></div></div>`
    : cards.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">Nothing needs you right now. Anything you nudge, assign, or mark handled stays out of this queue until the reason changes.</div>`
    : cards.slice(0, 6).map((c, i) => priorityCard(c, i, (RT.coachNudged || {})[c.athleteId] === new Date().toISOString().slice(0, 10))).join('')}

    <div class="eyebrow" style="display:flex;justify-content:space-between;align-items:baseline"><span>Live activity</span>${unseen ? `<span style="color:var(--blue-bright)">${unseen} new</span>` : ''}</div>
    ${feed === null ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px">Loading the feed…</div>`
    : feed.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">No logs yet ${scope.kind === 'team' ? 'today' : 'in this group today'}. Every meal lands here the moment it's logged.</div>`
    : `<div style="display:flex;gap:9px;overflow-x:auto;padding-bottom:4px;margin:0 -2px">${feed.slice(0, 12).map(m => {
        const who = rows.find(r => r.athleteId === m.athlete_id) || {};
        const photo = CD.act.photos[m.id];
        const bits = [cap(m.type || 'Meal'), actTime(m.logged_at)].filter(Boolean);
        return `<div class="act-card" data-go="coach-meal/${esc(m.id)}" style="position:relative;flex:0 0 47%">
          ${photo ? `<div class="act-media" style="height:64px;background-image:url('${esc(photo)}');background-size:cover;background-position:center"></div>` : `<div class="act-media" style="height:64px;background:linear-gradient(150deg,var(--surface-2),var(--surface-3))"></div>`}
          ${seen.has(m.id) ? '' : `<span style="position:absolute;top:7px;right:7px;width:9px;height:9px;border-radius:50%;background:var(--blue-bright);box-shadow:0 0 9px rgba(96,165,250,0.7);border:2px solid rgba(5,8,15,0.8)"></span>`}
          <div style="padding:8px 10px 9px"><div style="font-size:11px;font-weight:800">${esc((who.name || 'Athlete').split(' ')[0])}</div>
          <div style="font-size:9.5px;color:var(--text-3);font-weight:700;margin-top:2px">${esc(bits.join(' · '))}</div></div>
        </div>`;
      }).join('')}</div>`}

    <div class="eyebrow">Follow-ups</div>
    ${followUps.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px">All caught up.</div>`
    : `<section class="card" style="padding:6px 16px">${followUps.map(f => `
      <div class="lrow" ${f.go ? `data-go="${f.go}" style="cursor:pointer"` : 'style="cursor:default"'}>
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)"><b>${f.n}</b></div>
        <div class="lm"><div class="lt" style="text-transform:capitalize">${esc(f.t)}</div></div>
        ${f.go ? '<span style="color:var(--text-3)">›</span>' : ''}
      </div>`).join('')}</section>`}
    <div style="height:10px"></div>`;
  },
  mount(root) {
    loadCoachRoster().then(() => loadActivity());
    root.querySelectorAll('[data-scopes]').forEach(b => b.addEventListener('click', () => { SHOW_SCOPES = !SHOW_SCOPES; window.__render(); }));
    root.querySelectorAll('[data-pulse]').forEach(b => b.addEventListener('click', () => { SHOW_PULSE = !SHOW_PULSE; window.__render(); }));
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-scope').split(':');
      setScope({ kind: kind || 'team', value: value || null }); SHOW_SCOPES = false; window.__render();
    }));
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    // Failed writes never lie: log() only mirrors the intervention into the local cache when the
    // server took it, and returns the honest boolean so callers can keep the card + say so.
    const log = async (athleteId, kind, b) => {
      const reasonKey = b.getAttribute('data-key'), tier = b.getAttribute('data-tier');
      const ok = await roles.logIntervention({ teamId, athleteId, kind, reasonKey, tier });
      if (ok && CD.extras) CD.extras.interventions.push({ athlete_id: athleteId, kind, reason_key: reasonKey, tier });
      return ok;
    };
    const sayFail = (athleteId, msg) => {
      const el = root.querySelector(`#pstatus-${athleteId}`);
      if (el) { el.style.color = 'var(--red)'; el.textContent = msg; }
    };
    root.querySelectorAll('[data-phandle]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-phandle');
      b.disabled = true; b.textContent = '…';
      const ok = await log(id, 'handled', b);
      if (!ok) {
        b.disabled = false; b.textContent = 'Handled';
        sayFail(id, "Couldn't save that — check your connection.");
        return;
      }
      window.__render();
    }));
    root.querySelectorAll('[data-pnudge]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-pnudge');
      b.disabled = true; b.textContent = '…';
      const ok = await roles.nudgePush(id, `${S.coachIdentity.handle} is waiting`, 'Your log is overdue. Get it in.');
      if (!ok) {
        b.disabled = false; b.textContent = 'Nudge';
        sayFail(id, "Couldn't send the nudge — check your connection.");
        return;
      }
      act.markNudged(id);
      await log(id, 'nudge', b);
      window.__render();
    }));
    root.querySelectorAll('[data-passign]').forEach(b => b.addEventListener('click', async () => {
      if (b.disabled) return; // double-tap guard — navigates away, so no re-enable needed
      b.disabled = true;
      const id = b.getAttribute('data-passign');
      // The intervention row is bookkeeping; the assign itself happens in the composer —
      // navigate regardless (log() already refuses to fake the cache on failure).
      await log(id, 'assign', b);
      window.__go(`coach-assign/${id}`);
    }));
  },
};
