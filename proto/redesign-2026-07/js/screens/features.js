import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

/* ============================================================
   The 11 approved ideas, made walkable. Live where possible,
   honestly framed as preview where the backend must exist first.
   ============================================================ */

/* ---------- #devices · Wearable-verified recovery ---------- */
export const devices = {
  tab: 'profile',
  render() {
    const on = RT.wearable;
    return `
    ${backHead('Connected Devices', 'Recovery stops being a vibe check', 'profile')}

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:${on ? 'var(--green-surface)' : 'var(--surface-2)'};color:${on ? 'var(--green-bright)' : 'var(--text-3)'}">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Apple Watch</div><div class="ls">${on ? 'Connected · sleep, HRV, resting HR' : 'Not connected'}</div></div>
        <div class="seg" style="width:104px">
          <button class="${on ? 'on' : ''}" data-act="toggleWearable" data-then="devices">On</button>
          <button class="${on ? '' : 'on'}" data-act="toggleWearable" data-then="devices">Off</button>
        </div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">Whoop</div><div class="ls">Available · same rules</div></div>
        <span class="status-pill b">Connect</span>
      </div>
    </section>

    <div class="eyebrow">What it changes</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['moon', 'Sleep fills itself in', '7h 42m last night, from the watch. You stop guessing.'],
        ['bolt', 'HRV + resting HR verify readiness', 'Objective inputs get a Verified badge in your score breakdown.'],
        ['edit', 'Feelings stay yours', 'Soreness, mood, and stress are still asked. Hardware can’t feel a hamstring.'],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon g" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Why this matters here</div>
      <div class="ts">Recovery is 25% of your score and was the last self-reported piece. Verified data closes the last honest gap in “the score never lies.”</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #recruiting · The score as a recruiting asset ---------- */
export const recruiting = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Discipline Record', 'Coach-verified. Yours to share.', 'profile')}

    <section class="card pad" style="border-color:var(--green-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon g" style="width:52px;height:52px;border-radius:16px">${icon('shield', 25)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">${S.athlete.name} · ${S.athlete.position}</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:3px">Verified by ${S.coach.name}, ${S.coach.team}</div>
        </div>
      </div>
      <div class="macro-row" style="margin-top:16px">
        <div class="macro"><div class="mv" style="color:var(--green-bright)">84</div><div class="mk">Season avg</div></div>
        <div class="macro"><div class="mv">87%</div><div class="mk">Consistency</div></div>
        <div class="macro"><div class="mv" style="color:var(--amber-bright)">9d</div><div class="mk">Best streak</div></div>
        <div class="macro"><div class="mv">92%</div><div class="mk">Meals logged</div></div>
      </div>
    </section>

    <div class="eyebrow">Why a recruiter cares</div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Film shows talent. This shows habits.</div>
      <div class="ts">Six months of coach-verified daily execution is a signal no highlight reel carries: this athlete does the work when nobody claps.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary">${icon('arrowUp', 18)} Share with a recruiter</button>
    <div style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);margin-top:12px;line-height:1.5">Sharing is always your choice, link by link. Nothing is public,<br>and ${S.coach.name} countersigns every shared record.</div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #restrictions · Allergy & restriction guardian (editor) ---------- */
const RESTRICTION_OPTS = ['Peanuts · severe', 'Tree nuts · severe', 'Shellfish · severe', 'Dairy', 'Gluten', 'Eggs', 'Vegetarian', 'Halal'];
export const restrictions = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Food Restrictions', 'Declared once. Enforced everywhere.', 'profile')}

    <div class="eyebrow">Yours</div>
    <div class="chip-row" id="allergy-chips">
      ${RESTRICTION_OPTS.map(o => `<span class="chp ${RT.allergies.includes(o) ? 'on' : ''}" data-opt="${o}">${o}</span>`).join('')}
    </div>

    <div class="eyebrow">How the guardian works</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['camera', 'Every scan is checked', 'Meal photos and label scans are cross-checked against this list before anything logs.'],
        ['bell', 'Severe means loud', 'A severe conflict alerts you immediately and notifies your coach and parent. Preferences just warn you.'],
        ['users', 'Your coach carries it', `${S.coach.name}'s team sheet shows every athlete's restrictions for travel and team meals.`],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>

    <div style="height:16px"></div>
    <button class="btn primary" id="save-allergies">${icon('check', 18)} Save</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    root.querySelectorAll('#allergy-chips .chp').forEach(ch =>
      ch.addEventListener('click', () => ch.classList.toggle('on')));
    root.querySelector('#save-allergies').addEventListener('click', () => {
      const list = [...root.querySelectorAll('#allergy-chips .chp.on')].map(c => c.getAttribute('data-opt'));
      window.__act.saveAllergies(list);
      location.hash = '#profile';
    });
  },
};

/* ---------- #team-diet · Coach's team dietary sheet ---------- */
export const teamDiet = {
  nav: 'coach', tab: 'team',
  render() {
    const rows = [
      { n: 'J. Woods', r: RT.allergies.length ? RT.allergies : ['None declared'], sev: RT.allergies.some(a => a.includes('severe')) },
      { n: 'D. Okafor', r: ['Shellfish · severe'], sev: true },
      { n: 'M. Reyes', r: ['Vegetarian'], sev: false },
      { n: 'T. Boone', r: ['None declared'], sev: false },
      { n: 'K. Bell', r: ['Dairy'], sev: false },
      { n: 'A. Grant', r: ['Gluten', 'Eggs'], sev: false },
    ];
    return `
    ${backHead('Team Dietary Sheet', 'Every restriction, one screen. Travel-ready.', 'coach')}

    <section class="card" style="padding:6px 16px">
      ${rows.map(x => `
        <div class="lrow" style="cursor:default">
          <div class="lic" style="${x.sev ? 'background:var(--red-surface);color:var(--red)' : ''}">${icon(x.sev ? 'bell' : 'check', 16)}</div>
          <div class="lm"><div class="lt">${x.n}</div><div class="ls">${x.r.join(' · ')}</div></div>
          ${x.sev ? '<span class="status-pill" style="color:var(--red);border-color:var(--red-border)">Severe</span>' : ''}
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('bell', 17)}</div>
      <div><div class="tt">Two severe allergies on this roster</div>
      <div class="ts">Okafor (shellfish) and Woods (peanuts). Anyone ordering for the bus needs this screen, not a group-chat memory test.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #injury · Adaptive Standard / return-to-play ---------- */
export const injury = {
  tab: 'home',
  render() {
    const on = RT.injured;
    return `
    ${backHead('Injury Mode', on ? 'Right hamstring · week 2 of 4' : 'The Standard adapts when you are hurt', 'home')}

    ${on ? `
    <section class="card pad" style="border-color:var(--amber-border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:15px;font-weight:800">Return to play</div>
        <span class="status-pill a">Week 2 of 4</span>
      </div>
      <div class="finish-segs" style="margin-top:12px">
        <div class="fseg on"></div><div class="fseg on"></div><div class="fseg"></div><div class="fseg"></div>
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:10px">Cleared for non-contact. ${S.coach.name} and your athletic trainer see the same progress; nobody gets surprised on Friday.</div>
    </section>

    <div class="eyebrow">What changed in your Standard</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['bolt', 'Rehab replaces intensity', 'Band work 2×15 before practice, on your requirements list now.'],
        ['utensils', 'Nutrition tilts anti-inflammatory', 'Protein holds at 190g; add color, cut the fried stuff for two weeks.'],
        ['moon', 'Recovery counts double attention', 'Sleep is when tissue heals. Same +6, more coaching eyes on it.'],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>

    <div style="height:16px"></div>
    <button class="btn ghost" data-act="toggleInjury" data-then="home">Mark recovered · restore the Standard</button>`
    : `
    <div class="state-demo">
      <div class="sd-ic">${icon('bolt', 24)}</div>
      <div class="sd-t">No active injury</div>
      <div class="sd-s">When your athletic trainer flags one, your Standard adapts automatically: rehab tasks join the list, nutrition shifts to healing, and coach + AT watch the same return-to-play bar.</div>
      <div class="sd-cta"><button class="btn ghost sm" style="width:auto;padding:0 22px" data-act="toggleInjury" data-then="injury">Preview injury mode</button></div>
    </div>`}
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #partner · Peer accountability ---------- */
export const partner = {
  tab: 'home',
  render() {
    return `
    ${backHead('Accountability Partner', 'Paired by Coach Mark this month', 'home')}

    <section class="card pad" style="display:flex;align-items:center;gap:14px">
      <div class="big-av" style="width:52px;height:52px;background:linear-gradient(150deg,#34D399,#0d9488);font-size:17px">DO</div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">D. Okafor · WR</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--green-bright);margin-top:3px">Checked in today ✓ · 12-day streak</div>
      </div>
      ${RT.partnerNudged
        ? '<span class="status-pill g">Nudged ✓</span>'
        : `<button class="btn green sm" style="width:auto;padding:0 16px;height:40px" data-act="nudgePartner" data-then="partner">Nudge</button>`}
    </section>
    ${RT.partnerNudged ? '<div class="msg-status" style="display:block;text-align:center;margin-top:10px">Delivered · he gets one push: “Your partner is done for today.”</div>' : ''}

    <div class="eyebrow">The rules</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['check', 'You see one thing', 'Whether your partner finished today. Never his meals, weight, or score.'],
        ['bell', 'One nudge a day', 'If he is behind by 8 PM, you can send exactly one push. Pressure, rationed.'],
        ['users', 'Coach pairs, coach rotates', 'Pairs change monthly so it stays a push, not a clique.'],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #coach-voice · AI that sounds like YOUR coach ---------- */
export const coachVoice = {
  nav: 'coach', tab: 'profile',
  render() {
    return `
    ${backHead('AI · Your Voice', 'It reinforces your rulings. It never invents.', 'coach-profile')}

    <section class="card pad" style="display:flex;align-items:center;gap:14px">
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">Speak as Coach Mark</div>
        <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-top:2px">AI replies to your athletes borrow your phrasing.</div>
      </div>
      <div class="seg" style="width:104px" data-toggle-group><button class="on">On</button><button>Off</button></div>
    </section>

    <div class="eyebrow">Phrases it learned from you</div>
    <section class="card" style="padding:6px 16px">
      ${['That’s the standard.', 'Don’t chase the scale, we’re building.', 'Hydration is the standard this week.', 'Keep this structure.'].map(p => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon('message', 16)}</div>
          <div class="lm"><div class="lt" style="font-weight:700">“${p}”</div></div>
          <span class="status-pill g">In use</span>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Hard limits</div>
      <div class="ts">The AI only restates rulings you actually made, in words you actually use. New coaching always comes from you; it clarifies, it never leads.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) { const { wireToggles } = await import('./settings.js'); wireToggles(root); },
};

/* ---------- #safety · Protective pattern flags (design preview, deliberately not simulated) ---------- */
export const safety = {
  nav: 'coach', tab: 'team',
  render() {
    return `
    ${backHead('Wellness Flags', 'Protective, never punitive', 'coach')}

    <section class="card pad" style="border-color:var(--green-border)">
      <div style="display:flex;align-items:center;gap:13px">
        <div class="req-icon g" style="width:44px;height:44px">${icon('check', 20)}</div>
        <div><div style="font-size:15px;font-weight:800">No flags on your roster this week</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">That's the sentence you want to read here.</div></div>
      </div>
    </section>

    <div class="eyebrow">What it watches for</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['bars', 'Severe restriction patterns', 'Sustained intake far below any goal profile, or meals shrinking week over week.'],
        ['clock', 'Compulsive logging', 'Obsessive re-logging, deleting, and re-photographing the same meals.'],
        ['scale', 'Weight fixation', 'Off-schedule weigh-ins spiking, especially on a cut.'],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>

    <div class="eyebrow">What happens on a flag</div>
    <div class="sidebox" style="border-color:var(--purple-border)">
      <div class="req-icon p" style="width:38px;height:38px">${icon('heart', 17)}</div>
      <div><div class="tt">A quiet conversation, not a penalty</div>
      <div class="ts">Scoring pauses so the number can't feed the pattern. You and a parent get a private “worth a check-in” note with talking points. The athlete is never shamed, ranked, or flagged publicly.</div></div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:12px;padding:0 2px">Detection logic ships with the real backend and gets clinical review first. This screen commits the product to how it will behave.</div>
    <div style="height:10px"></div>
    `;
  },
};
