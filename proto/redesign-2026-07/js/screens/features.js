import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc } from '../components.js';

/* ============================================================
   The 11 approved ideas, made walkable. Live where possible,
   honestly framed as preview where the backend must exist first.
   ============================================================ */

/* ---------- #devices · Wearable-verified recovery ---------- */
export const devices = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Connected Devices', 'Wearable recovery is coming', 'profile')}

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--surface-2);color:var(--text-3)">${icon('moon', 17)}</div>
        <div class="lm"><div class="lt">Apple Watch</div><div class="ls">Not connected · coming soon</div></div>
        <span class="status-pill" style="color:var(--text-3)">Soon</span>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:var(--surface-2);color:var(--text-3)">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">Whoop</div><div class="ls">Not connected · coming soon</div></div>
        <span class="status-pill" style="color:var(--text-3)">Soon</span>
      </div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div><div class="tt">Honest about what v1 measures</div>
      <div class="ts">Recovery in v1 comes from your own check-in answers — nothing here reads your watch yet. When HealthKit and Whoop are wired, verified sleep/HRV will show up here. We won't fake hardware data until then.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #recruiting · The score as a recruiting asset ---------- */
export const recruiting = {
  tab: 'profile',
  render() {
    const P = S.progress;
    return `
    ${backHead('Discipline Record', 'Your real execution, yours to share', 'profile')}

    <section class="card pad" style="border-color:var(--green-border)">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon g" style="width:52px;height:52px;border-radius:16px">${icon('shield', 25)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">${esc([S.athlete.name, S.athlete.position].filter(Boolean).join(' · '))}</div>
          <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:3px">Your real execution record</div>
        </div>
      </div>
      ${P.hasHistory ? `
      <div class="macro-row" style="margin-top:16px">
        <div class="macro"><div class="mv" style="color:var(--green-bright)">${P.weekAvg}</div><div class="mk">Recent avg</div></div>
        ${P.monthConsistency != null ? `<div class="macro"><div class="mv">${P.monthConsistency}%</div><div class="mk">Consistency</div></div>` : ''}
        <div class="macro"><div class="mv" style="color:var(--amber-bright)">${P.bestStreak}d</div><div class="mk">Best streak</div></div>
      </div>` : `
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:14px">Your record builds as you log. A few days in, your real average, consistency, and best streak show up here.</div>`}
    </section>

    <div class="eyebrow">Why a recruiter cares</div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Film shows talent. This shows habits.</div>
      <div class="ts">Coach-verified daily execution is a signal no highlight reel carries: this athlete does the work when nobody claps.</div></div>
    </div>

    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('clock', 17)}</div>
      <div><div class="tt">Sharing coming soon</div>
      <div class="ts">Recruiter-shareable links land with the coach-verification backend. Your record is real and yours — nothing is public.</div></div>
    </div>
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
        ['bell', 'Severe means loud', 'A severe conflict warns you immediately, before the meal logs. Preferences just note it.'],
        ['users', 'Your coach carries it', `${S.coach.hasCoach ? esc(S.coach.name) + '’s' : 'Your coach’s'} team sheet shows every athlete's restrictions for travel and team meals.`],
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

/* ---------- #team-diet · Coach's team dietary sheet ----------
   HONEST: athletes' restriction declarations don't sync to the server yet, so a coach has no
   real data to show here. This is a safety surface — a coach could order team meals off it —
   so it must NEVER render invented allergies. Coming-soon until the sync exists. */
export const teamDiet = {
  nav: 'coach', tab: 'team',
  render() {
    return `
    ${backHead('Team Dietary Sheet', 'Every restriction, one screen. Travel-ready.', 'coach')}

    <div class="state-demo">
      <div class="sd-ic">${icon('bell', 24)}</div>
      <div class="sd-t">Declarations are coming</div>
      <div class="sd-s">When your athletes declare restrictions and allergies in their profile, every one of them lands here — severity-flagged, one screen, travel-ready. Nothing shows until it's their real declaration; a dietary sheet is the last place for placeholder data.</div>
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
    ${backHead('Injury Mode', on ? 'Your Standard adapts while you heal' : 'The Standard adapts when you are hurt', 'home')}

    ${on ? `
    <div class="eyebrow">What changed in your Standard</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['bolt', 'Rehab replaces intensity', 'Band work 2×15 before practice, on your requirements list now.'],
        ['utensils', 'Nutrition tilts anti-inflammatory', 'Protein stays on target; add color, cut the fried stuff while you heal.'],
        ['moon', 'Recovery counts double attention', 'Sleep is when tissue heals — Recovery stays 25% of your score, with more eyes on it.'],
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
    ${backHead('Accountability Partner', 'Coming soon', 'home')}

    <div class="state-demo">
      <div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">No partner yet</div>
      <div class="sd-s">When your coach pairs you with a teammate, you'll see whether they finished today (never their meals, weight, or score) and can send one nudge a day. There's no partner to show until then — we won't invent one.</div>
    </div>

    <div class="eyebrow">How it will work</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['check', 'You see one thing', 'Whether your partner finished today. Never their meals, weight, or score.'],
        ['bell', 'One nudge a day', 'If they are behind by 8 PM, you can send exactly one push. Pressure, rationed.'],
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
        <div style="font-size:15px;font-weight:800">Speak as ${esc(S.coachIdentity.name)}</div>
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
