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
        : logged ? `${logged} of ${entries.length} have logged today — nothing needs your attention right now.`
        : 'Quiet so far — no logs yet today.');
    }
    return `${head}
    <div class="eyebrow">Today's read</div>
    <section class="card" style="padding:13px 16px">
      ${lines.map(l => `<div style="font-size:13px;font-weight:600;color:var(--text-2);line-height:1.55;margin:3px 0">· ${esc(l)}</div>`).join('')}
      <div style="font-size:10.5px;color:var(--text-3);font-weight:700;margin-top:8px">Computed from your roster's real logs — nothing here is generated.</div>
    </section>
    <div class="eyebrow">This week</div>
    <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
    <div><div class="tt">Trends unlock as history builds</div>
    <div class="ts">Weekly change, most-missed requirements, and whether your nudges are working — this screen fills in from your team's real data. Every action you take is already being recorded toward it.</div></div></div>
    <div style="height:10px"></div>`;
  },
  mount() { loadCoachRoster(); },
};
