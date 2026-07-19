import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadCoachRoster, loadActivity, actTime, entriesFor, getScope, setScope } from '../coach-data.js';
import { buildPriorities } from '../priority.js';
import { teamPulse } from '../status.js';
import { encodeQR, addQuietZone, qrSvg } from '../qr.js';

/* Athlete-invite link + share text (mirrors the trainer's inviteLink/inviteShareText inline,
   the same way state.js mirrors src/core in plain JS). Empty code → empty string: never link or
   share a dead code before the team's join code is real. */
function inviteLink(code) {
  const c = (code || '').trim().toUpperCase();
  return c ? `https://onstandard.app/join?code=${c}` : '';
}
function inviteShareText(code, teamName) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const name = (teamName && teamName.trim()) || 'my team';
  return `Join ${name} on OnStandard. Use code ${c} or open ${inviteLink(c)}`;
}

/* SIGNATURE-matched invite card for the empty dashboard: the athlete code in boxes, a scannable
   QR, and Copy / Share — the coach's first useful action is to hand out the code. */
function coachInviteCard(code, teamName) {
  const link = inviteLink(code);
  const svg = qrSvg(addQuietZone(encodeQR(link, 'M')), 96, '#0B0D12', `QR code to join ${esc(teamName)}`);
  return `<section class="card" style="padding:18px">
    <div class="eyebrow" style="margin:0 0 10px">Invite code</div>
    <div class="code-boxes invite-code" style="padding:0;margin-bottom:14px">
      ${code.split('').map((ch) => `<div class="cb filled">${esc(ch)}</div>`).join('')}
    </div>
    <div style="display:flex;gap:14px;align-items:center">
      <div style="flex:none"><div class="hq-qr">${svg}</div><div class="hq-qcap">SCAN TO JOIN</div></div>
      <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.45">Athletes scan the code or enter it to join your team. Only you hand it out.</div>
    </div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn ghost sm" id="coach-copy-code">${icon('clipboard', 16)} Copy code</button>
      <button class="btn sm" id="coach-share-invite" style="background:linear-gradient(150deg,var(--blue-bright),#2563eb);color:#fff">${icon('share', 16)} Share invite</button>
    </div>
  </section>`;
}

/* First-run checklist — the concrete next actions, each linking to the real screen. "Share your
   athlete code" is already done the moment a code exists. */
function setupChecklist(hasCode) {
  const items = [
    { done: hasCode, t: 'Share your athlete code', s: 'Invite athletes to start tracking execution', go: null },
    { done: false, t: 'Review your standard', s: 'Meals, windows, and requirements', go: 'coach-plan' },
    { done: false, t: 'Set notification rules', s: 'When you and your athletes get nudged', go: 'coach-notif-settings' },
    { done: false, t: 'Add another staff member', s: 'Coordinators, position coaches, and more', go: 'coach-profile' },
    { done: false, t: 'Create position groups', s: 'Scope the standard to a room', go: 'coach-roster' },
  ];
  return `<div class="eyebrow">Finish setting up your team</div>
    <section class="card" style="padding:6px 16px">
      ${items.map((i) => `<div class="lrow" ${i.go ? `data-go="${i.go}" style="cursor:pointer"` : 'style="cursor:default"'}>
        <div class="xico sm ${i.done ? 'green' : 'gray'}">${i.done ? icon('check', 15) : ''}</div>
        <div class="lm"><div class="lt">${esc(i.t)}</div><div class="ls">${esc(i.s)}</div></div>
        ${i.go ? icon('chevron', 17, 'style="color:var(--text-3)"') : ''}
      </div>`).join('')}
    </section>`;
}

/* Honest team-score tile for the empty roster: "Not scored yet", never a fabricated 0/failure. */
function notScoredTeamTile() {
  return `<section class="co-pulse" style="cursor:default">
    <div class="co-pulse-top">
      <div class="co-pulse-score"><div class="k">Team score</div><div class="num" style="font-size:34px;color:var(--text-3);-webkit-text-fill-color:var(--text-3)">—</div><div class="delta flat">Not scored yet</div></div>
      <div class="co-pulse-done"><div class="v">0</div><div class="k">Athletes</div></div>
    </div>
  </section>`;
}

/* The whole truthful empty dashboard body (everything below the header): team-created
   confirmation, "Not scored yet" tile, athlete-invite card (code/QR/share) or a minting note,
   setup checklist, and honest empty roster/activity — never a fabricated athlete or team score.
   Pure (given code + teamName) so it is unit-testable without a live roster. */
export function emptyTeamDashboard(code, teamName) {
  return `
    <section class="state-demo" style="border-style:solid;border-color:var(--green-border)"><div class="sd-ic" style="color:var(--green-bright)">${icon('check', 24)}</div>
      <div class="sd-t">Your team is ready</div>
      <div class="sd-s">Invite athletes to begin. Your command center lights up in real time as they log.</div></section>
    ${notScoredTeamTile()}
    ${code
        ? coachInviteCard(code, teamName)
        : `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div><div><div class="tt">Your athlete code is minting…</div><div class="ts">It appears here the moment your team is set up on the server — usually a few seconds. Nothing shows until it's real.</div></div></div>`}
    ${setupChecklist(!!code)}
    <div class="eyebrow">Roster</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 8px;line-height:1.4">No athletes yet — they appear here the moment they join with your code.</div>
    <div class="eyebrow">Live activity</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">No activity yet. New logs land here in real time once athletes begin.</div>
    <div class="co-bottom"></div>`;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
let SHOW_SCOPES = false;        // scope sheet open?
let SHOW_PULSE = false;         // pulse breakdown open?

function scopeLabel(scope) {
  // Slice F: a scoped staff member's 'team' view is already server-narrowed to their
  // responsibility (0078) — calling it "Entire team" would overstate what they see.
  if (!scope || scope.kind === 'team') return (CD.extras && CD.extras.scope) ? 'My athletes' : 'Entire team';
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
    <div>${chip('team', '', (CD.extras && CD.extras.scope) ? 'My athletes' : 'Entire team', is('team', ''))}
    ${positions.map(p => chip('position', p, `${p} room`, is('position', p))).join('')}
    ${groups.map(g => chip('group', g.id, g.name, is('group', g.id))).join('')}</div>
    <div style="font-size:11.5px;color:var(--text-3);font-weight:600;margin-top:4px">Custom groups are built on the Roster tab.</div>
  </section>`;
}

/* SIGNATURE — Team Pulse standing bar: the group score in the blue→teal signature,
   the roster's real live standing as one honest proportional bar. */
function pulseCard(rows, statuses) {
  const p = teamPulse(rows, statuses, roles.todayISO());
  if (p.avg == null && !rows.length) return '';
  const keys = Object.values(statuses).map(s => s.key);
  const count = (pred) => keys.filter(pred).length;
  const g = count(k => k === 'on_standard');
  const a = count(k => k === 'due_soon' || k === 'below_standard' || k === 'needs_review');
  const r = count(k => k === 'overdue');
  const d = count(k => k === 'no_activity' || k === 'excused');
  const seg = (cls, c) => c ? `<span class="seg ${cls}" style="flex:${c}"></span>` : '';
  const leg = (cls, c, label) => c ? `<span class="it"><span class="dot ${cls}"></span><b>${c}</b> ${label}</span>` : '';
  const delta = p.deltaVsYesterday;
  const dCls = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const dTxt = delta == null ? 'First day of data' : delta === 0 ? 'Even with yesterday'
    : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs yesterday`;
  const scored = rows.filter(x => x.score != null).length;
  return `
  <section class="co-pulse tappable" data-pulse>
    <div class="co-pulse-top">
      <div class="co-pulse-score">
        <div class="k">Group score</div>
        <div class="num">${p.avg != null ? p.avg : '—'}</div>
        <div class="delta ${dCls}">${esc(dTxt)}</div>
      </div>
      <div class="co-pulse-done"><div class="v">${p.completionPct != null ? p.completionPct + '%' : '—'}</div><div class="k">Done today</div></div>
    </div>
    <div class="co-standing">${seg('g', g)}${seg('a', a)}${seg('r', r)}${seg('d', d)}</div>
    <div class="co-legend">${leg('g', g, 'on standard')}${leg('a', a, 'need attention')}${leg('r', r, 'overdue')}${leg('d', d, 'no activity')}</div>
    ${SHOW_PULSE ? `<div style="border-top:1px solid var(--hairline-soft);margin-top:var(--s3);padding-top:var(--s3);font-size:12px;font-weight:600;color:var(--text-2);line-height:1.6">The group score averages today's real athlete scores (${scored} of ${rows.length} scored so far). The bar is your roster's live standing — nothing is estimated; an athlete with no log adds no score.</div>` : ''}
  </section>`;
}

/* Ranked priority — calm hierarchy, one primary action by tier, the rest subordinate. */
function priorityCard(c, i, nudgedToday) {
  const tier = c.tier === 'critical' ? 'critical' : c.tier === 'below' ? 'below' : 'due';
  const tierLbl = { critical: 'Critical', below: 'Below standard', due: 'Due soon' }[tier];
  const scoreCol = c.score == null ? '' : c.score >= 80 ? 'var(--green-bright)' : c.score >= 60 ? 'var(--amber-bright)' : '#FF9B9B';
  const openPrimary = tier === 'below';  // below-standard → review the log; critical/due → send the nudge
  const nudgeCls = !openPrimary ? (tier === 'critical' ? 'primary warn' : 'primary') : '';
  return `
  <div class="co-pri t-${tier}">
    <div class="co-pri-head" data-go="coach-athlete/${esc(c.athleteId)}">
      <div class="co-pri-rank">${i + 1}</div>
      <div class="co-pri-main">
        <div class="co-pri-name">${esc(c.name)}${c.unit ? `<span class="pos">${esc(c.unit)}</span>` : ''}<span class="co-tier t-${tier}">${tierLbl}</span></div>
        ${c.reasons.map(r => `<div class="co-pri-reason">${esc(r)}</div>`).join('')}
      </div>
      ${c.score != null ? `<div class="co-pri-score" style="color:${scoreCol}">${c.score}</div>` : ''}
    </div>
    <div class="co-pri-acts">
      <button class="co-abtn ${openPrimary ? 'primary' : ''}" data-go="coach-athlete/${esc(c.athleteId)}">${openPrimary ? 'Review' : 'Open'}</button>
      <button class="co-abtn ${nudgeCls}" data-pnudge="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" ${nudgedToday ? 'disabled' : ''}>${nudgedToday ? 'Nudged ✓' : 'Nudge'}</button>
      <button class="co-abtn" data-passign="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}">Assign</button>
      <button class="co-abtn" data-phandle="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}">Handled</button>
    </div>
    <div class="co-pstatus" id="pstatus-${esc(c.athleteId)}"></div>
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
    if (!CD.roster.rows.length) {
      const code = RT.team && RT.team.code;
      const teamNm = (CD.roster.teams[0] && CD.roster.teams[0].name) || teamName;
      return `${head}${emptyTeamDashboard(code, teamNm)}`;
    }

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
    <div class="co-bottom"></div>`;
  },
  mount(root) {
    loadCoachRoster().then(() => loadActivity());
    // Empty-state invite card: Copy + native Share of the athlete code (present only before any
    // athlete has joined).
    const code = RT.team && RT.team.code;
    const teamNm = (CD.roster && CD.roster.teams[0] && CD.roster.teams[0].name) || 'your team';
    const copyBtn = root.querySelector('#coach-copy-code');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code || ''); } catch { /* no-op */ }
      copyBtn.innerHTML = `${icon('check', 16)} Copied`;
      setTimeout(() => { copyBtn.innerHTML = `${icon('clipboard', 16)} Copy code`; }, 1600);
    });
    const shareBtn = root.querySelector('#coach-share-invite');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const url = inviteLink(code), text = inviteShareText(code, teamNm);
      try {
        if (window.OnStandardNative && window.OnStandardNative.share) {
          window.OnStandardNative.share({ title: `Join ${teamNm}`, message: text, url });
        } else if (navigator.share) {
          await navigator.share({ title: `Join ${teamNm}`, text, url });
        } else {
          await navigator.clipboard.writeText(text);
          shareBtn.innerHTML = `${icon('check', 16)} Copied invite`;
          setTimeout(() => { shareBtn.innerHTML = `${icon('share', 16)} Share invite`; }, 1600);
        }
      } catch { /* share sheet dismissed */ }
    });
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
