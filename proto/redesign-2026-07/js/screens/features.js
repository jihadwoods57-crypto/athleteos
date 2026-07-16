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

/* ---------- #recruiting · Discipline Record (spec §17) ---------- */
export const recruiting = {
  tab: 'profile',
  render() {
    const P = S.progress;
    const hist = S.history; // newest first, real day rows
    const range = hist.length
      ? `${hist[hist.length - 1].date} – today`
      : 'Started today';
    const avgAll = hist.length
      ? Math.round((hist.reduce((a, h) => a + (h.score || 0), 0) + S.score) / (hist.length + 1))
      : S.score;
    const onPct = hist.length
      ? Math.round(([...hist.map(h => h.score), S.score].filter(s => s >= 80).length / (hist.length + 1)) * 100)
      : null;
    const verified = S.coach.hasCoach;
    return `
    ${backHead('Discipline Record', 'Your real execution, yours to share', 'profile')}

    <section class="card pad" style="border-color:${verified ? 'var(--green-border)' : 'var(--hairline)'}">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="req-icon ${verified ? 'g' : 'b'}" style="width:52px;height:52px;border-radius:16px">${icon('shield', 25)}</div>
        <div style="flex:1">
          <div style="font-size:17px;font-weight:800">${esc([S.athlete.name, S.athlete.position].filter(Boolean).join(' · '))}</div>
          <div style="font-size:12.5px;font-weight:600;color:${verified ? 'var(--green-bright)' : 'var(--text-3)'};margin-top:3px">
            ${verified ? `Verified by ${esc(S.coach.name)} · ${esc(range)}` : `Not verified yet · ${esc(range)}`}</div>
        </div>
      </div>
      ${P.daysLogged > 0 ? `
      <div class="macro-row" style="margin-top:16px">
        <div class="macro"><div class="mv">${P.daysLogged}</div><div class="mk">Days tracked</div></div>
        <div class="macro"><div class="mv" style="color:var(--green-bright)">${avgAll}</div><div class="mk">Avg score</div></div>
        ${onPct != null ? `<div class="macro"><div class="mv">${onPct}%</div><div class="mk">On standard</div></div>` : ''}
      </div>
      <div class="macro-row" style="margin-top:8px">
        <div class="macro"><div class="mv" style="color:var(--amber-bright)">${P.bestStreak}d</div><div class="mk">Best streak</div></div>
        <div class="macro"><div class="mv" style="color:var(--amber-bright)">${S.streakDays}d</div><div class="mk">Current streak</div></div>
        ${P.weekAvg != null ? `<div class="macro"><div class="mv">${P.weekAvg}</div><div class="mk">Recent avg</div></div>` : ''}
      </div>` : `
      <div style="font-size:13px;font-weight:600;color:var(--text-2);margin-top:14px">Your record builds as you log. A few days in, your real average, consistency, and streaks show up here.</div>`}
    </section>

    ${verified ? '' : `
    <div class="sidebox" style="margin-top:12px">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Not verified yet</div>
      <div class="ts">Connect a coach to begin building a verified record — verification means a real coach watches the same numbers.</div>
      <div style="margin-top:8px"><button class="btn ghost sm" data-go="connect" style="width:auto;padding:0 18px">Connect a coach</button></div></div>
    </div>`}

    <div class="eyebrow">Why a recruiter cares</div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('bars', 17)}</div>
      <div><div class="tt">Film shows talent. This shows habits.</div>
      <div class="ts">Verified daily execution is a signal no highlight reel carries: this athlete does the work when nobody claps.</div></div>
    </div>

    <div style="height:16px"></div>
    <div class="sidebox">
      <div class="req-icon g" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Private by default</div>
      <div class="ts">Nothing here is public and nothing is shared unless you explicitly share it. You control who ever sees this record.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- #restrictions · Food restrictions & allergies (spec §18) ----------
   Three SEPARATE data types — allergies (with per-allergen severity), intolerances, and
   dietary preferences — never one undifferentiated chip list. Custom entries allowed in
   every section. Selected state is unmistakable (filled chip + check). Safety copy never
   claims guaranteed detection. Structured data lives in RT.restrictions; the flat
   RT.allergies summary list keeps every existing consumer (meal guardian, profile row)
   working unchanged. */
const ALLERGY_OPTS = ['Peanuts', 'Tree nuts', 'Shellfish', 'Eggs', 'Fish', 'Soy', 'Wheat', 'Sesame'];
const INTOLERANCE_OPTS = ['Dairy', 'Gluten', 'Caffeine'];
const PREFERENCE_OPTS = ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Pescatarian'];

function currentRestrictions() {
  const r = RT.restrictions;
  if (r && typeof r === 'object') {
    return {
      allergies: Array.isArray(r.allergies) ? r.allergies : [],
      intolerances: Array.isArray(r.intolerances) ? r.intolerances : [],
      preferences: Array.isArray(r.preferences) ? r.preferences : [],
    };
  }
  // Legacy migration: old flat strings like "Peanuts · severe" / "Dairy" / "Vegetarian".
  const out = { allergies: [], intolerances: [], preferences: [] };
  for (const s of RT.allergies || []) {
    const name = String(s).split('·')[0].trim();
    const severe = /severe/i.test(String(s));
    if (PREFERENCE_OPTS.includes(name)) out.preferences.push(name);
    else if (INTOLERANCE_OPTS.includes(name)) out.intolerances.push(name);
    else out.allergies.push({ name, severity: severe ? 'severe' : 'moderate' });
  }
  return out;
}

export const restrictions = {
  tab: 'profile',
  render() {
    const R = currentRestrictions();
    const has = (arr, n) => arr.some((x) => (x.name || x) === n);
    const sevOf = (n) => { const a = R.allergies.find((x) => x.name === n); return a ? a.severity : 'severe'; };
    const chip = (n, on) => `<span class="chp rx-chip ${on ? 'on' : ''}" data-name="${esc(n)}">${on ? '✓ ' : ''}${esc(n)}</span>`;
    const customs = (arr, opts) => arr.map((x) => x.name || x).filter((n) => !opts.includes(n));
    return `
    ${backHead('Food Restrictions', 'Allergies, intolerances, and preferences — kept separate', 'profile')}

    <div class="eyebrow">Allergies · medical, taken seriously</div>
    <div class="chip-row" id="rx-allergies">
      ${[...ALLERGY_OPTS, ...customs(R.allergies, ALLERGY_OPTS)].map((n) => chip(n, has(R.allergies, n))).join('')}
    </div>
    <div id="rx-severity"></div>
    <div class="rx-add"><input class="input" id="rx-add-allergy" maxlength="30" placeholder="Add another allergen…" /><button class="btn ghost sm rx-add-btn" data-add="allergy">Add</button></div>

    <div class="eyebrow">Intolerances</div>
    <div class="chip-row" id="rx-intolerances">
      ${[...INTOLERANCE_OPTS, ...customs(R.intolerances, INTOLERANCE_OPTS)].map((n) => chip(n, R.intolerances.includes(n))).join('')}
    </div>
    <div class="rx-add"><input class="input" id="rx-add-intolerance" maxlength="30" placeholder="Add an intolerance…" /><button class="btn ghost sm rx-add-btn" data-add="intolerance">Add</button></div>

    <div class="eyebrow">Dietary preferences</div>
    <div class="chip-row" id="rx-preferences">
      ${[...PREFERENCE_OPTS, ...customs(R.preferences, PREFERENCE_OPTS)].map((n) => chip(n, R.preferences.includes(n))).join('')}
    </div>
    <div class="rx-add"><input class="input" id="rx-add-preference" maxlength="30" placeholder="Add a preference…" /><button class="btn ghost sm rx-add-btn" data-add="preference">Add</button></div>

    <div class="eyebrow">How checking works</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['camera', 'Detected foods are compared', 'The app compares detected foods and label entries with your saved restrictions. Detection may miss ingredients, preparation methods, or cross-contact.'],
        ['bell', 'Severe allergies warn loudest', 'A possible severe-allergen conflict warns you before you confirm the log — it names the allergen and tells you what it can’t be sure of.'],
        ['shield', 'Always verify severe allergens yourself', 'This never replaces reading labels, asking staff, or medical guidance. Treat every severe allergen as unverified until you check it.'],
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
    // Live severity panel for selected allergies (severe = loud warning; moderate = note).
    const R = currentRestrictions();
    const severity = {};
    R.allergies.forEach((a) => { severity[a.name] = a.severity || 'severe'; });
    const sevPanel = root.querySelector('#rx-severity');
    const paintSeverity = () => {
      const on = [...root.querySelectorAll('#rx-allergies .chp.on')].map((c) => c.getAttribute('data-name'));
      sevPanel.innerHTML = on.length ? `<section class="card" style="padding:4px 14px;margin-top:8px">${on.map((n) => `
        <div class="lrow" style="cursor:default">
          <div class="lm"><div class="lt" style="font-size:13px">${esc(n)}</div></div>
          <div class="seg" style="width:170px" data-sev="${esc(n)}">
            <button class="${(severity[n] || 'severe') === 'severe' ? 'on' : ''}">Severe</button>
            <button class="${(severity[n] || 'severe') === 'moderate' ? 'on' : ''}">Moderate</button>
          </div>
        </div>`).join('')}</section>` : '';
      sevPanel.querySelectorAll('[data-sev]').forEach((seg) => {
        const name = seg.getAttribute('data-sev');
        const [sv, md] = seg.querySelectorAll('button');
        sv.addEventListener('click', () => { severity[name] = 'severe'; sv.classList.add('on'); md.classList.remove('on'); });
        md.addEventListener('click', () => { severity[name] = 'moderate'; md.classList.add('on'); sv.classList.remove('on'); });
      });
    };
    const wireChip = (ch) => ch.addEventListener('click', () => {
      ch.classList.toggle('on');
      const on = ch.classList.contains('on');
      ch.textContent = `${on ? '✓ ' : ''}${ch.getAttribute('data-name')}`;
      if (ch.closest('#rx-allergies')) paintSeverity();
    });
    root.querySelectorAll('.rx-chip').forEach(wireChip);
    paintSeverity();
    // Custom entries (spec §18.5): add to the right section, pre-selected.
    root.querySelectorAll('.rx-add-btn').forEach((btn) => btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-add');
      const input = root.querySelector(`#rx-add-${kind}`);
      const name = (input.value || '').trim().slice(0, 30);
      if (!name) return;
      input.value = '';
      const wrap = root.querySelector(kind === 'allergy' ? '#rx-allergies' : kind === 'intolerance' ? '#rx-intolerances' : '#rx-preferences');
      if ([...wrap.querySelectorAll('.chp')].some((c) => c.getAttribute('data-name').toLowerCase() === name.toLowerCase())) return;
      wrap.insertAdjacentHTML('beforeend', `<span class="chp rx-chip on" data-name="${esc(name)}">✓ ${esc(name)}</span>`);
      wireChip(wrap.lastElementChild);
      if (kind === 'allergy') paintSeverity();
    }));
    root.querySelector('#save-allergies').addEventListener('click', () => {
      const names = (sel) => [...root.querySelectorAll(`${sel} .chp.on`)].map((c) => c.getAttribute('data-name'));
      const structured = {
        allergies: names('#rx-allergies').map((n) => ({ name: n, severity: severity[n] || 'severe' })),
        intolerances: names('#rx-intolerances'),
        preferences: names('#rx-preferences'),
      };
      window.__act.saveRestrictions(structured);
      window.__back('profile');
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

/* ---------- #injury · Injury Mode (spec §19): role boundaries enforced ----------
   The ATHLETE reports pain or an injury concern (that's the real action here — it adapts
   the local Standard and flags the report). Medical restrictions and clearance belong to
   an authorized athletic trainer or medical professional; the coach sees participation
   status, never a diagnosis. Copy states each boundary explicitly. */
export const injury = {
  tab: 'home',
  render() {
    const on = RT.injured;
    return `
    ${backHead('Injury Mode', on ? 'Your Standard adapts while you heal' : 'Report it — your Standard adapts', 'home')}

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
    <button class="btn ghost" data-act="toggleInjury" data-then="__back:home">I'm cleared · restore the Standard</button>`
    : `
    <section class="card pad">
      <div style="font-size:15.5px;font-weight:800">Hurt, or worried you might be?</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Report it. Your Standard adapts — rehab joins your list and nutrition shifts to healing — and the right people see the right things.</div>
      <button class="btn primary sm" data-act="toggleInjury" data-then="injury" style="margin-top:12px;width:auto;padding:0 22px">${icon('bolt', 16)} Report an injury or pain</button>
    </section>`}

    <div class="eyebrow">Who does what</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['user', 'You report', 'Pain or an injury concern — that’s your part. Reporting is never punished.'],
        ['heart', 'Medical decides', 'An authorized athletic trainer or medical professional manages restrictions and clearance. Return-to-play is theirs, not an app setting.'],
        ['users', 'Coach sees participation', 'Your coach sees your participation status and adapted Standard — not a diagnosis, and they never medically clear you.'],
      ].map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>

    <div style="height:12px"></div>
    <div class="sidebox">
      <div class="req-icon p" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Who can see injury details</div>
      <div class="ts">Your report goes to your athletic trainer and coach connection only. Teammates never see it. If something feels urgent — severe pain, a head injury, numbness — tell an adult and get care first; the app comes second.</div></div>
    </div>
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
        <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-top:2px">AI replies to your athletes will borrow your phrasing.</div>
      </div>
      <span class="status-pill a" style="flex:none">Preview</span>
    </section>

    <div class="eyebrow">Phrases it will reinforce</div>
    <section class="card" style="padding:6px 16px">
      ${['That’s the standard.', 'Don’t chase the scale, we’re building.', 'Hydration is the standard this week.', 'Keep this structure.'].map(p => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon('message', 16)}</div>
          <div class="lm"><div class="lt" style="font-weight:700">“${p}”</div></div>
          <span class="status-pill" style="color:var(--text-3);border-color:var(--hairline)">Example</span>
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
