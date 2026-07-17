import { S } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc } from '../components.js';
import { CD, loadCoachRoster, entriesFor } from '../coach-data.js';

/* Insights v1 starter (slice A): today's deterministic read over the real roster.
   Weekly trends / most-missed / movers land in slice E — the unlock note below is
   honest about that, and coach_interventions is ALREADY recording so slice E's
   "did the intervention work?" has history from today forward. */
export const coachInsights = {
  nav: 'coach', tab: 'insights',
  render() {
    const initials = (S.coachIdentity.handle || 'C').replace(/coach\s*/i, '').slice(0, 2).toUpperCase();
    const head = avatarHead('Insights', 'What the numbers say', initials);
    if (CD.roster === null || !CD.extras) return `${head}<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div><div><div class="tt">Reading the day…</div></div></div>`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    const by = (k) => entries.filter(e => e.status.key === k);
    const lines = [];
    if (by('overdue').length) lines.push(`${by('overdue').length} athlete${by('overdue').length > 1 ? 's are' : ' is'} overdue right now: ${by('overdue').slice(0, 3).map(e => e.row.name.split(' ')[0]).join(', ')}${by('overdue').length > 3 ? '…' : ''}.`);
    if (by('no_activity').length) lines.push(`${by('no_activity').length} ${by('no_activity').length > 1 ? 'have' : 'has'} no activity in the last day.`);
    if (by('below_standard').length) lines.push(`${by('below_standard').length} logged below the standard today.`);
    if (by('needs_review').length) lines.push(`${by('needs_review').length} log${by('needs_review').length > 1 ? 's are' : ' is'} in — waiting on a score or your review.`);
    const top = entries.filter(e => e.row.score != null).sort((a, b) => b.row.score - a.row.score)[0];
    if (top) lines.push(`${top.row.name} leads the day at ${top.row.score}.`);
    if (!lines.length) {
      const logged = entries.filter(e => e.row.loggedToday).length;
      lines.push(!entries.length ? 'No athletes on the roster yet.'
        : logged ? `${logged} of ${entries.length} ${logged === 1 ? 'has' : 'have'} logged today — nothing needs your attention right now.`
        : 'Quiet so far — no logs yet today.');
    }
    // Recurring standing-bar motif — the same signature language as Home, so Insights opens
    // on the team's real shape at a glance before the sentences explain it.
    const keys = entries.map(e => e.status.key);
    const cnt = (p) => keys.filter(p).length;
    const g = cnt(k => k === 'on_standard'), a = cnt(k => k === 'due_soon' || k === 'below_standard' || k === 'needs_review');
    const r = cnt(k => k === 'overdue'), d = cnt(k => k === 'no_activity' || k === 'excused');
    const seg = (cls, c) => c ? `<span class="seg ${cls}" style="flex:${c}"></span>` : '';
    const leg = (cls, c, l) => c ? `<span class="it"><span class="dot ${cls}"></span><b>${c}</b> ${l}</span>` : '';
    const lineDot = (l) => /overdue|no activity/i.test(l) ? 'r' : /below|waiting|review/i.test(l) ? 'a' : /leads/i.test(l) ? 'g' : 'b';
    return `${head}
    ${entries.length ? `<div class="co-eyebrow tight">Where the team stands</div>
    <section class="card" style="padding:var(--s4)">
      <div class="co-standing">${seg('g', g)}${seg('a', a)}${seg('r', r)}${seg('d', d)}</div>
      <div class="co-legend">${leg('g', g, 'on standard')}${leg('a', a, 'need attention')}${leg('r', r, 'overdue')}${leg('d', d, 'no activity')}</div>
    </section>` : ''}

    <div class="co-eyebrow">Today's read</div>
    <section class="card" style="padding:var(--s3) var(--s4)">
      ${lines.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:13.5px;font-weight:600;color:var(--text);line-height:1.5"><span class="dot ${lineDot(l)}" style="width:7px;height:7px;border-radius:50%;margin-top:7px;flex:none"></span><span>${esc(l)}</span></div>`).join('')}
    </section>
    <div class="co-note">Computed from your roster's real logs — nothing here is generated.</div>

    <div class="co-eyebrow">This week</div>
    <div class="co-empty"><div class="ic">${icon('bars', 24)}</div>
    <div class="tt">Trends unlock as history builds</div>
    <div class="ts">Weekly change, most-missed requirements, and whether your nudges are working — this screen fills in from your team's real data. Every action you take is already recording toward it.</div></div>
    <div class="co-bottom"></div>`;
  },
  mount() { loadCoachRoster(); },
};
